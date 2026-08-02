"""
docx-audit 运行时配置存储（iii-state 唯一源）。

scope: `project:<projectId>`  key: `settings`
格式:  { llm: {baseUrl, apiKey, model}, embedding: {...}, reranker: {...} }
"""
from __future__ import annotations

from typing import Any

from .models import DEFAULT_PROJECT

# 允许外部配置的 key 白名单
ALLOWED_KEYS = {
    "LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL",
    "EMBEDDING_ENABLED", "EMBEDDING_INHERIT_LLM", "EMBEDDING_BASE_URL",
    "EMBEDDING_API_KEY", "EMBEDDING_MODEL", "EMBEDDING_DIMS", "EMBEDDING_BATCH_SIZE",
    "RERANKER_ENABLED", "RERANKER_INHERIT_LLM", "RERANKER_BASE_URL",
    "RERANKER_API_KEY", "RERANKER_MODEL", "RERANKER_TOP_N", "RERANKER_MAX_LENGTH",
}

# 扁平 key ↔ iii-state 嵌套字段映射
_FLAT_TO_NESTED: dict[str, tuple[str, str]] = {
    "LLM_BASE_URL": ("llm", "baseUrl"),
    "LLM_API_KEY": ("llm", "apiKey"),
    "LLM_MODEL": ("llm", "model"),
    "EMBEDDING_ENABLED": ("embedding", "enabled"),
    "EMBEDDING_INHERIT_LLM": ("embedding", "inheritLlm"),
    "EMBEDDING_BASE_URL": ("embedding", "baseUrl"),
    "EMBEDDING_API_KEY": ("embedding", "apiKey"),
    "EMBEDDING_MODEL": ("embedding", "model"),
    "EMBEDDING_DIMS": ("embedding", "dims"),
    "EMBEDDING_BATCH_SIZE": ("embedding", "batchSize"),
    "RERANKER_ENABLED": ("reranker", "enabled"),
    "RERANKER_INHERIT_LLM": ("reranker", "inheritLlm"),
    "RERANKER_BASE_URL": ("reranker", "baseUrl"),
    "RERANKER_API_KEY": ("reranker", "apiKey"),
    "RERANKER_MODEL": ("reranker", "model"),
    "RERANKER_TOP_N": ("reranker", "topN"),
    "RERANKER_MAX_LENGTH": ("reranker", "maxLength"),
}


# ── iii-state 读写 ───────────────────────────────────────────

async def get_project_settings(iii, project_id: str = DEFAULT_PROJECT) -> dict:
    """从 iii-state 读取项目配置。"""
    try:
        result = await iii.trigger_async({
            "function_id": "state::get",
            "payload": {"scope": f"project:{project_id}", "key": "settings"},
        })
        return result if isinstance(result, dict) else {}
    except Exception:
        return {}


async def set_project_settings(iii, project_id: str, settings: dict) -> None:
    """写入 iii-state。"""
    await iii.trigger_async({
        "function_id": "state::set",
        "payload": {"scope": f"project:{project_id}", "key": "settings", "value": settings},
    })


# ── 格式转换 ─────────────────────────────────────────────────

def settings_to_flat(settings: dict) -> dict[str, str]:
    """iii-state 嵌套格式 → 扁平 key 格式。"""
    flat: dict[str, str] = {}
    for flat_key, (group, field) in _FLAT_TO_NESTED.items():
        val = settings.get(group, {}).get(field)
        if val is not None and val != "":
            flat[flat_key] = str(val) if not isinstance(val, bool) else str(val).lower()
    return flat


def flat_to_settings(flat: dict) -> dict:
    """扁平 key 格式 → iii-state 嵌套格式。"""
    settings: dict = {"llm": {}, "embedding": {}, "reranker": {}}
    for flat_key, (group, field) in _FLAT_TO_NESTED.items():
        if flat_key in flat and flat[flat_key] not in (None, ""):
            val = flat[flat_key]
            # 布尔字段转换
            if field in ("enabled", "inheritLlm"):
                val = val.lower() == "true" if isinstance(val, str) else bool(val)
            # 数字字段转换
            elif field in ("batchSize", "topN", "maxLength"):
                try:
                    val = int(val)
                except (ValueError, TypeError):
                    val = val
            settings[group][field] = val
    return settings
