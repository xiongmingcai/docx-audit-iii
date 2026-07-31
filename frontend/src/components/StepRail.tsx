export type StepStatus = 'done' | 'active' | 'pending' | 'error';

export interface Step {
  key: string;
  label: string;
  detail?: string;
  status: StepStatus;
}

/**
 * 流水线进度条。
 *
 * 当前实现为本地 step 状态机：按后端 4 阶段推进。
 * 设计文档建议后续替换为 iii state / stream 事件驱动：
 *   - 后端在 docx::audit 各阶段 state::set('audit:{jobId}:step', ...)
 *   - 本组件订阅 state 变更即可，接口不变。
 */
export function StepRail({ steps }: { steps: Step[] }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <ol className="flex items-start gap-2">
        {steps.map((step, i) => {
          const last = i === steps.length - 1;
          return (
            <li key={step.key} className="flex flex-1 items-start gap-2">
              <div className="flex flex-col items-center">
                <StepNode step={step} />
                {!last && (
                  <div
                    className={[
                      'mt-2 h-px w-12',
                      step.status === 'done' ? 'bg-accent' : 'bg-border',
                    ].join(' ')}
                  />
                )}
              </div>
              <div className="min-w-0 pt-0.5">
                <div className="truncate text-sm font-medium text-fg">{step.label}</div>
                {step.detail && (
                  <div className="truncate text-xs text-muted">{step.detail}</div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function StepNode({ step }: { step: Step }) {
  const base = 'relative grid h-7 w-7 place-items-center rounded-full text-xs font-medium ring-1 ring-inset';
  switch (step.status) {
    case 'done':
      return (
        <span className={`${base} bg-accent text-accent-fg ring-accent`}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M20 6L9 17l-5-5" />
          </svg>
        </span>
      );
    case 'active':
      return (
        <span className={`${base} text-accent ring-accent pulse-dot`}>
          {step.detail ? '' : '●'}
        </span>
      );
    case 'error':
      return <span className={`${base} bg-danger text-white ring-danger`}>✕</span>;
    case 'pending':
    default:
      return <span className={`${base} text-muted ring-border`}>○</span>;
  }
}
