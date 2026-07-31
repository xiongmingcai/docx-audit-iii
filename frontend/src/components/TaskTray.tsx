import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore, clearFinished } from '@/store';
import type { AuditJob, AuditJobStep } from '@/types';
import { JobIdChip } from './JobIdChip';
import { StatusIcon } from './StatusIcon';

type Tab = 'all' | 'running' | 'completed' | 'failed';

/** 步骤点文案（与 worker.py state.step 对齐） */
const STEP_LABELS: Record<AuditJobStep, string> = {
  accepted: '已接单',
  static_done: '静态检查完成',
  agent_running: 'Agent 质检中',
  finalizing: '正在生成报告',
  completed: '审核完成',
  failed: '失败',
};

/** 内部步骤 → 显示文案（plan/1.md §6）。status 用于在 step 缺失时给出准确文案。 */
function stepCopy(step?: AuditJobStep, status?: string): string {
  if (step) return STEP_LABELS[step] ?? step;
  // step 缺失时，按 status 给出准确文案，避免「进行中」徽章与「排队中」文案并存
  if (status === 'error') return '失败';
  if (status === 'success') return '审核完成';
  if (status === 'running') return '接单中';
  return '排队中';
}

/** 进度百分比（plan/1.md §6） */
function percent(job: AuditJob): number {
  if (job.status === 'success') return 100;
  if (job.status === 'error') return 100;
  const total = job.totalBatches ?? 0;
  const done = job.doneBatches ?? 0;
  if (total > 0) {
    // Agent 阶段占 15–90%
    return Math.round(15 + (done / total) * 75);
  }
  // 接单+静态阶段
  return job.step && job.step !== 'accepted' ? 15 : 5;
}

const STEP_DOTS: { key: string; label: string }[] = [
  { key: 'accepted', label: '接单' },
  { key: 'static_done', label: '静态' },
  { key: 'agent_running', label: 'Agent' },
  { key: 'completed', label: '报告' },
];

function StepDots({ step }: { step?: AuditJobStep }) {
  const order: AuditJobStep[] = ['accepted', 'static_done', 'agent_running', 'completed'];
  const currentIdx = step ? order.indexOf(step) : -1;
  return (
    <div className="flex items-center gap-1 text-[11px]">
      {STEP_DOTS.map((dot, i) => {
        const done = currentIdx >= i;
        const active = currentIdx === i;
        return (
          <span key={dot.key} className="flex items-center gap-1">
            <span
              className={[
                'grid h-3.5 w-3.5 place-items-center rounded-full',
                done ? 'bg-accent text-accent-fg' : 'bg-surface-2 text-muted',
                active ? 'ring-2 ring-accent/40' : '',
              ].join(' ')}
            >
              {done ? '●' : '○'}
            </span>
            <span className={done ? 'text-fg' : 'text-muted'}>{dot.label}</span>
            {i < STEP_DOTS.length - 1 && <span className="text-muted">·</span>}
          </span>
        );
      })}
    </div>
  );
}

function JobCard({ job }: { job: AuditJob }) {
  const navigate = useNavigate();
  const pct = percent(job);
  const isRunning = job.status === 'running';
  const isFailed = job.status === 'error';
  const isDone = job.status === 'success';

  const copyTrace = () => {
    if (job.jobTraceId) void navigator.clipboard.writeText(job.jobTraceId);
  };

  return (
    <div className="rounded-md border border-border bg-surface p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{job.fileName}</div>
          <div className="text-xs text-muted">
            <span className="font-mono">{job.project}</span> · {new Date(job.createdAt).toLocaleTimeString()}
          </div>
        </div>
        <span
          className={[
            'shrink-0 flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium',
            isRunning ? 'bg-accent/15 text-accent' : '',
            isDone ? 'bg-ok/15 text-ok' : '',
            isFailed ? 'bg-danger/15 text-danger' : '',
            job.status === 'pending' ? 'bg-surface-2 text-muted' : '',
          ].join(' ')}
        >
          <StatusIcon step={job.step} status={job.status} activityType={job.activity?.type} size="sm" />
          {isRunning ? '进行中' : isDone ? '完成' : isFailed ? '失败' : '排队'}
        </span>
      </div>

      {/* Job ID */}
      <div className="mt-1.5">
        <JobIdChip jobId={job.id} label="ID" />
      </div>

      <div className="mt-1.5">
        <StepDots step={job.step} />
      </div>

      {isRunning && (
        <div className="mt-2">
          <div className="mb-1 flex justify-between text-[11px] text-muted">
            <span>{stepCopy(job.step, job.status)}</span>
            <span className="tnum">
              {job.totalBatches ? `${job.doneBatches}/${job.totalBatches} 批 · ` : ''}
              {pct}%
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
          </div>
          {/* 当前活动 */}
          {job.activity && (
            <div className="mt-1.5 flex items-center gap-1 text-[11px] text-accent">
              <StatusIcon step={job.step} status={job.status} activityType={job.activity.type} size="sm" />
              <span className="truncate">{job.activity.message}</span>
            </div>
          )}
        </div>
      )}

      <div className="mt-2 flex items-center gap-3 text-[11px] text-muted">
        {job.issueCount != null && <span>已发现问题 {job.issueCount}</span>}
        {job.jobTraceId && (
          <span className="flex items-center gap-1 font-mono">
            Trace {job.jobTraceId.slice(0, 6)}…
            <button onClick={copyTrace} className="text-accent hover:underline" title="复制 Trace ID">
              复制
            </button>
          </span>
        )}
      </div>

      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={() => navigate(`/jobs/${job.id}`)}
          className="rounded border border-border px-2 py-0.5 text-[11px] text-fg transition hover:bg-surface-2"
        >
          {isDone || isFailed ? '打开结果' : '查看详情'}
        </button>
        {isDone && job.result && (
          <a
            href={`data:text/csv;charset=utf-8,${encodeURIComponent(toCsv(job))}`}
            download={`${job.fileName.replace(/\.docx$/i, '')}_audit_report.csv`}
            className="rounded border border-border px-2 py-0.5 text-[11px] text-fg transition hover:bg-surface-2"
          >
            下载 CSV
          </a>
        )}
      </div>
    </div>
  );
}

/** 简单 CSV 生成（复用 job.result.issues） */
function toCsv(job: AuditJob): string {
  const issues = job.result?.issues ?? [];
  const header = 'Key,P,类型,问题,修改建议';
  const rows = issues.map((i, idx) => {
    const key = `${job.project}-${String(idx + 1).padStart(3, '0')}`;
    return [key, i.priority ?? '', i.issue_type ?? i.rule_id ?? '', i.message ?? '', i.suggestion ?? '']
      .map((c) => `"${(c ?? '').replace(/"/g, '""')}"`)
      .join(',');
  });
  return [header, ...rows].join('\n');
}

export function TaskTray({ open, onClose }: { open: boolean; onClose: () => void }) {
  const jobs = useStore((s) => s.jobs);
  const [tab, setTab] = useState<Tab>('all');

  if (!open) return null;

  const filtered = jobs.filter((j) => {
    if (tab === 'all') return true;
    if (tab === 'running') return j.status === 'running' || j.status === 'pending';
    if (tab === 'completed') return j.status === 'success';
    return j.status === 'error';
  });

  const runningCount = jobs.filter((j) => j.status === 'running' || j.status === 'pending').length;
  const doneCount = jobs.filter((j) => j.status === 'success').length;
  const failedCount = jobs.filter((j) => j.status === 'error').length;

  return (
    <>
      {/* 遮罩 */}
      <div className="fixed inset-0 z-30" onClick={onClose} />
      {/* 抽屉 */}
      <div className="fixed right-0 top-12 z-40 flex h-[calc(100vh-3rem)] w-full max-w-md flex-col border-l border-border bg-bg shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="text-sm font-medium">
            后台任务
            <span className="ml-2 text-xs text-muted">
              进行中 {runningCount} · 已完成 {doneCount} · 失败 {failedCount}
            </span>
          </div>
          <button
            onClick={onClose}
            className="grid h-6 w-6 place-items-center rounded text-muted transition hover:bg-surface-2 hover:text-fg"
            aria-label="关闭"
          >
            ✕
          </button>
        </div>

        {/* 筛选 tabs */}
        <div className="flex gap-1 border-b border-border px-4 py-2 text-xs">
          {(
            [
              ['all', '全部'],
              ['running', '进行中'],
              ['completed', '已完成'],
              ['failed', '失败'],
            ] as [Tab, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={[
                'rounded px-2 py-1 transition',
                tab === key ? 'bg-accent text-accent-fg' : 'text-muted hover:bg-surface-2 hover:text-fg',
              ].join(' ')}
            >
              {label}
            </button>
          ))}
          {(doneCount > 0 || failedCount > 0) && (
            <button
              onClick={() => clearFinished()}
              className="ml-auto rounded px-2 py-1 text-[11px] text-muted transition hover:bg-surface-2 hover:text-fg"
            >
              清除已完成
            </button>
          )}
        </div>

        {/* 列表 */}
        <div className="flex-1 overflow-auto p-4">
          {filtered.length === 0 ? (
            <div className="grid h-full place-items-center text-center">
              <div>
                <div className="text-2xl text-muted">📋</div>
                <p className="mt-2 text-sm text-muted">暂无后台任务</p>
                <p className="text-xs text-muted">提交审核后，进度会显示在这里，可随时离开本页</p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map((job) => (
                <JobCard key={job.id} job={job} />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
