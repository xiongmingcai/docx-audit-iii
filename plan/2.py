"""
文生文审核 · CLI 本地执行脚本

用 workers/docx-audit/config.json 中的 LLM 配置（SiliconFlow + DeepSeek-V3.2），
对指定 docx 执行完整审核（parse → static → agent → report），进程内直调（iii=None），
不走引擎。用于验证 CLI 版本端到端效果。

执行：
    cd /home/robert/development/docx-audit-iii
    python3 plan/2.py
"""
import asyncio
import sys
from pathlib import Path

# 把 worker 源码加入路径
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "workers" / "docx-audit"))

from src.worker import fn_audit  # noqa: E402

# ── 要检测的文档 ──────────────────────────────────────────
DOC = Path(__file__).parent / "副本景嘉微智能文档项目合同-需求和验收标准-0311(1)(1).docx"


async def main() -> None:
    if not DOC.exists():
        print(f"文档不存在: {DOC}")
        sys.exit(1)

    print(f"📄 审核文档: {DOC.name} ({DOC.stat().st_size / 1024:.1f} KB)")
    print(f"📂 路径: {DOC}")
    print()

    payload = {
        "path": str(DOC),
        "use_llm": True,        # 启用 Agent 语言质量检查（用 config.json 的 LLM）
        "check_comments": True, # 启用批注检测
    }

    result = await fn_audit(payload, iii=None)

    print("\n" + "=" * 60)
    if result.get("ok"):
        print("✅ 审核完成")
        stats = result.get("stats", {})
        summary = result.get("summary", {})
        report = result.get("report", {})
        print(f"   段落: {stats.get('paragraphs', 0)}  标题: {stats.get('headings', 0)}  表格: {stats.get('tables', 0)}")
        print(f"   问题: {summary.get('total', 0)}  (ERROR: {summary.get('errors', 0)}, WARNING: {summary.get('warnings', 0)})")
        print(f"   报告: {report.get('report_path', '')}")
        print(f"   CSV : {report.get('csv_path', '')}")
        print(f"   Trace: {result.get('trace_id', '')}")
    else:
        print(f"❌ 审核失败: {result.get('error', '未知错误')}")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
