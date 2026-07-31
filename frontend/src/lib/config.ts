// 前端配置管理：localStorage 缓存 + 与引擎 docx::config_get/set 同步

import type { EngineClient } from '@/sdk/client';

export interface LlmConfig {
  base_url: string;
  api_key: string; // 本地明文输入用；不持久化到 localStorage
  model: string;
}

export interface EmbeddingConfig {
  enabled: boolean;
  inherit_llm: boolean;
  base_url: string;
  api_key: string;
  model: string;
  dims: string;
  batch_size: string;
}

export interface RerankerConfig {
  enabled: boolean;
  inherit_llm: boolean;
  base_url: string;
  api_key: string;
  model: string;
  top_n: string;
  max_length: string;
}

export interface WorkerConfig {
  llm: LlmConfig;
  embedding: EmbeddingConfig;
  reranker: RerankerConfig;
}

const STORAGE_KEY = 'docx-audit:worker-config';

// 安全视图（从引擎回读）：secret 只给 hint
export interface SafeConfigResponse {
  llm: Record<string, unknown>;
  embedding: Record<string, unknown>;
  reranker: Record<string, unknown>;
  allowed_keys: string[];
}

export function loadCached(): Partial<WorkerConfig> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Partial<WorkerConfig>;
  } catch {
    return {};
  }
}

function cacheConfig(cfg: Partial<WorkerConfig>) {
  try {
    // 缓存时清除 secret（不把 key 存 localStorage）
    const safe = {
      ...cfg,
      llm: cfg.llm ? { ...cfg.llm, api_key: '' } : undefined,
      embedding: cfg.embedding ? { ...cfg.embedding, api_key: '' } : undefined,
      reranker: cfg.reranker ? { ...cfg.reranker, api_key: '' } : undefined,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(safe));
  } catch {
    /* ignore */
  }
}

/** 从引擎拉取安全配置视图，合并到本地缓存 */
export async function fetchConfig(client: EngineClient): Promise<SafeConfigResponse> {
  const res = await client.trigger<Record<string, unknown>, SafeConfigResponse>({
    function_id: 'docx::config_get',
    payload: {},
  });
  return res;
}

/** 把本地配置推送到引擎（仅传非空非 secret 字段 + 显式修改的 secret） */
export async function saveConfig(
  client: EngineClient,
  local: Partial<WorkerConfig>,
  dirty: { llm?: string[]; embedding?: string[]; reranker?: string[] },
): Promise<{ written: string[] }> {
  const payload: Record<string, unknown> = {};

  const LLM_MAP: Record<string, string> = {
    base_url: 'LLM_BASE_URL',
    model: 'LLM_MODEL',
  };
  const EMB_MAP: Record<string, string> = {
    enabled: 'EMBEDDING_ENABLED',
    inherit_llm: 'EMBEDDING_INHERIT_LLM',
    base_url: 'EMBEDDING_BASE_URL',
    model: 'EMBEDDING_MODEL',
    dims: 'EMBEDDING_DIMS',
    batch_size: 'EMBEDDING_BATCH_SIZE',
  };
  const RERANK_MAP: Record<string, string> = {
    enabled: 'RERANKER_ENABLED',
    inherit_llm: 'RERANKER_INHERIT_LLM',
    base_url: 'RERANKER_BASE_URL',
    model: 'RERANKER_MODEL',
    top_n: 'RERANKER_TOP_N',
    max_length: 'RERANKER_MAX_LENGTH',
  };

  for (const field of dirty.llm ?? []) {
    const key = LLM_MAP[field];
    if (key && local.llm) {
      const v = (local.llm as any)[field];
      if (v !== undefined) payload[key] = v;
    }
  }
  // LLM key：仅在非空时传（空 = 不修改）
  if (local.llm?.api_key) payload.LLM_API_KEY = local.llm.api_key;

  for (const field of dirty.embedding ?? []) {
    const key = EMB_MAP[field];
    if (key && local.embedding) {
      const v = (local.embedding as any)[field];
      if (v !== undefined) payload[key] = v;
    }
  }
  if (local.embedding?.api_key) payload.EMBEDDING_API_KEY = local.embedding.api_key;

  for (const field of dirty.reranker ?? []) {
    const key = RERANK_MAP[field];
    if (key && local.reranker) {
      const v = (local.reranker as any)[field];
      if (v !== undefined) payload[key] = v;
    }
  }
  if (local.reranker?.api_key) payload.RERANKER_API_KEY = local.reranker.api_key;

  const res = await client.trigger<{ [k: string]: unknown }, { written: string[]; path?: string }>({
    function_id: 'docx::config_set',
    payload,
  });

  cacheConfig(local);
  return res;
}

export { cacheConfig };
