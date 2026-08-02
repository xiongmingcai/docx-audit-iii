/**
 * MinerU 文档转换页面
 *
 * 将 PDF/Docx/PPT/Excel/图片 通过 MinerU API 转换为 Markdown。
 * 基于 III Queue 异步架构：提交 → 入队 → 轮询进度 → 获取结果。
 *
 * 支持两种模式：
 * 1. URL 模式：输入文件 URL，直接提交
 * 2. 文件上传模式：选择本地文件 → 获取签名 URL → 上传到 OSS → 自动解析
 *
 * 遵循 NewJob 页面模式：
 * - 连接状态检查
 * - 文件上传（拖拽 + 选择）
 * - 模型版本选择
 * - 进度轮询
 * - 结果预览
 */

import { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import { useStore, startMineruConvert, getMineruStatus, getMineruResult, getMineruBatchStatus, mineruChannelUpload } from '@/store';
import { StatusDot } from '@/components/StatusDot';
import { JobIdChip } from '@/components/JobIdChip';
import { MarkdownPreview } from '@/components/MarkdownPreview';
import type { MineruModelVersion, MineruJobStatus, MineruSourceMode } from '@/types';

// 状态文案映射
const STATUS_LABELS: Record<MineruJobStatus, string> = {
  pending: '排队中',
  queued: '已入队',
  uploading: '上传中',
  processing: '转换中',
  done: '完成',
  failed: '失败',
};

// 支持的文件类型
const ACCEPTED_TYPES = '.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.png,.jpg,.jpeg,.jp2,.webp,.gif,.bmp';

function connectionBlocked(s: string): boolean {
  return s !== 'connected';
}

export function MinerUConvert() {
  const connection = useStore((s) => s.connection);
  const settings = useStore((s) => s.settings);

  // 模式选择
  const [mode, setMode] = useState<MineruSourceMode>('url');

  // URL 模式状态
  const [url, setUrl] = useState('');

  // 文件上传模式状态
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ sent: number; total: number } | null>(null);

  // 通用状态
  const [modelVersion, setModelVersion] = useState<MineruModelVersion>('pipeline');
  const [enableFormula, setEnableFormula] = useState(true);
  const [enableTable, setEnableTable] = useState(true);
  const [isOcr, setIsOcr] = useState(false);

  // 任务状态
  const [mineruTaskId, setMineruTaskId] = useState<string | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [status, setStatus] = useState<MineruJobStatus | null>(null);
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [showMarkdown, setShowMarkdown] = useState(true);  // 默认显示预览
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const blocked = connectionBlocked(connection);

  // 轮询状态（URL 模式）
  const pollStatus = useCallback(async () => {
    if (!mineruTaskId) return;

    try {
      const result = await getMineruStatus(mineruTaskId);
      if (result.ok && result.state) {
        const newState = result.state === 'done' ? 'done' : result.state === 'failed' ? 'failed' : 'processing';
        setStatus(newState);

        if (result.state === 'done') {
          const mdResult = await getMineruResult({ mineruTaskId });
          if (mdResult.ok && mdResult.markdown) {
            setMarkdown(mdResult.markdown);
            toast.success('✓ 转换完成');
          } else {
            setError(mdResult.error || '获取结果失败');
            toast.error('获取结果失败');
          }
        } else if (result.state === 'failed') {
          setError('转换失败');
          toast.error('转换失败');
        }
      }
    } catch {
      // 轮询失败不中断
    }
  }, [mineruTaskId]);

  // 轮询状态（文件上传模式）
  const pollBatchStatus = useCallback(async () => {
    if (!batchId) return;

    try {
      const result = await getMineruBatchStatus(batchId);
      if (result.ok && result.results && result.results.length > 0) {
        const r = result.results[0];
        const newState = r.state === 'done' ? 'done' : r.state === 'failed' ? 'failed' : 'processing';
        setStatus(newState);

        if (r.state === 'done') {
          // 通过 Worker 下载 ZIP 并提取 Markdown
          const mdResult = await getMineruResult({ batchId });
          if (mdResult.ok && mdResult.markdown) {
            setMarkdown(mdResult.markdown);
            toast.success('✓ 转换完成');
          } else {
            setError(mdResult.error || '获取结果失败');
            toast.error('获取结果失败');
          }
        } else if (r.state === 'failed') {
          setError(r.err_msg || '转换失败');
          toast.error('转换失败');
        }
      }
    } catch {
      // 轮询失败不中断
    }
  }, [batchId]);

  // 轮询定时器
  useEffect(() => {
    if (!status || status === 'done' || status === 'failed') return;
    if (!mineruTaskId && !batchId) return;

    const interval = setInterval(() => {
      if (mode === 'url') pollStatus();
      else pollBatchStatus();
    }, 3000);
    return () => clearInterval(interval);
  }, [status, mineruTaskId, batchId, mode, pollStatus, pollBatchStatus]);

  // URL 模式提交
  const submitUrl = async () => {
    setSubmitting(true);
    setError(null);
    setMarkdown(null);
    setStatus(null);
    setMineruTaskId(null);

    try {
      const result = await startMineruConvert({
        url: url.trim(),
        model_version: modelVersion,
      });

      setMineruTaskId(result.mineruTaskId);
      setStatus('queued');
      toast.success(`✓ 已提交转换任务\nMinerU Task: ${result.mineruTaskId.slice(0, 8)}…`, {
        duration: 6000,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      toast.error(`提交失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSubmitting(false);
    }
  };

  // 文件上传模式提交（使用 Channel 流式传输）
  const submitFile = async () => {
    if (!file) return;

    setSubmitting(true);
    setError(null);
    setMarkdown(null);
    setStatus(null);
    setBatchId(null);
    setUploadProgress(null);

    try {
      // 使用 Channel 模式：文件字节通过 Channel 流式传输到 Worker
      setStatus('uploading');
      const { batchId: bid } = await mineruChannelUpload(
        file,
        modelVersion,
        (sent, total) => setUploadProgress({ sent, total }),
      );

      setBatchId(bid);
      setUploadProgress(null);
      setStatus('queued');
      toast.success(`✓ 文件已通过 Channel 上传，开始转换\nBatch: ${bid.slice(0, 8)}…`, {
        duration: 6000,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      toast.error(`上传失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSubmitting(false);
    }
  };

  // 统一提交
  const onSubmit = async () => {
    if (blocked) {
      toast.error('未连接到 iii 引擎，请稍后再试');
      return;
    }

    if (mode === 'url') {
      if (!url.trim()) {
        toast.error('请输入文件 URL');
        return;
      }
      await submitUrl();
    } else {
      if (!file) {
        toast.error('请选择文件');
        return;
      }
      await submitFile();
    }
  };

  // 文件选择处理
  const onFile = (f: File | null) => {
    setFile(f);
    if (f) setUrl(''); // 互斥：选择文件时清除 URL
  };

  // 清除当前任务
  const clearResult = () => {
    setMarkdown(null);
    setMineruTaskId(null);
    setBatchId(null);
    setStatus(null);
    setError(null);
    setUrl('');
    setFile(null);
    setUploadProgress(null);
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">文档转换</h1>
          <p className="text-sm text-muted">
            将 PDF/Docx/PPT/Excel/图片 通过 MinerU API 转换为 Markdown
          </p>
        </div>
      </div>

      {/* Connection banner */}
      {blocked && (
        <div className="flex items-center justify-between rounded-lg border border-warn/40 bg-warn/10 px-4 py-3 text-sm">
          <div className="flex items-center gap-2 text-warn">
            <StatusDot state={connection} />
            <span>未连接到 iii 引擎 · <span className="font-mono">{settings.engineUrl}</span></span>
          </div>
          <span className="text-xs text-muted">请确认引擎已启动</span>
        </div>
      )}

      {/* 输入区域 */}
      <section className="rounded-lg border border-border bg-surface p-4">
        <h2 className="mb-3 text-sm font-medium text-muted">输入配置</h2>

        <div className="space-y-4">
          {/* 模式切换 */}
          <div>
            <label className="mb-1 block text-sm">输入模式</label>
            <div className="flex gap-2">
              <button
                onClick={() => setMode('url')}
                className={`rounded-md border px-3 py-1.5 text-sm transition ${
                  mode === 'url'
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-border text-muted hover:bg-surface-2'
                }`}
              >
                URL 链接
              </button>
              <button
                onClick={() => setMode('upload')}
                className={`rounded-md border px-3 py-1.5 text-sm transition ${
                  mode === 'upload'
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-border text-muted hover:bg-surface-2'
                }`}
              >
                文件上传
              </button>
            </div>
          </div>

          {/* URL 输入 */}
          {mode === 'url' && (
            <div>
              <label className="mb-1 block text-sm">
                文件 URL <span className="text-danger">*</span>
              </label>
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/document.pdf"
                className="input"
                disabled={submitting || blocked}
              />
              <p className="mt-1 text-xs text-muted">
                支持 PDF、Docx、PPT、Excel、图片等格式。文件需可通过 URL 访问。
              </p>
            </div>
          )}

          {/* 文件上传 */}
          {mode === 'upload' && (
            <div>
              <label className="mb-1 block text-sm">
                选择文件 <span className="text-danger">*</span>
              </label>
              <label
                className={[
                  'flex cursor-pointer select-none flex-col items-center justify-center rounded-md border border-dashed px-4 py-6 text-center transition',
                  dragOver ? 'border-accent bg-accent/5' : 'border-border bg-bg hover:border-accent',
                  file ? 'border-ok/50' : '',
                ].join(' ')}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) onFile(f); }}
              >
                {file ? (
                  <>
                    <span className="text-2xl">✓</span>
                    <span className="mt-2 text-sm font-medium">{file.name}</span>
                    <span className="text-xs text-muted">{(file.size / 1024).toFixed(1)} KB</span>
                  </>
                ) : (
                  <>
                    <span className="text-2xl text-muted">↑</span>
                    <span className="mt-2 text-sm text-muted">拖拽文件到此处，或点击选择</span>
                    <span className="text-xs text-muted">支持 PDF/Docx/PPT/Excel/图片</span>
                  </>
                )}
                <input
                  type="file"
                  accept={ACCEPTED_TYPES}
                  className="hidden"
                  onChange={(e) => onFile(e.target.files?.[0] ?? null)}
                  disabled={submitting || blocked}
                />
              </label>

              {/* 上传进度 */}
              {uploadProgress && uploadProgress.total > 0 && (
                <div className="mt-3">
                  <div className="mb-1 flex justify-between text-xs text-muted">
                    <span>上传中…</span>
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
            </div>
          )}

          {/* 模型版本 */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm">模型版本</label>
              <select
                value={modelVersion}
                onChange={(e) => setModelVersion(e.target.value as MineruModelVersion)}
                className="input"
                disabled={submitting || blocked}
              >
                <option value="pipeline">Pipeline（默认，平衡速度精度）</option>
                <option value="vlm">VLM（视觉语言模型，精度更高）</option>
                <option value="MinerU-HTML">MinerU-HTML（HTML 专用）</option>
              </select>
            </div>

            {/* 识别选项 */}
            <div>
              <label className="mb-1 block text-sm">识别选项</label>
              <div className="flex flex-wrap gap-3 pt-1">
                <label className="flex cursor-pointer items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={enableFormula}
                    onChange={(e) => setEnableFormula(e.target.checked)}
                    className="h-4 w-4 rounded border-border accent-accent"
                    disabled={submitting || blocked}
                  />
                  <span className="text-sm">公式识别</span>
                </label>
                <label className="flex cursor-pointer items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={enableTable}
                    onChange={(e) => setEnableTable(e.target.checked)}
                    className="h-4 w-4 rounded border-border accent-accent"
                    disabled={submitting || blocked}
                  />
                  <span className="text-sm">表格识别</span>
                </label>
                <label className="flex cursor-pointer items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={isOcr}
                    onChange={(e) => setIsOcr(e.target.checked)}
                    className="h-4 w-4 rounded border-border accent-accent"
                    disabled={submitting || blocked}
                  />
                  <span className="text-sm">OCR</span>
                </label>
              </div>
            </div>
          </div>

          {/* 提交按钮 */}
          <div className="flex items-center gap-3">
            <button
              onClick={onSubmit}
              disabled={submitting || blocked || (mode === 'url' ? !url.trim() : !file)}
              className="h-9 rounded-md bg-accent px-4 text-sm font-medium text-accent-fg transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? '提交中...' : '开始转换'}
            </button>
            {status === 'queued' || status === 'processing' || status === 'uploading' ? (
              <span className="flex items-center gap-1.5 text-xs text-accent">
                <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
                {STATUS_LABELS[status]}
              </span>
            ) : null}
          </div>
        </div>
      </section>

      {/* 进度区域 */}
      {status && status !== 'done' && status !== 'failed' && (
        <section className="rounded-lg border border-accent/40 bg-accent/5 p-4">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">转换进度</div>
            <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium text-accent">
              {STATUS_LABELS[status]}
            </span>
          </div>
          <div className="mt-2">
            {mineruTaskId && <JobIdChip jobId={mineruTaskId} label="MinerU Task" />}
            {batchId && <JobIdChip jobId={batchId} label="Batch ID" />}
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-accent transition-all"
              style={{ width: status === 'processing' ? '60%' : status === 'uploading' ? '40%' : '20%' }}
            />
          </div>
          <p className="mt-2 text-xs text-muted">
            {status === 'uploading' && '正在上传文件到 OSS...'}
            {status === 'queued' && '任务已入队，等待处理...'}
            {status === 'processing' && '正在解析文档，请稍候...'}
          </p>
        </section>
      )}

      {/* 错误区域 */}
      {error && (
        <section className="rounded-lg border border-danger/40 bg-danger/10 p-4">
          <div className="text-sm font-medium text-danger">转换失败</div>
          <p className="mt-1 text-sm text-danger/80">{error}</p>
        </section>
      )}

      {/* 结果区域 */}
      {markdown && (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium">转换结果</h2>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowMarkdown(!showMarkdown)}
                className="rounded-md border border-border px-2 py-1 text-xs text-fg transition hover:bg-surface-2"
              >
                {showMarkdown ? '隐藏预览' : '预览 Markdown'}
              </button>
              <button onClick={clearResult} className="text-xs text-accent hover:underline">
                清空结果
              </button>
            </div>
          </div>
          {showMarkdown && (
            <MarkdownPreview content={markdown} fileName="converted_document" />
          )}
        </section>
      )}

      {/* 使用说明 */}
      <section className="rounded-lg border border-border bg-surface p-4">
        <h2 className="mb-2 text-sm font-medium">使用说明</h2>
        <ul className="space-y-1 text-xs text-muted">
          <li>• <strong>URL 模式</strong>：输入可访问的文件链接，支持 PDF/Docx/PPT/Excel/图片</li>
          <li>• <strong>文件上传模式</strong>：选择本地文件，通过 III Channel 流式传输到 Worker，无大小限制</li>
          <li>• <strong>Pipeline</strong>：默认模型，平衡速度与精度</li>
          <li>• <strong>VLM</strong>：视觉语言模型，精度更高但速度较慢</li>
          <li>• <strong>MinerU-HTML</strong>：专用于 HTML 文件解析</li>
          <li>• 转换任务通过 III Queue 异步处理，提交后可离开页面</li>
          <li>• 支持公式识别、表格识别、OCR 等功能</li>
          <li>• <strong>Channel 模式优势</strong>：文件内容不经过 JSON payload，支持任意大小文件</li>
        </ul>
      </section>
    </div>
  );
}
