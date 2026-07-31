import type { AuditIssue } from '@/types';

interface Props {
  issues: AuditIssue[];
  project?: string;
  fileName?: string;
}

/** 完成态：问题类型分布可视化 + CSV 下载 */
export function IssueChart({ issues, project = 'DOC', fileName = 'audit' }: Props) {
  // 按类型分组计数
  const typeMap = new Map<string, { count: number; severity: string }>();
  for (const i of issues) {
    const t = i.issue_type || i.rule_id || '其他';
    const existing = typeMap.get(t);
    if (existing) {
      existing.count++;
    } else {
      typeMap.set(t, { count: 1, severity: i.severity ?? 'INFO' });
    }
  }
  const entries = [...typeMap.entries()]
    .map(([type, { count, severity }]) => ({ type, count, severity }))
    .sort((a, b) => b.count - a.count);
  const maxCount = entries[0]?.count ?? 1;

  const errors = issues.filter((i) => i.severity === 'ERROR').length;
  const warnings = issues.filter((i) => i.severity === 'WARNING').length;

  if (entries.length === 0) {
    return (
      <div className="rounded-lg border border-ok/30 bg-ok/5 p-4 text-center text-sm text-ok">
        ✓ 未发现问题
      </div>
    );
  }

  const downloadCsv = () => {
    const header = 'Key,P,类型,问题,修改建议';
    const rows = issues.map((i, idx) => {
      const key = `${project}-${String(idx + 1).padStart(3, '0')}`;
      return [key, i.priority ?? '', i.issue_type ?? i.rule_id ?? '', i.message ?? '', i.suggestion ?? '']
        .map((c) => `"${(c ?? '').replace(/"/g, '""')}"`)
        .join(',');
    });
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileName.replace(/\.docx$/i, '')}_audit_report.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium">问题分布</h3>
        <div className="flex items-center gap-2">
          <span className="tnum text-xs text-muted">
            ERROR {errors} · WARNING {warnings} · 共 {issues.length}
          </span>
          <button
            onClick={downloadCsv}
            className="rounded border border-accent/50 bg-accent/10 px-2 py-0.5 text-[11px] text-accent transition hover:bg-accent/20"
          >
            📥 下载 CSV
          </button>
        </div>
      </div>
      <div className="space-y-1.5">
        {entries.slice(0, 10).map(({ type, count, severity }) => {
          const pct = Math.max(8, (count / maxCount) * 100);
          const color =
            severity === 'ERROR'
              ? 'bg-danger/70'
              : severity === 'WARNING'
                ? 'bg-warn/70'
                : 'bg-accent/50';
          return (
            <div key={type} className="flex items-center gap-2 text-[11px]">
              <span className="w-20 shrink-0 truncate text-fg/70" title={type}>
                {type}
              </span>
              <div className="h-3 flex-1 overflow-hidden rounded-full bg-surface-2">
                <div
                  className={`h-full rounded-full ${color} transition-all`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="tnum w-8 shrink-0 text-right font-medium text-fg/80">{count}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
