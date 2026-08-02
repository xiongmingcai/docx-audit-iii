// 与 workers/docx-audit/src/models.py 的 AuditIssue / fn_audit 返回结构对齐

export type Severity = 'ERROR' | 'WARNING' | 'INFO';

export interface AuditIssue {
  severity: Severity;
  rule_id: string;
  message: string;
  context?: string;
  suggestion?: string;
  priority?: string; // P0 / P1 / P2 / P3 / P4
  issue_type?: string;
  location?: string;
}

export interface AuditStats {
  paragraphs?: number;
  headings?: number;
  tables?: number;
}

export interface AuditSummary {
  total: number;
  errors: number;
  warnings: number;
}

export interface AuditReport {
  report_path?: string;
  csv_path?: string;
  errors: number;
  warnings: number;
  total: number;
}

/** docx::audit 的 payload */
export interface AuditPayload {
  path: string;
  output_path?: string;
  use_llm?: boolean;
  check_comments?: boolean;
}

/** docx::audit 的返回值 */
export interface AuditResult {
  ok: boolean;
  error?: string;
  path?: string; // 后台流程中可能无文件路径
  stats?: AuditStats;
  issues?: AuditIssue[];
  report?: AuditReport;
  summary?: AuditSummary;
  trace_id?: string; // 关联 iii Console trace
}

export type AuditJobStatus = 'pending' | 'running' | 'success' | 'error';

/** 后台作业当前步骤（与 worker.py state.step 对齐） */
export type AuditJobStep =
  | 'accepted'       // 接单中（解析+静态检查）
  | 'static_done'    // 静态检查完成（等待 Agent 或出报告）
  | 'agent_running'  // Agent 质检中
  | 'finalizing'     // 生成报告中
  | 'completed'      // 完成
  | 'failed';        // 失败

export interface AuditJob {
  /** worker 返回的 job_id（== state key），贯穿轮询/推送/跳转全链路 */
  id: string;
  project: string;
  fileName: string;
  path: string;
  useLlm: boolean;
  checkComments: boolean;
  status: AuditJobStatus;
  createdAt: number; // epoch ms
  finishedAt?: number;
  durationMs?: number;
  result?: AuditResult;
  error?: string;
  // ── 后台进度（由 docx::audit_start / ui_progress push / audit_status 轮询 填充）──
  step?: AuditJobStep;
  doneBatches?: number;
  totalBatches?: number;
  totalParas?: number;
  issueCount?: number;
  jobTraceId?: string; // OTel trace_id（不同于 job.id），用于跳转 iii Console
  // ── 实时活动 ──
  activity?: ActivityEvent;        // 当前正在发生的事件
  activityLog?: ActivityEvent[];   // 完整活动时间线（最近 20 条）
  llmCalls?: LlmCallStatus;        // 当前 LLM 调用状态
  queueDepth?: number;             // 队列深度
}

/** docx::audit_start 的 payload */
export interface AuditStartPayload {
  path?: string;
  content?: string;
  channel_ref?: { access_key: string; channel_id: string; direction: string };
  filename?: string;
  use_llm?: boolean;
  check_comments?: boolean;
  job_id?: string; // 前端预生成的 job_id，worker 使用此值而非自行生成
}

/** docx::audit_start 的返回值 */
export interface AuditStartResult {
  ok: boolean;
  error?: string;
  job_id: string;
  trace_id?: string;
  static_issues?: AuditIssue[];
  stats?: AuditStats;
  agent_enqueued?: number;
  agent_total_paras?: number;
}

/** 后端推送到浏览器的进度 payload（docx::ui_progress） */
export interface AuditProgressPayload {
  job_id: string;
  step: AuditJobStep;
  done_batches: number;
  total_batches: number;
  total_paras?: number;
  issue_count?: number;
  report_path?: string;
  // ── 实时活动详情 ──
  activity?: ActivityEvent;
  llm_calls?: LlmCallStatus;
  queue_depth?: number;
}

/** 实时活动事件 */
export interface ActivityEvent {
  type: 'parse' | 'static_check' | 'agent_call' | 'report' | 'queue_wait' | 'error';
  message: string;
  at: number; // epoch ms
}

/** LLM 调用状态 */
export interface LlmCallStatus {
  batch_index: number;
  total_batches: number;
  started_at: number; // epoch ms
  model: string;
}

// ═══════════════════════════════════════════════════════════
// MinerU 文档转换
// ═══════════════════════════════════════════════════════════

export type MineruJobStatus = 'pending' | 'queued' | 'uploading' | 'processing' | 'done' | 'failed';

export type MineruModelVersion = 'pipeline' | 'vlm' | 'MinerU-HTML';

export type MineruSourceMode = 'url' | 'upload';

export interface MineruJob {
  id: string;                       // 前端生成的 task_id
  mineruTaskId?: string;            // MinerU API 返回的任务 ID (URL 模式)
  batchId?: string;                 // 批量任务 ID (上传模式)
  fileName: string;                 // 文件名
  source: MineruSourceMode;         // 输入方式
  url: string;                      // 文件 URL
  status: MineruJobStatus;
  createdAt: number;
  completedAt?: number;
  markdown?: string;                // 转换结果
  error?: string;                   // 错误信息
  progress?: { extracted: number; total: number };
  modelVersion: MineruModelVersion;
}

/** mineru::convert 的 payload */
export interface MineruConvertPayload {
  url: string;
  model_version?: MineruModelVersion;
  is_ocr?: boolean;
  enable_formula?: boolean;
  enable_table?: boolean;
  language?: string;
  page_ranges?: string;
}

/** mineru::convert 的返回值 */
export interface MineruConvertResult {
  ok: boolean;
  error?: string;
  task_id?: string;
  mineru_task_id?: string;
  state?: string;
}

/** mineru::status 的返回值 */
export interface MineruStatusResult {
  ok: boolean;
  error?: string;
  state?: string;
  progress?: { extracted: number; total: number };
}

/** mineru::result 的返回值 */
export interface MineruResultResult {
  ok: boolean;
  error?: string;
  state?: string;
  markdown?: string;
}

/** mineru::upload 的 payload */
export interface MineruUploadPayload {
  filename: string;
  model_version?: MineruModelVersion;
  language?: string;
}

/** mineru::upload 的返回值 */
export interface MineruUploadResult {
  ok: boolean;
  error?: string;
  batch_id?: string;
  upload_url?: string;
}

/** mineru::batch_status 的返回值 */
export interface MineruBatchStatusResult {
  ok: boolean;
  error?: string;
  results?: Array<{
    file_name: string;
    state: string;
    full_zip_url?: string;
    err_msg?: string;
  }>;
}
