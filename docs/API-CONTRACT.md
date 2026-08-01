# Docx Audit · 后端响应约定

> 本文档定义 Worker 函数的返回格式与前端消费约定，确保 UI 解析一致。

---

## 1. 函数总览

| Function ID | 方法 | 触发方式 | 返回类型 |
|-------------|------|---------|---------|
| `docx::audit_start` | 同步 | HTTP `/audit` 或 CLI | `AuditStartResult` |
| `docx::audit_status` | 同步 | 轮询 | `JobState` |
| `docx::quality_batch` | 异步 | Queue `default` | `BatchResult` |
| `docx::quality_finalize` | 异步 | Queue `default` | `FinalizeResult` |
| `docx::config_get` | 同步 | 直接调用 | `SafeConfigResponse` |
| `docx::config_set` | 同步 | 直接调用 | `{ written: string[] }` |
| `docx::parse` | 同步 | 内部调用 | `{ elements, stats }` |
| `docx::check_*` | 同步 | 内部调用 | `{ issues: AuditIssue[] }` |
| `docx::generate_report` | 同步 | 内部调用 | `{ report_path, csv_path }` |

---

## 2. 返回格式定义

### 2.1 `AuditStartResult` — 接单返回

```typescript
// fn_audit_start 返回值
interface AuditStartResult {
  ok: boolean;                    // 是否接单成功
  error?: string;                 // 失败原因（ok=false 时）
  job_id: string;                 // job 唯一标识（== 前端传入的 job_id）
  trace_id: string | null;        // OTel trace_id（跳转 iii Console 用）
  static_issues: AuditIssue[];    // 静态检查发现的问题
  stats: {
    paragraphs: number;           // 段落数
    headings: number;             // 标题数
    tables: number;               // 表格数
  };
  agent_enqueued: number;         // 入队的 Agent 批次数（0=无 Agent）
  agent_total_paras: number;      // 参与 Agent 检查的段落数
}
```

**前端消费**：
- `ok === true` → 用 `job_id` 创建 `AuditJob`，加入轮询集合
- `ok === false` → Toast 提示 `error`
- `trace_id` → 页头显示 + 跳转 iii Console

---

### 2.2 `JobState` — 状态查询返回

```typescript
// fn_audit_status 返回值（== state::get 的值）
interface JobState {
  job_id: string;
  step: 'accepted' | 'static_done' | 'agent_running' | 'finalizing' | 'completed' | 'failed';
  trace_id: string;
  filename: string;
  stats: { paragraphs: number; headings: number; tables: number };
  static_issues: AuditIssue[];       // 静态检查结果
  total_batches: number;             // Agent 总批次数
  done_batches: number;              // 已完成批次数
  total_paras: number;
  agent_issues: AuditIssue[][];      // 每批一个数组
  issue_count: number;               // 实时计算的问题总数
  report_path: string | null;        // 报告路径（完成时）
  error: string | null;              // 失败原因
  batch_ok: number[];                // 已完成的批次索引
}
```

**前端消费**：
- 映射到 `AuditJob` 的进度字段
- `step === 'completed'` → 展示 IssueChart + IssueTable
- `step === 'failed'` → 展示错误横幅

---

### 2.3 `AuditIssue` — 问题详情

```typescript
interface AuditIssue {
  severity: 'ERROR' | 'WARNING' | 'INFO';
  rule_id: string;          // 规则标识
  message: string;          // 问题描述
  context?: string;         // 触发问题的文本片段（截断 200 字符）
  suggestion?: string;      // 修改建议
  priority?: string;        // P0 / P1 / P2 / P3 / P4
  issue_type?: string;      // 类型（标题批注错误/段落缺批注/通顺性/标点/口语化/…）
}
```

**rule_id 枚举**：
| rule_id | 含义 | 默认 severity |
|---------|------|--------------|
| `HEADING_WITH_COMMENT` | 标题含批注 | ERROR/P0 |
| `PARAGRAPH_WITHOUT_COMMENT` | 段落缺批注 | ERROR/P0 |
| `TABLE_NAME_WITHOUT_TABLE` | 有表名无表格 | ERROR/P0 |
| `AI_TRACE` | AI 生成痕迹 | ERROR/P1 |
| `PARAGRAPH_QUALITY` | 语言质量问题 | WARNING/P2-P4 |

---

### 2.4 `BatchResult` — 批次处理返回

```typescript
// fn_quality_batch 返回值（内部使用，前端不直接消费）
interface BatchResult {
  job_id: string;
  batch_index: number;
  issues: AuditIssue[];     // 该批次发现的问题
  skipped?: boolean;        // 幂等跳过时 true
}
```

---

### 2.5 `FinalizeResult` — 汇总返回

```typescript
// fn_quality_finalize 返回值（内部使用）
interface FinalizeResult {
  job_id: string;
  report_path: string | null;
  total_issues: number;
}
```

---

## 3. 进度推送格式（docx::ui_progress）

Worker 通过 `docx::ui_progress` 函数推送实时进度，引擎经 WebSocket 推到浏览器。

```typescript
interface ProgressPayload {
  job_id: string;               // 关联的 job
  step: AuditJobStep;           // 当前步骤
  done_batches: number;         // 已完成批次数
  total_batches: number;        // 总批次数
  total_paras?: number;         // 参与 Agent 检查的段落数
  issue_count?: number;         // 已发现的问题数
  report_path?: string;         // 报告路径（完成时）
  // ── 实时活动 ──
  activity?: {
    type: 'parse' | 'static_check' | 'agent_call' | 'report' | 'queue_wait' | 'error';
    message: string;            // 中文描述
    at: number;                 // epoch ms
  };
  llm_calls?: {
    batch_index: number;
    total_batches: number;
    started_at: number;         // epoch ms
    model: string;              // 模型名
  };
}
```

**前端消费**：
- `registerProgressHandler('docx::ui_progress', handler)`
- `applyProgress(job_id, patch)` 更新 store

---

## 4. 错误约定

### 4.1 函数返回错误

```typescript
// 所有函数错误统一格式
{
  ok: false;
  error: string;       // 可读的错误描述（中文）
}
```

### 4.2 前端错误处理

| 错误场景 | 前端行为 |
|---------|---------|
| `ok === false` | Toast 提示 `error` 字段 |
| `job not found` | "任务状态丢失或 Worker 重启" |
| `Function not found` | "Worker 未注册该功能，请检查 Worker 状态" |
| 网络超时 | "请求超时，请检查引擎连接" |

### 4.3 Worker 内部错误

```python
# 批次失败时写入 state
await iii.trigger_async({
    "function_id": "state::update",
    "payload": {
        "scope": "docx-audit-jobs",
        "key": job_id,
        "ops": [{"type": "set", "path": "/error", "value": f"batch_{batch_index}: {error}"}],
    },
})
```

---

## 5. 状态机

```
PENDING → PARSE → STATIC → AGENT → REPORT → COMPLETED
                          ↘ FAILED（任一步骤 max_retries 耗尽）
```

| 状态 | 写入者 | 前端展示 |
|------|--------|---------|
| `accepted` | `fn_audit_start` | Pipeline Flow 接单节点活跃 |
| `static_done` | `fn_audit_start`（静态检查完成时） | 静态检查节点完成 |
| `agent_running` | `fn_audit_start` / `fn_quality_batch` | Agent 节点活跃 + 子批次进度 |
| `finalizing` | `fn_quality_finalize` | 报告节点活跃 |
| `completed` | `fn_quality_finalize` | 全部节点变绿 + IssueChart |
| `failed` | DLQ / 异常处理 | 红色错误横幅 |

---

## 6. Trace 关联

每次 `fn_audit_start` 调用创建一个 OTel trace，贯穿整个审核流程。

```typescript
// trace_id 在 audit_start 返回
const traceId: string = result.trace_id;

// 前端跳转 iii Console
const consoleUrl = `http://127.0.0.1:3113/#/traces?trace_id=${traceId}`;

// Trace 调用链（与 Job 状态一一对应）
execute docx::audit_start           [引擎创建]
  ├── audit.parse                   [worker 创建]
  ├── audit.static_checks           [worker 创建]
  ├── audit.agent_quality ×N        [worker 创建，每批一个]
  └── audit.generate_report         [worker 创建]
```

---

## 7. 前端 Store 映射

```typescript
// JobState → AuditJob 映射
function mapStateToJob(state: JobState): Partial<AuditJob> {
  return {
    step: state.step,
    doneBatches: state.done_batches,
    totalBatches: state.total_batches,
    totalParas: state.total_paras,
    issueCount: state.issue_count,
    jobTraceId: state.trace_id,
    status: state.step === 'completed' ? 'success' : state.error ? 'error' : 'running',
    finishedAt: state.step === 'completed' ? Date.now() : undefined,
    error: state.error ?? undefined,
  };
}
```

---

## 8. 幂等性约定

| 操作 | 幂等键 | 实现 |
|------|--------|------|
| 批次处理 | `job_id + batch_index` | `batch_ok` 数组检查 |
| 报告生成 | `job_id` | 仅在 `step !== 'completed'` 时执行 |
| 配置写入 | `key` | 覆盖写入，最后一次生效 |

---

*文档生成时间：2026-08-01*
*版本：对应 jobId 串联 + Pipeline Flow + Trace 视图 + Settings 持久化实现*
