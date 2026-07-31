import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { useStore, connect, startBackgroundAudit, startBackgroundAuditFile } from '@/store';
import { StatusDot } from '@/components/StatusDot';
import { IssueTable } from '@/components/IssueTable';
import { JobIdChip } from '@/components/JobIdChip';
import type { IIIConnectionState } from '@/sdk/client';
import { fetchConfig } from '@/lib/config';

const SAMPLE_FILES = [
  '技术说明书+M1212产品规范、技术说明、维护说明.docx',
  '维护说明.docx',
  '产品规范.docx',
];

function connectionBlocked(s: IIIConnectionState): boolean {
  return s !== 'connected';
}

export function NewJob() {
  const connection = useStore((s) => s.connection);
  const settings = useStore((s) => s.settings);
  const runningCount = useStore((s) => s.runningCount);
  // 最近提交的 job（用于摘要卡）
  const activeJob = useStore((s) => (s.activeJobId ? s.jobs.find((j) => j.id === s.activeJobId) : undefined));

  const [path, setPath] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [useLlm, setUseLlm] = useState(true);
  const [checkComments, setCheckComments] = useState(true);
  const [uploadProgress, setUploadProgress] = useState<{ sent: number; total: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [llmConfigured, setLlmConfigured] = useState(true); // 默认乐观，拉取后修正
  const [submitting, setSubmitting] = useState(false); // 仅接单阶段的短暂 loading
  const navigate = useNavigate();

  // 拉取 worker 配置，判断 LLM key 是否已配置
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const client = await connect();
        const res = await fetchConfig(client);
        const keySet =
          res.llm &&
          typeof res.llm === 'object' &&
          'LLM_API_KEY' in res.llm &&
          (res.llm.LLM_API_KEY as { set?: boolean })?.set;
        if (!cancelled) setLlmConfigured(Boolean(keySet));
      } catch {
        // 离线时保持乐观
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const blocked = connectionBlocked(connection);

  const onPickSample = (name: string) => {
    setPath(`projects/${settings.defaultProject}/results/${name}`);
    setFile(null);
  };

  const onFile = (f: File | null) => {
    setFile(f);
    setPath(f ? `（上传）${f.name}` : '');
  };

  const onSubmit = async () => {
    if (blocked) {
      toast.error('未连接到 iii 引擎，请稍后再试');
      return;
    }
    if (file) {
      setSubmitting(true);
      setUploadProgress({ sent: 0, total: file.size });
      try {
        const { jobId, traceId } = await startBackgroundAuditFile(file, {
          project: settings.defaultProject,
          useLlm,
          checkComments,
          onProgress: (sent, total) => setUploadProgress({ sent, total }),
        });
        setSubmitting(false);
        setUploadProgress(null);
        toast.success(
          `✓ 已提交后台审核 · 静态检查完成 · Agent 质检进行中\n${jobId}${traceId ? ` · Trace ${traceId.slice(0, 8)}…` : ''}`,
          { duration: 6000 },
        );
        // 保留表单，允许立刻再提交下一单
      } catch (e) {
        setSubmitting(false);
        setUploadProgress(null);
        toast.error(`提交失败：${e instanceof Error ? e.message : String(e)}`);
      }
      return;
    }
    const value = path.trim();
    if (!value) {
      toast.error('请先上传文档或输入路径');
      return;
    }
    const fileName = value.split('/').pop() ?? value;
    setSubmitting(true);
    try {
      const { jobId, traceId } = await startBackgroundAudit({
        project: settings.defaultProject,
        path: value,
        fileName,
        useLlm,
        checkComments,
      });
      setSubmitting(false);
      toast.success(
        `✓ 已提交后台审核 · 静态检查完成 · Agent 质检进行中\n${jobId}${traceId ? ` · Trace ${traceId.slice(0, 8)}…` : ''}`,
        { duration: 6000 },
      );
      // 保留表单，允许立刻再提交下一单
    } catch (e) {
      setSubmitting(false);
      toast.error(`提交失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  // 摘要卡数据（来自 store 的实时进度）
  const summaryIssues = activeJob?.issueCount ?? 0;
  const summaryTotalBatches = activeJob?.totalBatches ?? 0;
  const summaryDoneBatches = activeJob?.doneBatches ?? 0;
  const summaryStatus = activeJob?.status;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">审核作业</h1>
          <p className="text-sm text-muted">
            上传 / 选择文档 → 后台审核 · 提交后可在右上角 <span className="font-mono">🔔</span> 查看进度
          </p>
        </div>
        {runningCount > 0 && (
          <button
            onClick={() => navigate('/jobs')}
            className="rounded-md border border-border px-3 py-1.5 text-xs text-muted transition hover:bg-surface-2 hover:text-fg"
          >
            查看后台任务（{runningCount}）
          </button>
        )}
      </div>

      {/* 连接空态 */}
      {blocked && (
        <div className="flex items-center justify-between rounded-lg border border-warn/40 bg-warn/10 px-4 py-3 text-sm">
          <div className="flex items-center gap-2 text-warn">
            <StatusDot state={connection} />
            <span>
              未连接到 iii 引擎 · <span className="font-mono">{settings.engineUrl}</span>
            </span>
          </div>
          <span className="text-xs text-muted">请确认 Worker Manager 浏览器端口已启动</span>
        </div>
      )}

      {/* ── Zone A: 输入 & 触发 ─────────────────────────────────── */}
      <section className="rounded-lg border border-border bg-surface p-4">
        <h2 className="mb-3 text-sm font-medium text-muted">作业输入</h2>

        <div className="flex flex-col gap-3 sm:flex-row">
          {/* 文件上传区：拖拽或选择 .docx */}
          <label
            className={[
              'flex flex-1 cursor-pointer select-none flex-col items-center justify-center rounded-md border border-dashed px-4 py-6 text-center transition',
              dragOver ? 'border-accent bg-accent/5' : 'border-border bg-bg hover:border-accent',
              file ? 'border-ok/50' : '',
            ].join(' ')}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const f = e.dataTransfer.files?.[0];
              if (f) onFile(f);
            }}
          >
            {file ? (
              <>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-ok">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
                <span className="mt-2 text-sm text-fg">{file.name}</span>
                <span className="text-xs text-muted">{(file.size / 1024).toFixed(1)} KB · 点击或拖拽更换</span>
              </>
            ) : (
              <>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
                </svg>
                <span className="mt-2 text-sm text-muted">
                  拖拽 <span className="font-mono text-fg">.docx</span> 到此处，或点击选择文件
                </span>
                <span className="text-xs text-muted">文件经 iii Channel 流式上传，无大小限制</span>
              </>
            )}
            <input
              type="file"
              accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="hidden"
              onChange={(e) => onFile(e.target.files?.[0] ?? null)}
            />
          </label>

          {/* 示例 / 路径输入 */}
          <div className="flex flex-col gap-1.5 sm:w-64">
            <span className="text-xs text-muted">项目示例（路径模式）</span>
            <div className="flex flex-1 flex-col gap-1.5">
              {SAMPLE_FILES.map((name) => (
                <button
                  key={name}
                  onClick={() => onPickSample(name)}
                  className="truncate rounded-md border border-border bg-bg px-3 py-1.5 text-left text-xs text-fg transition hover:border-accent"
                >
                  {name}
                </button>
              ))}
            </div>
            <div className="mt-1">
              <input
                value={file ? '' : path}
                onChange={(e) => {
                  setPath(e.target.value);
                  setFile(null);
                }}
                placeholder="或输入 projects/.../doc.docx"
                className="h-8 w-full rounded-md border border-border bg-surface px-2 text-xs outline-none focus:border-accent"
              />
            </div>
          </div>
        </div>

        {/* 上传进度 */}
        {uploadProgress && uploadProgress.total > 0 && (
          <div className="mt-3">
            <div className="mb-1 flex justify-between text-xs text-muted">
              <span>流式上传中…</span>
              <span className="tnum">{((uploadProgress.sent / uploadProgress.total) * 100).toFixed(0)}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full rounded-full bg-accent transition-all"
                style={{ width: `${(uploadProgress.sent / uploadProgress.total) * 100}%` }}
              />
            </div>
          </div>
        )}

        {/* 选项 */}
        <div className="mt-4 flex flex-wrap items-center gap-4 text-sm">
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={checkComments}
              onChange={(e) => setCheckComments(e.target.checked)}
              className="h-4 w-4 rounded border-border accent-accent"
            />
            <span>批注检测</span>
          </label>
          <div className="flex items-center gap-2">
            <label
              className={[
                'flex items-center gap-2 text-sm',
                llmConfigured ? 'cursor-pointer' : 'cursor-not-allowed opacity-60',
              ].join(' ')}
            >
              <input
                type="checkbox"
                checked={useLlm && llmConfigured}
                disabled={!llmConfigured}
                onChange={(e) => setUseLlm(e.target.checked)}
                className="h-4 w-4 rounded border-border accent-accent disabled:cursor-not-allowed"
              />
              <span>
                Agent 语言质量 <span className="text-muted">（需 LLM）</span>
              </span>
            </label>
            {!llmConfigured && (
              <button
                onClick={() => navigate('/settings')}
                className="text-xs text-accent hover:underline"
              >
                未配置 LLM，前往设置 →
              </button>
            )}
          </div>
        </div>

        <div className="mt-2 text-xs text-muted">
          报告将写入 <span className="font-mono">projects/{'{'}project{'}'}/results/_audit_report.docx</span>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={onSubmit}
            disabled={submitting || blocked}
            className={[
              'h-8 rounded-md bg-accent px-4 text-sm font-medium text-accent-fg transition',
              submitting || blocked ? 'cursor-not-allowed opacity-50' : 'hover:opacity-90',
            ].join(' ')}
          >
            {submitting ? '接单中…' : '开始审核 →'}
          </button>
          <span className="text-xs text-muted">提交后立即返回，Agent 质检在后台运行</span>
        </div>
      </section>

      {/* ── 当前作业摘要卡（可离开，数据来自 store 实时进度）──────── */}
      {activeJob && summaryStatus === 'running' && (
        <section className="rounded-lg border border-accent/40 bg-accent/5 p-4">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">当前作业</div>
            <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium text-accent">后台运行中</span>
          </div>
          <div className="mt-1.5">
            <JobIdChip jobId={activeJob.id} />
          </div>
          <div className="mt-2 flex items-center gap-2 text-xs text-muted">
            <span className="truncate">{activeJob.fileName}</span>
            <span>·</span>
            <span>
              {summaryTotalBatches > 0
                ? `Agent 质检 ${summaryDoneBatches}/${summaryTotalBatches} 批`
                : '静态检查完成'}
            </span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-accent transition-all"
              style={{
                width: `${summaryTotalBatches > 0 ? Math.round((summaryDoneBatches / summaryTotalBatches) * 100) : 50}%`,
              }}
            />
          </div>
          <div className="mt-2 text-xs text-muted">已发现问题 {summaryIssues}（实时更新）</div>
        </section>
      )}

      {/* 最近完成/失败的 job 结果（展示 IssueTable） */}
      {activeJob && (summaryStatus === 'success' || summaryStatus === 'error') && (
        <section className="space-y-4">
          {summaryStatus === 'success' && activeJob.result && (
            <IssueTable
              issues={activeJob.result.issues ?? []}
              project={settings.defaultProject}
              reportPath={activeJob.result.report?.report_path}
              fileName={activeJob.fileName.replace(/\.docx$/i, '')}
              traceId={activeJob.result.trace_id}
            />
          )}
          {summaryStatus === 'error' && (
            <div className="space-y-2">
              <div className="rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
                {typeof activeJob.error === 'string' && activeJob.error !== 'job not found'
                  ? activeJob.error
                  : '审核失败（任务状态丢失或 Worker 重启），请重新提交'}
              </div>
              <button
                onClick={() => window.location.reload()}
                className="rounded-md border border-border px-3 py-1.5 text-xs text-muted transition hover:bg-surface-2 hover:text-fg"
              >
                刷新页面
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
