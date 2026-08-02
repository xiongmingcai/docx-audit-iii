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
 * 测试连通性（LLM / Embedding / Reranker）
 *
 * 通过 docx::config_test 向目标端点发送真实请求验证配置，
 * 不写入任何配置。这是唯一推荐的测试方式。
 */
async function _testConnection(
  client: EngineClient,
  kind: 'llm' | 'embedding' | 'reranker',
  cfg: { baseUrl: string; apiKey: string; model: string },
): Promise<{ ok: boolean; ms: number; msg: string }> {
  try {
    const res = await client.trigger<
      { kind: string; baseUrl: string; apiKey: string; model: string },
      { ok: boolean; ms: number; msg: string }
    >({
      function_id: 'docx::config_test',
      payload: { kind, baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.model },
    });
    return res ?? { ok: false, ms: 0, msg: '空响应' };
  } catch (e) {
    return { ok: false, ms: 0, msg: extractErrorMsg(e) };
  }
}

/** 测试 LLM 连通性 — 发送 1 token 的 chat 请求验证模型真实可用 */
export function testLLMConnection(
  client: EngineClient,
  cfg: { baseUrl: string; apiKey: string; model: string },
): Promise<{ ok: boolean; ms: number; msg: string }> {
  return _testConnection(client, 'llm', cfg);
}

/** 测试 Embedding 连通性 — 发送短文本验证返回向量维度 */
export function testEmbeddingConnection(
  client: EngineClient,
  cfg: { baseUrl: string; apiKey: string; model: string; dims?: string },
): Promise<{ ok: boolean; ms: number; msg: string }> {
  return _testConnection(client, 'embedding', cfg);
}

/** 测试 Reranker 连通性 — 发送 query + documents 验证排序返回 */
export function testRerankerConnection(
  client: EngineClient,
  cfg: { baseUrl: string; apiKey: string; model: string; topN?: number; maxLength?: number },
): Promise<{ ok: boolean; ms: number; msg: string }> {
  return _testConnection(client, 'reranker', cfg);
}
