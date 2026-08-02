"""docx::config_get / docx::config_set / docx::config_test — 运行时配置读写 + 连通性测试。

get：返回安全视图（不含完整 secret），供前端设置页渲染。
set：写入 iii-state（scope=project:<id>, key=settings），仅接受白名单 key。
test：探测 LLM / Embedding / Reranker 端点的真实连通性（不写入配置）。
"""
from __future__ import annotations

import json
from .config_store import get_all_safe, set_values, ALLOWED_KEYS


# ── config_get / config_set（兼容旧接口，供内部/调试使用）────────────────────

async def fn_config_get(payload: dict) -> dict:
    """
    Function: docx::config_get

    Input:  {}                    # 无参数，返回全配置安全视图
    Output: { "llm": {...}, "embedding": {...}, "reranker": {...}, "allowed_keys": [...] }
    """
    return {
        **get_all_safe(),
        "allowed_keys": sorted(ALLOWED_KEYS),
    }


async def fn_config_set(payload: dict) -> dict:
    """
    Function: docx::config_set

    Input:
      {
        "LLM_BASE_URL": "...",           # 非 secret：直接写入
        "LLM_API_KEY": "sk-...",         # secret：写入完整值
        "EMBEDDING_MODEL": "BAAI/bge-m3",
        ...
      }

    规则：
      - 仅白名单 key 被写入
      - secret 类 key 传空串/None → 清除已保存值
      - 未传的 key → 保持不变

    Output: { "written": ["LLM_API_KEY", ...], "path": "..." }
    """
    if not isinstance(payload, dict):
        return {"error": "payload must be an object", "written": []}
    result = set_values(payload)
    return result


# ── config_test — 真实连通性探测 ─────────────────────────────────────────────

import asyncio
from urllib.parse import urlparse

import httpx


def _normalize_url(base_url: str) -> str:
    """去除末尾斜杠，确保格式统一。"""
    return base_url.rstrip("/")


def _auth_headers(api_key: str) -> dict[str, str]:
    """构造认证 header（Bearer <REDACTED>，兼容空 key 的开放端点）。"""
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    return headers


async def _test_llm(base_url: str, api_key: str, model: str) -> dict:
    """测试 LLM 端点：调用 /chat/completions 发送 1 token 请求验证真实可用。"""
    url = f"{_normalize_url(base_url)}/chat/completions"
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": "hi"}],
        "max_tokens": 1,
    }
    async with httpx.AsyncClient(timeout=15.0) as client:
        r = await client.post(url, json=payload, headers=_auth_headers(api_key))
        if r.status_code == 401:
            return {"ok": False, "msg": "HTTP 401 — API Key 无效或缺失"}
        if r.status_code == 404:
            return {"ok": False, "msg": f"HTTP 404 — 模型 {model} 不存在或端点错误"}
        r.raise_for_status()
        data = r.json()
        usage = data.get("usage", {})
        return {
            "ok": True,
            "msg": f"模型 {model} 响应正常（prompt {usage.get('prompt_tokens', '?')} / completion {usage.get('completion_tokens', '?')} tokens）",
        }


async def _test_embedding(base_url: str, api_key: str, model: str) -> dict:
    """测试 Embedding 端点：发送短文本验证返回向量维度。"""
    url = f"{_normalize_url(base_url)}/embeddings"
    payload = {"model": model, "input": "test"}
    async with httpx.AsyncClient(timeout=15.0) as client:
        r = await client.post(url, json=payload, headers=_auth_headers(api_key))
        if r.status_code == 401:
            return {"ok": False, "msg": "HTTP 401 — API Key 无效或缺失"}
        if r.status_code == 404:
            return {"ok": False, "msg": f"HTTP 404 — 模型 {model} 不存在或端点错误"}
        r.raise_for_status()
        data = r.json()
        items = data.get("data", [])
        if items and isinstance(items[0].get("embedding"), list):
            dims = len(items[0]["embedding"])
            return {"ok": True, "msg": f"模型 {model} 返回 {dims} 维向量"}
        return {"ok": True, "msg": f"模型 {model} 响应正常（返回结构异常，请确认端点）"}


async def _test_reranker(base_url: str, api_key: str, model: str) -> dict:
    """测试 Reranker 端点：发送 query + documents 验证排序返回。"""
    url = f"{_normalize_url(base_url)}/rerank"
    payload = {
        "model": model,
        "query": "测试查询",
        "documents": ["文档一", "文档二"],
    }
    async with httpx.AsyncClient(timeout=15.0) as client:
        r = await client.post(url, json=payload, headers=_auth_headers(api_key))
        if r.status_code == 401:
            return {"ok": False, "msg": "HTTP 401 — API Key 无效或缺失"}
        if r.status_code == 404:
            # 部分厂商 rerank 路径不同，回退到 /v1/rerank 探测
            return {"ok": False, "msg": f"HTTP 404 — 模型 {model} 不存在或 /rerank 端点错误"}
        r.raise_for_status()
        data = r.json()
        results = data.get("results") or data.get("data") or []
        if isinstance(results, list) and len(results) > 0:
            return {"ok": True, "msg": f"模型 {model} 返回 {len(results)} 条排序结果"}
        return {"ok": True, "msg": f"模型 {model} 响应正常（返回结构异常，请确认端点）"}


async def fn_config_test(payload: dict) -> dict:
    """
    Function: docx::config_test

    探测 LLM / Embedding / Reranker 端点的真实连通性，不写入任何配置。

    Input:
      {
        "kind": "llm" | "embedding" | "reranker",
        "baseUrl": "https://api.siliconflow.cn/v1",
        "apiKey": "sk-...",
        "model": "deepseek-ai/DeepSeek-V3.2",
      }

    Output:
      {
        "ok": true,
        "ms": 245,
        "msg": "模型 ... 响应正常 ..."
      }
    """
    kind = (payload.get("kind") or "llm").lower()
    base_url = payload.get("baseUrl", "")
    api_key = payload.get("apiKey", "")
    model = payload.get("model", "")

    if not base_url:
        return {"ok": False, "ms": 0, "msg": "缺少 baseUrl"}
    if not model:
        return {"ok": False, "ms": 0, "msg": "缺少 model"}

    # 校验 URL 格式
    parsed = urlparse(base_url)
    if not parsed.scheme or not parsed.hostname:
        return {"ok": False, "ms": 0, "msg": f"无效的 baseUrl: {base_url}"}

    t0 = asyncio.get_event_loop().time()
    try:
        if kind == "llm":
            result = await _test_llm(base_url, api_key, model)
        elif kind == "embedding":
            result = await _test_embedding(base_url, api_key, model)
        elif kind == "reranker":
            result = await _test_reranker(base_url, api_key, model)
        else:
            return {"ok": False, "ms": 0, "msg": f"未知类型: {kind}"}
        result["ms"] = int((asyncio.get_event_loop().time() - t0) * 1000)
        return result
    except httpx.TimeoutException:
        return {"ok": False, "ms": int((asyncio.get_event_loop().time() - t0) * 1000), "msg": "连接超时（15s），请检查网络或 BASE_URL"}
    except httpx.ConnectError as e:
        return {"ok": False, "ms": int((asyncio.get_event_loop().time() - t0) * 1000), "msg": f"无法连接到端点: {str(e)[:120]}"}
    except httpx.HTTPStatusError as e:
        body = ""
        try:
            body = e.response.text[:200]
        except Exception:
            pass
        return {"ok": False, "ms": int((asyncio.get_event_loop().time() - t0) * 1000), "msg": f"HTTP {e.response.status_code}: {body or str(e)[:120]}"}
    except Exception as e:
        return {"ok": False, "ms": int((asyncio.get_event_loop().time() - t0) * 1000), "msg": f"未知错误: {str(e)[:150]}"}
