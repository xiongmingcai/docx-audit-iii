/**
 * MarkdownPreview — 高质量 Markdown 预览组件
 *
 * 基于开源方案:
 * - react-markdown: https://github.com/remarkjs/react-markdown (核心渲染)
 * - remark-gfm: GFM 支持（表格、删除线、任务列表）
 * - rehype-highlight: 代码块语法高亮
 *
 * 支持：
 * - 高质量可读性渲染（react-markdown）
 * - 原始 Markdown 源码显示
 * - 复制到剪贴板
 * - 下载为 .md 文件
 */

import { useState } from 'react';
import { toast } from 'sonner';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';

type ViewMode = 'preview' | 'source';

interface MarkdownPreviewProps {
  content: string;
  fileName?: string;
}

export function MarkdownPreview({ content, fileName = 'document' }: MarkdownPreviewProps) {
  const [copied, setCopied] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('preview');

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      toast.success('已复制到剪贴板');
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('复制失败');
    }
  };

  const handleDownload = () => {
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileName.replace(/\.[^.]+$/, '')}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success('已下载 Markdown 文件');
  };

  return (
    <div className="rounded-lg border border-border bg-surface">
      {/* 工具栏 */}
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Markdown 预览</span>
          <span className="text-xs text-muted">
            {content.length} 字符 · {content.split('\n').length} 行
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* 视图切换按钮 */}
          <div className="flex rounded-md border border-border overflow-hidden">
            <button
              onClick={() => setViewMode('preview')}
              className={`px-2.5 py-1 text-xs transition ${
                viewMode === 'preview'
                  ? 'bg-accent text-accent-fg'
                  : 'text-muted hover:bg-surface-2'
              }`}
            >
              预览
            </button>
            <button
              onClick={() => setViewMode('source')}
              className={`px-2.5 py-1 text-xs transition border-l border-border ${
                viewMode === 'source'
                  ? 'bg-accent text-accent-fg'
                  : 'text-muted hover:bg-surface-2'
              }`}
            >
              源码
            </button>
          </div>
          <button
            onClick={handleCopy}
            className="rounded border border-border px-2 py-1 text-xs text-fg transition hover:bg-surface-2"
          >
            {copied ? '✓ 已复制' : '复制'}
          </button>
          <button
            onClick={handleDownload}
            className="rounded border border-border px-2 py-1 text-xs text-fg transition hover:bg-surface-2"
          >
            下载 .md
          </button>
        </div>
      </div>

      {/* 内容区域 */}
      <div className="max-h-[600px] overflow-auto">
        {viewMode === 'preview' ? (
          <div className="p-6 markdown-body">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeHighlight]}
            >
              {content}
            </ReactMarkdown>
          </div>
        ) : (
          <div className="p-4">
            <pre className="whitespace-pre-wrap font-mono text-sm leading-relaxed text-fg">
              {content}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
