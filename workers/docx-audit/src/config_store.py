"""
docx-audit 运行时配置存储。

优先级：运行时配置（config.json）> 环境变量（.env / 进程 env）> 代码默认值。

config.json 由前端通过 docx::config_set 写入，沙箱内持久化到本地文件。
密钥仅作完整值保存；对外读取时按规则回显 hint（末 4 位）而非完整 secret。
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from .models import _ROOT

# 沙箱内写 /workspace/config.json（与 src 平级）；本地写 workers/docx-audit/config
_SANDBOX = Path("/workspace")
if _SANDBOX.exists():
    CONFIG_PATH = _SANDBOX / "config.json"
else:
    CONFIG_PATH = _ROOT / "config.json"

# 允许外部配置的 key 白名单（与前端设置页字段一一对应）
ALLOWED_KEYS = {
    # LLM（文本生成）
    "LLM_BASE_URL",
    "LLM_API_KEY",
    "LLM_MODEL",
    # Embedding
    "EMBEDDING_ENABLED",
    "EMBEDDING_INHERIT_LLM",
    "EMBEDDING_BASE_URL",
    "EMBEDDING_API_KEY",
    "EMBEDDING_MODEL",
    "EMBEDDING_DIMS",
    "EMBEDDING_BATCH_SIZE",
    # Reranker
    "RERANKER_ENABLED",
    "RERANKER_INHERIT_LLM",
    "RERANKER_BASE_URL",
    "RERANKER_API_KEY",
    "RERANKER_MODEL",
    "RERANKER_TOP_N",
    "RERANKER_MAX_LENGTH",
}


def _load() -> dict[str, Any]:
    if not CONFIG_PATH.exists():
        return {}
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _save(data: dict) -> None:
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def get_masked(key: str) -> dict:
    """返回单个 key 的安全视图：完整值（仅非 secret）+ 是否已配置 + hint。"""
    val = get(key)
    is_secret = "KEY" in key.upper() or "SECRET" in key.upper() or "TOKEN" in key.upper()
    if is_secret:
        return {
            "set": bool(val),
            "hint": _mask(str(val)) if val else "",
        }
    return {"value": val}


def _mask(secret: str) -> str:
    """只回显末 4 位，其余掩码。"""
    if len(secret) <= 4:
        return "•" * len(secret)
    return "•" * (len(secret) - 4) + secret[-4:]


def get_all_safe() -> dict[str, dict]:
    """返回所有已配置 key 的安全视图（不含完整 secret）。"""
    data = _load()
    out: dict[str, dict] = {}
    # 按分组输出
    groups = {
        "llm": ["LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL"],
        "embedding": [
            "EMBEDDING_ENABLED",
            "EMBEDDING_INHERIT_LLM",
            "EMBEDDING_BASE_URL",
            "EMBEDDING_API_KEY",
            "EMBEDDING_MODEL",
            "EMBEDDING_DIMS",
            "EMBEDDING_BATCH_SIZE",
        ],
        "reranker": [
            "RERANKER_ENABLED",
            "RERANKER_INHERIT_LLM",
            "RERANKER_BASE_URL",
            "RERANKER_API_KEY",
            "RERANKER_MODEL",
            "RERANKER_TOP_N",
            "RERANKER_MAX_LENGTH",
        ],
    }
    for group, keys in groups.items():
        out[group] = {}
        for k in keys:
            val = data.get(k)
            is_secret = "KEY" in k.upper()
            if is_secret:
                out[group][k] = {"set": bool(val), "hint": _mask(str(val)) if val else ""}
            else:
                out[group][k] = val
    return out


def get(key: str, default: Any = None) -> Any:
    """读配置：优先 config.json，其次环境变量，其次 default。"""
    data = _load()
    if key in data and data[key] not in (None, ""):
        return data[key]
    env_val = os.getenv(key)
    if env_val is not None and env_val != "":
        return env_val
    return default


def get_effective() -> dict[str, Any]:
    """返回完整生效配置（含环境变量兜底），供 worker 内部使用。"""
    return {k: get(k) for k in ALLOWED_KEYS}


def set_values(updates: dict, wipe_secret_if_empty: bool = True) -> dict:
    """写入配置。

    - 仅白名单 key 会被写入
    - secret 类 key 传空字符串/None 时：默认视为「清空已保存 key」
    - 返回实际写入的 key 列表
    """
    data = _load()
    written = []
    for k, v in updates.items():
        if k not in ALLOWED_KEYS:
            continue
        is_secret = "KEY" in k.upper()
        if is_secret:
            # secret 为空 → 清除（前端「留空不修改」应由前端过滤，不传该 key）
            if v in (None, ""):
                if wipe_secret_if_empty and k in data:
                    del data[k]
                    written.append(k)
                continue
            data[k] = str(v)
            written.append(k)
        else:
            if v is None:
                # 非 secret 的 None 视为不修改
                continue
            data[k] = v
            written.append(k)
    _save(data)
    return {"written": written, "path": str(CONFIG_PATH)}
