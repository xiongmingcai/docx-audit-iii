import { useState } from 'react';

/** 可复用的 Job ID 展示 + 复制组件 */
export function JobIdChip({
  jobId,
  label = 'Job ID',
  showCopy = true,
}: {
  jobId: string;
  label?: string;
  showCopy?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const short = jobId.length > 16 ? `${jobId.slice(0, 8)}…${jobId.slice(-6)}` : jobId;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(jobId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  return (
    <span className="inline-flex items-center gap-1 font-mono text-[11px] text-muted">
      <span className="text-fg/60">{label}</span>
      <span title={jobId}>{short}</span>
      {showCopy && (
        <button
          onClick={copy}
          className="grid h-4 w-4 place-items-center rounded text-muted transition hover:bg-surface-2 hover:text-fg"
          title="复制完整 ID"
        >
          {copied ? (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="text-ok">
              <path d="M20 6L9 17l-5-5" />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="9" y="9" width="13" height="13" rx="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          )}
        </button>
      )}
    </span>
  );
}
