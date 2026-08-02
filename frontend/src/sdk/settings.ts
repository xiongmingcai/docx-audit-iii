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

