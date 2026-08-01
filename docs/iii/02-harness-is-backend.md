# Harness 即后端 — Agent 不是特殊物种

> **目标读者**：了解 III 基础后，想理解 Agent 在 III 中位置的实习生
> **阅读时间**：12 分钟
> **验证代码**：[verify/02-harness-is-backend.mjs](./verify/02-harness-is-backend.mjs)
> **前置阅读**：[第 1 篇：III 是什么](./01-three-primitives.md)

---

## 核心命题

> **"The harness isn't on top of the backend. The harness is a part of the backend."**
> —— Mike Piccolo, iii 创始人

在传统架构中，Agent 的"Harness"（循环、工具、记忆）跑在一层，Backend（队列、状态、HTTP）跑在另一层。III 的赌注是：**这两层应该是一层**。

---

## Agent 在 III 中的映射

| Agent 概念 | III 对应 | 说明 |
|-----------|---------|------|
| **Agent 本身** | Worker | 一个连接到 Engine 的进程 |
| **工具（Tool）** | Function | 稳定 ID 的能力单元 |
| **记忆（Memory）** | `state::*` | 持久化键值存储 |
| **编排（Orchestration）** | Trigger | 声明式事件绑定 |
| **调用工具** | `worker.trigger()` | Worker 调用另一个 Worker 的 Function |

**验证结果**（实际运行输出）：
```
✅ Agent 注册了 3 个工具（Function）
  agent::research 返回: 2 条结果
  agent::write_code 返回: // 快速排序
  Agent Worker 状态: connected
  Agent Worker 函数数: 3
  Agent Worker 运行时: node
```

---

## Agent 就是一个 Worker

在 III 中，创建一个 Agent 和创建一个普通服务**完全一样**：

```typescript
// 创建一个 Agent（就是一个 Worker）
const agent = registerWorker("ws://localhost:49134", {
  workerName: "my-agent",
  workerDescription: "一个能搜索和写代码的 Agent",
});

// Agent 注册"工具"（就是 Function）
agent.registerFunction("agent::research", async (data) => {
  return { results: await searchWeb(data.query) };
});

agent.registerFunction("agent::write_code", async (data) => {
  return { code: await generateCode(data.task) };
});
```

**验证结果**（实际运行输出）：
```
  Agent 选择工具: agent::research
  工具返回: {"action":"research","query":"搜索 III 框架"...}
  Agent Worker 状态: connected
  Agent Worker 函数数: 3
```

Agent 在注册表中**没有特殊地位**——它和队列 Worker、HTTP Worker、Python ML Worker 一样，只是一个 connected 的 Worker。

---

## Agent 的工具就是 Function

传统 Agent 框架中，"工具"是 JSON Schema 描述的函数，由模型选择调用。在 III 中：

> **工具 = Function = 引擎注册表中的能力**

```typescript
// 注册工具
agent.registerFunction("agent::research", handler, {
  description: "搜索信息",  // Agent 用这个描述决定何时调用
});

// 调用工具（本质是 Worker.trigger）
const result = await agent.trigger({
  function_id: "agent::research",
  payload: { query: "III framework" },
});
```

**验证结果**（实际运行输出）：
```
  agent::research 返回: 2 条结果
  agent::write_code 返回: // 快速排序
```

---

## Agent 的记忆就是 state::*

Agent 需要持久化记忆（对话历史、用户偏好、学习成果）。在 III 中，这就是 `state::set` / `state::get`：

```typescript
// 写入记忆
await agent.trigger({
  function_id: "state::set",
  payload: {
    scope: "agent-memory",
    key: "session-001",
    value: { user: "实习生", learned: ["Worker", "Trigger"] },
  },
});

// 读取记忆
const memory = await agent.trigger({
  function_id: "state::get",
  payload: { scope: "agent-memory", key: "session-001" },
});
```

**验证结果**（实际运行输出）：
```
  写入记忆: session-001
  读取记忆: user=实习生, topic=III 框架
  已学会: Worker, Trigger, Function
```

---

## Agent 的编排就是 Trigger

当特定事件发生时，Agent 需要被自动唤醒。这就是 Trigger：

```typescript
// 当收到 HTTP 请求时，自动触发 Agent 的研究工具
agent.registerTrigger({
  type: "http",
  function_id: "agent::research",
  config: { method: "GET", api_path: "/agent/research" },
});

// 当某个状态变更时，触发 Agent
agent.registerTrigger({
  type: "state",
  function_id: "agent::summarize",
  config: { scope: "tasks", key: "pending-summary" },
});
```

**验证结果**（实际运行输出）：
```
✅ HTTP Trigger 注册: GET /agent/research → agent::research
```

---

## Agent 调用工具 = Worker 调用 Worker

Agent 的"自主决策循环"在 III 中就是：

```typescript
async function agentLoop(userQuery) {
  // 1. 读取记忆（state::get）
  const memory = await agent.trigger({
    function_id: "state::get",
    payload: { scope: "agent-memory", key: "current-session" },
  });

  // 2. 模型决定调用哪个工具
  const toolId = await modelDecideTool(userQuery, memory);

  // 3. 调用工具（Worker.trigger）
  const result = await agent.trigger({
    function_id: toolId,
    payload: { query: userQuery, context: memory },
  });

  // 4. 持久化结果（state::set）
  await agent.trigger({
    function_id: "state::set",
    payload: { scope: "agent-memory", key: "last-result", value: result },
  });

  return result;
}
```

**验证结果**（实际运行输出）：
```
  Agent 选择工具: agent::research
  工具返回: {"action":"research","query":"搜索 III 框架的最新版本"...}
```

---

## 为什么这很重要？

### 传统架构的问题

```
Agent → [HTTP] → Backend API → [DB]
Agent → [SDK] → Queue → [Consumer]
Agent → [Log] → Log Aggregator
（三条路径、三个 trace、三套重试）
```

### III 架构

```
Agent(Worker) → trigger() → Function(Worker) → trigger() → Function(Worker)
（一条 trace、一套重试、一个运行时）
```

当 Agent 和 Backend 运行在**同一个运行时**上：
- Agent 调用工具 = 调用 Function = 自动产生 trace
- Agent 的记忆 = state::* = 自动持久化 + 触发变更事件
- Agent 的编排 = Trigger = 声明式、可组合
- **不需要单独的 Harness 层**

---

## 一句话总结

> **Agent 不是特殊物种。它是 Worker，工具是 Function，记忆是 state::*，编排是 Trigger。当 Harness 和 Backend 运行在同一个运行时上时，"Harness"这个概念本身就消失了——剩下的只有 Worker、Trigger、Function。**

---

## 下一步

- [第 3 篇：可观测性即运行时属性](./03-observability.md) — 验证自动 trace 注入
- [验证代码运行](../verify/02-harness-is-backend.mjs)：`node verify/02-harness-is-backend.mjs`

---

> **本文件所有结论均来自代码实际运行**。运行 `node docs/iii/verify/02-harness-is-backend.mjs` 即可复现。
