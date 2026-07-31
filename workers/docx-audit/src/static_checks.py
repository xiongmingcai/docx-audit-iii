"""静态检查 Functions（不依赖 LLM）。"""
from __future__ import annotations

import re
from typing import Any

def _parse_elements(v):
    """兼容 CLI 传 string 或 list 的 elements 参数。"""
    if isinstance(v, str):
        try:
            return json.loads(v)
        except Exception:
            return []
    return v or []

from .models import AI_TRACE_PATTERNS, AuditIssue, issues_to_dicts


def check_ai_traces(elements: list[dict]) -> list[AuditIssue]:
    issues: list[AuditIssue] = []
    for el in elements:
        if el["kind"] not in ("heading", "paragraph"):
            continue
        for pattern in AI_TRACE_PATTERNS:
            m = re.search(pattern, el["text"])
            if m:
                issues.append(
                    AuditIssue(
                        severity="ERROR",
                        rule_id="AI_TRACE",
                        message=f'段落包含 AI 生成痕迹 "{m.group(0)}"',
                        context=el["text"][:200],
                        suggestion="删除 AI 生成标记，确保文档内容自然",
                        priority="P1",
                        issue_type="AI生成痕迹",
                    )
                )
                break
    return issues


def check_heading_comments(elements: list[dict]) -> list[AuditIssue]:
    issues: list[AuditIssue] = []
    for el in elements:
        if el["kind"] != "heading":
            continue
        if el.get("has_comment"):
            issues.append(
                AuditIssue(
                    severity="ERROR",
                    rule_id="HEADING_WITH_COMMENT",
                    message=f'标题 "{el["text"]}" 不应包含批注',
                    context=el["text"],
                    suggestion="移除标题上的批注，批注应加在正文段落上",
                    priority="P0",
                    issue_type="标题批注错误",
                )
            )
    return issues


def check_paragraph_comments(elements: list[dict]) -> list[AuditIssue]:
    issues: list[AuditIssue] = []
    for el in elements:
        if el["kind"] != "paragraph":
            continue
        if not el.get("has_comment"):
            issues.append(
                AuditIssue(
                    severity="ERROR",
                    rule_id="PARAGRAPH_WITHOUT_COMMENT",
                    message=f'段落缺少批注: "{el["text"][:60]}"',
                    context=el["text"][:200],
                    suggestion="为该段落添加批注说明",
                    priority="P0",
                    issue_type="段落缺批注",
                )
            )
    return issues


def check_table_refs_static(elements: list[dict]) -> list[AuditIssue]:
    issues: list[AuditIssue] = []
    existing_table_ids: set[str] = set()
    table_caption_indices: set[int] = set()

    for i, el in enumerate(elements):
        if el["kind"] != "table":
            continue
        table_id = None
        if i > 0 and elements[i - 1]["kind"] == "paragraph":
            prev_text = elements[i - 1]["text"].strip()
            m = re.match(r"^\s*表\s*(\d[\-\.]?\d*)\s*[：:：]?\s*\S", prev_text)
            if m:
                table_id = m.group(1)
                table_caption_indices.add(elements[i - 1]["idx"])
        if not table_id and el.get("rows"):
            first_row_text = " ".join(el["rows"][0])
            m = re.match(r"^\s*表\s*(\d[\-\.]?\d*)", first_row_text)
            if m:
                table_id = m.group(1)
        if table_id:
            existing_table_ids.add(table_id)

    for el in elements:
        if el["kind"] not in ("heading", "paragraph"):
            continue
        if el["idx"] in table_caption_indices:
            continue
        for m in re.finditer(r"表\s*(\d[\-\.]?\d*)", el["text"]):
            table_id = m.group(1)
            if table_id not in existing_table_ids:
                issues.append(
                    AuditIssue(
                        severity="ERROR",
                        rule_id="TABLE_NAME_WITHOUT_TABLE",
                        message=f'段落提到"表{table_id}"但文档中无此表格',
                        context=el["text"][:200],
                        suggestion=f"补充表{table_id}或修正引用",
                        priority="P0",
                        issue_type="表格引用缺失",
                    )
                )
    return issues


# ── iii Function 入口（统一 payload: {elements: [...]}）────

async def fn_check_ai_traces(payload: dict) -> dict:
    elements = _parse_elements(payload.get("elements"))
    issues = check_ai_traces(elements)
    return {"issues": issues_to_dicts(issues), "count": len(issues)}


async def fn_check_heading_comments(payload: dict) -> dict:
    elements = _parse_elements(payload.get("elements"))
    issues = check_heading_comments(elements)
    return {"issues": issues_to_dicts(issues), "count": len(issues)}


async def fn_check_paragraph_comments(payload: dict) -> dict:
    elements = _parse_elements(payload.get("elements"))
    issues = check_paragraph_comments(elements)
    return {"issues": issues_to_dicts(issues), "count": len(issues)}


async def fn_check_table_refs_static(payload: dict) -> dict:
    elements = _parse_elements(payload.get("elements"))
    issues = check_table_refs_static(elements)
    return {"issues": issues_to_dicts(issues), "count": len(issues)}
