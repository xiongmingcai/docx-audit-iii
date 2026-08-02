# 后台任务运行设计约定

本文档描述 `docx-audit` 审核系统的后台任务运行架构与设计约定。

---

## 1. 三级异步流水线

```
audit_start(同步, <1s) → quality_batch(Queue × N) → quality_finalize(Queue)
```

| 阶段 | 触发方式 | 执行位置 | 返回时机 |
|------|----------|----------|----------|
| **L1 同步** | HTTP/WS 直接调用 | Worker 主进程 | 秒级返回 job_id |
| **L2 Queue** | 引擎 Queue 消费 | Worker 主进程 | 入队即返回，后台消费 |
| **L3 补偿** | Cron 定时扫描 | Worker 主进程 | 自动/手动触发 |

**约定**：

- 所有超过 1 秒的工作必须异步化（Agent LLM 调用、报告生成）
- 同步阶段只做 parse + 静态检查 + 拆批入队
- `audit_start` 必须在 1 秒内返回 job_id

---

## 2. 双模式执行（引擎路由 vs 进程内直调）

```python
async def call(function_id: str, body: dict) -> dict:
    """有 iii 走引擎（可观测）；无 iii 走进程内（本地调试）。"""
    if iii is not None:
        return await iii.trigger_async({"function_id": function_id, "payload": body})
    # 进程内 fallback
    return await dispatch[function_id](body)
```

**约定**：

- 生产环境：`iii` 由引擎注入，所有调用走引擎路由（有 OTel trace）
- 本地调试：`iii=None`，进程内直接调用（`cli_local.py` 模式）
- 每个 Function 必须有 `iii=None` 参数，无 iii 时也能独立运行

---

## 3. iii 注入 vs 自建连接

| 触发来源 | iii 客户端来源 |
|----------|----------------|
| HTTP/WS (audit_start) | 引擎注入（直接用于 I/O） |
| Queue (quality_batch) | `iii=None` → `_make_state_client()` |
| Queue (quality_finalize) | `iii=None` → `_make_state_client()` |
| Cron (job_reaper) | 闭包注入 `iii` |

**约定**：

- 编排函数（`fn_audit_start` 等）通过闭包注入 `iii`
- Queue 消费者（`fn_quality_batch`）自建短连接，用后即弃
- **禁止**全局单例 worker 连接（避免连接泄漏和重连问题）
- **禁止**在已有事件循环内调用 `asyncio.run()`（嵌套 loop 报错）

---

## 4. Enqueue 入队模式

```python
# 标准入队：投递到指定队列，立即返回
await iii.trigger_async({
    "function_id": "docx::quality_batch",
    "payload": { "job_id": ..., "batch_index": 0, "elements": [...] },
    "action": TriggerAction.Enqueue(queue="default"),
})

# fire-and-forget 推送：不等待结果
await iii.trigger_async({
    "function_id": "docx::ui_progress",
    "payload": { "job_id": ..., "step": "agent_running" },
    "action": TriggerAction.Void(),
})
```

**约定**：

- 所有 Agent 批次通过 `Enqueue(queue="default")` 异步化
- 进度推送用 `Void()` 动作（推送失败不阻塞主流程）
- 队列配置：`concurrency: 5`, `max_retries: 3`, `backoff: 2s`

---

## 5. 状态持久化约定

```python
# 写入
await iii.trigger_async({
    "function_id": "state::set",
    "payload": { "scope": "docx-audit-jobs", "key": job_id, "value": { ... } },
})

# 原子更新（单次 RPC 多个 ops）
await iii.trigger_async({
    "function_id": "state::update",
    "payload": {
        "scope": "docx-audit-jobs", "key": job_id,
        "ops": [
            {"type": "append", "path": "agent_issues", "value": issues},
            {"type": "increment", "path": "done_batches", "by": 1},
            {"type": "set", "path": "step", "value": "completed"},
        ],
    },
})
```

**约定**：

- Job 状态：`scope=docx-audit-jobs, key=job_id`
- 配置状态：`scope=project:{id}, key=settings`
- **禁止**多次独立 RPC 更新同一 job（用单次 `update` 多 ops 保证原子性）
- 所有状态变更必须同步 `push_progress`（保持 UI 一致）

---

## 6. 配置注入约定

```python
# 入口一次性读取，缓存到模块变量
_cached_llm_key = ""
async def fn_audit_start(payload, iii=None):
    global _cached_llm_key
    state_cfg = await iii.trigger_async({ "function_id": "state::get", ... })
    _cached_llm_key = str(state_cfg.get("llm", {}).get("apiKey", ""))

# 下游通过 set_runtime_config 注入
from .agent_checks import set_runtime_config
set_runtime_config({"LLM_API_KEY": ..., "LLM_BASE_URL": ..., "LLM_MODEL": ...})
```

**约定**：

- 配置唯一源：iii-state（`project:{id}/settings`）
- **禁止**在 worker 内直接读 config.json 或环境变量
- 调用链上游读 state → 注入下游（避免嵌套 `asyncio.run`）
- 配置变更实时生效（无需重启 worker）

---

## 7. 错误处理约定

```python
async def _handle_error(iii, job_id, e, context):
    if isinstance(e, _RETRYABLE):  # 网络/超时
        raise  # 抛出让 Queue 重试
    if isinstance(e, _FAILABLE):   # 权限/数据
        await state_update(step="failed", error=str(e))
        return
```

**约定**：

| 错误类型 | 处理 | 示例 |
|----------|------|------|
| `_RETRYABLE` | raise（Queue 自动重试） | TimeoutException, ConnectError |
| `_FAILABLE` | state.step=failed | PermissionError, ValueError |
| 推送失败 | 吞掉（fire-and-forget） | WebSocket 断开 |

---

## 8. 幂等性约定

```python
# quality_batch 幂等检查
existing = await local_iii.trigger_async({ "function_id": "state::get", ... })
if batch_index in existing.get("batch_ok", []):
    return {"skipped": True}  # 重复消费 → 跳过
```

**约定**：

- Queue 消费天然 at-least-once，所有 batch handler 必须幂等
- 用 `batch_ok[]` 数组记录已完成批次
- `batch_complete` 单次 RPC 原子追加（避免重复计数）

---

## 9. 进度同步约定

```
Backend                          Frontend
───────                          ────────

① _push_progress() ──────────▶  WebSocket 实时推送 (主)
   trigger("docx::ui_progress",
   action=Void)

② state::update() ───────────▶  ③ pollJobStatus() (兜底)
   持久化                          setInterval(5s, hidden时暂停)
```

**约定**：

- 推送是主通道（实时），轮询是兜底（5s 间隔）
- 页面隐藏时暂停轮询（`document.visibilityState`）
- 推送失败不抛异常（`fire-and-forget`，`Void()` 动作）
- 终态（completed/failed）由轮询补充完整 result（推送 payload 不含 issues）

---

## 10. 补偿机制约定

```python
# job_reaper: Cron 每 30s 扫描
async def fn_job_reaper(payload, iii=None):
    jobs = await state_list(scope="docx-audit-jobs")
    for job in jobs:
        if done >= total and idle > 60s:
            Enqueue(finalize)  # 补触发
        if idle > 10min:
            state_update(step="failed", error="timeout")
```

**约定**：

- 任何阶段卡住超过阈值都应有补偿
- `batch_complete` 是正常推进，`job_reaper` 是兜底补偿
- 补偿触发后记录日志（`_emit_log warning`）

---

## 11. 文件输入约定

```
优先级: channel_ref > content(base64) > path

┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│ channel_ref │    │ content     │    │ path        │
│ (推荐大文件) │    │ (小文件)    │    │ (本地调试)   │
│             │    │             │    │             │
│ WS 流式传输  │    │ base64 内联  │    │ worker 直读  │
│ 无大小限制   │    │ <10MB 合适  │    │ 需共享文件系统│
└─────────────┘    └─────────────┘    └─────────────┘
```

**约定**：

- 浏览器上传走 Channel（无 base64 膨胀）
- CLI/调试走 path（worker 能访问文件系统）
- base64 仅作降级兜底（小文件 <10MB）

---

## 12. 报告输出约定

```python
# 路径生成
output_path = str(REPORTS_DIR / f"{job_id}_audit_report.docx")
# REPORTS_DIR = _ROOT / "reports" (models.py 统一定义)

# 同时生成
report.docx  # 样式化报告
report.csv   # 伴生 CSV（同名 .csv）
```

**约定**：

- 路径统一用 `REPORTS_DIR` 常量（无 `/workspace` 硬编码）
- 文件名：`{job_id}_audit_report.docx`
- 输出目录自动创建（`REPORTS_DIR.mkdir` 在 models.py 加载时执行）

---

## 13. 函数签名约定

```python
# 所有 iii Function 入口
async def fn_xxx(payload: dict, iii=None) -> dict:
    ...

# 注册时注入 iii（编排函数）
async def fn_xxx_with_iii(payload: dict) -> dict:
    return await fn_xxx(payload, iii=iii)
iii.register_function("docx::xxx", fn_xxx_with_iii)

# 注册时不注入 iii（Queue 消费者）
iii.register_function("docx::xxx", fn_xxx)
```

**约定**：

- `iii=None` 是默认参数（支持无引擎的本地调试）
- 编排函数（`audit_start`, `batch_complete`）注册时闭包注入 `iii`
- Queue 消费者（`quality_batch`, `quality_finalize`）不注入（自建连接）

---

## 14. 触发路径约定

```
① CLI:    iii trigger docx::audit_start path=./doc.docx
② HTTP:   POST /audit {"path":"...", "use_llm":true}
③ WS:     Frontend → EngineClient.trigger("docx::audit_start")
```

**约定**：

- HTTP Trigger 由 `iii.worker.yaml` 声明
- Queue Trigger 由 worker `main()` 注册
- CLI 触发仅用于调试（生产走 HTTP/WS）

---

## 总结

> **同步接单、异步执行、状态驱动、推送为主、轮询兜底、幂等消费、错误分类、补偿兜底。**

---

## 附录：完整数据流

```
docx file
    │
    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 阶段 1: audit_start (同步, <1s)                                              │
│                                                                             │
│  ① 读 iii-state → _cached_llm_key                                          │
│  ② parse docx → elements[]                                                 │
│  ③ static checks → static_issues[]                                         │
│  ④ state::set(job, step=agent_running)                                     │
│  ⑤ Enqueue batch ×N (quality_batch)                                       │
│  ⑥ return {job_id, trace_id, ...}                                          │
└─────────────────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 阶段 2: quality_batch × N (Queue 异步)                                      │
│                                                                             │
│  ① _make_state_client() 自建连接                                            │
│  ② 幂等检查 (batch_ok)                                                      │
│  ③ 读 iii-state → set_runtime_config (注入 agent_checks)                    │
│  ④ check_paragraph_quality_agent → DeepSeek-V3.2                           │
│  ⑤ docx::batch_complete (单次 RPC: append + inc + finalize)                │
│  ⑥ _handle_error 分类处理                                                   │
└─────────────────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 阶段 3: quality_finalize (Queue 异步)                                       │
│                                                                             │
│  ① state::get(job) → 合并 static + agent issues                           │
│  ② push progress (finalizing)                                              │
│  ③ generate_report → REPORTS_DIR/{job_id}_audit_report.docx                │
│  ④ state::update(step=completed, report_path)                              │
│  ⑤ push progress (completed)                                               │
└─────────────────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 补偿: job_reaper (Cron 30s)                                                 │
│                                                                             │
│  done>=total 但 finalize 未触发 → 补触发                                     │
│  agent_running > 10min → 标记超时                                            │
│  finalizing > 5min → 重试                                                   │
└─────────────────────────────────────────────────────────────────────────────┘
```
