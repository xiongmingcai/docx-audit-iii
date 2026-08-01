import { useMemo, useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useStore, fetchTraceTree } from '@/store';
import { IssueTable } from '@/components/IssueTable';
import { JobIdChip } from '@/components/JobIdChip';
import { StatusIcon } from '@/components/StatusIcon';
import { PipelineFlow } from '@/components/PipelineFlow';
import { IssueChart } from '@/components/IssueChart';
import { Clipboard, Waves, FileBarChart, CircleCheckBig } from 'lucide-react';
import type { AuditJob, AuditJobStep } from '@/types';

const STEP_LABELS: Record<AuditJobStep, string> = {
  accepted: '已接单',
  static_done: '静态检查完成',
  agent_running: 'Agent 质检中',
  finalizing: '正在生成报告',
  completed: '审核完成',
  failed: '失败',
};

/** 管线阶段排序 */
const PIPELINE_STEP_ORDER = ['accepted', 'agent_running', 'finalizing', 'completed'];

function getStepStatus(targetStep: string, currentStep?: string): 'done' | 'active' | 'pending' {
  if (!currentStep) return 'pending';
  const tgtIdx = PIPELINE_STEP_ORDER.indexOf(targetStep);
  // 归一化：accepted/static_done 都属于"接单完成"阶段
  const normalizedCur = ['accepted', 'static_done', 'static_check', 'queue_wait'].includes(currentStep)
    ? 'accepted'
    : currentStep;
  const nCurIdx = PIPELINE_STEP_ORDER.indexOf(normalizedCur);
  if (tgtIdx < nCurIdx) return 'done';
  if (tgtIdx === nCurIdx) return 'active';
  return 'pending';
}

function buildStages(job: AuditJob) {
  const step = job.step;
  // 根据 activityType 判断实际活跃子阶段
  const isAgentPhase = step === 'agent_running' || job.activity?.type === 'agent_call';
  const isFinalizing = step === 'finalizing' || job.activity?.type === 'report';

  // 显式类型化 status 避免 TS 推断为 string
  const acceptedSt: 'done' | 'active' | 'pending' = getStepStatus('accepted', step);
  const agentSt: 'done' | 'active' | 'pending' = isAgentPhase ? 'active' : getStepStatus('agent_running', step);
  const reportSt: 'done' | 'active' | 'pending' = isFinalizing ? 'active' : getStepStatus('finalizing', step);
  const doneSt: 'done' | 'active' | 'pending' | 'error' =
    step === 'completed' ? 'done' : step === 'failed' ? 'error' : getStepStatus('completed', step);

  return [
    { id: 'accepted', label: '接单', icon: Clipboard, status: acceptedSt, detail: job.activity?.type === 'parse' ? job.activity.message : undefined },
    { id: 'agent', label: 'Agent 质检', icon: Waves, status: agentSt, detail: isAgentPhase ? job.activity?.message : undefined },
    { id: 'report', label: '生成报告', icon: FileBarChart, status: reportSt, detail: isFinalizing ? job.activity?.message : undefined },
    { id: 'done', label: '完成', icon: CircleCheckBig, status: doneSt },
  ];
}

export function JobDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const job = useStore((s) => s.jobs.find((j) => j.id === id));

  const fileName = job?.fileName ?? 'audit';
  const project = job?.project ?? 'DOC';

  const issues = useMemo(() => job?.result?.issues ?? [], [job]);
  const summary = job?.result?.summary;
  const isRunning = job?.status === 'running';

  // Trace 视图数据（实时轮询——使用 tree API 获取完整层级）
  const [traceTree, setTraceTree] = useState<any>(null);
  const [traceLoading, setTraceLoading] = useState(false);
  useEffect(() => {
    if (!job?.jobTraceId) return;
    let cancelled = false;
    const poll = async () => {
      setTraceLoading(true);
      try {
        const tree = await fetchTraceTree(job.jobTraceId!);
        if (!cancelled) setTraceTree(tree);
      } catch { /* ignore */ }
      finally { if (!cancelled) setTraceLoading(false); }
    };
    poll();
    const timer = isRunning ? setInterval(poll, 3000) : null;
    return () => { cancelled = true; if (timer) clearInterval(timer); };
  }, [job?.jobTraceId, isRunning]);

  if (!job) {
    return (
      <div className="grid h-full place-items-center">
        <div className="text-center">
          <div className="text-sm text-muted">未找到作业 {id}</div>
          <button
            onClick={() => navigate('/jobs')}
            className="mt-3 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface-2"
          >
            返回历史
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-6">
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate('/jobs')}
          className="grid h-7 w-7 place-items-center rounded-md border border-border text-muted transition hover:bg-surface-2 hover:text-fg"
          aria-label="返回"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold tracking-tight">{job.fileName}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <JobIdChip jobId={job.id} />
            {job.jobTraceId && (
              <a
                href={`http://127.0.0.1:3113/traces?trace_id=${job.jobTraceId}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded border border-border bg-surface px-1.5 py-0.5 font-mono text-[11px] text-accent transition hover:bg-surface-2 hover:border-accent/40"
                title={`在 iii Console 中查看 Trace (${job.jobTraceId})`}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3" />
                </svg>
                <span>Trace {job.jobTraceId.slice(0, 8)}…</span>
              </a>
            )}
          </div>
          <p className="mt-1 text-xs text-muted">
            <span className="font-mono">{job.project}</span> · {new Date(job.createdAt).toLocaleString()}
            {job.durationMs != null && ` · ${(job.durationMs / 1000).toFixed(1)}s`}
            {job.useLlm ? ' · Agent' : ' · 仅静态'}
          </p>
        </div>
        <div
          className={[
            'ml-auto shrink-0 flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium',
            job.status === 'success' ? 'bg-ok/15 text-ok' : '',
            job.status === 'error' ? 'bg-danger/15 text-danger' : '',
            isRunning ? 'bg-accent/15 text-accent' : '',
          ].join(' ')}
        >
          <StatusIcon step={job.step} status={job.status} activityType={job.activity?.type} size="sm" />
          {job.status === 'success'
            ? summary
              ? `${summary.errors}E / ${summary.warnings}W`
              : '完成'
            : job.status === 'error'
              ? job.error ?? '失败'
              : STEP_LABELS[job.step ?? 'accepted'] ?? '进行中'}
        </div>
      </div>

      {/* Pipeline 管线流程图（运行中 / 已完成） */}
      {(isRunning || job.status === 'success' || job.status === 'error') && (
        <PipelineFlow
          stages={buildStages(job)}
          activeBatch={job.step === 'agent_running' && (job.totalBatches ?? 0) > 0
            ? { current: job.doneBatches ?? 0, total: job.totalBatches ?? 0 }
            : undefined
          }
        />
      )}

      {/* 实时活动时间线（Pipeline 流程感） */}
      {job.activityLog && job.activityLog.length > 0 && (
        <div className="rounded-lg border border-border bg-surface p-3">
          <h3 className="mb-2 text-xs font-medium text-muted">实时活动</h3>
          <div className="max-h-44 overflow-auto">
            <div className="relative">
              {/* 管线竖线 */}
              <div className="absolute left-[7px] top-2 bottom-2 w-[2px] bg-surface-2" />
              <div className="space-y-2">
                {job.activityLog.map((ev, i) => {
                  const isLast = i === job.activityLog!.length - 1;
                  return (
                    <div key={i} className="relative flex items-start gap-2.5 pl-0">
                      {/* 管线节点 */}
                      <span
                        className={[
                          'relative z-10 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full',
                          isLast && isRunning
                            ? 'breathe bg-accent/15 text-accent ring-2 ring-accent/30'
                            : ev.type === 'error'
                              ? 'bg-danger/10 text-danger'
                              : 'bg-accent/10 text-accent',
                        ].join(' ')}
                      >
                        <ActivityDot type={ev.type} isLast={isLast} isRunning={isRunning} />
                      </span>
                      {/* 内容 */}
                      <div className="min-w-0 flex-1 pt-0.5">
                        <div className="flex items-baseline gap-1.5">
                          <span className="tnum text-[10px] text-muted">
                            {new Date(ev.at).toLocaleTimeString()}
                          </span>
                          <span
                            className={[
                              'text-[11px]',
                              isLast && isRunning ? 'font-medium text-accent' : 'text-fg/70',
                            ].join(' ')}
                          >
                            {ev.message}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {job.status === 'error' && job.error && (
        <div className="rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
          {typeof job.error === 'string' ? job.error : '审核失败'}
        </div>
      )}

      {/* 完成态：问题分布 + 下载 */}
      {job.status === 'success' && job.result && (
        <IssueChart issues={job.result.issues ?? []} project={project} fileName={fileName} />
      )}

      {/* 实时 Trace 追踪视图（树形结构） */}
      {(job.jobTraceId || job.result?.trace_id) && (
        <TraceView
          tree={traceTree}
          traceId={job.jobTraceId ?? job.result?.trace_id}
          loading={traceLoading}
        />
      )}

      <IssueTable
        issues={issues}
        project={project}
        reportPath={job.result?.report?.report_path}
        fileName={fileName}
        traceId={job.result?.trace_id ?? job.jobTraceId}
      />
    </div>
  );
}

/** 活动事件的小圆点图标 */
function ActivityDot({ type, isLast, isRunning }: { type: string; isLast: boolean; isRunning: boolean }) {
  const cls = 'h-2 w-2';
  if (type === 'parse') return <span className={`${cls} rounded-full bg-accent ${isLast && isRunning ? 'animate-pulse' : ''}`} />;
  if (type === 'static_check') return <span className={`${cls} rounded-full bg-accent ${isLast && isRunning ? 'animate-pulse' : ''}`} />;
  if (type === 'agent_call') return <span className={`${cls} rounded-full bg-accent ${isLast && isRunning ? 'animate-pulse' : ''}`} />;
  if (type === 'report') return <span className={`${cls} rounded-full bg-ok`} />;
  if (type === 'error') return <span className={`${cls} rounded-full bg-danger`} />;
  return <span className={`${cls} rounded-full bg-accent ${isLast && isRunning ? 'animate-pulse' : ''}`} />;
}

/**
 * 实时 Trace 追踪视图 — 展示 OTel span 调用链（树形结构）
 *
 * 验收标准视觉：
 *   OTel Trace (3 spans)                          0599ea72…  [↗ Console]
 *   ├─▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░  audit.parse        49ms   OK  ▶
 *   │    └─ filename: 技术说明书.docx
 *   ├─▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░  audit.static_checks  85ms   OK  ▶
 *   │    └─ use_comments: true
 *   ├─▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░  audit.agent_quality  ⟳     ⋯   ▶
 *   │    └─ batch_index: 3, total_batches: 5
 *   └─                              audit.generate_report  —     ○
 */
function TraceView({ tree, traceId, loading }: { tree: any; traceId?: string; loading?: boolean }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const toggle = (id: string) => setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

  // 展平树形结构收集所有 span（用于计算时间范围）
  const allSpans: any[] = [];
  const collectSpans = (node: any) => {
    if (node) { allSpans.push(node); for (const child of (node.children ?? [])) collectSpans(child); }
  };
  for (const root of (tree?.roots ?? [])) collectSpans(root);

  const spanCount = allSpans.length;
  const now = Date.now() * 1e6;
  const minStart = spanCount ? Math.min(...allSpans.map((s) => s.start_time_unix_nano || now)) : now;
  const maxEnd = spanCount ? Math.max(...allSpans.map((s) => s.end_time_unix_nano || now)) : now;
  const totalWindow = Math.max(maxEnd - minStart, 1);

  const parseAttrs = (attrs: any): Record<string, string> => {
    const obj: Record<string, string> = {};
    if (Array.isArray(attrs)) { for (const a of attrs) obj[a.key ?? a[0]] = String(a.value ?? a[1] ?? '').slice(0, 100); }
    else if (attrs && typeof attrs === 'object') { for (const [k, v] of Object.entries(attrs)) obj[k] = String(v).slice(0, 100); }
    return obj;
  };

  const renderSpan = (node: any, depth: number) => {
    if (!node) return null;
    const name = node.name || '?';
    const spanId = node.span_id || name + depth;
    const dur = node.end_time_unix_nano && node.start_time_unix_nano ? node.end_time_unix_nano - node.start_time_unix_nano : null;
    const durMs = dur !== null ? (dur / 1e6) : null;
    const isPending = !node.end_time_unix_nano;
    const isError = node.status === 'error';
    const attrsObj = parseAttrs(node.attributes);
    const hasAttrs = Object.keys(attrsObj).length > 0;
    const isOpen = expanded[spanId];
    const hasChildren = node.children && node.children.length > 0;
    const offset = ((node.start_time_unix_nano || minStart) - minStart) / totalWindow;
    const width = dur !== null ? Math.max(2, (dur / totalWindow) * 100) : 0;

    return (
      <div key={spanId}>
        <div
          className={['flex items-center gap-1.5 rounded px-1 py-0.5 text-[11px]', 'hover:bg-surface-2 cursor-pointer', isError ? 'bg-danger/5' : ''].join(' ')}
          style={{ paddingLeft: `${depth * 14 + 4}px` }}
          onClick={() => (hasAttrs || hasChildren) && toggle(spanId)}
        >
          {depth > 0 && <span className="text-border text-[10px]">├─</span>}
          <div className="relative h-3 w-10 shrink-0 overflow-hidden rounded-sm bg-surface-2">
            <div className={['absolute top-0 h-full rounded-sm', isError ? 'bg-danger/60' : isPending ? 'bg-accent/40' : 'bg-accent/50', isPending ? 'animate-pulse' : ''].join(' ')}
              style={{ left: `${offset * 100}%`, width: `${Math.max(width, 8)}%` }} />
          </div>
          <span className={['min-w-[100px] shrink-0 font-mono', isError ? 'text-danger' : 'text-fg/80'].join(' ')}>{name}</span>
          <span className="tnum w-12 shrink-0 text-right text-muted">
            {durMs !== null ? (durMs < 1000 ? `${durMs.toFixed(0)}ms` : `${(durMs / 1000).toFixed(1)}s`) : '⟳'}
          </span>
          <span className={['inline-flex h-4 w-7 items-center justify-center rounded text-[9px] font-medium', isError ? 'bg-danger/15 text-danger' : isPending ? 'bg-accent/15 text-accent' : 'bg-ok/15 text-ok'].join(' ')}>
            {isError ? 'ERR' : isPending ? '⋯' : 'OK'}
          </span>
          {(hasAttrs || hasChildren) && <span className="text-muted transition-transform" style={{ transform: isOpen ? 'rotate(90deg)' : '' }}>▶</span>}
        </div>
        {isOpen && hasAttrs && (
          <div className="ml-8 mt-0.5 mb-1 rounded border border-border/50 bg-bg p-1.5">
            <div className="space-y-0.5 text-[10px]">
              {Object.entries(attrsObj).slice(0, 6).map(([k, v]) => (
                <div key={k} className="flex gap-1"><span className="text-muted">└─ {k}:</span><span className="truncate font-mono text-fg/70">{v}</span></div>
              ))}
            </div>
          </div>
        )}
        {isOpen && hasChildren && node.children.map((child: any) => renderSpan(child, depth + 1))}
      </div>
    );
  };

  return (
    <div className="rounded-lg border border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-medium">OTel Trace{spanCount > 0 && <span className="text-muted"> ({spanCount} spans)</span>}</h3>
          {loading && <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent" />}
        </div>
        <div className="flex items-center gap-2">
          {traceId && <span className="font-mono text-[10px] text-muted">{traceId.slice(0, 8)}…</span>}
          <a href={`http://127.0.0.1:3113/#/traces?trace_id=${traceId}`} target="_blank" rel="noreferrer"
            className="rounded border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent transition hover:bg-accent/20">↗ Console</a>
        </div>
      </div>
      <div className="max-h-72 overflow-auto p-1">
        {spanCount === 0 && loading ? (
          <div className="space-y-2 p-2">{[1, 2, 3].map((i) => <div key={i} className="h-5 w-full animate-pulse rounded bg-surface-2" />)}</div>
        ) : spanCount === 0 ? (
          <div className="px-2 py-6 text-center text-xs text-muted">等待 trace 数据…<br /><span className="text-[10px]">Worker 执行中，span 将在步骤完成后上报</span></div>
        ) : tree?.roots?.map((root: any) => renderSpan(root, 0))}
      </div>
    </div>
  );
}

