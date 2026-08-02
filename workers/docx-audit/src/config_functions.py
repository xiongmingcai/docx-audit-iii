"""docx::config_get / docx::config_set — 运行时配置读写。

get：返回安全视图（不含完整 secret），供前端设置页渲染。
set：写入 config.json，仅接受白名单 key，secret 空值视为清除。
"""
from __future__ import annotations

from .config_store import get_all_safe, set_values, ALLOWED_KEYS


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
