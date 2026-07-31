import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { connect, useStore } from '@/store';

interface WorkerInfo {
  name?: string;
  runtime?: string;
  description?: string;
  functions?: string[];
  state?: string;
}

/**
 * 只读：列出引擎侧已注册的 workers。
 * 触发 engine::workers::list 获取；若引擎未实现该内置 Function，回退显示本浏览器 worker。
 */
export function Workers() {
  const settings = useStore((s) => s.settings);
  const connection = useStore((s) => s.connection);
  const [workers, setWorkers] = useState<WorkerInfo[]>([]);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const client = await connect();
      const res = await client.trigger<{ detail?: boolean }, WorkerInfo[] | { workers: WorkerInfo[] }>({
        function_id: 'engine::workers::list',
        payload: { detail: true },
      });
      const list = Array.isArray(res) ? res : (res as { workers?: WorkerInfo[] }).workers ?? [];
      setWorkers(list);
    } catch {
      // 回退：至少显示本浏览器 worker
      setWorkers([
        {
          name: settings.workerName,
          runtime: 'browser',
          description: 'docx-audit-ui（本浏览器）',
          functions: ['docx::audit（触发）'],
          state: connection,
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection]);

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Workers</h1>
          <p className="text-sm text-muted">引擎已注册的 Worker 与能力</p>
        </div>
        <button
          onClick={() => {
            void load();
            toast.info('已刷新');
          }}
          disabled={loading}
          className="h-8 rounded-md border border-border px-3 text-sm text-muted transition hover:bg-surface-2 hover:text-fg disabled:opacity-50"
        >
          {loading ? '刷新中…' : '刷新'}
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {workers.length === 0 && !loading ? (
          <div className="col-span-full rounded-lg border border-border px-3 py-10 text-center text-sm text-muted">
            暂无 Worker
          </div>
        ) : (
          workers.map((w, i) => (
            <div key={w.name ?? i} className="rounded-lg border border-border bg-surface p-4">
              <div className="flex items-center gap-2">
                <span className="grid h-7 w-7 place-items-center rounded-md bg-accent/15 text-xs font-semibold text-accent">
                  {(w.name ?? 'W').slice(0, 1).toUpperCase()}
                </span>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{w.name ?? 'unnamed'}</div>
                  <div className="text-xs text-muted">{w.runtime ?? '—'}</div>
                </div>
              </div>
              {w.description && (
                <p className="mt-2 line-clamp-2 text-xs text-muted">{w.description}</p>
              )}
              {w.functions && w.functions.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1">
                  {w.functions.slice(0, 6).map((fn) => (
                    <span
                      key={fn}
                      className="rounded-md border border-border bg-bg px-1.5 py-0.5 font-mono text-[10px] text-muted"
                    >
                      {fn}
                    </span>
                  ))}
                  {w.functions.length > 6 && (
                    <span className="text-[10px] text-muted">+{w.functions.length - 6}</span>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
