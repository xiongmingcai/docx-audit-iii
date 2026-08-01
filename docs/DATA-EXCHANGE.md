# docx-audit · Worker ↔ 前端数据交换格式与机制

## 概述

本文档描述 docx-audit Worker（Python）与前端（React）之间的完整数据交换格式和通信机制。

### 通信拓扑

```
┌─ 前端 (browser) ──────────────────────────────────────────────────────────────┐
│                                                                              │
│  startBackgroundAudit()  ──trigger──▶  引擎  ──route──▶  Worker fn_audit_start │
│                                                                              │
│  registerProgressHandler  ◀──push────  引擎  ◀──trigger──  Worker _push_progress│
│                                                                              │
│  pollJobStatus()  ──trigger──▶  引擎  ──route──▶  Worker fn_audit_status       │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘

三种通信路径：
  1. 同步请求/响应：前端 trigger → Worker 处理 → 返回结果
  2. 后端推送：Worker trigger docx::ui_progress → 引擎 WebSocket → 浏览器
  3. 状态轮询：前端定时 trigger → Worker 返回 state::get 结果
```

---

## 1. 同步请求/响应

### 1.1 前端 → Worker：`docx::audit_start`

**触发时机**：用户提交审核（路径模式或文件上传模式）

**前端代码**：`store.ts` → `startBackgroundAudit()` / `startBackgroundAuditFile()`

**Payload 格式** (`AuditStartPayload`)：

```typescript
// 路径模式
{
  path: string;              // 文件路径（worker 可访问时）
  use_llm: boolean;          // 是否启用 Agent 质检
  check_comments: boolean;   // 是否检测批注
  job_id: string;            // 前端预生成的 job_id（worker 使用此值）
}

// 文件上传模式（Channel）
{
  channel_ref: { access_key: string; channel_id: string; direction: string };
  filename: string;
  use_llm: boolean;
  check_comments: boolean;
  job_id: string;
}

// 文件上传模式（降级 base64）
{
  content: string;           // base64 编码的文件字节
  filename: string;
  use_llm: boolean;
  check_comments: boolean;
  job_id: string;
}
```

**Worker 处理**：`worker.py` → `fn_audit_start(payload, iii)`

**返回值** (`AuditStartResult`)：

```typescript
{
  ok: boolean;               // 接单是否成功
  error?: string;            // 失败原因
  job_id: string;            // job_id（== 前端传入的 job_id）
  trace_id?: string;         // OTel trace_id（关联 iii Console）
  static_issues: AuditIssue[];       // 静态检查发现的问题
  stats: { paragraphs: number; headings: number; tables: number };
  agent_enqueued: number;    // 入队的 Agent 批次数（0=无 Agent）
  agent_total_paras: number; // 参与 Agent 检查的段落数
}
```

**前端处理**：
- 成功 → 用 `result.job_id` 创建 `AuditJob` 对象，加入 `pollJobs` 轮询集合
- 失败 → 抛出异常，Toast 提示

---

### 1.2 前端 → Worker：`docx::audit_status`

**触发时机**：前端 3s 轮询（运行时）或页面加载恢复（`recoverJobsOnLoad`）

**Payload**：

```typescript
{
  job_id: string;
}
```

**Worker 处理**：`worker.py` → `fn_audit_status(payload, iii)`

内部调用 `state::get(scope="docx-audit-jobs", key=job_id)` 返回完整状态。

**返回值**（state value 原样返回）：

```typescript
{
  job_id: string;
  step: "accepted" | "static_done" | "agent_running" | "finalizing" | "completed" | "failed";
  trace_id: string;
  filename: string;
  stats: { paragraphs, headings, tables };
  static_issues: AuditIssue[];
  total_batches: number;
  done_batches: number;
  total_paras: number;
  agent_issues: AuditIssue[][];   // 每批一个数组
  issue_count: number;
  report_path: string | null;
  error: string | null;
  batch_ok: number[];             // 已完成的批次索引
}
```

**前端处理**：`store.ts` → `applyProgress()` 将返回字段映射到 `AuditJob` 的进度字段。

---

## 2. 后端推送（WebSocket）

### 2.1 Worker → 前端：`docx::ui_progress`

**触发时机**：Worker 在关键节点调用 `_push_progress()` 推送实时活动

**推送机制**：

```python
# worker.py
await iii.trigger_async({
    "function_id": "docx::ui_progress",
    "payload": { ... },
    "action": TriggerAction.Void(),  # fire-and-forget
})
```

引擎将 `docx::ui_progress` 视为已注册的 Function，经 WebSocket 推送到浏览器。

**Payload 格式** (`AuditProgressPayload`)：

```typescript
{
  job_id: string;            // 关联的 job
  step: AuditJobStep;        // 当前步骤
  done_batches: number;      // 已完成批次数
  total_batches: number;     // 总批次数
  total_paras?: number;      // 参与 Agent 检查的段落数
  issue_count?: number;      // 已发现的问题数
  report_path?: string;      // 报告路径（完成时）
  // ── 实时活动详情 ──
  activity?: {
    type: "parse" | "static_check" | "agent_call" | "report" | "queue_wait" | "error";
    message: string;         // 中文描述
    at: number;              // epoch ms
  };
  llm_calls?: {
    batch_index: number;
    total_batches: number;
    started_at: number;
    model: string;
  };
  queue_depth?: number;
}
```

**前端处理**：`store.ts` → `registerProgressHandler()`

```typescript
registerFn('docx::ui_progress', (payload) => {
  const p = payload as AuditProgressPayload;
  applyProgress(p.job_id, {
    step: p.step,
    doneBatches: p.done_batches,
    totalBatches: p.total_batches,
    issueCount: p.issue_count,
    activity: p.activity,
    llmCalls: p.llm_calls,
    status: p.step === 'completed' ? 'success' : undefined,
    finishedAt: p.step === 'completed' ? Date.now() : undefined,
  });
});
```

### 2.2 推送时机表

| Worker 函数 | 推送时机 | activity.type | activity.message |
|-------------|---------|---------------|-----------------|
| `fn_audit_start` | 解析完成 | `parse` | "文档解析完成: 90段落 55标题" |
| `fn_audit_start` | 静态检查完成 | `static_check` | "静态检查完成，发现 N 个问题" |
| `fn_audit_start` | Agent 入队完成 | `queue_wait` | "已入队 N 个 Agent 批次，等待消费…" |
| `fn_audit_start` | 无 Agent 时 | - | step=agent_running, total=0 |
| `fn_quality_batch` | LLM 调用前 | `agent_call` | "正在检测第 N/M 批段落语言质量" |
| `fn_quality_batch` | LLM 调用后 | `agent_call` | "第 N/M 批完成，发现 K 个语言问题" |
| `fn_quality_finalize` | 生成报告前 | `report` | "正在生成审核报告…" |
| `fn_quality_finalize` | 完成 | `report` | "审核完成，共 N 个问题" |

---

## 3. State 存储（持久化中间状态）

### 3.1 State Schema

**scope**：`docx-audit-jobs`  
**key**：`job_id`

```typescript
{
  job_id: string;                    // == state key（冗余存储）
  step: AuditJobStep;
  trace_id: string;
  filename: string;
  stats: { paragraphs, headings, tables };
  static_issues: AuditIssue[];       // 静态检查结果
  total_batches: number;             // Agent 总批次数
  done_batches: number;              // 已完成批次数
  total_paras: number;
  agent_issues: AuditIssue[][];      // 每批一个数组（支持 append）
  issue_count: number;               // 实时计算：static + agent
  report_path: string | null;
  error: string | null;
  batch_ok: number[];                // 已完成的批次索引（幂等检查）
}
```

### 3.2 State 操作

| 操作 | 代码 | 用途 |
|------|------|------|
| 创建 | `state::set(scope, key, value)` | `fn_audit_start` 初始化 |
| 原子更新 | `state::update(scope, key, ops)` | `fn_quality_batch` 追加 issues、递增 done_batches |
| 读取 | `state::get(scope, key)` | `fn_audit_status` 返回完整状态 |
| 列表 | `state::list(scope)` | 调试/管理 |

**原子操作示例**（`fn_quality_batch`）：

```python
ops = [
    {"type": "append", "path": "agent_issues", "value": issues},
    {"type": "increment", "path": "done_batches", "by": 1},
    {"type": "append", "path": "batch_ok", "value": batch_index},
]
await iii.trigger_async({
    "function_id": "state::update",
    "payload": {"scope": "docx-audit-jobs", "key": job_id, "ops": ops},
})
```

---

## 4. 共享数据类型

### 4.1 AuditIssue

```typescript
interface AuditIssue {
  severity: "ERROR" | "WARNING" | "INFO";
  rule_id: string;          // 规则标识（如 HEADING_WITH_COMMENT）
  message: string;          // 问题描述
  context?: string;         // 触发问题的文本片段
  suggestion?: string;      // 修改建议
  priority?: string;        // P0 / P1 / P2 / P3 / P4
  issue_type?: string;      // 类型（标题批注错误/段落缺批注/通顺性/标点/口语化/…）
  location?: string;        // 位置（当前未使用）
}
```

### 4.2 AuditJobStep

```typescript
type AuditJobStep =
  | "accepted"       // 已接单（解析+静态检查中）
  | "static_done"    // 静态检查完成
  | "agent_running"  // Agent 质检中
  | "finalizing"     // 生成报告中
  | "completed"      // 完成
  | "failed";        // 失败
```

---

## 5. 数据流时序

### 5.1 路径模式（use_llm=true）

```
前端                          引擎                          Worker
 │                              │                             │
 ├─ trigger audit_start ───────▶│                             │
 │                              ├─ route ────────────────────▶│
 │                              │                             ├─ parse (span: audit.parse)
 │                              │                             ├─ static checks (span: audit.static_checks)
 │                              │                             ├─ state::set (初始状态)
 │                              │                             ├─ enqueue quality_batch ×5
 │                              │◀── _push_progress(queue_wait)─┤
 │◀── registerProgressHandler ──┤                             │
 │                              │◀── return {ok, job_id, ...} ─┤
 │                              │                             │
 ├─ 创建 AuditJob ──────────────┤                             │
 ├─ 加入 pollJobs ──────────────┤                             │
 │                              │                             │
 │   [quality_batch 消费]       │                             │
 │                              ├─ route ────────────────────▶│
 │                              │                             ├─ LLM call (span: audit.agent_quality)
 │                              │                             ├─ state::update (append issues)
 │                              │◀── _push_progress(agent_call)┤
 │◀── registerProgressHandler ──┤                             │
 │                              │                             │
 │   [quality_finalize 消费]    │                             │
 │                              ├─ route ────────────────────▶│
 │                              │                             ├─ generate_report (span)
 │                              │                             ├─ state::update (step=completed)
 │                              │◀── _push_progress(completed)─┤
 │◀── registerProgressHandler ──┤                             │
 │                              │                             │
 ├─ 3s 轮询 audit_status ───────▶│                             │
 │                              ├─ route ────────────────────▶│
 │                              │                             ├─ state::get
 │                              │◀── return state ────────────┤
 │◀── result ───────────────────┤                             │
```

### 5.2 文件上传模式（Channel）

```
前端                          引擎                          Worker
 │                              │                             │
 ├─ createChannel() ───────────▶│                             │
 │◀── {readerRef, writer} ──────┤                             │
 │                              │                             │
 ├─ trigger audit_start ───────▶│                             │
 │  (channel_ref in payload)    ├─ route ────────────────────▶│
 │                              │                             ├─ _read_channel_bytes(iii, channel_ref)
 │                              │                             │   （从 reader 下载文件）
 │◀═══ WebSocket: 文件上传 ════▶│                             │
 │  (writeFileToChannel)        │                             │
 │                              │                             ├─ 后续同路径模式
```

---

## 6. 错误处理

### 6.1 Worker 端错误

| 场景 | 处理方式 |
|------|---------|
| 文件不存在 | `return {"error": "file not found: ...", "ok": false}` |
| 解析失败 | `return {"error": "parse failed", "ok": false}` |
| Agent 调用失败 | `state::update(error=...)` + `raise`（触发 Queue 重试） |
| 批次幂等 | `batch_ok` 检查 → 已完成的批次直接返回空 issues |
| Worker 重启 | 前端 `recoverJobsOnLoad` 轮询恢复 + `job not found` 标记失败 |

### 6.2 前端端错误

| 场景 | 处理方式 |
|------|---------|
| 接单失败 | Toast 错误 + job status=error |
| 轮询丢失 | `job not found` → 显示"任务状态丢失或 Worker 重启" |
| 推送丢失 | 3s 轮询兜底恢复最新状态 |
| 网络断开 | ConnectionDot 红色 + 自动重连 |

---

## 7. 幂等性设计

### 7.1 批次幂等

`fn_quality_batch` 执行前检查 `batch_ok` 数组：

```python
batch_ok = existing.get("batch_ok", [])
if batch_index in batch_ok:
    return {"job_id": job_id, "batch_index": batch_index, "issues": [], "skipped": True}
```

**原因**：Queue 消息可能因重试而重复投递，避免重复计算。

### 7.2 状态原子更新

使用 `state::update` 的原子操作（append/increment/set）而非 read-modify-write，避免并发消费时的数据竞争。

---

*文档生成时间：2026-08-01*
*版本：对应 jobId 串联 + Pipeline Flow + Trace 视图实现*
