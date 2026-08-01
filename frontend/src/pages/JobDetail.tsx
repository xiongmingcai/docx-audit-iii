import { useMemo, useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useStore, fetchTraceSpans } from '@/store';
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
  // agent_running 对应 accepted 之后的阶段
  const normalizedCur = currentStep === 'accepted' || currentStep === 'static_check' || currentStep === 'queue_wait' ? 'accepted' : currentStep;
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

  // Trace 视图数据
  const [traceSpans, setTraceSpans] = useState<any[]>([]);
  useEffect(() => {
    if (job?.jobTraceId) {
      fetchTraceSpans(job.jobTraceId).then(setTraceSpans);
    }
  }, [job?.jobTraceId]);

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

  const summary = job.result?.summary;
  const isRunning = job.status === 'running';

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
              <span className="inline-flex items-center gap-1 font-mono text-[11px] text-muted">
                <span className="text-fg/60">Trace</span>
                <span>{job.jobTraceId.slice(0, 8)}…{job.jobTraceId.slice(-4)}</span>
                <button
                  onClick={() => navigator.clipboard?.writeText(job.jobTraceId!)}
                  className="grid h-4 w-4 place-items-center rounded text-muted transition hover:bg-surface-2 hover:text-fg"
                  title="复制 Trace ID"
                >
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                </button>
                <a
                  href={`http://127.0.0.1:3113/traces?trace_id=${job.jobTraceId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="grid h-4 w-4 place-items-center rounded text-accent hover:bg-surface-2"
                  title="在 iii Console 中打开 Trace"
                >
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3" />
                  </svg>
                </a>
              </span>
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

      {/* Trace 视图 — 展示真实 OTel spans */}
      {traceSpans.length > 0 && (
        <TraceView spans={traceSpans} traceId={job.jobTraceId ?? job.result?.trace_id} />
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

/** Trace 视图 — 展示 OTel spans 列表 */
function TraceView({ spans, traceId }: { spans: any[]; traceId?: string }) {
  if (!spans.length) return null;
  return (
    <div className="rounded-lg border border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <h3 className="text-xs font-medium">
          Trace Spans <span className="text-muted">({spans.length})</span>
        </h3>
        {traceId && (
          <a
            href={`http://127.0.0.1:3113/traces?trace_id=${traceId}`}
            target="_blank"
            rel="noreferrer"
            className="text-[11px] text-accent hover:underline"
          >
            在 Console 中打开 →
          </a>
        )}
      </div>
      <div className="max-h-48 overflow-auto">
        <table className="w-full text-[11px]">
          <thead className="sticky top-0 bg-surface text-muted">
            <tr className="text-left">
              <th className="px-3 py-1.5 font-medium">操作</th>
              <th className="px-2 py-1.5 font-medium">状态</th>
              <th className="px-2 py-1.5 font-medium">耗时</th>
            </tr>
          </thead>
          <tbody>
            {spans.map((s: any, i: number) => {
              const dur = s.end_time_unix_nano && s.start_time_unix_nano
                ? `${((s.end_time_unix_nano - s.start_time_unix_nano) / 1e6).toFixed(0)}ms`
                : s.status === 'unset' ? '进行中…' : '—';
              const isError = s.status === 'error';
              return (
                <tr key={i} className="border-t border-border/50 hover:bg-surface-2">
                  <td className="px-3 py-1 font-mono text-fg/80">{s.name || '?'}</td>
                  <td className="px-2 py-1">
                    <span className={[
                      'inline-flex h-4 items-center rounded px-1 text-[10px] font-medium',
                      isError ? 'bg-danger/15 text-danger' : 'bg-ok/15 text-ok',
                    ].join(' ')}>
                      {isError ? 'ERR' : 'OK'}
                    </span>
                  </td>
                  <td className="px-2 py-1 tnum text-muted">{dur}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

