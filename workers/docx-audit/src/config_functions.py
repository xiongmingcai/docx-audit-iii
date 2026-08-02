"""docx::config_get / docx::config_set — 运行时配置读写。

get：返回安全视图（不含完整 secret），供前端设置页渲染。
set：写入 config.json，仅接受白名单 key，secret 空值视为清除。
"""
from __future__ import annotations

from .config_store import get_all_safe, set_values, ALLOWED_KEYS


async def fn_config_get(payload: dict, iii=None) -> dict:
    """
    Function: docx::config_get

    Input:  {}                    # 无参数，返回全配置安全视图
    Output: { "llm": {...}, "embedding": {...}, "reranker": {...}, "allowed_keys": [...] }

    当 iii 客户端可用时（引擎注入），直接用 iii 调 state::get 获取最新配置。
    否则回退到 get_all_safe()（可能读到过时的 config.json）。
    """
    # 优先用 iii 直接读 iii-state（实时、准确）
    if iii is not None:
        try:
            from .models import DEFAULT_PROJECT
            state = await iii.trigger_async({
                "function_id": "state::get",
                "payload": {"scope": f"project:{DEFAULT_PROJECT}", "key": "settings"},
            })
            if state and isinstance(state, dict) and "llm" in state:
                # iii-state 格式: { llm: {baseUrl, apiKey, model}, embedding: {...}, reranker: {...} }
                # 转换为前端期望的 SafeConfigResponse 格式
                def _to_safe(group_key: str, flat_map: dict) -> dict:
                    out = {}
                    for env_key, field in flat_map.items():
                        val = group_key.get(field, "")
                        is_secret = "KEY" in env_key.upper()
                        if is_secret:
                            out[env_key] = {"set": bool(val), "hint": _mask(str(val)) if val else ""}
                        else:
                            out[env_key] = val if val else ""
                    return out

                return {
                    "llm": _to_safe(state.get("llm", {}), {
                        "LLM_BASE_URL": "baseUrl",
                        "LLM_API_KEY": "apiKey",
                        "LLM_MODEL": "model",
                    }),
                    "embedding": _to_safe(state.get("embedding", {}), {
                        "EMBEDDING_ENABLED": "enabled",
                        "EMBEDDING_INHERIT_LLM": "inheritLlm",
                        "EMBEDDING_BASE_URL": "baseUrl",
                        "EMBEDDING_API_KEY": "apiKey",
                        "EMBEDDING_MODEL": "model",
                        "EMBEDDING_DIMS": "dims",
                        "EMBEDDING_BATCH_SIZE": "batchSize",
                    }),
                    "reranker": _to_safe(state.get("reranker", {}), {
                        "RERANKER_ENABLED": "enabled",
                        "RERANKER_INHERIT_LLM": "inheritLlm",
                        "RERANKER_BASE_URL": "baseUrl",
                        "RERANKER_API_KEY": "apiKey",
                        "RERANKER_MODEL": "model",
                        "RERANKER_TOP_N": "topN",
                        "RERANKER_MAX_LENGTH": "maxLength",
                    }),
                    "allowed_keys": sorted(ALLOWED_KEYS),
                }
        except Exception:
            pass  # 降级到 get_all_safe()

    # 降级：从 config.json + 环境变量读取
    return {
        **get_all_safe(),
        "allowed_keys": sorted(ALLOWED_KEYS),
    }


def _mask(secret: str) -> str:
    """只回显末 4 位，其余掩码。"""
    if len(secret) <= 4:
        return "•" * len(secret)
    return "•" * (len(secret) - 4) + secret[-4:]


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
