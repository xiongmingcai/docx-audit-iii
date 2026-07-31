import { useCallback, useEffect, useRef, useState } from 'react';
import { runAudit, uploadAndAudit } from '@/store';
import type { AuditResult } from '@/types';
import type { Step } from '@/components/StepRail';

export type Phase = 'idle' | 'running' | 'success' | 'error';

const INITIAL_STEPS: Step[] = [
  { key: 'parse', label: '解析', status: 'pending' },
  { key: 'static', label: '静态检查', status: 'pending' },
  { key: 'agent', label: 'Agent 检查', status: 'pending' },
  { key: 'report', label: '报告', status: 'pending' },
];

/**
 * 本地 step 状态机 + 触发 docx::audit。
 *
 * 进度推进策略：由于 docx::audit 是单次同步 trigger（返回完整结果），
 * 真实 per-step 事件尚未由后端发出。这里用「预估耗时」做渐进式推进，
 * 待结果返回后一次性对齐到终态。
 *
 * 替换为 state/stream 事件时：只需在 subscribe 回调里根据
 * state key `audit:{jobId}:step` 设置对应 step 状态，接口不变。
 */
export function useAuditJob() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [steps, setSteps] = useState<Step[]>(INITIAL_STEPS);
  const [stats, setStats] = useState<{ paragraphs: number; headings: number; tables: number } | null>(null);
  const [currentFn, setCurrentFn] = useState<string>('');
  const [result, setResult] = useState<AuditResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    return () => {
      timers.current.forEach(clearTimeout);
    };
  }, []);

  const reset = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setPhase('idle');
    setSteps(INITIAL_STEPS);
    setStats(null);
    setCurrentFn('');
    setResult(null);
    setError(null);
  }, []);

  /** 本地推进：按预估时间逐步点亮各步，制造「引擎在跑」的实时体感 */
  const startLocalProgress = useCallback((useLlm: boolean) => {
    const sequence: { key: string; fn: string; delay: number }[] = [
      { key: 'parse', fn: 'docx::parse', delay: 0 },
      { key: 'static', fn: 'docx::check_*', delay: 500 },
      ...(useLlm
        ? [
            { key: 'agent', fn: 'docx::check_table_refs_agent', delay: 1200 },
            { key: 'report', fn: 'docx::generate_report', delay: 2800 },
          ]
        : [{ key: 'report', fn: 'docx::generate_report', delay: 1200 }]),
    ];

    // 先把 agent 步标记为跳过（无 LLM 时）
    if (!useLlm) {
      setSteps((prev) =>
        prev.map((s) => (s.key === 'agent' ? { ...s, status: 'done' as const, detail: '跳过' } : s)),
      );
    }

    sequence.forEach(({ key, fn, delay }, idx) => {
      const t = setTimeout(() => {
        setCurrentFn(fn);
        setSteps((prev) =>
          prev.map((s) => {
            if (s.key === key) return { ...s, status: 'active' as const, detail: '进行中' };
            // 前一步完成
            const prevSeq = sequence[idx - 1];
            if (prevSeq && s.key === prevSeq.key) {
              return { ...s, status: 'done' as const, detail: '完成' };
            }
            return s;
          }),
        );
      }, delay);
      timers.current.push(t);
    });
  }, []);

  const submit = useCallback(
    async (input: {
      project: string;
      path: string;
      fileName: string;
      useLlm: boolean;
      checkComments: boolean;
    }) => {
      reset();
      setPhase('running');
      startLocalProgress(input.useLlm);

      try {
        const res = await runAudit(input);
        // 对齐终态
        timers.current.forEach(clearTimeout);
        timers.current = [];
        const agentSkipped = !input.useLlm;
        setSteps(
          INITIAL_STEPS.map((s) => {
            if (s.key === 'agent' && agentSkipped) {
              return { ...s, status: 'done', detail: '跳过（无 LLM）' };
            }
            return { ...s, status: 'done', detail: '完成' };
          }),
        );
        setCurrentFn('');
        setStats({
          paragraphs: res.stats?.paragraphs ?? 0,
          headings: res.stats?.headings ?? 0,
          tables: res.stats?.tables ?? 0,
        });
        setResult(res);
        setPhase(res.ok ? 'success' : 'error');
        if (!res.ok && res.error) setError(res.error);
      } catch (e) {
        timers.current.forEach(clearTimeout);
        timers.current = [];
        setSteps((prev) =>
          prev.map((s) =>
            s.status === 'active' ? { ...s, status: 'error', detail: '失败' } : s,
          ),
        );
        setCurrentFn('');
        setError(e instanceof Error ? e.message : String(e));
        setPhase('error');
      }
    },
    [reset, startLocalProgress],
  );

  // 通过 iii Channel 流式上传文件并审核
  const submitFile = useCallback(
    async (input: {
      file: File;
      project: string;
      useLlm: boolean;
      checkComments: boolean;
      onProgress?: (sent: number, total: number) => void;
    }) => {
      reset();
      setPhase('running');
      startLocalProgress(input.useLlm);

      try {
        const res = await uploadAndAudit(input.file, {
          project: input.project,
          useLlm: input.useLlm,
          checkComments: input.checkComments,
          onProgress: input.onProgress,
        });
        timers.current.forEach(clearTimeout);
        timers.current = [];
        const agentSkipped = !input.useLlm;
        setSteps(
          INITIAL_STEPS.map((s) => {
            if (s.key === 'agent' && agentSkipped) {
              return { ...s, status: 'done', detail: '跳过（无 LLM）' };
            }
            return { ...s, status: 'done', detail: '完成' };
          }),
        );
        setCurrentFn('');
        setStats({
          paragraphs: res.stats?.paragraphs ?? 0,
          headings: res.stats?.headings ?? 0,
          tables: res.stats?.tables ?? 0,
        });
        setResult(res);
        setPhase(res.ok ? 'success' : 'error');
        if (!res.ok && res.error) setError(res.error);
      } catch (e) {
        timers.current.forEach(clearTimeout);
        timers.current = [];
        setSteps((prev) =>
          prev.map((s) =>
            s.status === 'active' ? { ...s, status: 'error', detail: '失败' } : s,
          ),
        );
        setCurrentFn('');
        setError(e instanceof Error ? e.message : String(e));
        setPhase('error');
      }
    },
    [reset, startLocalProgress],
  );

  return { phase, steps, stats, currentFn, result, error, submit, submitFile, reset };
}
