"""
docx-audit Worker — iii 注册入口

三大原语:
  Worker  = 本进程（连接引擎并注册能力）
  Function = docx::* 系列
  Trigger  = HTTP POST /audit、队列 docx-audit-jobs、CLI iii trigger
"""
from __future__ import annotations

import os
from pathlib import Path

# ── OTel 可观测性（withSpan 包裹审核步骤）──
from opentelemetry import trace as otel_trace
from opentelemetry.trace import SpanKind

from .models import III_ENGINE_URL, LLM_API_KEY, issues_to_dicts, REPORTS_DIR
from .parse import fn_parse
from .static_checks import (
    fn_check_ai_traces,
    fn_check_heading_comments,
    fn_check_paragraph_comments,
    fn_check_table_refs_static,
)
from .agent_checks import (
    fn_check_paragraph_quality,
    fn_check_table_refs_agent,
)
from .report import fn_generate_report
from .config_functions import fn_config_get, fn_config_set

# 浏览器注册的进度推送 Function（后端 fire-and-forget 触发，引擎经 WebSocket 推到浏览器）
UI_PROGRESS_FN = "docx::ui_progress"


# ── 错误处理策略 ───────────────────────────────────────────

import httpx as _httpx

# 可重试错误：网络类 → Queue 重试
_RETRYABLE = (
    _httpx.TimeoutException,
    _httpx.ConnectError,
    _httpx.RemoteProtocolError,
    ConnectionError,
    OSError,
    TimeoutError,
)

# 不可重试错误：数据/权限类 → 标记 job 失败
_FAILABLE = (
    PermissionError,
    FileNotFoundError,
    ValueError,
    KeyError,
    TypeError,
)


async def _handle_error(iii, job_id: str, e: Exception, context: str = "") -> str:
    """
    统一错误处理入口。
    返回动作: "retry" | "failed" | "ignored"
    """
    from pathlib import Path as _Path
    import time as _time

    if isinstance(e, _RETRYABLE):
        # 可重试：记日志后抛出，让 Queue 重试
        await _emit_log(iii, "warning", f"[retry] {context}: {str(e)[:150]}", {
            "job_id": job_id, "error_type": type(e).__name__,
        })
        raise

    # 不可重试：标记 job 失败
    error_msg = f"{type(e).__name__}: {str(e)[:180]}"
    try:
        if iii is not None:
            await iii.trigger_async({
                "function_id": "state::update",
                "payload": {
                    "scope": "docx-audit-jobs", "key": job_id,
                    "ops": [
                        {"type": "set", "path": "step", "value": "failed"},
                        {"type": "set", "path": "error", "value": error_msg},
                    ],
                },
            })
    except Exception:
        pass  # state 更新失败不抛出，避免掩盖原始错误

    await _emit_log(iii, "error", f"[failed] {context}: {error_msg}", {
        "job_id": "job_id", "error_type": type(e).__name__,
    })
    return "failed"


# ── 辅助 ─────────────────────────────────────────────────

def _build_parse_payload(path, file_bytes):
    """根据输入形态构造 docx::parse 的 payload。"""
    if file_bytes is not None:
        import base64
        return {"content": base64.b64encode(file_bytes).decode("ascii")}
    return {"path": path}


async def _read_channel_bytes(iii, channel_ref: dict) -> bytes:
    """从 iii Channel reader 读取全部字节。

    channel_ref 是 StreamChannelRef 字典，含 access_key/channel_id/direction。
    直接连接 reader 端的 WebSocket 端点，读取全部二进制帧。
    """
    import asyncio

    # channel_ref 可能是 dict，也可能已被 SDK materialize 为 ChannelReader 对象
    if hasattr(channel_ref, "read_all"):
        # 已是 materialized ChannelReader —— 用 read_all() 协程读取
        return await _read_from_reader(channel_ref)

    if not isinstance(channel_ref, dict):
        return b""

    # dict 形态：构造 reader WebSocket URL 直连读取
    channel_id = channel_ref.get("channel_id")
    access_key = channel_ref.get("access_key")
    if not channel_id or not access_key:
        raise ValueError(f"channel_ref missing fields: {list(channel_ref.keys())}")
    engine_url = III_ENGINE_URL.replace("wss://", "ws://").rstrip("/")
    channel_url = f"{engine_url}/ws/channels/{channel_id}?key={access_key}&dir=read"

    try:
        from iii.channels import ReadableStream
    except Exception:
        ReadableStream = None

    loop = asyncio.get_event_loop()

    # 用线程跑同步 websocket-client 读取，避免阻塞事件 loop
    def _read_sync():
        import websocket
        ws = websocket.create_connection(channel_url)
        chunks = []
        try:
            while True:
                data = ws.recv()
                if isinstance(data, (bytes, bytearray)):
                    chunks.append(bytes(data))
                # 字符串帧通常是控制消息，忽略
        except Exception:
            pass
        ws.close()
        return b"".join(chunks)

    try:
        data = await loop.run_in_executor(None, _read_sync)
        return data
    except Exception as e:
        raise ValueError(f"channel read failed: {e}")


async def _read_from_reader(reader) -> bytes:
    """从已 materialize 的 ChannelReader 异步读取全部字节。"""
    data = await reader.read_all()
    if isinstance(data, (bytes, bytearray)):
        return bytes(data)
    # 某些 SDK 版本返回 list[bytes]
    if isinstance(data, list):
        return bytes(b for c in data for b in (c if isinstance(c, (bytes, bytearray)) else [c]))
    return b""


# ── 编排 Function：docx::audit ────────────────────────────

async def fn_audit(payload: dict, iii=None) -> dict:
    """
    Function: docx::audit — 全流程编排

    Input（三种输入方式，优先级从高到低）:
      {
        "channel_ref": { "access_key", "channel_id", "direction: "read" }
        # ↑ 流式输入：浏览器通过 iii Channel 上传文件（推荐大文件）

        "content": "<base64 docx bytes>",     # base64 内联（小文件）
        "path": "/path/to/doc.docx",          # 文件路径（worker 能访问文件系统时）

        "output_path": "...",                 # 可选
        "filename": "...",                    # 可选，channel/content 模式下的显示名
        "use_llm": true,                      # 默认 true
        "check_comments": true                # 默认 true
      }

    通过 iii.trigger 调用下游 Function（同 Worker 内也可直接 await）。
    有 iii 客户端时走引擎路由（可观测、跨语言）；否则进程内直调。
    """
    import base64

    path = payload.get("path") or payload.get("input_path")
    content_b64 = payload.get("content")
    channel_ref = payload.get("channel_ref")

    # 解析输入：channel > content > path
    file_bytes = None
    display_name = path
    if channel_ref and iii is not None:
        try:
            file_bytes = await _read_channel_bytes(iii, channel_ref)
        except Exception as e:
            return {"error": f"channel read failed: {e}", "ok": False}
        display_name = payload.get("filename") or f"channel_{len(file_bytes)}_bytes.docx"
    elif content_b64:
        try:
            file_bytes = base64.b64decode(content_b64)
        except Exception as e:
            return {"error": f"invalid base64 content: {e}", "ok": False}
        display_name = payload.get("filename") or f"uploaded_{len(file_bytes)}_bytes.docx"
    elif path:
        if not os.path.exists(path):
            return {"error": f"file not found: {path}", "ok": False}
        display_name = path
    else:
        return {"error": "missing path, content, or channel_ref", "ok": False}

    use_llm = payload.get("use_llm", True)
    check_comments = payload.get("check_comments", True)
    output_path = payload.get("output_path")
    if not output_path:
        if path:
            base = os.path.splitext(path)[0]
            output_path = f"{base}_audit_report.docx"
        else:
            output_path = "/tmp/docx-audit-report.docx"

    async def call(function_id: str, body: dict) -> dict:
        """优先经引擎 trigger，保证 trace；无 iii 时进程内直调。

        注意：fn_audit 本身是 async handler，在事件 loop 线程内运行，
        因此经引擎路由时必须用 trigger_async，不能调用同步 trigger()。
        """
        if iii is not None:
            return await iii.trigger_async({"function_id": function_id, "payload": body})
        # 进程内 fallback（本地调试 / 单测）
        dispatch = {
            "docx::parse": fn_parse,
            "docx::check_ai_traces": fn_check_ai_traces,
            "docx::check_heading_comments": fn_check_heading_comments,
            "docx::check_paragraph_comments": fn_check_paragraph_comments,
            "docx::check_table_refs_static": fn_check_table_refs_static,
            "docx::check_table_refs_agent": fn_check_table_refs_agent,
            "docx::check_paragraph_quality": fn_check_paragraph_quality,
            "docx::generate_report": fn_generate_report,
        }
        fn = dispatch.get(function_id)
        if not fn:
            return {"error": f"unknown function {function_id}"}
        return await fn(body)

    print("=" * 60)
    print("  文生文文档审核（iii Worker）")
    print("=" * 60)

    # 1. 解析
    print(f"\n[1/4] 解析文档: {display_name}")
    parse_payload = _build_parse_payload(path, file_bytes)
    parsed = await call("docx::parse", parse_payload)
    if parsed.get("error"):
        return {**parsed, "ok": False}
    elements = parsed["elements"]
    stats = parsed.get("stats", {})
    print(
        f"  段落: {stats.get('paragraphs', 0)}  "
        f"标题: {stats.get('headings', 0)}  "
        f"表格: {stats.get('tables', 0)}"
    )

    all_issues: list[dict] = []

    # 2. 静态检查
    print("\n[2/4] 静态检查...")
    r = await call("docx::check_ai_traces", {"elements": elements})
    all_issues.extend(r.get("issues") or [])
    print(f"  AI 痕迹: {r.get('count', 0)} 个")

    if check_comments:
        r = await call("docx::check_heading_comments", {"elements": elements})
        all_issues.extend(r.get("issues") or [])
        print(f"  标题含批注: {r.get('count', 0)} 个")

        r = await call("docx::check_paragraph_comments", {"elements": elements})
        all_issues.extend(r.get("issues") or [])
        print(f"  段落缺批注: {r.get('count', 0)} 个")
    else:
        print("  批注检测已跳过")

    r = await call("docx::check_table_refs_static", {"elements": elements})
    all_issues.extend(r.get("issues") or [])
    print(f"  有表名无表格(预检): {r.get('count', 0)} 个")

    # 3. Agent 检查
    # Agent 检查：agent_checks.py 内部通过 config_store.get() 实时读取 LLM 配置，
    # 前端写入 config.json 后即刻生效，无需重启 worker。
    if use_llm:
        print("\n[3/4] Agent 检查...")
        print("  [3.1] 表格引用检测 Agent...")
        r = await call("docx::check_table_refs_agent", {"elements": elements})
        all_issues.extend(r.get("issues") or [])
        print(f"    有表名无表格: {r.get('count', 0)} 个")

        print("  [3.2] 段落质量检测 Agent...")
        r = await call("docx::check_paragraph_quality", {"elements": elements})
        all_issues.extend(r.get("issues") or [])
        print(f"    段落语言质量: {r.get('count', 0)} 个")
    else:
        print("\n[3/4] 跳过 Agent 检查（use_llm=false）")

    # 4. 报告
    print(f"\n[4/4] 生成报告: {output_path}")
    source_name = Path(path).name if path else display_name
    report = await call(
        "docx::generate_report",
        {
            "elements": elements,
            "issues": all_issues,
            "output_path": output_path,
            "source_name": source_name,
        },
    )

    errs = report.get("errors", 0)
    warns = report.get("warnings", 0)
    total = report.get("total", len(all_issues))
    print("\n" + "=" * 60)
    print(f"  审核完成!  共 {total} 个问题  (ERROR: {errs}, WARNING: {warns})")
    print(f"  报告: {report.get('report_path', output_path)}")
    print("=" * 60)

    # 提取当前 trace_id（供前端跳转 iii Console）
    trace_id = _current_trace_id()

    return {
        "ok": True,
        "path": path,
        "stats": stats,
        "issues": all_issues,
        "report": report,
        "summary": {"total": total, "errors": errs, "warnings": warns},
        "trace_id": trace_id,
    }


def _current_trace_id() -> str | None:
    """从当前 OTel context 提取 trace_id（供前端关联 iii Console）。"""
    try:
        from opentelemetry import context as otel_context, propagate

        carrier = {}
        propagate.inject(carrier, context=otel_context.get_current())
        traceparent = carrier.get("traceparent", "")
        # 格式: 00-{trace_id}-{span_id}-01
        parts = traceparent.split("-")
        return parts[1] if len(parts) >= 2 and parts[1] else None
    except Exception:
        return None


# ── 子步骤（供 withSpan 包裹）────────────────────────────────

async def _do_parse(iii, path, file_bytes):
    """解析 docx → (elements, stats)，失败返回 (None, None)。"""
    parse_result = await _call_trigger_or_local(iii, "docx::parse",
        _build_parse_payload(path, file_bytes))
    if parse_result.get("error"):
        return None, None
    return parse_result["elements"], parse_result.get("stats", {})


async def _do_static_checks(iii, elements, check_comments):
    """执行静态规则检查，返回 issues 列表。"""
    issues: list[dict] = []
    r = await _call_trigger_or_local(iii, "docx::check_ai_traces", {"elements": elements})
    issues.extend(r.get("issues") or [])
    if check_comments:
        r = await _call_trigger_or_local(iii, "docx::check_heading_comments", {"elements": elements})
        issues.extend(r.get("issues") or [])
        r = await _call_trigger_or_local(iii, "docx::check_paragraph_comments", {"elements": elements})
        issues.extend(r.get("issues") or [])
    r = await _call_trigger_or_local(iii, "docx::check_table_refs_static", {"elements": elements})
    issues.extend(r.get("issues") or [])
    return issues


# ── L1 同步接单：audit_start ────────────────────────────────
# 只负责 parse + 静态检查 + 拆批入队，秒级返回。
# Agent 长工作在 Queue 里异步跑，前端通过 audit_status 轮询。

async def fn_audit_start(payload: dict, iii=None) -> dict:
    """
    Function: docx::audit_start — 同步接单，秒级返回。

    Input: 同 fn_audit（path / content / channel_ref / use_llm / check_comments）
    Output:
      {
        "job_id": "job-...",
        "trace_id": "...",
        "ok": true,
        "static_issues": [...],       // 静态检查发现的问题
        "stats": { paragraphs, headings, tables },
        "agent_enqueued": 6,          // 入队的 Agent 批次数（0=无需 Agent）
        "agent_total_paras": 90       // 参与 Agent 检查的段落数
      }
    """
    import base64
    import time

    path = payload.get("path") or payload.get("input_path")
    content_b64 = payload.get("content")
    channel_ref = payload.get("channel_ref")
    use_llm = payload.get("use_llm", True)
    check_comments = payload.get("check_comments", True)
    filename = payload.get("filename") or "audit"

    # 优先使用前端传入的 job_id，确保推送到达时前端 job 已存在
    pre_job_id = payload.get("job_id") or ""

    # 解析输入
    file_bytes = None
    display_name = path
    if channel_ref and iii is not None:
        try:
            file_bytes = await _read_channel_bytes(iii, channel_ref)
        except Exception as e:
            return {"error": f"channel read failed: {e}", "ok": False}
        display_name = filename or f"channel_{len(file_bytes)}_bytes.docx"
    elif content_b64:
        try:
            file_bytes = base64.b64decode(content_b64)
        except Exception as e:
            return {"error": f"invalid base64 content: {e}", "ok": False}
        display_name = filename or f"uploaded_{len(file_bytes)}_bytes.docx"
    elif path:
        if not os.path.exists(path):
            return {"error": f"file not found: {path}", "ok": False}
        display_name = path
    else:
        return {"error": "missing path, content, or channel_ref", "ok": False}

    # ── Step 1: 解析（OTel span: audit.parse）──
    elements, stats = await _with_span("audit.parse", {"filename": display_name}, lambda: _do_parse(iii, path, file_bytes))
    if elements is None:
        return {"error": "parse failed", "ok": False}

    # 推送：解析完成（前端 UI 用）
    await _push_progress(iii, {
        "job_id": pre_job_id, "step": "accepted", "done_batches": 0, "total_batches": 0,
        "activity": {"type": "parse", "message": f"文档解析完成: {stats.get('paragraphs', 0)}段落 {stats.get('headings', 0)}标题", "at": int(time.time()*1000)},
    })

    # ── Step 2: 静态检查（OTel span: audit.static_checks）──
    static_issues = await _with_span("audit.static_checks", {"use_comments": check_comments}, lambda: _do_static_checks(iii, elements, check_comments))

    # 推送：静态检查完成
    await _push_progress(iii, {
        "job_id": pre_job_id, "step": "accepted", "done_batches": 0, "total_batches": 0,
        "activity": {"type": "static_check", "message": f"静态检查完成，发现 {len(static_issues)} 个问题", "at": int(time.time()*1000)},
    })

    # 3. 创建 job 并入队 Agent 批次（优先使用前端传入的 job_id）
    job_id = pre_job_id or f"job-{int(time.time() * 1000)}-{__import__('random').randint(1000, 9999)}"
    trace_id = _current_trace_id()

    # 收集需要 Agent 检查的段落（≥20 字）
    agent_paras = [
        el for el in elements
        if el["kind"] == "paragraph" and len(el.get("text", "")) >= 20
    ] if use_llm else []

    agent_enqueued = 0
    batch_size = 15
    # 初始状态（无论是否走 Agent 都写入，便于前端 audit_status 轮询）
    await _call_trigger_or_local(iii, "state::set", {
        "scope": "docx-audit-jobs",
        "key": job_id,
        "value": {
            "job_id": job_id,          # 冗余存储，便于 trace 关联与调试
            "step": "agent_running",
            "trace_id": trace_id,
            "filename": display_name,
            "stats": stats,
            "static_issues": static_issues,
            "total_batches": 0,
            "done_batches": 0,
            "total_paras": len(agent_paras),
            "agent_issues": [],
            "issue_count": len(static_issues),
            "report_path": None,
            "error": None,
            "batch_ok": [],   # 已完成的批次索引（顶层键，支持 append）
        },
    })

    # 结构化日志：接单完成
    await _emit_log(iii, "info", f"审核接单完成: {display_name}", {
        "job_id": job_id, "static_issues": len(static_issues),
        "agent_paras": len(agent_paras), "filename": display_name,
    })

    if agent_paras and iii is not None and _get_llm_key():
        batches = [agent_paras[i:i + batch_size] for i in range(0, len(agent_paras), batch_size)]
        total_batches = len(batches)
        # 更新 total_batches
        await _call_trigger_or_local(iii, "state::update", {
            "scope": "docx-audit-jobs",
            "key": job_id,
            "ops": [{"type": "set", "path": "total_batches", "value": total_batches}],
        })
        # 入队各批次
        for batch_index, batch in enumerate(batches):
            await iii.trigger_async({
                "function_id": "docx::quality_batch",
                "payload": {
                    "job_id": job_id,
                    "batch_index": batch_index,
                    "elements": batch,
                    "filename": display_name,
                },
                "action": __import__("iii", fromlist=["TriggerAction"]).TriggerAction.Enqueue(queue="default"),
            })
            agent_enqueued += 1
        # 推送：入队完成，等待消费
        await _push_progress(iii, {
            "job_id": job_id, "step": "agent_running",
            "done_batches": 0, "total_batches": total_batches,
            "total_paras": len(agent_paras), "issue_count": len(static_issues),
            "activity": {"type": "queue_wait", "message": f"已入队 {total_batches} 个 Agent 批次，等待消费…", "at": int(time.time()*1000)},
        })
    else:
        # 无 Agent 检查（use_llm=false / 无 key / 无段落）→ 直接 finalize 出报告
        if iii is not None:
            await iii.trigger_async({
                "function_id": "docx::quality_finalize",
                "payload": {"job_id": job_id, "filename": display_name},
                "action": __import__("iii", fromlist=["TriggerAction"]).TriggerAction.Enqueue(queue="default"),
            })
            await _push_progress(iii, {
                "job_id": job_id, "step": "agent_running",
                "done_batches": 0, "total_batches": 0,
                "total_paras": 0, "issue_count": len(static_issues),
            })

    return {
        "job_id": job_id,
        "trace_id": trace_id,
        "ok": True,
        "static_issues": static_issues,
        "stats": stats,
        "agent_enqueued": agent_enqueued,
        "agent_total_paras": len(agent_paras),
    }


async def _call_trigger_or_local(iii, function_id: str, body: dict) -> dict:
    """有 iii 走引擎 trigger（可观测）；否则进程内直调。"""
    if iii is not None:
        return await iii.trigger_async({"function_id": function_id, "payload": body})
    # 本地 fallback
    from . import static_checks, agent_checks
    from .parse import fn_parse
    dispatch = {
        "docx::parse": fn_parse,
        "docx::check_ai_traces": static_checks.fn_check_ai_traces,
        "docx::check_heading_comments": static_checks.fn_check_heading_comments,
        "docx::check_paragraph_comments": static_checks.fn_check_paragraph_comments,
        "docx::check_table_refs_static": static_checks.fn_check_table_refs_static,
        "docx::check_table_refs_agent": agent_checks.fn_check_table_refs_agent,
        "docx::check_paragraph_quality": agent_checks.fn_check_paragraph_quality,
    }
    fn = dispatch.get(function_id)
    if not fn:
        return {"error": f"unknown function {function_id}"}
    return await fn(body)


# ── L2 Queue 消费者：quality_batch ──────────────────────────

async def fn_quality_batch(payload: dict, iii=None) -> dict:
    """Function: docx::quality_batch — 一批段落的 Agent 语言质量检查。
    仅由 Queue(audit-agent) 触发。1 次 API 调用处理 10-20 段落。
    Queue 触发的 function 没有 iii 客户端注入，需自建连接读 state。"""
    import time as _time
    job_id = payload.get("job_id", "")
    batch_index = payload.get("batch_index", 0)
    elements = payload.get("elements") or []
    if isinstance(elements, str):
        import json
        try:
            elements = json.loads(elements)
        except Exception:
            elements = []

    # Queue consumer 自建 iii 客户端（用于读 state）
    local_iii = iii
    if local_iii is None:
        local_iii = _make_state_client()

    # 幂等检查：该批次是否已完成
    if local_iii is not None:
        try:
            existing = await local_iii.trigger_async({
                "function_id": "state::get",
                "payload": {"scope": "docx-audit-jobs", "key": job_id},
            })
            if existing and isinstance(existing, dict):
                # 幂等检查：该批次是否已完成（batch_ok 是顶层数组）
                batch_ok = existing.get("batch_ok", [])
                if batch_ok and batch_index in batch_ok:
                    return {"job_id": job_id, "batch_index": batch_index, "issues": [], "skipped": True}
        except Exception:
            pass

    # 推送：LLM 调用前
    _total_batches = 0
    if local_iii is not None:
        try:
            _st = await local_iii.trigger_async({
                "function_id": "state::get",
                "payload": {"scope": "docx-audit-jobs", "key": job_id},
            })
            _total_batches = _st.get("total_batches", 0) if isinstance(_st, dict) else 0
        except Exception:
            pass
    await _push_progress(local_iii, {
        "job_id": job_id, "step": "agent_running",
        "done_batches": 0, "total_batches": _total_batches,
        "activity": {"type": "agent_call", "message": f"正在检测第 {batch_index+1}/{_total_batches or '?'} 批段落语言质量", "at": int(_time.time()*1000)},
        "llm_calls": {"batch_index": batch_index, "total_batches": _total_batches, "started_at": int(_time.time()*1000), "model": "DeepSeek-V3.2"},
    })

    # ── Agent 质检（OTel span: audit.agent_quality）──
    from .agent_checks import check_paragraph_quality_agent
    try:
        issues = await _with_span("audit.agent_quality",
            {"batch_index": batch_index, "total_batches": _total_batches, "para_count": len(elements)},
            lambda: check_paragraph_quality_agent(elements))
    except Exception as e:
        await _handle_error(local_iii, job_id, e, f"Agent 质检 batch_{batch_index}")
        raise

    # 原子完成：单次 RPC 替代原来的 4-5 次独立操作
    if local_iii is not None:
        try:
            await local_iii.trigger_async({
                "function_id": "docx::batch_complete",
                "payload": {
                    "job_id": job_id,
                    "batch_index": batch_index,
                    "issues": issues,
                    "filename": payload.get("filename", "audit"),
                },
            })
        except Exception as e:
            await _handle_error(local_iii, job_id, e, f"batch_complete batch_{batch_index}")
            raise

    return {"job_id": job_id, "batch_index": batch_index, "issues": issues}


async def fn_job_reaper(payload: dict = None, iii=None) -> dict:
    """
    Function: docx::job_reaper — 补偿卡住的 job。

    由 engine cron 每 30s 触发，扫描：
    - agent_running 且 done >= total 但 finalize 未触发 → 补触发
    - agent_running 超过 10 分钟 → 标记超时失败

    Input:  {} (无参数)
    Output: { scanned, recovered }
    """
    import time as _time
    if iii is None:
        iii = _make_state_client()
    if iii is None:
        return {"scanned": 0, "recovered": 0}

    resp = await iii.trigger_async({
        "function_id": "state::list",
        "payload": {"scope": "docx-audit-jobs", "limit": 200},
    })
    jobs = resp if isinstance(resp, list) else []
    now = _time.time()
    recovered = 0

    for job_entry in jobs:
        job_id = job_entry.get("key", "") if isinstance(job_entry, dict) else ""
        val = job_entry.get("value", {}) if isinstance(job_entry, dict) else {}
        if not job_id or not isinstance(val, dict):
            continue

        step = val.get("step", "")
        if step in ("completed", "failed"):
            continue

        updated_at = val.get("updated_at", now)
        idle_sec = now - updated_at

        if step == "agent_running":
            done = val.get("done_batches", 0)
            total = val.get("total_batches", 0)

            if done >= total and total > 0 and idle_sec > 60:
                # batch 全部完成但 finalize 未触发 → 补偿
                await iii.trigger_async({
                    "function_id": "docx::quality_finalize",
                    "payload": {"job_id": job_id, "filename": val.get("filename", "audit")},
                    "action": __import__("iii", fromlist=["TriggerAction"]).TriggerAction.Enqueue(queue="default"),
                })
                recovered += 1
                await _emit_log(iii, "warning", f"[reaper] 补偿触发 finalize: {job_id}", {
                    "job_id": job_id, "done": done, "total": total, "idle_sec": int(idle_sec),
                })
            elif total > 0 and idle_sec > 600:
                # 10 分钟未完成 → 超时
                await iii.trigger_async({
                    "function_id": "state::update",
                    "payload": {"scope": "docx-audit-jobs", "key": job_id,
                               "ops": [{"type": "set", "path": "step", "value": "failed"},
                                       {"type": "set", "path": "error", "value": "timeout: 审核超时（10min）"}]},
                })
                recovered += 1
                await _emit_log(iii, "warning", f"[reaper] 标记超时: {job_id}", {
                    "job_id": job_id, "idle_sec": int(idle_sec),
                })

        elif step == "finalizing" and idle_sec > 300:
            # finalizing 超过 5 分钟 → 重试
            await iii.trigger_async({
                "function_id": "docx::quality_finalize",
                "payload": {"job_id": job_id, "filename": val.get("filename", "audit")},
                "action": __import__("iii", fromlist=["TriggerAction"]).TriggerAction.Enqueue(queue="default"),
            })
            recovered += 1
            await _emit_log(iii, "warning", f"[reaper] 重试 finalize: {job_id}", {
                "job_id": job_id, "idle_sec": int(idle_sec),
            })

    return {"scanned": len(jobs), "recovered": recovered}


async def fn_batch_complete(payload: dict, iii=None) -> dict:
    """
    Function: docx::batch_complete — 原子完成一次 batch。

    单次 RPC 完成：追加 issues + 递增计数 + 标记完成 + 推送进度 +
    判断是否全部完成并触发 finalize。替代原来的 4-5 次独立 state 操作。

    Input:  { job_id, batch_index, issues, filename }
    Output: { job_id, done, total, finalized: bool }
    """
    import time as _time
    job_id = payload.get("job_id", "")
    batch_index = payload.get("batch_index", 0)
    issues = payload.get("issues", [])
    filename = payload.get("filename", "audit")

    if iii is None:
        iii = _make_state_client()
    if iii is None:
        return {"job_id": job_id, "done": 0, "total": 0, "finalized": False}

    # 1. 原子更新（单次 RPC，引擎侧保证一致性）
    await iii.trigger_async({
        "function_id": "state::update",
        "payload": {
            "scope": "docx-audit-jobs",
            "key": job_id,
            "ops": [
                {"type": "append", "path": "agent_issues", "value": issues},
                {"type": "increment", "path": "done_batches", "by": 1},
                {"type": "append", "path": "batch_ok", "value": batch_index},
            ],
        },
    })

    # 2. 读取最新状态
    job = await iii.trigger_async({
        "function_id": "state::get",
        "payload": {"scope": "docx-audit-jobs", "key": job_id},
    })
    if not job or not isinstance(job, dict):
        return {"job_id": job_id, "done": 0, "total": 0, "finalized": False}

    done = job.get("done_batches", 0)
    total = job.get("total_batches", 0)
    agent_issues_flat = []
    for batch in (job.get("agent_issues") or []):
        if isinstance(batch, list):
            agent_issues_flat.extend(batch)
        else:
            agent_issues_flat.append(batch)
    issue_count = len(agent_issues_flat) + len(job.get("static_issues") or [])

    # 3. 同步 issue_count
    await iii.trigger_async({
        "function_id": "state::update",
        "payload": {
            "scope": "docx-audit-jobs", "key": job_id,
            "ops": [{"type": "set", "path": "issue_count", "value": issue_count}],
        },
    })

    # 4. 推送进度到浏览器
    await _push_progress(iii, {
        "job_id": job_id, "step": "agent_running",
        "done_batches": done, "total_batches": total,
        "total_paras": job.get("total_paras", 0),
        "issue_count": issue_count,
        "activity": {"type": "agent_call", "message": f"第 {batch_index+1}/{total} 批完成，发现 {len(issues)} 个语言问题", "at": int(_time.time()*1000)},
    })

    # 5. 全部完成 → 触发 finalize
    finalized = False
    if done >= total and total > 0:
        await iii.trigger_async({
            "function_id": "docx::quality_finalize",
            "payload": {"job_id": job_id, "filename": filename},
            "action": __import__("iii", fromlist=["TriggerAction"]).TriggerAction.Enqueue(queue="default"),
        })
        finalized = True

    return {"job_id": job_id, "done": done, "total": total, "finalized": finalized}


def _make_state_client():
    """Queue consumer 自建 iii 客户端（短连接，每次调用创建新连接）。"""
    try:
        from iii import register_worker
        url = os.getenv("III_ENGINE_URL", "ws://localhost:49134")
        return register_worker(url, options={
            "workerName": "docx-audit-state-reader",
            "invocation_timeout_ms": 30_000,
        })
    except Exception:
        return None


async def fn_quality_finalize(payload: dict, iii=None) -> dict:
    """Function: docx::quality_finalize — 汇总 Agent 结果，生成报告。"""
    import time as _time
    job_id = payload.get("job_id", "")
    filename = payload.get("filename", "audit")

    if iii is None:
        return {"job_id": job_id, "report_path": None, "total_issues": 0}

    # 读取完整 job 状态
    job = await iii.trigger_async({
        "function_id": "state::get",
        "payload": {"scope": "docx-audit-jobs", "key": job_id},
    })
    if not job or not isinstance(job, dict):
        return {"job_id": job_id, "report_path": None, "total_issues": 0}

    # 合并所有 issues（agent_issues 是 [[batch1],[batch2],...] 需展平）
    all_issues = list(job.get("static_issues") or [])
    for batch in (job.get("agent_issues") or []):
        if isinstance(batch, list):
            all_issues.extend(batch)       # 每个 batch 是一个 list
        else:
            all_issues.append(batch)       # 兼容单个 dict

    # 推送：正在生成报告
    await _push_progress(iii, {
        "job_id": job_id, "step": "finalizing",
        "done_batches": job.get("total_batches", 0), "total_batches": job.get("total_batches", 0),
        "issue_count": len(all_issues),
        "activity": {"type": "report", "message": "正在生成审核报告…", "at": int(_time.time()*1000)},
    })

    # ── 生成报告（OTel span: audit.generate_report）──
    report_result = await _with_span("audit.generate_report",
        {"issue_count": len(all_issues), "job_id": job_id},
        lambda: iii.trigger_async({
            "function_id": "docx::generate_report",
            "payload": {
                "elements": [],  # 报告不需要 elements，只需 issues
                "issues": all_issues,
                "output_path": str(REPORTS_DIR / f"{job_id}_audit_report.docx"),
                "source_name": filename,
            },
        }))

    total_issues = len(all_issues)
    report_path = report_result.get("report_path", "")
    # 更新状态为完成
    await iii.trigger_async({
        "function_id": "state::update",
        "payload": {
            "scope": "docx-audit-jobs",
            "key": job_id,
            "ops": [
                {"type": "set", "path": "step", "value": "completed"},
                {"type": "set", "path": "report_path", "value": report_path},
                {"type": "set", "path": "total_issues", "value": total_issues},
                {"type": "set", "path": "issue_count", "value": total_issues},
            ],
        },
    })

    # 结构化日志：审核完成
    await _emit_log(iii, "info", f"审核完成: {filename}", {
        "job_id": job_id, "total_issues": total_issues,
        "static_issues": len(job.get("static_issues") or []),
        "agent_batches": job.get("total_batches", 0),
        "report_path": report_path,
    })

    # 推送完成进度到浏览器
    await _push_progress(iii, {
        "job_id": job_id, "step": "completed",
        "done_batches": job.get("total_batches", 0),
        "total_batches": job.get("total_batches", 0),
        "total_paras": job.get("total_paras", 0),
        "issue_count": total_issues,
        "report_path": report_path,
        "activity": {"type": "report", "message": f"审核完成，共 {total_issues} 个问题", "at": int(_time.time()*1000)},
    })

    return {"job_id": job_id, "report_path": report_path, "total_issues": total_issues}


async def fn_audit_status(payload: dict, iii=None) -> dict:
    """
    Function: docx::audit_status — 查询 job 进度。

    Input:  { "job_id" }
    Output: job 状态字典（step / done_batches / total_batches / agent_issues 等）
    """
    job_id = payload.get("job_id", "")
    if iii is None or not job_id:
        return {"error": "missing job_id or iii client"}
    job = await iii.trigger_async({
        "function_id": "state::get",
        "payload": {"scope": "docx-audit-jobs", "key": job_id},
    })
    return job or {"error": "job not found"}


def _get_llm_key() -> str:
    from .config_store import get as cfg_get
    return str(cfg_get("LLM_API_KEY", "") or "")


# ── OTel 可观测性辅助（对齐 @iii-dev/helpers/observability 标准）──────────

_tracer = otel_trace.get_tracer("docx-audit")


async def _with_span(name: str, attrs: dict | None = None, fn=None):
    """包裹异步函数为一个 OTel span。

    对齐官方 withSpan(name, { kind, traceparent }, fn) 标准：
    - SpanKind.INTERNAL
    - 设置 attributes（截断 200 字符）
    - 成功时 set_status(OK)
    - 失败时 set_status(ERROR) + set_attribute("error.message") + record_exception
    - 支持 record_event 里程碑事件
    """
    from opentelemetry.trace import StatusCode
    with _tracer.start_as_current_span(name, kind=SpanKind.INTERNAL) as span:
        if attrs:
            for k, v in attrs.items():
                span.set_attribute(k, str(v)[:200])
        try:
            result = await fn()
            span.set_status(StatusCode.OK)
            return result
        except Exception as e:
            span.set_status(StatusCode.ERROR, str(e)[:200])
            span.set_attribute("error", True)
            span.set_attribute("error.message", str(e)[:200])
            span.record_exception(e)
            raise


def _record_event(name: str, attrs: dict | None = None):
    """在当前 span 上记录一个里程碑事件（fire-and-forget）。"""
    span = otel_trace.get_current_span()
    if span and span.is_recording():
        for k, v in (attrs or {}).items():
            span.set_attribute(f"event.{k}", str(v)[:200])
        span.add_event(name, attributes={k: str(v)[:100] for k, v in (attrs or {}).items()})


async def _emit_log(iii, level: str, message: str, data: dict | None = None):
    """发送结构化日志到 iii observability（fire-and-forget）。"""
    if iii is None:
        return
    try:
        await iii.trigger_async({
            "function_id": f"engine::log::{level}",
            "payload": {"message": message, "data": data or {}},
            "action": __import__("iii", fromlist=["TriggerAction"]).TriggerAction.Void(),
        })
    except Exception:
        pass


async def _push_progress(iii, payload: dict):
    """向浏览器推送进度（fire-and-forget，失败不影响主流程）。"""
    if iii is None:
        return
    try:
        await iii.trigger_async({
            "function_id": UI_PROGRESS_FN,
            "payload": payload,
            "action": __import__("iii", fromlist=["TriggerAction"]).TriggerAction.Void(),
        })
    except Exception:
        pass  # 推送失败不阻塞审核主流程


# ── Worker 注册 ───────────────────────────────────────────

def main():
    try:
        from iii import register_worker
    except ImportError:
        # 兼容包名 iii-sdk
        from iii_sdk import register_worker  # type: ignore

    # Agent LLM 检查耗时较长（90段落≈2-3分钟），需要 600s 超时
    try:
        from iii import InitOptions
        opts = InitOptions(worker_name="docx-audit", invocation_timeout_ms=600_000)
        iii = register_worker(III_ENGINE_URL, options=opts)
    except Exception:
        iii = register_worker(III_ENGINE_URL)

    iii.register_function("docx::parse", fn_parse)
    iii.register_function("docx::check_ai_traces", fn_check_ai_traces)
    iii.register_function("docx::check_heading_comments", fn_check_heading_comments)
    iii.register_function("docx::check_paragraph_comments", fn_check_paragraph_comments)
    iii.register_function("docx::check_table_refs_static", fn_check_table_refs_static)
    iii.register_function("docx::check_table_refs_agent", fn_check_table_refs_agent)
    iii.register_function("docx::check_paragraph_quality", fn_check_paragraph_quality)
    iii.register_function("docx::generate_report", fn_generate_report)

    # 配置读写 Function（注入 iii 以实时读取 iii-state）
    async def config_get_with_iii(payload: dict) -> dict:
        return await fn_config_get(payload, iii=iii)
    iii.register_function("docx::config_get", config_get_with_iii)
    iii.register_function("docx::config_set", fn_config_set)

    # 编排 Function：闭包注入 iii，使内部 trigger 可走引擎
    async def audit_with_iii(payload: dict) -> dict:
        return await fn_audit(payload, iii=iii)

    iii.register_function("docx::audit", audit_with_iii)

    # 三层编排 Function
    async def audit_start_with_iii(payload: dict) -> dict:
        return await fn_audit_start(payload, iii=iii)
    iii.register_function("docx::audit_start", audit_start_with_iii)

    async def quality_batch_with_iii(payload: dict) -> dict:
        return await fn_quality_batch(payload, iii=iii)
    iii.register_function("docx::quality_batch", quality_batch_with_iii)

    # batch_complete：原子完成一次 batch（单次 RPC 替代多次独立操作）
    async def batch_complete_with_iii(payload: dict) -> dict:
        return await fn_batch_complete(payload, iii=iii)
    iii.register_function("docx::batch_complete", batch_complete_with_iii)

    async def quality_finalize_with_iii(payload: dict) -> dict:
        return await fn_quality_finalize(payload, iii=iii)
    iii.register_function("docx::quality_finalize", quality_finalize_with_iii)

    # audit_status 也需闭包注入 iii，否则引擎调用时 iii=None → "missing job_id or iii client"
    async def audit_status_with_iii(payload: dict) -> dict:
        return await fn_audit_status(payload, iii=iii)
    iii.register_function("docx::audit_status", audit_status_with_iii)

    # job_reaper：补偿卡住的 job（由 engine cron 触发）
    async def job_reaper_with_iii(payload: dict) -> dict:
        return await fn_job_reaper(payload, iii=iii)
    iii.register_function("docx::job_reaper", job_reaper_with_iii)

    # HTTP Trigger（若 SDK 支持；否则依赖引擎侧 iii-http + 配置）
    try:
        iii.register_trigger(
            {
                "type": "http",
                "method": "POST",
                "path": "/audit",
                "function_id": "docx::audit_start",
            }
        )
        print("[docx-audit] trigger registered: HTTP POST /audit → docx::audit_start")
    except Exception as e:
        print(f"[docx-audit] trigger register skipped (HTTP /audit): {e}")
        print("  → 请确认 iii.worker.yaml 或引擎配置中已声明该 Trigger")

    # Queue Trigger：quality_batch 由 default 队列消费
    try:
        iii.register_trigger(
            {
                "type": "queue",
                "topic": "default",
                "function_id": "docx::quality_batch",
            }
        )
        print("[docx-audit] trigger registered: queue:default → docx::quality_batch")
    except Exception as e:
        print(f"[docx-audit] trigger register FAILED (queue:audit-agent): {e}")
        print("  → 后台异步审核将不可用！请通过以下方式之一补注册：")
        print("     1) iii.worker.yaml 的 triggers 段已声明，重启引擎加载")
        print("     2) 运行: iii trigger register --type queue --topic audit-agent --function docx::quality_batch")
        print("     3) 引擎配置 config/iii-queue.yaml 添加 audit-agent 队列")

    print(f"[docx-audit] connected → {III_ENGINE_URL}")
    print("[docx-audit] functions: audit_start | quality_batch | quality_finalize | audit_status | check_* | config_*")
    # 阻塞直到进程退出（SDK 通常保持 WebSocket 连接）
    if hasattr(iii, "run_forever"):
        iii.run_forever()
    else:
        import time

        while True:
            time.sleep(3600)


if __name__ == "__main__":
    main()
