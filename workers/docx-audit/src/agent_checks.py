"""Agent 检查 Functions（OpenAI Agents SDK / 兼容 OpenAI API）。

关键约束：
  - agents SDK 在 import 时需要 OPENAI_API_KEY 非空（即使是占位），否则构建内部
    httpx client 时报 Missing credentials。
  - 因此模块加载早期（agents import 之前）就必须写入环境变量占位。
  - LLM 配置通过 config_store 实时读取，前端写入 config.json 后即刻生效。
"""
from __future__ import annotations

import asyncio
import json
import os
import re
from typing import Any

from .config_store import get as cfg_get
from .models import AuditIssue, get_priority, issues_to_dicts


def _parse_elements(v):
    """兼容 CLI 传 string 或 list 的 elements 参数。"""
    if isinstance(v, str):
        try:
            return json.loads(v)
        except Exception:
            return []
    return v or []

_table_agent = None
_quality_agent = None
_agents_ready = False
_last_config_sig = ""


def _current_config_sig() -> str:
    return f"{cfg_get('LLM_BASE_URL','')}|{cfg_get('LLM_API_KEY','')}|{cfg_get('LLM_MODEL','')}"


def _get_llm_key() -> str:
    return str(cfg_get("LLM_API_KEY", "") or "")


def _ensure_openai_key_env():
    """agents SDK 要求 OPENAI_API_KEY 非空；用真实 key 或占位填充。"""
    key = cfg_get("LLM_API_KEY", "")
    if not os.environ.get("OPENAI_API_KEY"):
        os.environ["OPENAI_API_KEY"] = key if key else "sk-placeholder-local"


# 模块加载时立即设置（早于任何 agents import）
_ensure_openai_key_env()


def _init_agents():
    global _table_agent, _quality_agent, _agents_ready, _last_config_sig
    sig = _current_config_sig()
    if _agents_ready and sig == _last_config_sig and _table_agent and _quality_agent:
        return _table_agent, _quality_agent
    _last_config_sig = sig

    from openai import AsyncOpenAI
    from agents import (
        Agent,
        set_default_openai_api,
        set_default_openai_client,
        set_tracing_disabled,
    )

    _ensure_openai_key_env()
    set_tracing_disabled(True)

    llm_key = str(cfg_get("LLM_API_KEY", ""))
    base_url = str(cfg_get("LLM_BASE_URL", "https://api.siliconflow.cn/v1"))
    model = str(cfg_get("LLM_MODEL", "deepseek-ai/DeepSeek-V3.2"))

    custom_client = AsyncOpenAI(
        base_url=base_url,
        api_key=llm_key,
        timeout=120,
    )
    set_default_openai_client(custom_client)
    set_default_openai_api("chat_completions")

    _table_agent = Agent(
        name="table_checker",
        model=model,
        instructions="""你是一名文档表格审核专家。
你的任务是检查文档中段落提到的表格是否真实存在。

规则:
1. 段落中提到了"表N"（如"见表1"、"如下表2所示"、"详见表3"）
2. 检查给定的文档表格列表中是否有对应的表格
3. 注意：有些"表"字不是指表格（如"表现"、"表达"、"表格化"），不要误判
4. 表格标题段落（如"表2 技术栈一览"）后面紧跟表格，不算缺失

请以 JSON 返回:
{"has_missing_table": true/false, "missing_table_id": "缺失的表号", "reason": "判断理由"}

只返回 JSON，不要其他内容。""",
    )

    _quality_agent = Agent(
        name="quality_checker",
        model=model,
        instructions="""你是一名中文文档语言质量审核专家。
你的任务是检查文档段落的语言质量。

检查项:
1. 语句是否通顺
2. 标点符号是否符合中文书写规范
3. 是否有明显的语病
4. 是否有口语化表达（如"要注意"、"一定要"、"不能马虎"等）
5. 是否有重复啰嗦的表达
6. 是否有拼音混入（如"de"应为"的"）

请以 JSON 格式返回：
{"has_issue": true/false, "issue_type": "通顺性/标点/语病/口语化/重复/拼音混入", "description": "具体问题描述", "suggestion": "修改建议"}

只返回 JSON，不要其他内容。""",
    )
    _agents_ready = True
    return _table_agent, _quality_agent


async def _run_agent_async(agent, user_input: str) -> str | None:
    from agents import Runner, RunConfig
    from agents.models.multi_provider import MultiProvider

    try:
        run_config = RunConfig(
            model_provider=MultiProvider(unknown_prefix_mode="model_id"),
        )
        result = await Runner.run(agent, user_input, run_config=run_config)
        return result.final_output
    except Exception as e:
        print(f"    [Agent 错误] {e}")
        return None


def _parse_agent_json(output: str) -> list[dict]:
    if not output:
        return []
    try:
        output = re.sub(r"^```(?:json)?\s*", "", output)
        output = re.sub(r"\s*```$", "", output)
        data = json.loads(output)
        if isinstance(data, list):
            return data
        if isinstance(data, dict):
            return [data]
        return []
    except json.JSONDecodeError:
        return []


def check_table_refs_agent(elements: list[dict]) -> list[AuditIssue]:
    """同步包装：内部用 asyncio 跑 Agent。"""
    return asyncio.get_event_loop().run_until_complete(
        _check_table_refs_agent_async(elements)
    )


async def _check_table_refs_agent_async(elements: list[dict]) -> list[AuditIssue]:
    issues: list[AuditIssue] = []
    if not _get_llm_key():
        return issues

    table_descs = []
    for el in elements:
        if el["kind"] == "table":
            rows_text = " | ".join([" → ".join(r) for r in el["rows"][:3]])
            table_descs.append(f'[表格#{el["tbl_seq"]+1}]: {rows_text[:150]}')
    tables_summary = "\n".join(table_descs) if table_descs else "(文档中无表格)"

    table_paragraphs = [
        el["text"]
        for el in elements
        if el["kind"] in ("heading", "paragraph") and re.search(r"表\s*\d", el["text"])
    ]
    if not table_paragraphs:
        return issues

    paragraphs_text = "\n".join(f"{i+1}. {p}" for i, p, in enumerate(table_paragraphs))
    user_input = f"""请检查以下段落中提到的表格是否都在文档表格列表中。

段落内容:
{paragraphs_text}

文档中的表格:
{tables_summary}"""

    table_agent, _ = _init_agents()
    result = await _run_agent_async(table_agent, user_input)
    if result:
        for item in _parse_agent_json(result):
            if item.get("has_missing_table"):
                table_id = str(item.get("missing_table_id", "")).lstrip("表")
                issues.append(
                    AuditIssue(
                        severity="ERROR",
                        rule_id="TABLE_NAME_WITHOUT_TABLE",
                        message=f'段落提到"表{table_id}"但文档中无对应表格',
                        context=item.get("reason", ""),
                        suggestion="补充对应表格或修正引用",
                        priority="P0",
                        issue_type="表格引用缺失",
                    )
                )
    return issues


async def _check_quality_batch(quality_agent, paragraphs: list[dict]) -> list[AuditIssue]:
    """一批段落合并为 1 次 Agent API 调用（减少 API 调用次数）。"""
    issues: list[AuditIssue] = []
    if not paragraphs:
        return issues

    # 多段落合并在一次请求里（带编号，Agent 按编号返回结果）
    numbered = "\n".join(f"[{i+1}] {el['text']}" for i, el in enumerate(paragraphs))
    user_input = (
        f"请检查以下 {len(paragraphs)} 个段落的语言质量。\n"
        "对每个有问题的段落，返回其编号和问题。\n\n"
        f"{numbered}\n\n"
        "请以 JSON 数组返回，每个元素对应一个有问题的段落：\n"
        '[{"index": 段落编号(1-based), "issue_type": "通顺性/标点/语病/口语化/重复/拼音混入", "description": "具体问题描述", "suggestion": "修改建议"}]\n'
        '如果所有段落都没问题，返回空数组 []。\n'
        "只返回 JSON 数组，不要其他内容。"
    )

    result = await _run_agent_async(quality_agent, user_input)
    if not result:
        return issues

    items = _parse_agent_json(result)
    for item in items:
        # 通过 index 找到对应段落（1-based）
        idx = item.get("index", 1) - 1
        if not (0 <= idx < len(paragraphs)):
            continue
        el = paragraphs[idx]
        issue_type = item.get("issue_type", "语言质量")
        priority = get_priority("PARAGRAPH_QUALITY", issue_type)
        issues.append(
            AuditIssue(
                severity="WARNING",
                rule_id="PARAGRAPH_QUALITY",
                message=f'[{issue_type}] {item.get("description", "")}',
                context=el["text"][:200],
                suggestion=item.get("suggestion", "请修改"),
                priority=priority,
                issue_type=issue_type,
            )
        )
    return issues


async def check_paragraph_quality_agent(elements: list[dict]) -> list[AuditIssue]:
    issues: list[AuditIssue] = []
    if not _get_llm_key():
        return issues

    paragraphs = [
        el for el in elements if el["kind"] == "paragraph" and len(el["text"]) >= 20
    ]
    if not paragraphs:
        return issues

    _, quality_agent = _init_agents()
    # 每批最多 15 段落（1 次 API 调用处理 15 段）
    batch_size = 15
    total_batches = (len(paragraphs) - 1) // batch_size + 1
    for i in range(0, len(paragraphs), batch_size):
        batch = paragraphs[i : i + batch_size]
        print(
            f"    批次 {i // batch_size + 1}/{total_batches} "
            f"({len(batch)} 段落/1次API)..."
        )
        batch_issues = await _check_quality_batch(quality_agent, batch)
        issues.extend(batch_issues)
    return issues


# ── iii Function 入口 ─────────────────────────────────────

async def fn_check_table_refs_agent(payload: dict) -> dict:
    elements = _parse_elements(payload.get("elements"))
    issues = await _check_table_refs_agent_async(elements)
    return {"issues": issues_to_dicts(issues), "count": len(issues)}


async def fn_check_paragraph_quality(payload: dict) -> dict:
    elements = _parse_elements(payload.get("elements"))
    # CLI 传长 JSON 时可能为 string，需解析
    if isinstance(elements, str):
        try:
            elements = json.loads(elements)
        except Exception:
            elements = []
    issues = await check_paragraph_quality_agent(elements)
    return {"issues": issues_to_dicts(issues), "count": len(issues)}
