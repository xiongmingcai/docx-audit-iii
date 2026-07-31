import { useState } from 'react';
import { useStore, reconnect, setTheme } from '@/store';
import { StatusDot } from './StatusDot';
import { TaskTray } from './TaskTray';

export function TopBar() {
  const connection = useStore((s) => s.connection);
  const rttMs = useStore((s) => s.rttMs);
  const settings = useStore((s) => s.settings);
  const theme = useStore((s) => s.theme);
  const runningCount = useStore((s) => s.runningCount);
  const hasFailed = useStore((s) => s.jobs.some((j) => j.status === 'error'));
  const [trayOpen, setTrayOpen] = useState(false);

  return (
    <header className="sticky top-0 z-20 flex h-12 items-center justify-between border-b border-border bg-surface/80 px-4 backdrop-blur">
      <div className="flex items-center gap-2.5">
        <span className="grid h-6 w-6 place-items-center rounded-md bg-accent text-[11px] font-semibold text-accent-fg">
          iii
        </span>
        <span className="text-sm font-medium tracking-tight">Docx Audit</span>
        <span className="hidden text-xs text-muted sm:inline">文生文文档审核</span>
      </div>

      <div className="flex items-center gap-4">
        <div className="hidden items-center gap-3 text-xs text-muted md:flex">
          <StatusDot state={connection} />
          {rttMs != null && connection === 'connected' && (
            <span className="tnum">{rttMs}ms</span>
          )}
          <span className="truncate font-mono text-[11px] opacity-70">{settings.engineUrl}</span>
        </div>

        <select
          value={settings.defaultProject}
          onChange={() => void reconnect()}
          className="h-7 rounded-md border border-border bg-surface px-2 text-xs text-fg outline-none focus:border-accent"
          aria-label="当前项目"
        >
          <option value={settings.defaultProject}>{settings.defaultProject}</option>
        </select>

        {/* 任务铃 */}
        <button
          type="button"
          onClick={() => setTrayOpen((v) => !v)}
          className={[
            'relative grid h-7 w-7 place-items-center rounded-md border text-muted transition hover:bg-surface-2 hover:text-fg',
            trayOpen ? 'border-accent text-accent' : 'border-border',
            hasFailed ? 'text-danger' : '',
          ].join(' ')}
          aria-label="后台任务"
          title="后台任务"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
          {runningCount > 0 && (
            <span
              className={[
                'absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] font-medium',
                hasFailed ? 'bg-danger text-danger-fg' : 'bg-accent text-accent-fg',
              ].join(' ')}
            >
              {runningCount}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className="grid h-7 w-7 place-items-center rounded-md border border-border text-muted transition hover:bg-surface-2 hover:text-fg"
          aria-label="切换主题"
          title="切换主题"
        >
          {theme === 'dark' ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          )}
        </button>
      </div>

      {/* 任务托盘（全局） */}
      <TaskTray open={trayOpen} onClose={() => setTrayOpen(false)} />
    </header>
  );
}
