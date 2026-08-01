import { useSyncExternalStore } from 'react';
import type {
  ActivityEvent,
  AuditJob,
  AuditJobStep,
  AuditProgressPayload,
  AuditResult,
  AuditStartPayload,
  AuditStartResult,
} from './types';
import {
  createEngineClient,
  type EngineClient,
  type IIIConnectionState,
  type Channel,
} from './sdk/client';

const SETTINGS_KEY = 'docx-audit:settings';
const JOBS_KEY = 'docx-audit:jobs';

interface Settings {
  engineUrl: string;
  workerName: string;
  defaultProject: string;
  dataRoot: string;
}

interface StoreState {
  connection: IIIConnectionState;
  rttMs: number | null;
  settings: Settings;
  jobs: AuditJob[];
  activeJobId: string | null;
  theme: 'light' | 'dark';
  /** 进行中 + 排队的 job 数（任务铃气泡）；由 _syncRunningCount 维护 */
  runningCount: number;
}

type Listener = () => void;

function readSettings(): Settings {
  const fallback: Settings = {
    engineUrl: import.meta.env.VITE_ENGINE_URL || 'ws://localhost:3110',
    workerName: import.meta.env.VITE_WORKER_NAME || 'docx-audit-ui',
    defaultProject: import.meta.env.VITE_DEFAULT_PROJECT || 'M1212',
    dataRoot: import.meta.env.VITE_DATA_ROOT || '.',
  };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return fallback;
    return { ...fallback, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return fallback;
  }
}

function readJobs(): AuditJob[] {
  try {
    const raw = localStorage.getItem(JOBS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as AuditJob[];
  } catch {
    return [];
  }
}

function readTheme(): 'light' | 'dark' {
  try {
    const t = localStorage.getItem('docx-audit:theme');
    if (t === 'light' || t === 'dark') return t;
  } catch {
    /* ignore */
  }
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'light';
}

function computeRunningCount(jobs: AuditJob[]): number {
  return jobs.filter((j) => j.status === 'running' || j.status === 'pending').length;
}

let state: StoreState = {
  connection: 'disconnected',
  rttMs: null,
  settings: readSettings(),
  jobs: readJobs(),
  activeJobId: null,
  theme: readTheme(),
  runningCount: computeRunningCount(readJobs()),
};

const listeners = new Set<Listener>();
let client: EngineClient | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function emit() {
  listeners.forEach((l) => l());
}

function patch(p: Partial<StoreState>) {
  const next = { ...state, ...p };
  // jobs 变化时同步 runningCount
  if ('jobs' in p) {
    next.runningCount = computeRunningCount(next.jobs);
  }
  state = next;
  emit();
}

function persistJobs() {
  try {
    localStorage.setItem(JOBS_KEY, JSON.stringify(state.jobs));
  } catch {
    /* ignore */
  }
}

function persistSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
  } catch {
    /* ignore */
  }
}

// ── 引擎连接 ───────────────────────────────────────────────────────────────

function attachConnection(c: EngineClient) {
  c.onConnectionStateChange((s) => {
    patch({ connection: s });
  });
}

// 异步创建客户端（createEngineClient 内部用动态 import 加载 iii-browser-sdk）
async function makeClient(url: string): Promise<EngineClient> {
  return createEngineClient(url);
}

export async function connect(): Promise<EngineClient> {
  if (client) return client;
  client = await makeClient(state.settings.engineUrl);
  attachConnection(client);
  patch({ connection: 'connecting' });
  return client;
}

export async function reconnect(): Promise<void> {
  if (client) {
    void client.shutdown();
    client = null;
  }
  if (reconnectTimer) clearTimeout(reconnectTimer);
  client = await makeClient(state.settings.engineUrl);
  attachConnection(client);
  patch({ connection: 'connecting' });
}

export async function runAudit(input: {
  project: string;
  path: string;
  fileName: string;
  useLlm: boolean;
  checkComments: boolean;
}): Promise<AuditResult> {
  const c = client ?? (await connect());
  const t0 = Date.now();
  patch({ rttMs: null });

  const job: AuditJob = {
    id: `job-${t0}-${Math.random().toString(36).slice(2, 8)}`,
    project: input.project,
    fileName: input.fileName,
    path: input.path,
    useLlm: input.useLlm,
    checkComments: input.checkComments,
    status: 'running',
    createdAt: t0,
  };
  patch({ jobs: [job, ...state.jobs], activeJobId: job.id });
  persistJobs();

  try {
    const result = await c.trigger<{ path: string; use_llm?: boolean; check_comments?: boolean; output_path?: string }, AuditResult>({
      function_id: 'docx::audit',
      payload: {
        path: input.path,
        use_llm: input.useLlm,
        check_comments: input.checkComments,
      },
    });
    const finishedAt = Date.now();
    const done: AuditJob = {
      ...job,
      status: result.ok ? 'success' : 'error',
      finishedAt,
      durationMs: finishedAt - t0,
      result,
      error: result.error,
    };
    patch({
      jobs: state.jobs.map((j) => (j.id === job.id ? done : j)),
      activeJobId: null,
      rttMs: finishedAt - t0,
    });
    persistJobs();
    return result;
  } catch (e) {
    const finishedAt = Date.now();
    const failed: AuditJob = {
      ...job,
      status: 'error',
      finishedAt,
      durationMs: finishedAt - t0,
      error: e instanceof Error ? e.message : String(e),
    };
    patch({
      jobs: state.jobs.map((j) => (j.id === job.id ? failed : j)),
      activeJobId: null,
      rttMs: finishedAt - t0,
    });
    persistJobs();
    throw e;
  }
}

/**
 * 通过 iii Channel 流式上传文件并触发审核。
 *
 * 流程：
 *   1. createChannel() → 拿到 writer（往里写文件字节）+ readerRef
 *   2. 用 readerRef 触发 docx::audit（worker 从 reader 读文件）
 *   3. 浏览器把 File 分块写入 writer.stream
 *
 * 适合大文件：数据走 WebSocket 通道，不经过 JSON payload，无大小限制。
 */
export async function uploadAndAudit(
  file: File,
  opts: { project?: string; useLlm?: boolean; checkComments?: boolean; onProgress?: (sent: number, total: number) => void },
): Promise<AuditResult> {
  const c = client ?? (await connect());
  const project = opts.project ?? state.settings.defaultProject;
  const useLlm = opts.useLlm ?? true;
  const checkComments = opts.checkComments ?? true;
  const t0 = Date.now();
  patch({ rttMs: null });

  const job: AuditJob = {
    id: `job-${t0}-${Math.random().toString(36).slice(2, 8)}`,
    project,
    fileName: file.name,
    path: '',
    useLlm,
    checkComments,
    status: 'running',
    createdAt: t0,
  };
  patch({ jobs: [job, ...state.jobs], activeJobId: job.id });
  persistJobs();

  // 1. 创建流式通道
  let channel: Channel;
  try {
    channel = await c.createChannel();
  } catch {
    patch({ jobs: state.jobs.filter((j) => j.id !== job.id), activeJobId: null });
    persistJobs();
    // channel 不可用降级：走 base64 内联
    return fallbackBase64Audit(file, opts);
  }

  // 2. 触发审核（worker 拿到 readerRef，准备从通道读文件）
  //    同时在后台往 writer 写入文件字节
  const auditPromise = c.trigger<any, AuditResult>({
    function_id: 'docx::audit',
    payload: {
      channel_ref: channel.readerRef,
      filename: file.name,
      use_llm: useLlm,
      check_comments: checkComments,
    },
  });

  // 3. 流式写入文件
  await writeFileToChannel(channel, file, opts.onProgress);

  // 4. 等审核结果
  try {
    const result = await auditPromise;
    const finishedAt = Date.now();
    const done: AuditJob = {
      ...job,
      status: result.ok ? 'success' : 'error',
      finishedAt,
      durationMs: finishedAt - t0,
      result,
      error: result.error,
    };
    patch({
      jobs: state.jobs.map((j) => (j.id === job.id ? done : j)),
      activeJobId: null,
      rttMs: finishedAt - t0,
    });
    persistJobs();
    return result;
  } catch (e) {
    const finishedAt = Date.now();
    const failed: AuditJob = {
      ...job,
      status: 'error',
      finishedAt,
      durationMs: finishedAt - t0,
      error: e instanceof Error ? e.message : String(e),
    };
    patch({
      jobs: state.jobs.map((j) => (j.id === job.id ? failed : j)),
      activeJobId: null,
      rttMs: finishedAt - t0,
    });
    persistJobs();
    throw e;
  }
}

// 把 File 分块写入 channel writer（浏览器端 → 引擎 → worker 端）
// browser-sdk channel writer 是一个 WebSocket 端点，需自行连接后发二进制帧。
function writeFileToChannel(
  channel: Channel,
  file: File,
  onProgress?: (sent: number, total: number) => void,
): Promise<void> {
  const url = channel.writer.url;
  if (!url) return Promise.reject(new Error('channel writer url 不可用'));

  return new Promise((resolve, reject) => {
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      reject(e);
      return;
    }
    ws.binaryType = 'arraybuffer';
    ws.onerror = () => reject(new Error('channel writer WS 错误'));

    ws.onopen = () => {
      const CHUNK = 64 * 1024; // 64KB
      let offset = 0;

      const sendNext = () => {
        if (offset >= file.size) {
          ws.close();
          resolve();
          return;
        }
        const end = Math.min(offset + CHUNK, file.size);
        const slice = file.slice(offset, end);
        const reader = new FileReader();
        reader.onload = () => {
          try {
            ws.send(reader.result as ArrayBuffer);
            offset = end;
            onProgress?.(offset, file.size);
            // 分块间让出事件循环，避免阻塞
            setTimeout(sendNext, 0);
          } catch (e) {
            reject(e);
          }
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(slice);
      };
      sendNext();
    };
  });
}

// Channel 不可用时的降级：base64 内联到 payload
async function fallbackBase64Audit(
  file: File,
  opts: { project?: string; useLlm?: boolean; checkComments?: boolean },
): Promise<AuditResult> {
  const c = client ?? (await connect());
  const buf = await file.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  const b64 = btoa(binary);
  return c.trigger<any, AuditResult>({
    function_id: 'docx::audit',
    payload: {
      content: b64,
      filename: file.name,
      use_llm: opts.useLlm ?? true,
      check_comments: opts.checkComments ?? true,
    },
  });
}

// ── 后台审核（docx::audit_start + 进度推送 + 轮询）────────────────────────
//
// 同步只做「接单」(parse + 静态 + 入队)，秒级返回 job_id；Agent 与出报告在
// Queue 里异步跑。进度靠两条路径更新：
//   1. 后端 push：worker 调 docx::ui_progress → 引擎经 WebSocket 推到浏览器
//   2. 轮询兜底：每 3s 调 docx::audit_status（也用于刷新后恢复 in-progress）

let progressHandlerRegistered = false;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let pollJobs = new Set<string>(); // 正在轮询的 job_id

/** 注册进度推送处理函数（docx::ui_progress）。幂等。 */
export function registerProgressHandler(): void {
  if (progressHandlerRegistered) return;
  progressHandlerRegistered = true;
  if (!client) return;
  const registerFn = client.registerFunction;
  if (typeof registerFn !== 'function') return;
  registerFn('docx::ui_progress', (payload: unknown) => {
    const p = (payload ?? {}) as AuditProgressPayload;
    if (!p.job_id) return;
    const patch: Partial<AuditJob> & { _activityLogAppend?: ActivityEvent } = {
      step: p.step,
      doneBatches: p.done_batches,
      totalBatches: p.total_batches,
      totalParas: p.total_paras,
      issueCount: p.issue_count,
      activity: p.activity,
      llmCalls: p.llm_calls,
      queueDepth: p.queue_depth,
    };
    // 只在终态时更新 status，避免覆盖 running
    if (p.step === 'completed' || p.step === 'failed') {
      patch.status = p.step === 'completed' ? 'success' : 'error';
      patch.finishedAt = Date.now();
    }
    if (p.activity) patch._activityLogAppend = p.activity;
    // 推送完成时 result 由下一次 pollJobStatus 补充（推送 payload 不含 issues 列表）
    applyProgress(p.job_id, patch);
  });
}

/** 把任意 error 值规范化为可读字符串（对象 → JSON，null → undefined）。 */
function normalizeError(error: unknown): string | undefined {
  if (error == null) return undefined;
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  if (typeof error === 'object') {
    const obj = error as Record<string, unknown>;
    if (typeof obj.message === 'string') return obj.message;
    try {
      return JSON.stringify(error);
    } catch {
      return '未知错误';
    }
  }
  return String(error);
}

/**
 * 把进度 patch 到指定 job 上（找不到则忽略）。
 * - error 会被规范化为字符串
 * - _activityLogAppend 会追加到 activityLog（保留最近 20 条）
 */
function applyProgress(jobId: string, patch_: Partial<AuditJob> & { _activityLogAppend?: ActivityEvent }): void {
  const exists = state.jobs.some((j) => j.id === jobId);
  if (!exists) return;
  // 提取内部字段
  const { _activityLogAppend, error, ...rest } = patch_;
  const normalized: Partial<AuditJob> = { ...rest, error: normalizeError(error) };
  const jobs = state.jobs.map((j) => {
    if (j.id !== jobId) return j;
    const updated = { ...j, ...normalized };
    // activityLog 追加
    if (_activityLogAppend) {
      const existing = j.activityLog ?? [];
      updated.activityLog = [...existing, _activityLogAppend].slice(-20);
    }
    return updated;
  });
  patch({ jobs });
  persistJobs();
  // 终态 → 停止轮询该 job
  if (patch_.status === 'success' || patch_.status === 'error') {
    pollJobs.delete(jobId);
  }
}

/**
 * 启动后台审核（路径模式）。
 * 先调 worker 拿到 job_id，再用 worker 返回的 job_id 建 job——
 * 保证前端 ID == worker state key，贯穿轮询/推送/跳转全链路。
 */
export async function startBackgroundAudit(input: {
  project: string;
  path: string;
  fileName: string;
  useLlm: boolean;
  checkComments: boolean;
}): Promise<{ jobId: string; traceId?: string }> {
  const c = client ?? (await connect());
  patch({ rttMs: null });

  // 前端预生成 job_id，确保推送到达时 job 已存在
  const preId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  // 预建 job（Pipeline Flow 立即可见）
  const preJob: AuditJob = {
    id: preId,
    project: input.project,
    fileName: input.fileName,
    path: input.path,
    useLlm: input.useLlm,
    checkComments: input.checkComments,
    status: 'running',
    createdAt: Date.now(),
    step: 'accepted',
    totalBatches: 0,
    doneBatches: 0,
    issueCount: 0,
  };
  patch({ jobs: [preJob, ...state.jobs], activeJobId: preId });
  persistJobs();

  const result = await c.trigger<AuditStartPayload, AuditStartResult>({
    function_id: 'docx::audit_start',
    payload: {
      path: input.path,
      use_llm: input.useLlm,
      check_comments: input.checkComments,
      job_id: preId,  // 传给 worker 使用
    },
  });

  if (!result || !result.ok) {
    applyProgress(preId, { status: 'error', error: result?.error ?? '接单失败', finishedAt: Date.now() });
    throw new Error(result?.error ?? '接单失败');
  }

  // 用 worker 返回的数据更新 job（保留 preId 作为 state key）
  applyProgress(preId, {
    step: (result.agent_enqueued ?? 0) > 0 ? 'agent_running' : 'finalizing',
    totalBatches: result.agent_enqueued ?? 0,
    totalParas: result.agent_total_paras ?? 0,
    issueCount: result.static_issues?.length ?? 0,
    jobTraceId: result.trace_id,
  });
  pollJobs.add(preId);
  startPolling();
  return { jobId: preId, traceId: result.trace_id };
}

/**
 * 启动后台审核（文件上传模式）。
 * 前端预建 job → 推送立即可见；Channel/base64 上传与 audit_start 并行。
 */
export async function startBackgroundAuditFile(
  file: File,
  opts: { project?: string; useLlm?: boolean; checkComments?: boolean; onProgress?: (sent: number, total: number) => void },
): Promise<{ jobId: string; traceId?: string }> {
  const c = client ?? (await connect());
  const project = opts.project ?? state.settings.defaultProject;
  const useLlm = opts.useLlm ?? true;
  const checkComments = opts.checkComments ?? true;
  patch({ rttMs: null });

  // 预生成 job_id 并建 job（Pipeline Flow 立即可见）
  const preId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const preJob: AuditJob = {
    id: preId,
    project,
    fileName: file.name,
    path: '',
    useLlm,
    checkComments,
    status: 'running',
    createdAt: Date.now(),
    step: 'accepted',
    totalBatches: 0,
    doneBatches: 0,
    issueCount: 0,
  };
  patch({ jobs: [preJob, ...state.jobs], activeJobId: preId });
  persistJobs();

  // 1. 尝试创建流式通道；不可用则降级 base64 内联
  let channel: Channel | null = null;
  try {
    channel = await c.createChannel();
  } catch {
    channel = null; // 降级
  }

  let result: AuditStartResult;

  if (channel) {
    // 2a. Channel 模式：audit_start 调用 与 文件流式上传 并行
    const auditPromise = c.trigger<AuditStartPayload, AuditStartResult>({
      function_id: 'docx::audit_start',
      payload: {
        channel_ref: channel.readerRef,
        filename: file.name,
        use_llm: useLlm,
        check_comments: checkComments,
        job_id: preId,
      },
    });
    await writeFileToChannel(channel, file, opts.onProgress);
    result = await auditPromise;
  } else {
    // 2b. 降级：base64 内联
    const buf = await file.arrayBuffer();
    let binary = '';
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    const b64 = btoa(binary);
    opts.onProgress?.(file.size, file.size);
    result = await c.trigger<AuditStartPayload, AuditStartResult>({
      function_id: 'docx::audit_start',
      payload: {
        content: b64,
        filename: file.name,
        use_llm: useLlm,
        check_comments: checkComments,
        job_id: preId,
      },
    });
  }

  if (!result || !result.ok) {
    applyProgress(preId, { status: 'error', error: result?.error ?? '接单失败', finishedAt: Date.now() });
    throw new Error(result?.error ?? '接单失败');
  }

  // 用 worker 返回的数据更新预建 job
  applyProgress(preId, {
    step: (result.agent_enqueued ?? 0) > 0 ? 'agent_running' : 'finalizing',
    totalBatches: result.agent_enqueued ?? 0,
    totalParas: result.agent_total_paras ?? 0,
    issueCount: result.static_issues?.length ?? 0,
    jobTraceId: result.trace_id,
  });
  pollJobs.add(preId);
  startPolling();
  return { jobId: preId, traceId: result.trace_id };
}

/** 轮询单个 job 的后台状态（docx::audit_status）。 */
async function pollJobStatus(jobId: string): Promise<void> {
  if (!client) return;
  try {
    const job = await client.trigger<{ job_id: string }, any>({
      function_id: 'docx::audit_status',
      payload: { job_id: jobId },
    });
    if (!job || typeof job !== 'object') return;
    // worker 返回 {error: "job not found"} 说明 worker 重启后丢失了 state → 标记失败
    if (job.error && !job.step && !job.status) {
      applyProgress(jobId, {
        status: 'error',
        error: normalizeError(job.error) ?? '任务已丢失（Worker 重启）',
        finishedAt: Date.now(),
      });
      return;
    }
    const step = job.step as AuditJobStep | undefined;
    // 只在 worker 返回有效 step 时才更新，避免轮询把已有 step 覆盖为 undefined
    const patch_: Partial<AuditJob> & { _activityLogAppend?: ActivityEvent } = {
      doneBatches: typeof job.done_batches === 'number' ? job.done_batches : undefined,
      totalBatches: typeof job.total_batches === 'number' ? job.total_batches : undefined,
      totalParas: typeof job.total_paras === 'number' ? job.total_paras : undefined,
      issueCount: typeof job.issue_count === 'number' ? job.issue_count : undefined,
      jobTraceId: job.trace_id ?? undefined,
      // 只在终态时更新 status，避免覆盖 running
      ...(step === 'completed' || step === 'failed'
        ? { status: step === 'completed' ? 'success' : 'error', finishedAt: Date.now() }
        : {}),
      error: job.error ?? undefined,
      // 实时活动（轮询只取当前 activity，不覆盖 activityLog）
      activity: job.activity as ActivityEvent | undefined,
    };
    if (step) patch_.step = step;
    // activityLog 追加（如果有新事件）
    if (job.activity && typeof job.activity === 'object') {
      patch_._activityLogAppend = job.activity as ActivityEvent;
    }
    // 完成时构建 result（issues + report + summary）供 IssueTable 展示
    if (step === 'completed') {
      const staticIssues: any[] = Array.isArray(job.static_issues) ? job.static_issues : [];
      const agentIssuesRaw: any[] = Array.isArray(job.agent_issues) ? job.agent_issues : [];
      // agent_issues 是 [[batch1],[batch2],...] 需展平
      const agentIssues: any[] = [];
      for (const batch of agentIssuesRaw) {
        if (Array.isArray(batch)) agentIssues.push(...batch);
        else agentIssues.push(batch);
      }
      const allIssues = [...staticIssues, ...agentIssues];
      const errors = allIssues.filter((i: any) => i.severity === 'ERROR').length;
      const warnings = allIssues.filter((i: any) => i.severity === 'WARNING').length;
      const reportPath = job.report_path || undefined;
      patch_.result = {
        ok: true,
        issues: allIssues,
        report: reportPath ? {
          report_path: reportPath,
          csv_path: reportPath.replace(/\.docx$/, '.csv'),
          errors,
          warnings,
          total: allIssues.length,
        } : undefined,
        summary: { total: allIssues.length, errors, warnings },
        trace_id: job.trace_id ?? undefined,
      };
    }
    applyProgress(jobId, patch_);
  } catch {
    // 轮询失败静默忽略
  }
}

/** 启动轮询定时器（幂等）。 */
export function startPolling(): void {
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    if (pollJobs.size === 0) return;
    pollJobs.forEach((id) => void pollJobStatus(id));
  }, 3000);
}

/** 清除已完成的 job（success），保留运行中和失败的。 */
export function clearCompleted(): void {
  const remaining = state.jobs.filter((j) => j.status !== 'success');
  patch({ jobs: remaining });
  persistJobs();
}

/** 清除所有已结束（success + error）的 job，仅保留运行中。 */
export function clearFinished(): void {
  const remaining = state.jobs.filter((j) => j.status === 'running' || j.status === 'pending');
  patch({ jobs: remaining });
  persistJobs();
}

/**
 * 页面加载时恢复 job 进度。
 * - 运行中的 job → 加入持续轮询
 * - 已完成但缺少 result 的 job → 补一次 poll 填充结果
 */
export function recoverJobsOnLoad(): void {
  const running = state.jobs.filter((j) => j.status === 'running');
  const needResult = state.jobs.filter(
    (j) => (j.status === 'success' || j.status === 'error') && !j.result,
  );
  if (running.length > 0 || needResult.length > 0) {
    console.warn(
      `[recoverJobsOnLoad] 运行中=${running.length}, 需补结果=${needResult.length}`,
    );
  }
  // 运行中的 job → 持续轮询
  running.forEach((j) => pollJobs.add(j.id));
  if (pollJobs.size > 0) startPolling();
  // 立即 poll 所有需要数据的 job
  pollJobs.forEach((id) => void pollJobStatus(id));
  needResult.forEach((j) => void pollJobStatus(j.id));
}

// ── settings / theme ────────────────────────────────────────────────────────

export async function updateSettings(next: Partial<Settings>) {
  patch({ settings: { ...state.settings, ...next } });
  persistSettings();
  // 引擎地址变化即重连
  if (next.engineUrl) await reconnect();
}

export function setTheme(theme: 'light' | 'dark') {
  patch({ theme });
  try {
    localStorage.setItem('docx-audit:theme', theme);
  } catch {
    /* ignore */
  }
}

export function clearJobs() {
  patch({ jobs: [] });
  persistJobs();
}

// ── 可观测性 ───────────────────────────────────────────────────────────────

/** 查询 trace 的完整树形结构（含子 spans）。 */
export async function fetchTraceTree(traceId: string): Promise<any> {
  if (!client) return null;
  try {
    return await client.trigger<{ trace_id: string }, any>({
      function_id: 'engine::traces::tree',
      payload: { trace_id: traceId },
    });
  } catch {
    return null;
  }
}

/** 查询最近的日志（用于 JobDetail 日志视图）。 */
export async function fetchJobLogs(traceId: string): Promise<any[]> {
  if (!client) return [];
  try {
    const r = await client.trigger<{ trace_id: string; limit: number }, any>({
      function_id: 'engine::logs::list',
      payload: { trace_id: traceId, limit: 100 },
    });
    return r?.logs ?? r?.entries ?? [];
  } catch {
    return [];
  }
}

/** 查询引擎指标。 */
export async function fetchMetrics(): Promise<any> {
  if (!client) return {};
  try {
    return await client.trigger<{}, any>({
      function_id: 'engine::metrics::list',
      payload: {},
    });
  } catch {
    return {};
  }
}

// ── 订阅 ─────────────────────────────────────────────────────────────────────

function subscribe(l: Listener) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function getSnapshot() {
  return state;
}

export function useStore(): StoreState;
export function useStore<T>(selector: (s: StoreState) => T): T;
export function useStore<T>(selector?: (s: StoreState) => T) {
  return useSyncExternalStore(
    subscribe,
    () => (selector ? selector(state) : state),
    () => (selector ? selector(state) : state),
  );
}

// 模块加载即尝试连接（浏览器环境）
if (typeof window !== 'undefined') {
  void connect();
}
