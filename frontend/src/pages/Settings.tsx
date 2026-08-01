/**
 * Settings 页面 — 配置持久化到 iii-state
 *
 * scope: `project:<projectId>`  key: `settings`
 * 通过 state::get / state::set 读写，跨会话/跨浏览器同步。
 */

import { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import { useStore, connect, reconnect } from '@/store';
import {
  getProjectSettings,
  setProjectSettings,
  testLLMConnection,
  testEmbeddingConnection,
  testRerankerConnection,
  DEFAULT_SETTINGS,
  type ProjectSettings,
} from '@/sdk/settings';

// 表单内部状态（驼峰命名 → 提交时转为 ProjectSettings）
type Tab = 'env' | 'project' | 'connection' | 'about';
const TABS: { id: Tab; label: string }[] = [
  { id: 'env', label: '模型配置' },
  { id: 'project', label: '项目' },
  { id: 'connection', label: '引擎连接' },
  { id: 'about', label: '关于' },
];

export function Settings() {
  const connection = useStore((s) => s.connection);
  const settings = useStore((s) => s.settings);
  const [tab, setTab] = useState<Tab>('env');

  // 表单状态（ProjectSettings 格式）
  const [form, setForm] = useState<ProjectSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [showKey, setShowKey] = useState<Record<string, boolean>>({});
  const [testStates, setTestStates] = useState<Record<string, { status: 'idle' | 'ok' | 'err'; ms?: number; msg?: string }>>({});

  // ── 从 iii-state 加载配置 ──────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const client = await connect();
        const stored = await getProjectSettings(client, settings.defaultProject);
        if (cancelled) return;
        if (stored) {
          setForm(stored);
        } else {
          // 首次使用：写入默认值
          await setProjectSettings(client, settings.defaultProject, DEFAULT_SETTINGS);
        }
      } catch {
        // 离线时使用默认值
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [settings.defaultProject]);

  // ── 表单更新 ─────────────────────────────────────────────────────────────
  const update = useCallback(<K extends keyof ProjectSettings>(
    group: K,
    field: keyof ProjectSettings[K],
    value: ProjectSettings[K][keyof ProjectSettings[K]],
  ) => {
    setForm((prev) => ({ ...prev, [group]: { ...prev[group], [field]: value } }));
    setDirty(true);
  }, []);

  // ── 保存到 iii-state ─────────────────────────────────────────────────────
  const onSave = async () => {
    setSaving(true);
    try {
      const client = await connect();
      await setProjectSettings(client, settings.defaultProject, form);
      setDirty(false);
      toast.success('已保存到 iii-state');
    } catch (e) {
      toast.error('保存失败: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSaving(false);
    }
  };

  // ── 测试连接（通用）───────────────────────────────────────────────────────
  const testConnection = async (
    key: string,
    fn: (client: Awaited<ReturnType<typeof connect>>) => Promise<{ ok: boolean; ms: number; msg: string }>,
  ) => {
    setTestStates((s) => ({ ...s, [key]: { status: 'idle' } }));
    try {
      const client = await connect();
      const result = await fn(client);
      setTestStates((s) => ({ ...s, [key]: { status: result.ok ? 'ok' : 'err', ms: result.ms, msg: result.msg } }));
    } catch (e) {
      setTestStates((s) => ({ ...s, [key]: { status: 'err', msg: e instanceof Error ? e.message : String(e) } }));
    }
  };

  const testLLM = () => testConnection('llm', (c) =>
    testLLMConnection(c, { baseUrl: form.llm.baseUrl, apiKey: form.llm.apiKey, model: form.llm.model }),
  );
  const testEmbedding = () => testConnection('embedding', (c) =>
    testEmbeddingConnection(c, {
      baseUrl: form.embedding.inheritLlm ? form.llm.baseUrl : form.embedding.baseUrl,
      apiKey: form.embedding.inheritLlm ? form.llm.apiKey : form.embedding.apiKey,
      model: form.embedding.model,
      dims: form.embedding.dims,
    }),
  );
  const testReranker = () => testConnection('reranker', (c) =>
    testRerankerConnection(c, {
      baseUrl: form.reranker.inheritLlm ? form.llm.baseUrl : form.reranker.baseUrl,
      apiKey: form.reranker.inheritLlm ? form.llm.apiKey : form.reranker.apiKey,
      model: form.reranker.model,
      topN: form.reranker.topN,
      maxLength: form.reranker.maxLength,
    }),
  );

  // ── 重置 ─────────────────────────────────────────────────────────────────
  const onReset = async () => {
    setForm(DEFAULT_SETTINGS);
    setDirty(false);
    try {
      const client = await connect();
      await setProjectSettings(client, settings.defaultProject, DEFAULT_SETTINGS);
      toast.success('已重置为默认值');
    } catch {
      toast.error('重置失败');
    }
  };

  if (loading) {
    return (
      <div className="grid h-full place-items-center">
        <div className="flex items-center gap-2 text-sm text-muted">
          <span className="inline-block h-3 w-3 animate-pulse rounded-full bg-accent" />
          从 iii-state 加载配置…
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-6">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">设置</h1>
        <p className="text-sm text-muted">
          配置持久化到 iii-state（scope=project:{settings.defaultProject}），跨会话同步。
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={[
              'relative px-3 py-2 text-sm transition',
              tab === t.id ? 'text-fg' : 'text-muted hover:text-fg',
            ].join(' ')}
          >
            {t.label}
            {tab === t.id && <span className="absolute inset-x-0 -bottom-px h-0.5 bg-accent" />}
          </button>
        ))}
      </div>

      {tab === 'env' && (
        <div className="space-y-5">
          {/* LLM 卡片 */}
          <Card title="文本生成 LLM" subtitle="Agent 语言质量检查依赖此模型">
            <Field label="BASE_URL">
              <input
                value={form.llm.baseUrl}
                onChange={(e) => update('llm', 'baseUrl', e.target.value)}
                className="input"
                placeholder="https://api.siliconflow.cn/v1"
              />
            </Field>

            <Field label="API_KEY" hint={form.llm.apiKey ? '已配置（留空表示不修改）' : '未配置 · Agent 检查将被跳过'}>
              <div className="relative">
                <input
                  type={showKey.llm ? 'text' : 'password'}
                  value={form.llm.apiKey}
                  onChange={(e) => update('llm', 'apiKey', e.target.value)}
                  className="input pr-16"
                  placeholder="sk-..."
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => setShowKey((s) => ({ ...s, llm: !s.llm }))}
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-6 rounded px-2 text-xs text-muted hover:text-fg"
                >
                  {showKey.llm ? '隐藏' : '显示'}
                </button>
              </div>
            </Field>

            <Field label="MODEL">
              <input
                value={form.llm.model}
                onChange={(e) => update('llm', 'model', e.target.value)}
                className="input"
                placeholder="deepseek-ai/DeepSeek-V3.2"
              />
            </Field>

            <div className="mt-2 flex items-center gap-3">
              <button onClick={testLLM} className="h-7 rounded-md border border-border px-3 text-xs text-muted hover:bg-surface-2 hover:text-fg">
                测试连接
              </button>
              <TestBadge state={testStates.llm} />
            </div>
          </Card>

          {/* Embedding 卡片 */}
          <Card title="嵌入模型 Embedding" subtitle="段落语义重复、近义套话检测（可选）">
            <Toggle label="启用" checked={form.embedding.enabled} onChange={(v) => update('embedding', 'enabled', v)} />
            <Toggle
              label="继承 LLM 的 BASE_URL / API_KEY"
              checked={form.embedding.inheritLlm}
              onChange={(v) => update('embedding', 'inheritLlm', v)}
            />
            <fieldset disabled={form.embedding.inheritLlm} className={form.embedding.inheritLlm ? 'opacity-50 pointer-events-none' : ''}>
              <Field label="BASE_URL">
                <input value={form.embedding.baseUrl} onChange={(e) => update('embedding', 'baseUrl', e.target.value)} className="input" />
              </Field>
              <Field label="API_KEY">
                <input type="password" value={form.embedding.apiKey} onChange={(e) => update('embedding', 'apiKey', e.target.value)} className="input" autoComplete="off" />
              </Field>
            </fieldset>
            <Field label="MODEL">
              <input value={form.embedding.model} onChange={(e) => update('embedding', 'model', e.target.value)} className="input" placeholder="BAAI/bge-m3" />
            </Field>
            <div className="flex gap-3">
              <Field label="维度 (dims)">
                <input value={form.embedding.dims} onChange={(e) => update('embedding', 'dims', e.target.value)} className="input" placeholder="auto" />
              </Field>
              <Field label="batch size">
                <input
                  value={form.embedding.batchSize}
                  onChange={(e) => update('embedding', 'batchSize', parseInt(e.target.value, 10) || 16)}
                  className="input"
                  placeholder="16"
                  type="number"
                />
              </Field>
            </div>
            <div className="mt-2 flex items-center gap-3">
              <button onClick={testEmbedding} disabled={form.embedding.inheritLlm}
                className={[
                  'h-7 rounded-md border border-border px-3 text-xs transition',
                  form.embedding.inheritLlm ? 'opacity-40 cursor-not-allowed text-muted' : 'text-muted hover:bg-surface-2 hover:text-fg',
                ].join(' ')}
                title={form.embedding.inheritLlm ? '继承 LLM 配置时无需单独测试' : '测试 Embedding 连接'}
              >
                测试连接
              </button>
              <TestBadge state={testStates.embedding} />
            </div>
          </Card>

          {/* Reranker 卡片 */}
          <Card title="重排模型 Reranker" subtitle="证据句 / 相关段排序（可选）">
            <Toggle label="启用" checked={form.reranker.enabled} onChange={(v) => update('reranker', 'enabled', v)} />
            <Toggle
              label="继承 LLM 的 BASE_URL / API_KEY"
              checked={form.reranker.inheritLlm}
              onChange={(v) => update('reranker', 'inheritLlm', v)}
            />
            <fieldset disabled={form.reranker.inheritLlm} className={form.reranker.inheritLlm ? 'opacity-50 pointer-events-none' : ''}>
              <Field label="BASE_URL">
                <input value={form.reranker.baseUrl} onChange={(e) => update('reranker', 'baseUrl', e.target.value)} className="input" />
              </Field>
              <Field label="API_KEY">
                <input type="password" value={form.reranker.apiKey} onChange={(e) => update('reranker', 'apiKey', e.target.value)} className="input" autoComplete="off" />
              </Field>
            </fieldset>
            <Field label="MODEL">
              <input value={form.reranker.model} onChange={(e) => update('reranker', 'model', e.target.value)} className="input" placeholder="Qwen/Qwen3-Reranker-8B" />
            </Field>
            <div className="flex gap-3">
              <Field label="top_n">
                <input
                  value={form.reranker.topN}
                  onChange={(e) => update('reranker', 'topN', parseInt(e.target.value, 10) || 10)}
                  className="input"
                  placeholder="10"
                  type="number"
                />
              </Field>
              <Field label="max_length">
                <input
                  value={form.reranker.maxLength}
                  onChange={(e) => update('reranker', 'maxLength', parseInt(e.target.value, 10) || 512)}
                  className="input"
                  placeholder="512"
                  type="number"
                />
              </Field>
            </div>
            <div className="mt-2 flex items-center gap-3">
              <button onClick={testReranker} disabled={form.reranker.inheritLlm}
                className={[
                  'h-7 rounded-md border border-border px-3 text-xs transition',
                  form.reranker.inheritLlm ? 'opacity-40 cursor-not-allowed text-muted' : 'text-muted hover:bg-surface-2 hover:text-fg',
                ].join(' ')}
                title={form.reranker.inheritLlm ? '继承 LLM 配置时无需单独测试' : '测试 Reranker 连接'}
              >
                测试连接
              </button>
              <TestBadge state={testStates.reranker} />
            </div>
          </Card>

          {/* 底栏操作 */}
          <div className="flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-3">
            <div className="text-xs text-muted">
              变更写入 iii-state（scope=project:{settings.defaultProject} · key=settings），即刻生效。
            </div>
            <div className="flex items-center gap-2">
              <button onClick={onReset} className="h-7 rounded-md border border-border px-3 text-xs text-muted hover:bg-surface-2 hover:text-fg">
                重置默认
              </button>
              <button
                onClick={onSave}
                disabled={!dirty || saving}
                className={[
                  'h-7 rounded-md px-4 text-sm font-medium transition',
                  dirty ? 'bg-accent text-accent-fg hover:opacity-90' : 'bg-accent/40 text-accent-fg cursor-not-allowed',
                  saving ? 'opacity-60' : '',
                ].join(' ')}
              >
                {saving ? '保存中…' : `保存${dirty ? ' ●' : ''}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {tab === 'project' && (
        <Card title="项目" subtitle="默认项目与数据根目录">
          <Field label="默认项目">
            <input value={settings.defaultProject} className="input" disabled />
          </Field>
          <Field label="数据根目录">
            <input value={settings.dataRoot} className="input" disabled />
          </Field>
          <p className="text-xs text-muted">项目隔离通过 scope=project:{'<projectId>'} 实现。</p>
        </Card>
      )}

      {tab === 'connection' && (
        <Card title="引擎连接" subtitle="WebSocket 网关">
          <Field label="WebSocket 地址">
            <input value={settings.engineUrl} className="input" disabled />
          </Field>
          <div className="flex items-center justify-between rounded-md border border-border bg-bg px-3 py-2">
            <div>
              <div className="text-sm">连接状态</div>
              <div className="text-xs text-muted">{connection}</div>
            </div>
            <button
              onClick={() => { void reconnect(); toast.info('正在重连…'); }}
              className="h-7 rounded-md border border-border px-2.5 text-xs text-muted transition hover:bg-surface-2 hover:text-fg"
            >
              重连
            </button>
          </div>
        </Card>
      )}

      {tab === 'about' && (
        <Card title="关于" subtitle="文生文文档审核控制台">
          <div className="space-y-1 text-sm text-muted">
            <div>版本：iii-2026-08-01（Pipeline Flow + Trace 视图 + Settings 持久化）</div>
            <div>审核 Function：docx::parse · docx::check_* · docx::generate_report · docx::audit_start · docx::quality_batch · docx::quality_finalize · docx::audit_status</div>
            <div>iii 引擎：{settings.engineUrl} · Console：http://127.0.0.1:3113</div>
          </div>
        </Card>
      )}
    </div>
  );
}

// ── 子组件 ──────────────────────────────────────────────────────────────────

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <h2 className="text-sm font-medium">{title}</h2>
      {subtitle && <p className="mb-3 text-xs text-muted">{subtitle}</p>}
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1 text-sm">{label}</div>
      {children}
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </label>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={['relative h-5 w-9 rounded-full transition', checked ? 'bg-accent' : 'bg-border'].join(' ')}
      >
        <span className={['absolute top-0.5 h-4 w-4 rounded-full bg-surface transition-all', checked ? 'left-4' : 'left-0.5'].join(' ')} />
      </button>
      <span>{label}</span>
    </label>
  );
}

function TestBadge({ state }: { state?: { status: 'idle' | 'ok' | 'err'; ms?: number; msg?: string } }) {
  if (!state || state.status === 'idle') return null;
  if (state.status === 'ok') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-ok">
        ● 可用 · {state.ms}ms{state.msg ? ` · ${state.msg}` : ''}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-danger">
      × 失败 · {state.msg}
    </span>
  );
}
