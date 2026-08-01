# Mastra Agent 作为 III Worker

> **目标读者**：已了解 III 三个原语的实习生
> **阅读时间**：15 分钟
> **验证代码**：[verify/01-mastra-as-worker.mjs](./verify/01-mastra-as-worker.mjs)

---

## 一句话结论

**Mastra Agent 注册为 III Function 后，即可被 III 生态中任何调用方（HTTP、SDK、Queue、Cron）触发——Agent 与普通 Function 无区别。**

---

## 背景：III 眼中的 Agent

在 III 的世界里，没有"特殊物种"。Agent 不是需要特殊对待的东西——它就是一个 **Worker 提供的 Function**。

```
传统架构                    III 架构
─────────                   ──────
Agent Service      →        Worker (注册 Agent Function)
Agent API          →        HTTP Trigger → Agent Function
Agent 异步任务     →        Queue Trigger → Agent Function
Agent 定时任务     →        Cron Trigger → Agent Function
```

这意味着：**你学到的 III 三个原语，对 Agent 完全适用。**

---

## 实战：将 Mastra Agent 接入 III

### 步骤 1: 创建 Mastra Agent

```javascript
import { Agent } from "@mastra/core/agent";

const myAgent = new Agent({
  id: "assistant",
  name: "智能助手",
  instructions: "你是一个简洁的助手。用中文回答，不超过 50 字。",
  model: "siliconflow-cn/deepseek-ai/DeepSeek-V3.2",
});
```

> **关键**：`model` 字段使用 `provider/model` 格式。Mastra 原生支持 `siliconflow-cn` provider，需要环境变量 `SILICONFLOW_CN_API_KEY`。

### 步骤 2: 连接到 III 并注册为 Function

```javascript
import { registerWorker } from "iii-sdk";

const worker = registerWorker("ws://localhost:49134", {
  workerName: "mastra-worker",
});

// 将 Agent 包装为 III Function
worker.registerFunction("agent::chat", async (data) => {
  const response = await myAgent.generate(data.message);
  return { reply: response.text, tokens: response.usage?.totalTokens };
});
```

### 步骤 3: 通过 III 调用 Agent

**方式 A: SDK 同步调用**

```javascript
const result = await worker.trigger({
  function_id: "agent::chat",
  payload: { message: "什么是控制反转？" },
});
console.log(result.reply);
// → "控制反转是将依赖创建权交给外部容器管理的设计模式。"
```

**方式 B: HTTP 调用**

```javascript
// 先注册 HTTP Trigger
worker.registerTrigger({
  type: "http",
  function_id: "agent::chat",
  config: { api_path: "/api/chat", http_method: "POST" },
});

// 然后即可通过 HTTP 调用
const resp = await fetch("http://localhost:3111/api/chat", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ message: "什么是控制反转？" }),
});
const json = await resp.json();
// HTTP 函数需返回 { body, statusCode } 格式
```

> **验证结果**（实际运行输出）：
> ```
> ✅ Agent 注册为 agent::chat
> ✅ SDK 同步调用: "控制反转是将依赖创建权交给外部容器管理的设计模式。"
> ✅ HTTP 调用 status: 200
> ✅ 硅基流动 DeepSeek-V3.2 响应正常
> ```

---

## 关键发现

### 1. 硅基流动适配

Mastra 的 `siliconflow-cn` provider 默认使用 `.cn` 域名（不是 `.com`）：

```javascript
// ✅ 正确
model: "siliconflow-cn/deepseek-ai/DeepSeek-V3.2"
// 需要环境变量: SILICONFLOW_CN_API_KEY

// ❌ 错误（使用 .com 域名会报 401 Unauthorized）
model: "siliconflow/deepseek-ai/DeepSeek-V3.2"
```

> **验证结果**：
> ```
> ✅ siliconflow-cn → 200 OK
> ❌ siliconflow (.com) → 401 Unauthorized
> ```

### 2. HTTP Trigger 返回格式

HTTP 触发的 Function 必须返回 `{ body, statusCode }` 结构，否则 HTTP 响应为空 `{}`：

```javascript
// ❌ 错误 — HTTP 响应为空
worker.registerFunction("agent::chat", async (data) => {
  const r = await myAgent.generate(data.message);
  return { reply: r.text };  // 缺少 statusCode
});

// ✅ 正确
worker.registerFunction("agent::chat", async (data) => {
  const r = await myAgent.generate(data.message);
  return { body: { reply: r.text }, statusCode: 200 };
});
```

> **验证结果**：
> ```
> ❌ 返回 { reply } → HTTP body: {}
> ✅ 返回 { body, statusCode } → HTTP body: {"reply":"..."}
> ```

### 3. Agent 调用耗时

由于涉及 LLM 推理，Agent Function 的响应时间在 1-5 秒（取决于模型和 prompt 长度）。III 默认超时 30 秒足够覆盖：

```
验证: Agent 调用耗时
  → 平均 1.5-3 秒（硅基流动 DeepSeek-V3.2）
  → 默认超时 30s 足够
```

---

## 架构视角

```
┌─────────────────────────────────────────────────────────┐
│                     III Engine                           │
│                                                         │
│   HTTP ─────► agent::chat ──┐                          │
│   SDK  ─────► agent::chat ──┼──► Mastra Agent          │
│   Queue ────► agent::chat ──┘      └──► 硅基流动 LLM   │
│   Cron ─────► agent::chat ──┐                          │
│                             │                          │
│                    同一个 Function                       │
│                    被多种 Trigger 触发                   │
└─────────────────────────────────────────────────────────┘
```

**核心洞察**：Agent 接入 III 后，自动获得：
- **HTTP 暴露**：任何 HTTP 客户端可调用
- **队列异步**：长时间任务入队处理
- **定时调度**：Cron 触发定期执行
- **可观测性**：自动 trace 和 metrics
- **State 记忆**：跨调用持久化

---

## 下一步

- [第 2 篇：多 Agent 协作工作流](./02-multi-agent-workflow.md)
- [返回系列目录](./README.md)
