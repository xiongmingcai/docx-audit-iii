/**
 * useAuditJob — 新作业提交 hook。
 *
 * 不再维护本地 step 状态机（之前用 setTimeout 伪造进度，与实际脱节）。
 * audit_start 是同步调用（秒级返回 job_id），提交后立即跳转到 JobDetail。
 * JobDetail 通过轮询 backend state 获取真实进度。
 */

import { useCallback, useState } from 'react';
import { runAudit, uploadAndAudit } from '@/store';
import type { AuditResult } from '@/types';

export type Phase = 'idle' | 'running' | 'success' | 'error';

export function useAuditJob() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<AuditResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setPhase('idle');
    setResult(null);
    setError(null);
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

      try {
        const res = await runAudit(input);
        setResult(res);
        setPhase(res.ok ? 'success' : 'error');
        if (!res.ok && res.error) setError(res.error);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setPhase('error');
      }
    },
    [reset],
  );

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

      try {
        const res = await uploadAndAudit(input.file, {
          project: input.project,
          useLlm: input.useLlm,
          checkComments: input.checkComments,
          onProgress: input.onProgress,
        });
        setResult(res);
        setPhase(res.ok ? 'success' : 'error');
        if (!res.ok && res.error) setError(res.error);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setPhase('error');
      }
    },
    [reset],
  );

  return { phase, result, error, submit, submitFile, reset };
}
