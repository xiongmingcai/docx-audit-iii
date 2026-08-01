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
    """读配置：优先 iii-state → config.json → 环境变量 → default。

    iii-state 存储在 scope=project:<project_id>, key=settings，
    由前端 Settings 页面写入，包含 llm/api_key 等嵌套结构。
    """
    # 1. 优先从 iii-state 读取（前端 Settings 页面写入）
    state_val = _get_from_state(key)
    if state_val is not None and state_val != "":
        return state_val
    # 2. config.json（沙箱内 /workspace/config.json）
    data = _load()
    if key in data and data[key] not in (None, ""):
        return data[key]
    # 3. 环境变量
    env_val = os.getenv(key)
    if env_val is not None and env_val != "":
        return env_val
    return default


def _get_from_state(key: str) -> Any:
    """从 iii-state 读取配置（scope=project:M1212, key=settings）。"""
    try:
        from .models import DEFAULT_PROJECT
        from iii import register_worker
        import os

        state = _state_get_cached(DEFAULT_PROJECT)
        if not state:
            return None

        # 映射扁平 key 到嵌套结构
        # LLM_API_KEY → state.llm.apiKey
        # LLM_BASE_URL → state.llm.baseUrl
        # LLM_MODEL → state.llm.model
        # EMBEDDING_* → state.embedding.*
        # RERANKER_* → state.reranker.*
        key_upper = key.upper()
        if key_upper.startswith("LLM_"):
            field = key_upper.replace("LLM_", "", 1).lower()
            return state.get("llm", {}).get(field)
        if key_upper.startswith("EMBEDDING_"):
            field = key_upper.replace("EMBEDDING_", "", 1).lower()
            return state.get("embedding", {}).get(field)
        if key_upper.startswith("RERANKER_"):
            field = key_upper.replace("RERANKER_", "", 1).lower()
            return state.get("reranker", {}).get(field)
        return None
    except Exception:
        return None


_state_cache: dict = {}
_state_cache_time: float = 0
_state_reader = None


def _get_state_reader():
    """获取或创建 state reader worker 连接（单例）。"""
    global _state_reader
    if _state_reader is None:
        try:
            from iii import register_worker
            import os
            url = os.getenv("III_ENGINE_URL", "ws://localhost:49134")
            _state_reader = register_worker(url, options={"workerName": "docx-audit-state-reader"})
        except Exception:
            return None
    return _state_reader


def _state_get_cached(project_id: str) -> dict:
    """带缓存的 state 读取（缓存 10s）。"""
    import time
    import asyncio
    global _state_cache, _state_cache_time
    now = time.time()
    if now - _state_cache_time < 10 and _state_cache:
        return _state_cache
    try:
        reader = _get_state_reader()
        if reader is None:
            return _state_cache
        # 使用已缓存的 loop 或创建新的
        try:
            loop = asyncio.get_running_loop()
            # 如果在已有 loop 中，用 run_coroutine_threadsafe
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                future = pool.submit(asyncio.run, reader.trigger_async({
                    "function_id": "state::get",
                    "payload": {"scope": f"project:{project_id}", "key": "settings"},
                }))
                result = future.result(timeout=10)
        except RuntimeError:
            # 无 running loop，直接 asyncio.run
            result = asyncio.run(reader.trigger_async({
                "function_id": "state::get",
                "payload": {"scope": f"project:{project_id}", "key": "settings"},
            }))
        if result and isinstance(result, dict):
            _state_cache = result
            _state_cache_time = now
            return result
    except Exception:
        pass
    return _state_cache


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
