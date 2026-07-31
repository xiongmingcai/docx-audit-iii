# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **当前进度**：详见 [`docs/PROGRESS-2026-07-31.md`](docs/PROGRESS-2026-07-31.md)。接手请先读该文档。

## Project Overview

`docx-audit-iii` is a document audit system for Chinese text documents (docx), rebuilt on the [iii](https://iii.dev) engine using its three primitives:

- **Worker** — `docx-audit` process that registers all audit capabilities with the iii engine
- **Function** — individual audit operations (`docx::parse`, `docx::check_*`, `docx::generate_report`, `docx::audit`)
- **Trigger** — invocation paths: CLI `iii trigger`, HTTP `POST /audit`, queue `docx-audit-jobs`

Static checks and Agent checks are independent Functions that can be triggered individually or orchestrated by `docx::audit`.

## Commands

```bash
# Install dependencies
pip install -r requirements.txt

# Configure environment (LLM access is optional — Agent checks are skipped without API key)
cp .env.example .env

# Run locally WITHOUT the iii engine (in-process fallback, for debugging)
python cli_local.py                                  # default project M1212
python cli_local.py --project M1212                  # pick project
python cli_local.py path/to/doc.docx                 # explicit document
python cli_local.py --no-llm                         # skip Agent checks
python cli_local.py --no-comment-check               # skip comment checks

# Run WITH the iii engine (two terminals)
iii --config config.yaml                             # terminal 1: engine on ws:49134 / http:3111
cd workers/docx-audit && python -m src.worker        # terminal 2: register worker

# Trigger via engine CLI
iii trigger docx::audit path=/path/to/doc.docx

# Trigger via HTTP
curl -X POST http://localhost:3111/audit -H 'Content-Type: application/json' \
  -d '{"path":"/path/to/doc.docx","use_llm":true,"check_comments":true}'
```

There is **no test suite** currently — verification is done by running `cli_local.py` against a real docx and inspecting the generated `*_audit_report.docx` + `.csv`.

## Architecture

### Dual-mode execution (important)

Every Function has two entry points:
1. **Plain function** (e.g. `check_ai_traces(elements)`) — direct Python logic, returns `list[AuditIssue]`
2. **iii wrapper** (e.g. `fn_check_ai_traces(payload)`) — async, takes/returns dicts, used by the engine

The orchestrator `fn_audit(payload, iii=None)` in `worker.py` decides per-call whether to route through the engine (`iii.trigger`) or call Functions in-process. `iii=None` is the local-debug path; a real `iii` client means production routing with traces.

### Data flow

```
docx file
  → docx::parse          → elements[{idx, kind, level, text, para_idx, has_comment, comments, rows, tbl_seq}]
  → static checks        → issues (no LLM needed)
  → agent checks         → issues (require LLM_API_KEY; skipped silently if absent)
  → docx::generate_report→ docx + csv on disk
```

### File roles (`workers/docx-audit/src/`)

- `models.py` — `AuditIssue` dataclass, env loading, priority maps, AI_TRACE_PATTERNS. Single source of truth for issue shape and LLM config. `_ROOT` is computed as 3 levels up (reaches repo root from `src/`).
- `parse.py` — `parse_document()` walks `doc.element.body`, classifies paragraphs vs headings vs tables, extracts comments. Heading detection uses `w:pStyle`, `w:outlineLvl`, and regex on numbering. Comment extraction handles `commentRangeStart/End` plus the "blank paragraph after table inherits table-caption comment" quirk.
- `static_checks.py` — pure regex/structure checks: AI traces, heading-with-comment, paragraph-without-comment, dangling table references (pre-filter before Agent).
- `agent_checks.py` — uses OpenAI Agents SDK (`agents.Agent`, `agents.Runner`) pointed at any OpenAI-compatible endpoint (default: SiliconFlow + DeepSeek-V3.2). Quality check runs in batches of 10 paragraphs concurrently.
- `report.py` — writes styled docx report + companion CSV (project-prefixed keys like `M1212-001`).
- `worker.py` — `fn_audit` orchestrator + `main()` that registers Functions/triggers with the iii SDK.

### Configuration

- `.env` (repo root, via `dotenv`): `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, `DATA_ROOT`, `DEFAULT_PROJECT`, `III_ENGINE_URL`
- `config.yaml`: iii engine ports (ws 49134, http 3111) and built-in workers (iii-http, iii-queue, iii-state, iii-observability)
- `iii.worker.yaml`: declares the `docx-audit` worker, its Function list, and its HTTP/queue Triggers

### Adding a new check

1. Write the plain logic function (takes `elements`, returns `list[AuditIssue]`)
2. Add an async `fn_*` dict-in/dict-out wrapper in the same file
3. Register it in `worker.py`: import, add to `iii.register_function(...)`, and call it from `fn_audit`'s `dispatch` table so the orchestrator can reach it both in-process and via engine
4. Declare the Function ID in `iii.worker.yaml`

## Frontend Console (`./frontend`)

Linear/Vercel-style dashboard that runs the browser as a iii Worker via `iii-browser-sdk`. Stack: React 19 + react-router-dom v7 + TailwindCSS v4 + sonner, Vite 8. `package.json` is the source of truth — do not hand-edit it without checking the pinned majors.

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173
npm run build      # tsc -b && vite build
```

Key seams:
- `src/sdk/client.ts` — `EngineClient` abstraction over `iii-browser-sdk`. Ships a reference WebSocket client so the UI runs without the SDK installed; swap to real `registerWorker` here when the package is present.
- `src/store.ts` — single external store via `useSyncExternalStore`. Holds connection state, jobs (persisted to localStorage), settings, theme. `runAudit()` triggers `docx::audit`.
- `src/hooks/useAuditJob.ts` — local 4-step state machine (parse → static → agent → report). Designed to be replaced by real `state`/`stream` events from the backend when those are emitted.
- `src/components/StepRail.tsx`, `IssueTable.tsx` — progress + results.
- `src/pages/` — `NewJob` (Zones A/B/C), `History`, `JobDetail`, `Workers` (reads `engine::workers::list`), `Settings`.

The `.docx` download button is intentionally disabled (needs a future engine file-serving endpoint); CSV export works client-side from the result.

## Conventions

- Function IDs always use the `docx::` namespace
- Priorities: P0 (blocking structural issues) → P1 (AI traces) → P2 (language quality) → P3/P4 (style). Defined in `PRIORITY_MAP` and `ISSUE_TYPE_PRIORITY` in `models.py`
- Agent checks degrade gracefully: if `LLM_API_KEY` is empty, they return no issues rather than erroring
- Chinese UI/output strings are in simplified Chinese; keep that consistent in new checks
