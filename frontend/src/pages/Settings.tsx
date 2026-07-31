import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useStore, reconnect } from '@/store';
import { connect } from '@/store';
import type { EngineClient } from '@/sdk/client';
import {
  fetchConfig,
  saveConfig,
  loadCached,
  type WorkerConfig,
  type SafeConfigResponse,
} from '@/lib/config';

type Tab = 'env' | 'project' | 'connection' | 'about';
const TABS: { id: Tab; label: string }[] = [
  { id: 'env', label: '环境变量' },
  { id: 'project', label: '项目' },
  { id: 'connection', label: '引擎连接' },
  { id: 'about', label: '关于' },
];

const DEFAULTS: WorkerConfig = {
  llm: { base_url: 'https://api.siliconflow.cn/v1', api_key: '', model: 'deepseek-ai/DeepSeek-V3.2' },
  embedding: { enabled: false, inherit_llm: true, base_url: '', api_key: '', model: 'BAAI/bge-m3', dims: '', batch_size: '16' },
  reranker: { enabled: false, inherit_llm: true, base_url: '', api_key: '', model: 'Qwen/Qwen3-Reranker-8B', top_n: '10', max_length: '512' },
};

// 已配置 key 的 hint（从引擎回读）
const hintOf = (group: Record<string, unknown> | undefined, key: string): string => {
  const v = group?.[key];
  if (v && typeof v === 'object' && 'hint' in (v as Record<string, unknown>)) {
    return (v as Record<string, unknown>).hint as string;
  }
  return '';
};
const setOf = (group: Record<string, unknown> | undefined, key: string): boolean => {
  const v = group?.[key];
  if (v && typeof v === 'object' && 'set' in (v as Record<string, unknown>)) {
    return (v as Record<string, unknown>).set as boolean;
  }
  return false;
};
const valOf = (group: Record<string, unknown> | undefined, key: string): unknown => {
  const v = group?.[key];
  if (v && typeof v === 'object' && 'set' in (v as Record<string, unknown>)) return undefined;
  return v;
};

export function Settings() {
  const connection = useStore((s) => s.connection);
  const settings = useStore((s) => s.settings);
  const [tab, setTab] = useState<Tab>('env');

  const [form, setForm] = useState<WorkerConfig>(() => ({ ...DEFAULTS, ...loadCached() }));
  const [server, setServer] = useState<SafeConfigResponse | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [showKey, setShowKey] = useState<Record<string, boolean>>({});
  const [testState, setTestState] = useState<Record<string, { status: 'idle' | 'ok' | 'err'; ms?: number; msg?: string }>>({});

  // 从引擎拉取最新配置
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const client = await connect();
        const res = await fetchConfig(client);
        if (cancelled) return;
        setServer(res);
        // 用服务器非 secret 字段回填表单
        setForm((prev) => ({
          llm: {
            ...prev.llm,
            base_url: (valOf(res.llm, 'LLM_BASE_URL') as string) || prev.llm.base_url,
            model: (valOf(res.llm, 'LLM_MODEL') as string) || prev.llm.model,
          },
          embedding: {
            ...prev.embedding,
            enabled: (valOf(res.embedding, 'EMBEDDING_ENABLED') as boolean) ?? prev.embedding.enabled,
            inherit_llm: (valOf(res.embedding, 'EMBEDDING_INHERIT_LLM') as boolean) ?? true,
            base_url: (valOf(res.embedding, 'EMBEDDING_BASE_URL') as string) || '',
            model: (valOf(res.embedding, 'EMBEDDING_MODEL') as string) || prev.embedding.model,
            dims: (valOf(res.embedding, 'EMBEDDING_DIMS') as string) || '',
            batch_size: (valOf(res.embedding, 'EMBEDDING_BATCH_SIZE') as string) || '16',
          },
          reranker: {
            ...prev.reranker,
            enabled: (valOf(res.reranker, 'RERANKER_ENABLED') as boolean) ?? prev.reranker.enabled,
            inherit_llm: (valOf(res.reranker, 'RERANKER_INHERIT_LLM') as boolean) ?? true,
            base_url: (valOf(res.reranker, 'RERANKER_BASE_URL') as string) || '',
            model: (valOf(res.reranker, 'RERANKER_MODEL') as string) || prev.reranker.model,
            top_n: (valOf(res.reranker, 'RERANKER_TOP_N') as string) || '10',
            max_length: (valOf(res.reranker, 'RERANKER_MAX_LENGTH') as string) || '512',
          },
        }));
      } catch {
        // 离线时保持本地缓存
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const markDirty = (group: string, field: string) => {
    setDirty((d) => ({ ...d, [`${group}.${field}`]: true }));
  };

  const update = <K extends keyof WorkerConfig>(group: K, field: string, value: unknown) => {
    setForm((prev) => ({ ...prev, [group]: { ...(prev[group] as object), [field]: value } } as WorkerConfig));
    markDirty(group as string, field);
  };

  const dirtyCount = Object.keys(dirty).length;

  const onSave = async () => {
    setSaving(true);
    try {
      const client = await connect();
      const dGroups: { llm: string[]; embedding: string[]; reranker: string[] } = { llm: [], embedding: [], reranker: [] };
      for (const k of Object.keys(dirty)) {
        const [grp, ...rest] = k.split('.');
        dGroups[grp as keyof typeof dGroups]?.push(rest.join('.'));
      }
      await saveConfig(client, form, dGroups);
      setDirty({});
      toast.success('已保存');
    } catch (e) {
      toast.error('保存失败: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSaving(false);
    }
  };

  const testLLM = async () => {
    setTestState((s) => ({ ...s, llm: { status: 'idle' } }));
    const t0 = Date.now();
    try {
      const client: EngineClient = await connect();
      const res = await client.trigger<Record<string, unknown>, { written: string[] }>({
        function_id: 'docx::config_set',
        payload: {
          LLM_MODEL: form.llm.model,
          LLM_BASE_URL: form.llm.base_url,
          ...(form.llm.api_key ? { LLM_API_KEY: form.llm.api_key } : {}),
        },
      });
      setTestState((s) => ({ ...s, llm: { status: 'ok', ms: Date.now() - t0, msg: `已写入 ${res.written?.length ?? 0} 项` } }));
    } catch (e) {
      setTestState((s) => ({ ...s, llm: { status: 'err', ms: Date.now() - t0, msg: e instanceof Error ? e.message : String(e) } }));
    }
  };

  const llmKeySet = setOf(server?.llm, 'LLM_API_KEY');
  const llmKeyHint = hintOf(server?.llm, 'LLM_API_KEY');

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-6">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">设置</h1>
        <p className="text-sm text-muted">运行时配置；密钥仅可写入，不会完整回显。</p>
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
                value={form.llm.base_url}
                onChange={(e) => update('llm', 'base_url', e.target.value)}
                className="input"
                placeholder="https://api.siliconflow.cn/v1"
              />
            </Field>

            <Field label="API_KEY" hint={llmKeySet ? `已配置 · hint ${llmKeyHint}` : '未配置 · Agent 检查将被跳过'}>
              <div className="relative">
                <input
                  type={showKey.llm ? 'text' : 'password'}
                  value={form.llm.api_key}
                  onChange={(e) => update('llm', 'api_key', e.target.value)}
                  className="input pr-16"
                  placeholder={llmKeySet ? '已配置则留空表示不修改' : 'sk-...'}
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
              <TestBadge state={testState.llm} />
            </div>
          </Card>

          {/* Embedding 卡片 */}
          <Card title="嵌入模型 Embedding" subtitle="段落语义重复、近义套话检测（可选）">
            <Toggle label="启用" checked={form.embedding.enabled} onChange={(v) => update('embedding', 'enabled', v)} />
            <Toggle
              label="继承文本生成的 BASE_URL / API_KEY"
              checked={form.embedding.inherit_llm}
              onChange={(v) => update('embedding', 'inherit_llm', v)}
            />
            {!form.embedding.inherit_llm && (
              <>
                <Field label="BASE_URL">
                  <input value={form.embedding.base_url} onChange={(e) => update('embedding', 'base_url', e.target.value)} className="input" />
                </Field>
                <Field label="API_KEY">
                  <div className="relative">
                    <input
                      type={showKey.emb ? 'text' : 'password'}
                      value={form.embedding.api_key}
                      onChange={(e) => update('embedding', 'api_key', e.target.value)}
                      className="input pr-16"
                      autoComplete="off"
                    />
                    <button
                      type="button"
                      onClick={() => setShowKey((s) => ({ ...s, emb: !s.emb }))}
                      className="absolute right-1 top-1/2 -translate-y-1/2 h-6 rounded px-2 text-xs text-muted hover:text-fg"
                    >
                      {showKey.emb ? '隐藏' : '显示'}
                    </button>
                  </div>
                </Field>
              </>
            )}
            <Field label="MODEL">
              <input value={form.embedding.model} onChange={(e) => update('embedding', 'model', e.target.value)} className="input" placeholder="BAAI/bge-m3" />
            </Field>
            <div className="flex gap-3">
              <Field label="维度 (dims)">
                <input value={form.embedding.dims} onChange={(e) => update('embedding', 'dims', e.target.value)} className="input" placeholder="auto" />
              </Field>
              <Field label="batch size">
                <input value={form.embedding.batch_size} onChange={(e) => update('embedding', 'batch_size', e.target.value)} className="input" placeholder="16" />
              </Field>
            </div>
          </Card>

          {/* Reranker 卡片 */}
          <Card title="重排模型 Reranker" subtitle="证据句 / 相关段排序（可选）">
            <Toggle label="启用" checked={form.reranker.enabled} onChange={(v) => update('reranker', 'enabled', v)} />
            <Toggle label="继承文本生成的 BASE_URL / API_KEY" checked={form.reranker.inherit_llm} onChange={(v) => update('reranker', 'inherit_llm', v)} />
            {!form.reranker.inherit_llm && (
              <>
                <Field label="BASE_URL">
                  <input value={form.reranker.base_url} onChange={(e) => update('reranker', 'base_url', e.target.value)} className="input" />
                </Field>
                <Field label="API_KEY">
                  <div className="relative">
                    <input
                      type={showKey.rer ? 'text' : 'password'}
                      value={form.reranker.api_key}
                      onChange={(e) => update('reranker', 'api_key', e.target.value)}
                      className="input pr-16"
                      autoComplete="off"
                    />
                    <button
                      type="button"
                      onClick={() => setShowKey((s) => ({ ...s, rer: !s.rer }))}
                      className="absolute right-1 top-1/2 -translate-y-1/2 h-6 rounded px-2 text-xs text-muted hover:text-fg"
                    >
                      {showKey.rer ? '隐藏' : '显示'}
                    </button>
                  </div>
                </Field>
              </>
            )}
            <Field label="MODEL">
              <input value={form.reranker.model} onChange={(e) => update('reranker', 'model', e.target.value)} className="input" placeholder="Qwen/Qwen3-Reranker-8B" />
            </Field>
            <div className="flex gap-3">
              <Field label="top_n">
                <input value={form.reranker.top_n} onChange={(e) => update('reranker', 'top_n', e.target.value)} className="input" placeholder="10" />
              </Field>
              <Field label="max_length">
                <input value={form.reranker.max_length} onChange={(e) => update('reranker', 'max_length', e.target.value)} className="input" placeholder="512" />
              </Field>
            </div>
          </Card>

          {/* 底栏操作 */}
          <div className="flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-3">
            <div className="text-xs text-muted">
              变更将写入 config.json（沙箱内 /workspace/config.json），无需重启即刻生效。
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setForm({ ...DEFAULTS, ...loadCached() });
                  setDirty({});
                }}
                disabled={dirtyCount === 0}
                className="h-7 rounded-md border border-border px-3 text-xs text-muted hover:bg-surface-2 hover:text-fg disabled:opacity-50"
              >
                重置未保存
              </button>
              <button
                onClick={onSave}
                disabled={dirtyCount === 0 || saving}
                className={[
                  'h-7 rounded-md px-4 text-sm font-medium transition',
                  dirtyCount > 0 ? 'bg-accent text-accent-fg hover:opacity-90' : 'bg-accent/40 text-accent-fg cursor-not-allowed',
                  saving ? 'opacity-60' : '',
                ].join(' ')}
              >
                {saving ? '保存中…' : `保存更改${dirtyCount > 0 ? ` (${dirtyCount})` : ''}`}
              </button>
            </div>
          </div>

          {/* 未配置 LLM 时的警告空态 */}
          {!llmKeySet && !form.llm.api_key && (
            <div className="flex items-center justify-between rounded-lg border border-warn/40 bg-warn/10 px-4 py-3 text-sm">
              <div className="flex items-center gap-2 text-warn">
                <span>⚠</span>
                <span>
                  未检测到 LLM_API_KEY。静态规则仍可用，「Agent 检查」将被跳过。
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'project' && (
        <Card title="项目" subtitle="默认项目与数据根目录">
          <Field label="默认项目">
            <input value={settings.defaultProject} className="input" disabled />
          </Field>
          <Field label="数据根目录（仅显示拼接）">
            <input value={settings.dataRoot} className="input" disabled />
          </Field>
          <p className="text-xs text-muted">项目配置请通过环境变量或项目目录管理。</p>
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
              onClick={() => {
                void reconnect();
                toast.info('正在重连…');
              }}
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
            <div>版本：0.1.0（iii Worker 托管）</div>
            <div>审核 Function：docx::parse · docx::check_* · docx::generate_report · docx::audit</div>
            <div>iii 引擎：{settings.engineUrl}</div>
          </div>
        </Card>
      )}
    </div>
  );
}

// ── 子组件 ──────────────────────────────────────────────────────────────────

function Card({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <h2 className="text-sm font-medium">{title}</h2>
      {subtitle && <p className="mb-3 text-xs text-muted">{subtitle}</p>}
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-1 text-sm">{label}</div>
      {children}
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </label>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={[
          'relative h-5 w-9 rounded-full transition',
          checked ? 'bg-accent' : 'bg-border',
        ].join(' ')}
      >
        <span
          className={[
            'absolute top-0.5 h-4 w-4 rounded-full bg-surface transition-all',
            checked ? 'left-4' : 'left-0.5',
          ].join(' ')}
        />
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
