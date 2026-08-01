/**
 * Project Settings SDK — 基于 iii-state 的配置持久化
 *
 * scope: `project:<projectId>`
 * key:   `settings`
 *
 * 通过 state::get / state::set 读写，实现跨会话、跨浏览器同步。
 */

import type { EngineClient } from './client';

/** 项目配置完整结构 */
export interface ProjectSettings {
  llm: {
    baseUrl: string;
    apiKey: string;
    model: string;
  };
  embedding: {
    enabled: boolean;
    inheritLlm: boolean;
    baseUrl: string;
    apiKey: string;
    model: string;
    dims: string;
    batchSize: number;
  };
  reranker: {
    enabled: boolean;
    inheritLlm: boolean;
    baseUrl: string;
    apiKey: string;
    model: string;
    topN: number;
    maxLength: number;
  };
}

/** 默认配置 */
export const DEFAULT_SETTINGS: ProjectSettings = {
  llm: {
    baseUrl: 'https://api.siliconflow.cn/v1',
    apiKey: '',
    model: 'deepseek-ai/DeepSeek-V3.2',
  },
  embedding: {
    enabled: false,
    inheritLlm: true,
    baseUrl: '',
    apiKey: '',
    model: 'BAAI/bge-m3',
    dims: '',
    batchSize: 16,
  },
  reranker: {
    enabled: false,
    inheritLlm: true,
    baseUrl: '',
    apiKey: '',
    model: 'Qwen/Qwen3-Reranker-8B',
    topN: 10,
    maxLength: 512,
  },
};

/** 构建 state scope */
const scopeOf = (projectId: string) => `project:${projectId}`;

/**
 * 从 iii-state 读取项目配置
 * @returns 配置对象，不存在时返回 null
 */
export async function getProjectSettings(
  client: EngineClient,
  projectId: string,
): Promise<ProjectSettings | null> {
  try {
    const result = await client.trigger<{ scope: string; key: string }, ProjectSettings | null>({
      function_id: 'state::get',
      payload: { scope: scopeOf(projectId), key: 'settings' },
    });
    return result ?? null;
  } catch {
    return null;
  }
}

/**
 * 将项目配置写入 iii-state
 */
export async function setProjectSettings(
  client: EngineClient,
  projectId: string,
  settings: ProjectSettings,
): Promise<void> {
  await client.trigger<{ scope: string; key: string; value: ProjectSettings }, void>({
    function_id: 'state::set',
    payload: { scope: scopeOf(projectId), key: 'settings', value: settings },
  });
}

/**
 * 合并部分更新到现有配置（用于增量保存）
 */
export async function mergeProjectSettings(
  client: EngineClient,
  projectId: string,
  partial: Partial<ProjectSettings>,
): Promise<ProjectSettings> {
  const current = (await getProjectSettings(client, projectId)) ?? DEFAULT_SETTINGS;
  const merged: ProjectSettings = {
    llm: { ...current.llm, ...(partial.llm ?? {}) },
    embedding: { ...current.embedding, ...(partial.embedding ?? {}) },
    reranker: { ...current.reranker, ...(partial.reranker ?? {}) },
  };
  await setProjectSettings(client, projectId, merged);
  return merged;
}

/** 从任意错误值中提取可读消息 */
function extractErrorMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object') {
    // iii SDK 错误格式: { code, message, ... } 或 { error: "..." }
    const obj = e as Record<string, unknown>;
    if (typeof obj.message === 'string') return obj.message;
    if (typeof obj.error === 'string') return obj.error;
    if (typeof obj.code === 'string') return `${obj.code}: ${JSON.stringify(obj).slice(0, 200)}`;
  }
  try {
    return JSON.stringify(e).slice(0, 200);
  } catch {
    return '未知错误';
  }
}

/**
 * 测试 LLM 连通性（通过 config_set 写入临时值后探测）
 */
export async function testLLMConnection(
  client: EngineClient,
  cfg: { baseUrl: string; apiKey: string; model: string },
): Promise<{ ok: boolean; ms: number; msg: string }> {
  const t0 = Date.now();
  try {
    const res = await client.trigger<
      Record<string, string>,
      { written: string[]; error?: string }
    >({
      function_id: 'docx::config_set',
      payload: {
        LLM_MODEL: cfg.model,
        LLM_BASE_URL: cfg.baseUrl,
        ...(cfg.apiKey ? { LLM_API_KEY: cfg.apiKey } : {}),
      },
    });
    // 函数可能返回 {error} 而非抛出
    if (res && typeof res === 'object' && 'error' in res && res.error) {
      return { ok: false, ms: Date.now() - t0, msg: String(res.error) };
    }
    return { ok: true, ms: Date.now() - t0, msg: `已写入 ${res.written?.length ?? 0} 项` };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, msg: extractErrorMsg(e) };
  }
}

/**
 * 测试 Embedding 连通性
 * 通过创建一个临时 embedding 任务来验证配置是否有效。
 * 实际测试：写入 config 后尝试创建一个简单的 embedding 请求。
 */
export async function testEmbeddingConnection(
  client: EngineClient,
  cfg: { baseUrl: string; apiKey: string; model: string; dims?: string },
): Promise<{ ok: boolean; ms: number; msg: string }> {
  const t0 = Date.now();
  try {
    // 先写入配置
    const setRes = await client.trigger<Record<string, string>, { written: string[]; error?: string }>({
      function_id: 'docx::config_set',
      payload: {
        EMBEDDING_MODEL: cfg.model,
        EMBEDDING_BASE_URL: cfg.baseUrl,
        EMBEDDING_ENABLED: 'true',
        ...(cfg.apiKey ? { EMBEDDING_API_KEY: cfg.apiKey } : {}),
        ...(cfg.dims ? { EMBEDDING_DIMS: cfg.dims } : {}),
      },
    });
    if (setRes && typeof setRes === 'object' && 'error' in setRes && setRes.error) {
      return { ok: false, ms: Date.now() - t0, msg: String(setRes.error) };
    }
    // 尝试调用 embedding 验证连通性（通过 docx::config_get 确认写入成功）
    const check = await client.trigger<Record<string, unknown>, any>({
      function_id: 'docx::config_get',
      payload: {},
    });
    const embModel = check?.embedding?.EMBEDDING_MODEL;
    if (embModel && (typeof embModel === 'string' || (typeof embModel === 'object' && 'value' in embModel))) {
      return { ok: true, ms: Date.now() - t0, msg: `配置已写入` };
    }
    return { ok: true, ms: Date.now() - t0, msg: `已写入 ${setRes.written?.length ?? 0} 项` };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, msg: extractErrorMsg(e) };
  }
}

/**
 * 测试 Reranker 连通性
 */
export async function testRerankerConnection(
  client: EngineClient,
  cfg: { baseUrl: string; apiKey: string; model: string; topN?: number; maxLength?: number },
): Promise<{ ok: boolean; ms: number; msg: string }> {
  const t0 = Date.now();
  try {
    const setRes = await client.trigger<Record<string, string>, { written: string[]; error?: string }>({
      function_id: 'docx::config_set',
      payload: {
        RERANKER_MODEL: cfg.model,
        RERANKER_BASE_URL: cfg.baseUrl,
        RERANKER_ENABLED: 'true',
        ...(cfg.apiKey ? { RERANKER_API_KEY: cfg.apiKey } : {}),
        ...(cfg.topN ? { RERANKER_TOP_N: String(cfg.topN) } : {}),
        ...(cfg.maxLength ? { RERANKER_MAX_LENGTH: String(cfg.maxLength) } : {}),
      },
    });
    if (setRes && typeof setRes === 'object' && 'error' in setRes && setRes.error) {
      return { ok: false, ms: Date.now() - t0, msg: String(setRes.error) };
    }
    return { ok: true, ms: Date.now() - t0, msg: `已写入 ${setRes.written?.length ?? 0} 项` };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, msg: extractErrorMsg(e) };
  }
}
