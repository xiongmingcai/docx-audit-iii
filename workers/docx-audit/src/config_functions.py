"""docx::config_get / docx::config_set — 运行时配置读写（iii-state 唯一源）。

get：从 iii-state 读取配置，返回安全视图（secret 只回显 hint）。
set：把扁平 key 写入 iii-state（scope=project:<id>, key=settings）。
"""
from __future__ import annotations

from .config_store import (
    get_project_settings,
    set_project_settings,
    settings_to_flat,
    flat_to_settings,
    ALLOWED_KEYS,
)


async def fn_config_get(payload: dict, iii=None) -> dict:
    """
    Function: docx::config_get

    Input:  {}                    # 无参数，返回全配置安全视图
    Output: { "llm": {...}, "embedding": {...}, "reranker": {...}, "allowed_keys": [...] }
    """
    if iii is None:
        return {"llm": {}, "embedding": {}, "reranker": {}, "allowed_keys": sorted(ALLOWED_KEYS)}

    from .models import DEFAULT_PROJECT
    settings = await get_project_settings(iii, DEFAULT_PROJECT)
    flat = settings_to_flat(settings)

    # 分组输出（secret 只给 hint）
    groups = {
        "llm": ["LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL"],
        "embedding": [
            "EMBEDDING_ENABLED", "EMBEDDING_INHERIT_LLM", "EMBEDDING_BASE_URL",
            "EMBEDDING_API_KEY", "EMBEDDING_MODEL", "EMBEDDING_DIMS", "EMBEDDING_BATCH_SIZE",
        ],
        "reranker": [
            "RERANKER_ENABLED", "RERANKER_INHERIT_LLM", "RERANKER_BASE_URL",
            "RERANKER_API_KEY", "RERANKER_MODEL", "RERANKER_TOP_N", "RERANKER_MAX_LENGTH",
        ],
    }
    out: dict = {}
    for group, keys in groups.items():
        out[group] = {}
        for k in keys:
            val = flat.get(k, "")
            is_secret = "KEY" in k.upper()
            if is_secret:
                out[group][k] = {"set": bool(val), "hint": _mask(str(val)) if val else ""}
            else:
                out[group][k] = val if val else ""
    out["allowed_keys"] = sorted(ALLOWED_KEYS)
    return out


async def fn_config_set(payload: dict, iii=None) -> dict:
    """
    Function: docx::config_set

    Input:  { "LLM_BASE_URL": "...", "LLM_API_KEY": "sk-...", ... }
    Output: { "written": ["LLM_API_KEY", ...] }
    """
    if not isinstance(payload, dict) or iii is None:
        return {"error": "payload must be an object and iii client required", "written": []}

    from .models import DEFAULT_PROJECT
    # 读取现有配置，合并更新
    current = await get_project_settings(iii, DEFAULT_PROJECT)
    merged = flat_to_settings(settings_to_flat(current) | payload)
    await set_project_settings(iii, DEFAULT_PROJECT, merged)
    return {"written": sorted(payload.keys())}


def _mask(secret: str) -> str:
    """只回显末 4 位，其余掩码。"""
    if len(secret) <= 4:
        return "•" * len(secret)
    return "•" * (len(secret) - 4) + secret[-4:]
