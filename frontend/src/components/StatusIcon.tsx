import {
  Clipboard,
  ShieldCheck,
  Inbox,
  Waves,
  FileBarChart,
  Loader2,
  CircleCheckBig,
  CircleX,
} from 'lucide-react';
import type { AuditJobStep } from '@/types';

const ACTIVE = 'text-accent';
const DONE = 'text-ok';
const FAIL = 'text-danger';

interface Props {
  step?: AuditJobStep;
  status?: string;
  activityType?: string;      // 来自 ActivityEvent.type，用于更细粒度的图标
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

/** 审核状态图标 — 根据 step/status/activity 自动选择图标和动效 */
export function StatusIcon({ step, status, activityType, size = 'md', className = '' }: Props) {
  const cls = size === 'sm' ? 'h-3.5 w-3.5' : size === 'lg' ? 'h-6 w-6' : 'h-4 w-4';
  // 用 s 保存 step 避免 TypeScript 控制流收窄
  const s: string | undefined = step;

  // 终态
  if (status === 'error' || s === 'failed')
    return <CircleX className={`${cls} ${FAIL} animate-[shake_0.5s_ease-in-out] ${className}`} />;
  if (status === 'success' || s === 'completed')
    return <CircleCheckBig className={`${cls} ${DONE} animate-bounce ${className}`} />;

  // 根据 activityType 选择更精确的图标
  if (activityType === 'parse')
    return <Clipboard className={`${cls} ${ACTIVE} animate-pulse ${className}`} />;
  if (activityType === 'static_check')
    return <ShieldCheck className={`${cls} ${ACTIVE} animate-pulse ${className}`} />;
  if (activityType === 'queue_wait')
    return <Inbox className={`${cls} ${ACTIVE} animate-bounce ${className}`} />;
  if (activityType === 'agent_call' || s === 'agent_running')
    return <Waves className={`${cls} ${ACTIVE} animate-pulse ${className}`} />;
  if (activityType === 'report' || s === 'finalizing')
    return (
      <span className={`relative inline-block ${className}`}>
        <FileBarChart className={`${cls} ${ACTIVE}`} />
        <Loader2 className="absolute -right-1 -bottom-1 h-2.5 w-2.5 text-accent animate-spin" />
      </span>
    );

  // 兜底
  if (s === 'agent_running')
    return <Waves className={`${cls} ${ACTIVE} animate-pulse ${className}`} />;
  if (s === 'finalizing')
    return (
      <span className={`relative inline-block ${className}`}>
        <FileBarChart className={`${cls} ${ACTIVE}`} />
        <Loader2 className="absolute -right-1 -bottom-1 h-2.5 w-2.5 text-accent animate-spin" />
      </span>
    );
  return <Clipboard className={`${cls} ${ACTIVE} animate-pulse ${className}`} />;
}

/** 步骤点中的状态图标（更小，用于 StepDots） */
export function StepIcon({ step, active, done }: { step?: AuditJobStep; active: boolean; done: boolean }) {
  if (done && !active) return <CircleCheckBig className="h-3 w-3 text-ok" />;
  if (active) return <StatusIcon step={step} size="sm" />;
  return <span className="h-3 w-3 rounded-full bg-surface-2" />;
}
