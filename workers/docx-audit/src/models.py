"""共享数据结构与配置常量。"""
from __future__ import annotations

import os
import re
from dataclasses import asdict, dataclass, field
from pathlib import Path

from dotenv import load_dotenv

# ── 环境 ──────────────────────────────────────────────────
# 定位项目根目录：从本文件向上，找到包含 .env / config.yaml / .git 的那一级。
# 这样既兼容本地开发布局（workers/docx-audit/src/ → 上溯 3 级），
# 也兼容 iii 沙箱挂载布局（/workspace/src/ → 上溯 1 级到 /workspace）。
def _find_root() -> Path:
    marker_files = (".env", "config.yaml", "iii.worker.yaml")
    marker_dirs = (".git",)
    p = Path(__file__).resolve().parent
    for _ in range(8):
        if any((p / m).exists() for m in marker_files):
            return p
        if any((p / m).is_dir() for m in marker_dirs):
            return p
        parent = p.parent
        if parent == p:  # 已到文件系统根
            break
        p = parent
    # 兜底：回退 3 级（原始本地开发布局）
    return Path(__file__).resolve().parents[3]

_ROOT = _find_root()
load_dotenv(_ROOT / ".env")

LLM_BASE_URL = os.getenv("LLM_BASE_URL", "https://api.siliconflow.cn/v1")
LLM_API_KEY = os.getenv("LLM_API_KEY", "")
LLM_MODEL = os.getenv("LLM_MODEL", "deepseek-ai/DeepSeek-V3.2")
III_ENGINE_URL = os.getenv("III_ENGINE_URL", "ws://localhost:49134")

DATA_ROOT = Path(os.getenv("DATA_ROOT", _ROOT))
PROJECTS_DIR = DATA_ROOT / "projects"
TEMPLATES_DIR = DATA_ROOT / "templates"
DEFAULT_PROJECT = os.getenv("DEFAULT_PROJECT", "M1212")

# ── 统一路径常量（适配本地开发 + 沙箱双布局）──────────────────────────────
REPORTS_DIR = _ROOT / "reports"
CONFIG_DIR = _ROOT / "config"
CONFIG_PATH = CONFIG_DIR / "config.json"

# 确保目录存在（模块加载时一次性创建）
REPORTS_DIR.mkdir(parents=True, exist_ok=True)
CONFIG_DIR.mkdir(parents=True, exist_ok=True)

NS_W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"

PRIORITY_MAP = {
    "TABLE_NAME_WITHOUT_TABLE": "P0",
    "HEADING_WITH_COMMENT": "P0",
    "PARAGRAPH_WITHOUT_COMMENT": "P0",
    "AI_TRACE": "P1",
}

ISSUE_TYPE_PRIORITY = {
    "拼音混入": "P2",
    "标点误用": "P2",
    "语病": "P2",
    "标点": "P2",
    "口语化": "P3",
    "重复": "P3",
    "格式不统一": "P3",
    "通顺性": "P4",
    "优化": "P4",
}

AI_TRACE_PATTERNS = [
    r"AI生成",
    r"人工智能生成",
    r"大模型生成",
    r"GPT生成",
    r"ChatGPT",
    r"本文由AI",
    r"由AI撰写",
    r"AI撰写",
    r"（AI生成）",
    r"\[AI生成\]",
    r"【AI生成】",
    r"AI辅助生成",
    r"AI辅助撰写",
]


def get_priority(rule_id: str, issue_type: str = "") -> str:
    if rule_id in PRIORITY_MAP:
        return PRIORITY_MAP[rule_id]
    if issue_type:
        for key, priority in ISSUE_TYPE_PRIORITY.items():
            if key in issue_type:
                return priority
    return "P3"


@dataclass
class AuditIssue:
    severity: str  # ERROR / WARNING / INFO
    rule_id: str
    message: str
    context: str = ""
    suggestion: str = ""
    priority: str = ""
    issue_type: str = ""
    location: str = ""

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "AuditIssue":
        return cls(**{k: v for k, v in d.items() if k in cls.__dataclass_fields__})


def issues_to_dicts(issues: list[AuditIssue]) -> list[dict]:
    return [i.to_dict() for i in issues]


def dicts_to_issues(raw: list[dict]) -> list[AuditIssue]:
    return [AuditIssue.from_dict(d) for d in raw]
