# III + Mastra Agent 实战系列

> **用代码验证每一句话的 III + Mastra 实战教程**

本系列面向已了解 III 三个原语的实习生，带你掌握如何用 III + Mastra 构建生产级 Agent 应用。

---

## 文章列表

| # | 文章 | 核心结论 | 验证代码 |
|---|------|---------|---------|
| 1 | [Mastra Agent 作为 III Worker](./01-mastra-as-worker.md) | Mastra Agent 注册为 III Function，即可被全生态调用 | [运行](./verify/01-mastra-as-worker.mjs) |
| 2 | [多 Agent 协作 — 工作流编排](./02-multi-agent-workflow.md) | III Trigger 驱动 Mastra Workflow，多 Agent 链式协作 | [运行](./verify/02-multi-agent-workflow.mjs) |
| 3 | [Agent 记忆与会话持久化](./03-agent-memory.md) | iii-state 存储会话历史，跨调用保持上下文 | [运行](./verify/03-agent-memory.mjs) |
| 4 | [Agent 工具调用 — 打通 iii 生态](./04-agent-tools.md) | Mastra Tool 调用 iii Function，Agent 能力无限扩展 | [运行](./verify/04-agent-tools.mjs) |
| 5 | [后台 Agent 异步处理](./05-async-agent.md) | iii Queue 驱动长时间 Agent 任务，轮询获取结果 | [运行](./verify/05-async-agent.mjs) |
| 6 | [Agent 注册中心与智能路由](./06-agent-registry.md) | 多 Agent 统一注册，Router Agent 自动分发 | [运行](./verify/06-agent-registry.mjs) |

---

## 5 分钟快速体验

```bash
# 1. 确保 III 引擎运行中
iii --config config.yaml

# 2. 安装 Mastra
npm install @mastra/core

# 3. 配置硅基流动 API Key
export SILICONFLOW_CN_API_KEY=your-key

# 4. 运行第一篇验证脚本
node docs/mastra/verify/01-mastra-as-worker.mjs
```

---

## 学习路径

```
第 1 篇（基础）
  ↓ Mastra Agent 如何作为 III Function
第 2 篇（编排）
  ↓ 多 Agent 工作流协作
第 3 篇（记忆）
  ↓ Agent 跨会话记忆
第 4 篇（工具）
  ↓ Agent 调用外部系统
第 5 篇（异步）
  ↓ 后台长时间任务
第 6 篇（架构）
  → Agent 注册中心与智能路由
```

---

## 前置条件

- 已阅读 [III 三原语系列](../iii/README.md)
- III 引擎运行中 (`iii --config config.yaml`)
- Node.js >= 22.18.0
- `@mastra/core` 已安装
- 硅基流动 API Key（或其他兼容 OpenAI API 的 LLM）

---

## 验证结果总览

| 篇 | 验证项 | 结果 |
|---|--------|------|
| 1 | Agent 注册为 Function、SDK 同步调用、HTTP 调用、硅基流动适配、HTTP 返回格式 | ✅ 5/5 |
| 2 | Workflow 三步串联、.then() 传数据、.map()+getInitData()、注册为 Function、steps 结构 | ✅ 5/5 |
| 3 | State 读写会话、多轮对话记忆、Scope 隔离、滑动窗口、State API 操作 | ✅ 5/5 |
| 4 | Tool 包装 Function、Agent 自动选 Tool、toolCalls 结构、多 Tool 协作、Tool vs 直接调用 | ✅ 5/5 |
| 5 | 异步入队、后台执行+轮询、结果写回 State、三种调用模式、Queue 重试 | ✅ 5/5 |
| 6 | 多 Agent 注册、Function 列表发现、Router 路由、直接 vs 路由、注册中心扩展 | ✅ 5/5 |

**总计：30/30 项验证全部通过 ✅**

---

## 关于 Mastra

Mastra 是一个 TypeScript AI Agent 框架，提供 Agent、Workflow、Memory、RAG 等能力，支持 90+ LLM 提供商。

- 官网：https://mastra.ai
- 与 III 的关系：Mastra 提供 Agent"大脑"，III 提供分布式"骨架"
