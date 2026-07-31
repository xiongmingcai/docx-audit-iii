import type { LucideIcon } from 'lucide-react';
import { Check } from 'lucide-react';

interface Stage {
  id: string;
  label: string;
  icon: LucideIcon;
  status: 'done' | 'active' | 'pending' | 'error';
  detail?: string;
}

interface Props {
  stages: Stage[];
  activeBatch?: { current: number; total: number };
}

/**
 * 审核管线流程图
 * 每个阶段是一个节点，活跃阶段呼吸发光，Agent 阶段内嵌子批次进度条
 */
export function PipelineFlow({ stages, activeBatch }: Props) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      {/* 管线节点 */}
      <div className="flex items-center justify-between gap-1">
        {stages.map((stage, i) => {
          const isLast = i === stages.length - 1;
          return (
            <div key={stage.id} className="flex flex-1 items-center">
              {/* 节点 */}
              <div className="flex flex-col items-center gap-1">
                <StageNode stage={stage} />
                <span
                  className={[
                    'text-[10px] font-medium',
                    stage.status === 'active' ? 'text-accent' : '',
                    stage.status === 'done' ? 'text-fg/70' : '',
                    stage.status === 'pending' ? 'text-muted' : '',
                    stage.status === 'error' ? 'text-danger' : '',
                  ].join(' ')}
                >
                  {stage.label}
                </span>
                {/* Agent 阶段的子批次进度条 */}
                {stage.id === 'agent' && stage.status === 'active' && activeBatch && activeBatch.total > 0 && (
                  <BatchDots current={activeBatch.current} total={activeBatch.total} />
                )}
                {/* 活跃阶段的动态描述 */}
                {stage.status === 'active' && stage.detail && (
                  <span className="max-w-[120px] truncate text-[9px] text-accent" title={stage.detail}>
                    {stage.detail}
                  </span>
                )}
              </div>
              {/* 连接线 */}
              {!isLast && <ConnectorLine status={stage.status} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StageNode({ stage }: { stage: Stage }) {
  const { icon: Icon } = stage;

  if (stage.status === 'done') {
    return (
      <span className="grid h-8 w-8 place-items-center rounded-full bg-accent/10 text-accent">
        <Check className="h-4 w-4" strokeWidth={3} />
      </span>
    );
  }

  if (stage.status === 'active') {
    return (
      <span className="breathe grid h-8 w-8 place-items-center rounded-full bg-accent/15 text-accent ring-2 ring-accent/30">
        <Icon className="h-4 w-4" />
      </span>
    );
  }

  if (stage.status === 'error') {
    return (
      <span className="grid h-8 w-8 place-items-center rounded-full bg-danger/10 text-danger">
        <Icon className="h-4 w-4" />
      </span>
    );
  }

  // pending
  return (
    <span className="grid h-8 w-8 place-items-center rounded-full bg-surface-2 text-muted">
      <Icon className="h-4 w-4" />
    </span>
  );
}

function ConnectorLine({ status }: { status: string }) {
  // 已完成 → 实线 accent
  if (status === 'done') {
    return <div className="mx-1 h-[2px] flex-1 rounded-full bg-accent" />;
  }
  // 活跃 → 流动虚线
  if (status === 'active') {
    return (
      <svg className="mx-1 h-[2px] flex-1" preserveAspectRatio="none" viewBox="0 0 100 2">
        <line
          x1="0" y1="1" x2="100" y2="1"
          stroke="var(--color-accent)"
          strokeWidth="2"
          strokeDasharray="8 4"
          className="flow-line"
        />
      </svg>
    );
  }
  // 待处理 → 虚线 muted
  return <div className="mx-1 h-[2px] flex-1 rounded-full border-t border-dashed border-border" />;
}

/** Agent 阶段的子批次进度点 */
function BatchDots({ current, total }: { current: number; total: number }) {
  return (
    <div className="mt-1 flex flex-col items-center gap-0.5">
      <div className="flex gap-[3px]">
        {Array.from({ length: total }, (_, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <span
              key={i}
              className={[
                'h-1.5 w-3 rounded-sm transition-all',
                done ? 'bg-accent' : '',
                active ? 'animate-pulse bg-accent/60' : '',
                !done && !active ? 'bg-surface-2' : '',
              ].join(' ')}
            />
          );
        })}
      </div>
      <span className="tnum text-[9px] text-muted">
        {current}/{total} 批
      </span>
    </div>
  );
}
