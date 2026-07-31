import { useMemo, useState } from 'react';
import type { AuditIssue, Severity } from '@/types';
import { issuesToCsv, downloadCsv } from '@/lib/csv';

type PriorityFilter = 'ALL' | 'P0' | 'P1' | 'P2+' | 'ERROR' | 'WARNING';

const PRIORITIES: PriorityFilter[] = ['ALL', 'P0', 'P1', 'P2+', 'ERROR', 'WARNING'];

function matchFilter(issue: AuditIssue, f: PriorityFilter): boolean {
  switch (f) {
    case 'ALL':
      return true;
    case 'P0':
      return issue.priority === 'P0';
    case 'P1':
      return issue.priority === 'P1';
    case 'P2+':
      return !!issue.priority && issue.priority >= 'P2';
    case 'ERROR':
      return issue.severity === 'ERROR';
    case 'WARNING':
      return issue.severity === 'WARNING';
  }
}

const SEV_COLOR: Record<Severity, string> = {
  ERROR: 'bg-danger/15 text-danger ring-danger/30',
  WARNING: 'bg-warn/15 text-warn ring-warn/30',
  INFO: 'bg-accent/15 text-accent ring-accent/30',
};

function PriorityBar({ priority }: { priority?: string }) {
  if (priority === 'P0') return <span className="ml-0 h-3 w-3 rounded-sm bg-danger" aria-label="P0" />;
  if (priority === 'P1') return <span className="ml-0 h-3 w-3 rounded-sm bg-warn" aria-label="P1" />;
  return null;
}

export function IssueTable({
  issues,
  project,
  reportPath,
  fileName,
  traceId,
}: {
  issues: AuditIssue[];
  project: string;
  reportPath?: string;
  fileName: string;
  traceId?: string;
}) {
  const [filter, setFilter] = useState<PriorityFilter>('ALL');
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return issues.filter(
      (i) =>
        matchFilter(i, filter) &&
        (q === '' ||
          i.message.toLowerCase().includes(q) ||
          (i.issue_type ?? '').toLowerCase().includes(q) ||
          (i.context ?? '').toLowerCase().includes(q)),
    );
  }, [issues, filter, query]);

  const total = issues.length;
  const errors = issues.filter((i) => i.severity === 'ERROR').length;
  const warnings = issues.filter((i) => i.severity === 'WARNING').length;

  return (
    <div className="rounded-lg border border-border bg-surface">
      {/* 汇总 */}
      <div className="grid grid-cols-2 gap-px border-b border-border bg-border sm:grid-cols-4">
        <Stat label="Total" value={total} />
        <Stat label="ERROR" value={errors} tone="danger" />
        <Stat label="WARNING" value={warnings} tone="warn" />
        <Stat label="Showing" value={filtered.length} />
      </div>

      {/* Trace ID — 关联 iii Console */}
      {traceId && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 text-xs">
          <span className="text-muted">Trace</span>
          <span className="font-mono text-fg">{traceId.slice(0, 8)}…{traceId.slice(-8)}</span>
          <button
            onClick={() => navigator.clipboard?.writeText(traceId).then(() => {/* toast */}).catch(() => {})}
            className="h-6 rounded-md border border-border px-2 text-muted transition hover:bg-surface-2 hover:text-fg"
            title="复制完整 trace_id"
          >
            复制
          </button>
          <a
            href={`http://127.0.0.1:3113/traces?trace_id=${traceId}`}
            target="_blank"
            rel="noreferrer"
            className="h-6 rounded-md border border-border px-2 text-muted transition hover:bg-surface-2 hover:text-fg inline-flex items-center gap-1"
            title="在 iii Console 中打开 Trace 树"
          >
            查看 Trace 树
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M7 17L17 7M9 7h8v8" />
            </svg>
          </a>
        </div>
      )}

      {/* 筛选 + 操作 */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <div className="flex flex-wrap gap-1">
          {PRIORITIES.map((p) => (
            <button
              key={p}
              onClick={() => setFilter(p)}
              className={[
                'h-6 rounded-md px-2 text-xs ring-1 ring-inset transition',
                filter === p
                  ? 'bg-accent text-accent-fg ring-accent'
                  : 'text-muted ring-border hover:text-fg',
              ].join(' ')}
            >
              {p}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <svg
              className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.3-4.3" />
            </svg>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索问题 / 类型 / 上下文"
              className="h-7 w-44 rounded-md border border-border bg-bg pl-7 pr-2 text-xs outline-none focus:border-accent sm:w-60"
            />
          </div>
          <button
            onClick={() => downloadCsv(`${fileName}_issues.csv`, issuesToCsv(filtered, project))}
            className="h-7 rounded-md border border-border px-2.5 text-xs text-muted transition hover:bg-surface-2 hover:text-fg"
          >
            下载 CSV
          </button>
          {reportPath && (
            <button
              disabled
              title="报告下载需引擎文件服务，后续接入"
              className="h-7 rounded-md border border-border px-2.5 text-xs text-muted opacity-50"
            >
              下载 .docx
            </button>
          )}
        </div>
      </div>

      {/* 表格 */}
      <div className="max-h-[440px] overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-surface text-xs text-muted">
            <tr className="text-left">
              <th className="w-10 px-3 py-2 font-medium">P</th>
              <th className="w-12 px-2 py-2 font-medium">Sev</th>
              <th className="w-24 px-2 py-2 font-medium">类型</th>
              <th className="px-2 py-2 font-medium">问题</th>
              <th className="w-40 px-3 py-2 font-medium">建议 / 位置</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-10 text-center text-sm text-muted">
                  {total === 0 ? '未发现问题 ✓' : '没有匹配的问题'}
                </td>
              </tr>
            ) : (
              filtered.map((issue, i) => (
                <tr key={i} className="border-t border-border hover:bg-surface-2">
                  <td className="px-3 py-2 align-top">
                    <div className="flex items-center gap-1.5">
                      <PriorityBar priority={issue.priority} />
                      <span className="text-xs text-muted">{issue.priority}</span>
                    </div>
                  </td>
                  <td className="px-2 py-2 align-top">
                    <span
                      className={`inline-flex h-5 items-center rounded-md px-1.5 text-[11px] font-medium ring-1 ring-inset ${SEV_COLOR[issue.severity]}`}
                    >
                      {issue.severity === 'ERROR' ? 'E' : issue.severity === 'WARNING' ? 'W' : 'I'}
                    </span>
                  </td>
                  <td className="px-2 py-2 align-top text-xs text-muted">{issue.issue_type || '—'}</td>
                  <td className="px-2 py-2 align-top">
                    <div className="text-fg">{issue.message}</div>
                    {issue.context && (
                      <div className="mt-0.5 line-clamp-1 font-mono text-[11px] text-muted">
                        {issue.context.slice(0, 200)}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top text-xs text-muted">
                    {issue.suggestion || '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'danger' | 'warn';
}) {
  return (
    <div className="bg-surface px-3 py-2.5">
      <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
      <div
        className={`text-xl font-semibold tnum ${
          tone === 'danger'
            ? 'text-danger'
            : tone === 'warn'
              ? 'text-warn'
              : 'text-fg'
        }`}
      >
        {value}
      </div>
    </div>
  );
}
