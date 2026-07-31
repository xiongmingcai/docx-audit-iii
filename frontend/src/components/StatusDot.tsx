import type { IIIConnectionState } from '@/sdk/client';

const MAP: Record<IIIConnectionState, { color: string; label: string; pulse: boolean }> = {
  connected: { color: 'bg-ok', label: 'Live', pulse: false },
  connecting: { color: 'bg-warn', label: 'Connecting', pulse: true },
  reconnecting: { color: 'bg-warn', label: 'Reconnecting', pulse: true },
  disconnected: { color: 'bg-muted', label: 'Offline', pulse: false },
  failed: { color: 'bg-danger', label: 'Failed', pulse: false },
};

export function StatusDot({ state }: { state: IIIConnectionState }) {
  const m = MAP[state];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted">
      <span className={`relative inline-block h-2 w-2 rounded-full ${m.color} ${m.pulse ? 'pulse-dot' : ''}`} />
      <span className="tnum">{m.label}</span>
    </span>
  );
}
