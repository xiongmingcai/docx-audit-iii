"""docx::parse — 解析文档为结构化元素 + 批注映射。"""
from __future__ import annotations

import os
import re
from io import BytesIO
from typing import Any, Union

from docx import Document
from docx.oxml.ns import qn
from lxml import etree

from .models import NS_W


def _xml_text(element) -> str:
    parts = []
    for node in element.iter():
        if node.tag in (f"{{{NS_W}}}t", "t") and node.text:
            parts.append(node.text)
    return "".join(parts)


def _extract_comments(doc) -> dict[int, list[str]]:
    """{paragraph_index: [comment_texts]}"""
    comment_texts: dict[str, str] = {}

    for rel in doc.part.rels.values():
        try:
            target_ref = rel.target_ref
        except (AttributeError, TypeError):
            continue
        if "comments" not in target_ref or "Extended" in target_ref:
            continue

        comments_part = rel.target_part
        if hasattr(comments_part, "_element") and comments_part._element is not None:
            root = comments_part._element
        else:
            if not comments_part.blob:
                continue
            root = etree.fromstring(comments_part.blob)

        for comment in root.findall(qn("w:comment")):
            cid = comment.get(qn("w:id"))
            text = _xml_text(comment).strip()
            comment_texts[cid] = text

    if not comment_texts:
        return {}

    comments_map: dict[int, list[str]] = {}
    body_children = list(doc.element.body)
    active_comments: set[str] = set()
    para_idx = 0
    paragraph_comments: dict[int, set[str]] = {}
    body_to_para: dict[int, int] = {}

    for body_idx, child in enumerate(body_children):
        tag = child.tag.split("}")[-1] if "}" in child.tag else child.tag
        if tag != "p":
            continue

        text = _xml_text(child).strip()
        if not text:
            continue

        body_to_para[body_idx] = para_idx
        current_comments = set(active_comments)

        for cr_start in child.findall(qn("w:commentRangeStart")):
            cid = cr_start.get(qn("w:id"))
            if cid in comment_texts:
                active_comments.add(cid)
                current_comments.add(cid)

        for ref in child.iter(qn("w:commentReference")):
            cid = ref.get(qn("w:id"))
            if cid in comment_texts:
                current_comments.add(cid)

        for cr_end in child.findall(qn("w:commentRangeEnd")):
            cid = cr_end.get(qn("w:id"))
            if cid in comment_texts:
                current_comments.add(cid)
                active_comments.discard(cid)

        paragraph_comments[para_idx] = current_comments
        para_idx += 1

    # 表格后空段落批注 → 归属表格标题
    for body_idx, child in enumerate(body_children):
        tag = child.tag.split("}")[-1] if "}" in child.tag else child.tag
        if tag != "p":
            continue
        if _xml_text(child).strip():
            continue
        refs = list(child.iter(qn("w:commentReference")))
        if not refs or body_idx < 2:
            continue
        prev_tag = (
            body_children[body_idx - 1].tag.split("}")[-1]
            if "}" in body_children[body_idx - 1].tag
            else body_children[body_idx - 1].tag
        )
        prev2_tag = (
            body_children[body_idx - 2].tag.split("}")[-1]
            if "}" in body_children[body_idx - 2].tag
            else body_children[body_idx - 2].tag
        )
        if prev_tag != "tbl" or prev2_tag != "p":
            continue
        caption_para_idx = body_to_para.get(body_idx - 2)
        if caption_para_idx is None:
            continue
        for ref in refs:
            cid = ref.get(qn("w:id"))
            if cid in comment_texts:
                comments_map.setdefault(caption_para_idx, []).append(comment_texts[cid])

    for idx, comment_ids in paragraph_comments.items():
        for cid in comment_ids:
            comments_map.setdefault(idx, []).append(comment_texts[cid])

    return comments_map


def _is_heading(child, text: str) -> tuple[bool, int]:
    pPr = child.find(qn("w:pPr"))
    if pPr is not None:
        pStyle = pPr.find(qn("w:pStyle"))
        if pStyle is not None:
            val = pStyle.get(qn("w:val")) or ""
            if "Heading" in val or "heading" in val:
                m = re.search(r"(\d)", val)
                return True, int(m.group(1)) if m else 1
            if val in ("1", "2", "3", "4", "5", "6"):
                return True, int(val)
        ol = pPr.find(qn("w:outlineLvl"))
        if ol is not None:
            ol_val = ol.get(qn("w:val"))
            if ol_val is not None and 0 <= int(ol_val) <= 8:
                return True, int(ol_val) + 1

    if re.match(r"^(\d+[\.、：:]|第?[一二三四五六七八九十]+[章节篇])", text):
        return True, 1
    return False, 0


def parse_document(source: Union[str, bytes]) -> list[dict[str, Any]]:
    """
    解析 docx → 结构化元素列表。

    source 可以是文件路径（str）或 docx 二进制内容（bytes）。
    传 bytes 时用 BytesIO 在内存中打开，适配沙箱/无文件系统场景。

    每项: {idx, kind, level?, text?, para_idx?, has_comment?, comments?, rows?, tbl_seq?}
    """
    if isinstance(source, bytes):
        doc = Document(BytesIO(source))
    else:
        doc = Document(source)
    comments_map = _extract_comments(doc)

    elements: list[dict[str, Any]] = []
    tbl_seq = 0
    para_idx = 0

    for child in doc.element.body:
        tag = child.tag.split("}")[-1] if "}" in child.tag else child.tag

        if tag == "p":
            text = _xml_text(child).strip()
            if not text:
                continue
            is_heading, heading_level = _is_heading(child, text)
            elements.append(
                {
                    "idx": len(elements),
                    "kind": "heading" if is_heading else "paragraph",
                    "level": heading_level,
                    "text": text,
                    "para_idx": para_idx,
                    "has_comment": para_idx in comments_map,
                    "comments": comments_map.get(para_idx, []),
                }
            )
            para_idx += 1

        elif tag == "tbl":
            rows = []
            for tr in child.findall(qn("w:tr")):
                cells = [_xml_text(tc) for tc in tr.findall(qn("w:tc"))]
                rows.append(cells)
            elements.append(
                {
                    "idx": len(elements),
                    "kind": "table",
                    "rows": rows,
                    "tbl_seq": tbl_seq,
                }
            )
            tbl_seq += 1

    return elements


# ── iii Function 入口 ─────────────────────────────────────

async def fn_parse(payload: dict) -> dict:
    """
    Function: docx::parse

    Input（二选一）:
      { "path": "<docx path>" }            # 文件路径（worker 能访问文件系统时）
      { "content": "<base64 docx bytes>" }  # docx 二进制 base64（沙箱/无文件路径时）
    Output: { "elements": [...], "stats": {paragraphs, headings, tables}, "source": "path"|"content" }
    """
    import base64

    path = payload.get("path") or payload.get("input_path")
    content_b64 = payload.get("content")

    if content_b64:
        try:
            raw = base64.b64decode(content_b64)
        except Exception as e:
            return {"error": f"invalid base64 content: {e}"}
        elements = parse_document(raw)
        stats = _compute_stats(elements)
        return {"elements": elements, "stats": stats, "source": "content", "size": len(raw)}
    elif path:
        if not os.path.exists(path):
            return {"error": f"file not found: {path}"}
        elements = parse_document(path)
        stats = _compute_stats(elements)
        return {"elements": elements, "stats": stats, "source": "path", "path": path}
    else:
        return {"error": "missing path or content"}


def _compute_stats(elements: list[dict]) -> dict:
    return {
        "paragraphs": sum(1 for e in elements if e["kind"] == "paragraph"),
        "headings": sum(1 for e in elements if e["kind"] == "heading"),
        "tables": sum(1 for e in elements if e["kind"] == "table"),
    }
