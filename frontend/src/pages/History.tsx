import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore, clearJobs } from '@/store';
import { issuesToCsv, downloadCsv } from '@/lib/csv';

function formatTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}-${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDuration(ms?: number): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function History() {
  const jobs = useStore((s) => s.jobs);
  const navigate = useNavigate();
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return jobs.filter(
      (j) =>
        q === '' ||
        j.project.toLowerCase().includes(q) ||
        j.fileName.toLowerCase().includes(q),
    );
  }, [jobs, query]);

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">历史作业</h1>
          <p className="text-sm text-muted">共 {jobs.length} 次审核</p>
        </div>
        {jobs.length > 0 && (
          <button
            onClick={() => {
              if (confirm('清空本地历史记录？')) clearJobs();
            }}
            className="h-8 rounded-md border border-border px-3 text-sm text-muted transition hover:bg-surface-2 hover:text-fg"
          >
            清空
          </button>
        )}
      </div>

      <div className="relative">
        <svg
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
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
          placeholder="搜索项目 / 文件名"
          className="h-8 w-full max-w-sm rounded-md border border-border bg-surface pl-8 pr-2 text-sm outline-none focus:border-accent"
        />
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted">
            <tr className="border-b border-border text-left">
              <th className="px-3 py-2.5 font-medium">时间</th>
              <th className="px-3 py-2.5 font-medium">项目</th>
              <th className="px-3 py-2.5 font-medium">文档</th>
              <th className="px-3 py-2.5 font-medium">结果</th>
              <th className="px-3 py-2.5 font-medium">耗时</th>
              <th className="px-3 py-2.5 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-12 text-center text-sm text-muted">
                  {jobs.length === 0 ? '暂无审核记录' : '没有匹配的作业'}
                </td>
              </tr>
            ) : (
              filtered.map((job) => {
                const summary = job.result?.summary;
                return (
                  <tr key={job.id} className="border-t border-border hover:bg-surface-2">
                    <td className="px-3 py-2.5 text-xs text-muted tnum">{formatTime(job.createdAt)}</td>
                    <td className="px-3 py-2.5 font-mono text-xs">{job.project}</td>
                    <td className="max-w-xs truncate px-3 py-2.5 text-xs">{job.fileName}</td>
                    <td className="px-3 py-2.5">
                      {job.status === 'success' && summary ? (
                        <span className="text-xs">
                          <span className="font-medium text-danger">{summary.errors}E</span>
                          {' / '}
                          <span className="font-medium text-warn">{summary.warnings}W</span>
                        </span>
                      ) : job.status === 'error' ? (
                        <span className="rounded-md bg-danger/15 px-1.5 py-0.5 text-[11px] font-medium text-danger">
                          失败
                        </span>
                      ) : (
                        <span className="text-xs text-muted">{job.status}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-muted tnum">{formatDuration(job.durationMs)}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => navigate(`/jobs/${job.id}`)}
                          className="text-xs text-accent hover:underline"
                        >
                          打开
                        </button>
                        {job.result?.issues && job.result.issues.length > 0 && (
                          <button
                            onClick={() =>
                              downloadCsv(
                                `${job.fileName}_issues.csv`,
                                issuesToCsv(job.result!.issues ?? [], job.project),
                              )
                            }
                            className="text-xs text-muted hover:text-fg"
                          >
                            报告
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
