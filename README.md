# docx-audit — iii 版文生文文档审核

基于 [iii](https://iii.dev) 引擎重构的中文 docx 文档审核系统。可解析文档、执行静态规则检查、调用 LLM Agent 做语言质量检查，最终生成结构化报告。

![Status](https://img.shields.io/badge/status-active%20development-blue)
![Stack](https://img.shields.io/badge/stack-React%2019%20%2B%20Python%203.12%20%2B%20iii%20v0.21-green)
![License](https://img.shields.io/badge/license-MIT-lightgrey)

## ✨ 特性

- **Pipeline Flow 可视化** — 审核管线实时展示：接单 → Agent 质检（内嵌子批次进度）→ 生成报告 → 完成
- **实时活动流** — WebSocket 推送 + 轮询双通道，秒级刷新进度
- **Agent 并行质检** — 段落分批并发调用 LLM，支持 SiliconFlow / DeepSeek / OpenAI 兼容接口
- **可恢复工作流** — 基于 iii Queue + State，Worker 崩溃后自动重投递、断点续审
- **双模式入口** — 同步 CLI / HTTP 触发，或异步后台提交 + 实时进度面板
- **前端控制台** — React 19 + TailwindCSS，Linear/Vercel 风格 UI

## 🏗 架构

```
┌──────────────────────────────────────────────────────────────────┐
│  iii Engine                                                       │
│  ┌─────────┐   ┌─────────────┐   ┌──────────┐   ┌────────────┐  │
│  │  State   │◄──│  Queue       │──▶│ Function │──▶│  Worker     │  │
│  │audit-    │   │audit-agent  │   │docx::    │   │docx-audit   │  │
│  │jobs     │   │(retry+DLQ)  │   │quality_  │   │(Python)     │  │
│  └─────────┘   └─────────────┘   │batch     │   └────────────┘  │
│       │                           └──────────┘          │         │
│       │  _push_progress                                │         │
│       ▼                                                ▼         │
│  ┌──────────────────────────────────────────────────────────────┐│
│  │  Frontend (React)  ←── WebSocket ──▶  Browser               ││
│  │  Pipeline Flow · 实时活动 · IssueTable · JobDetail           ││
│  └──────────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────┘
```

### iii 三原语映射

| 原语 | 本项目中的角色 |
|------|----------------|
| **Worker** | `docx-audit`：注册全部审核能力 |
| **Function** | `docx::parse`、`docx::check_*`、`docx::generate_report`、`docx::audit_start`、`docx::quality_batch`、`docx::quality_finalize`、`docx::audit_status` |
| **Trigger** | HTTP `POST /audit`、Queue `audit-agent`、CLI `iii trigger` |

## 🚀 快速开始

### 前置条件

- [iii 引擎](https://iii.dev/docs/install) v0.21+
- Python 3.12+
- Node.js 20+
- （可选）LLM API Key — 用于 Agent 语言质量检查

### 1. 安装 iii 引擎

```bash
curl -fsSL https://install.iii.dev | sh
```

### 2. 安装依赖

```bash
# Worker 依赖
pip install -r requirements.txt

# 前端依赖
cd frontend && npm install
```

### 3. 配置环境

```bash
cp .env.example .env
# 编辑 .env 填入 LLM 配置（可选，不配则跳过 Agent 检查）
```

### 4. 启动服务

```bash
# 终端 1：启动 iii 引擎
iii --config config.yaml

# 终端 2：启动 Worker
cd workers/docx-audit && python -m src.worker

# 终端 3：启动前端
cd frontend && npm run dev   # http://localhost:5173
```

### 5. 触发审核

```bash
# CLI 同步触发
iii trigger docx::audit path=/path/to/doc.docx use_llm=true

# HTTP 异步触发（返回 job_id，后台执行）
curl -X POST http://localhost:3111/audit \
  -H 'Content-Type: application/json' \
  -d '{"path":"/path/to/doc.docx","use_llm":true,"check_comments":true}'

# 前端界面：http://localhost:5173 → 上传文件 → 开始审核
```

## 📋 Function 一览

| Function ID | 类型 | 说明 |
|-------------|------|------|
| `docx::parse` | 核心 | 解析 docx → 结构化 elements + 批注映射 |
| `docx::check_ai_traces` | 静态 | 检测 AI 生成痕迹（GPT/ChatGPT 等） |
| `docx::check_heading_comments` | 静态 | 标题不得含批注 |
| `docx::check_paragraph_comments` | 静态 | 每段必须有批注 |
| `docx::check_table_refs_static` | 静态 | 有表名无表格（正则预检） |
| `docx::check_table_refs_agent` | Agent | 有表名无表格（LLM 复核） |
| `docx::check_paragraph_quality` | Agent | 语句通顺性 + 标点 + 语病 + 口语化 |
| `docx::generate_report` | 核心 | 生成 .docx + .csv 报告 |
| `docx::audit` | 编排 | 同步全流程（CLI 入口） |
| `docx::audit_start` | 编排 | 异步接单（秒级返回 job_id） |
| `docx::quality_batch` | 编排 | 单批段落 Agent 检查（Queue 消费） |
| `docx::quality_finalize` | 编排 | 汇总结果、生成报告 |
| `docx::audit_status` | 查询 | 查询 job 进度快照 |
| `docx::config_get` / `config_set` | 配置 | 运行时 LLM 配置读写 |

## 📊 当前状态

### ✅ 已完成

- **引擎 & Worker 启动** — 15 个 Function 注册成功，健康检查通过
- **核心审核能力** — 解析 + 4 项静态检查 + 2 项 Agent 检查 + 报告生成
- **异步工作流** — `audit_start` 同步接单 → Queue 批量 Agent → `finalize` 出报告
- **前端控制台** — Pipeline Flow 可视化、实时活动流、JobDetail、TaskTray、IssueTable
- **jobId 全链路贯穿** — 前端 ID == worker state key == 轮询 key == 推送匹配 key
- **状态图标系统** — 每个阶段独立图标 + 动效（呼吸/脉冲/抖动）
- **实时活动推送** — WebSocket `_push_progress` + 3s 轮询兜底

### 🔧 已知限制

- `.docx` 报告下载需引擎文件服务（当前仅 CSV 可下载）
- Embedding / Reranker 配置 UI 已就绪，逻辑未接入
- Agent 检查依赖 LLM，无 API Key 时自动跳过

### 📈 性能参考

| 指标 | 数值 |
|------|------|
| 静态检查（90 段落） | < 200ms |
| 单批 Agent 检查（15 段落） | ~15–27s |
| 全文 Agent 检查（90 段落，5 批并发） | ~2–3 min |

## 🤝 贡献指南

欢迎提交 Issue 和 PR！请遵循以下流程：

### 开发流程

1. **Fork** 本仓库
2. 创建特性分支：`git checkout -b feat/your-feature`
3. 提交变更：`git commit -m "feat: add your feature"`
4. 推送分支：`git push origin feat/your-feature`
5. 提交 **Pull Request** 到 `main` 分支

### PR 规范

- **标题格式**：`feat:` / `fix:` / `docs:` / `refactor:` / `chore:` + 简短描述
- **描述内容**：说明变更原因、实现方式、测试方法
- **代码风格**：
  - Python：遵循 PEP 8，函数有 docstring
  - TypeScript：遵循项目 ESLint 配置，组件有 Props 类型
- **测试**：确保 `npm run build` 和 `python -c "import src.worker"` 通过
- **提交前**：确认 `.env` 等敏感文件未被提交

### 添加新检查

1. 在 `static_checks.py` 或 `agent_checks.py` 中编写纯逻辑函数
2. 添加对应的 `fn_check_*` async wrapper
3. 在 `worker.py` 中注册 Function 并加入编排流程
4. 在 `iii.worker.yaml` 的 `functions` 列表中声明
5. 如需新配置 key，在 `config_store.py` 的 `ALLOWED_KEYS` 中添加

## 📁 目录结构

```
docx-audit-iii/
├── config.yaml                    # iii 引擎配置
├── .env.example                   # 环境变量模板
├── requirements.txt               # Worker Python 依赖
├── workers/
│   └── docx-audit/
│       ├── iii.worker.yaml        # Worker manifest
│       └── src/
│           ├── worker.py          # 编排主入口 + Function 注册
│           ├── models.py          # AuditIssue 数据结构 + 优先级
│           ├── parse.py           # docx 解析 + 批注提取
│           ├── static_checks.py   # 4 项静态规则检查
│           ├── agent_checks.py    # 2 项 LLM Agent 检查
│           ├── report.py          # docx + CSV 报告生成
│           ├── config_store.py    # 运行时配置存储
│           └── config_functions.py
├── frontend/
│   ├── package.json
│   └── src/
│       ├── store.ts               # 全局状态 + 审核流程编排
│       ├── sdk/client.ts          # iii-browser-sdk 封装
│       ├── pages/
│       │   ├── NewJob.tsx         # 审核提交页
│       │   ├── JobDetail.tsx      # 作业详情（Pipeline Flow）
│       │   ├── History.tsx        # 历史记录
│       │   ├── Settings.tsx       # 配置页
│       │   └── Workers.tsx        # Worker 注册表
│       └── components/
│           ├── PipelineFlow.tsx   # 管线流程图
│           ├── StatusIcon.tsx     # 状态图标 + 动效
│           ├── IssueChart.tsx     # 问题分布可视化
│           ├── IssueTable.tsx     # 问题列表 + 筛选
│           ├── TaskTray.tsx       # 后台任务托盘
│           └── JobIdChip.tsx      # Job ID 展示 + 复制
├── plan/                          # 架构设计文档
├── docs/                          # 进度文档
└── CLAUDE.md                      # AI 助手工作约定
```

## 📄 License

MIT
