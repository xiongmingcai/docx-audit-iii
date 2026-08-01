# 构建你的第一个 Agent Harness

> **目标读者**：已完成前 4 篇，想动手实践的实习生
> **阅读时间**：15 分钟
> **验证代码**：[verify/05-build-harness.mjs](./verify/05-build-harness.mjs)
> **前置阅读**：[第 1-4 篇](./01-three-primitives.md)

---

## 实战目标

用 III 构建一个**最小但完整的 Agent Harness**，具备：
1. ✅ 工具注册（计算、查询、记忆）
2. ✅ 决策循环（根据输入选择工具）
3. ✅ 记忆系统（持久化键值存储）
4. ✅ 可观测性（自动 trace + 日志）

**验证结果**（实际运行输出）：
```
  🎉 Agent Harness 构建完成！
  Agent 名称: my-first-agent
  注册工具: agent::calculate, agent::lookup, agent::remember
  记忆系统: state::set/get (scope: agent-memory)
  可观测性: 4 spans + 结构化日志
```

---

## 步骤 1：创建 Agent Worker

```typescript
import { registerWorker } from "iii-sdk";
import { Logger, withSpan, initOtel } from "@iii-dev/helpers/observability";

// 初始化可观测性
initOtel({ serviceName: "my-first-agent", enabled: true });
const logger = new Logger();

// 创建 Agent（就是一个 Worker）
const agent = registerWorker("ws://localhost:49134", {
  workerName: "my-first-agent",
  workerDescription: "我的第一个 Agent Harness",
});
```

**验证结果**：
```
✅ Agent Worker 已连接
  Agent 名称: my-first-agent
  Agent 状态: connected
  Agent 工具数: 3
```

---

## 步骤 2：注册工具（Function）

```typescript
// 工具 1: 数学计算
agent.registerFunction("agent::calculate", async (data) => {
  const { a, b, op } = data;
  const result = eval(`${a} ${op} ${b}`); // 简化版
  return { expression: `${a} ${op} ${b}`, result };
}, { description: "执行数学运算" });

// 工具 2: 知识查询
agent.registerFunction("agent::lookup", async (data) => {
  const knowledge = {
    "III": "III 是一个开源后端引擎...",
    "Worker": "Worker 是 III 的参与者...",
  };
  return { topic: data.topic, info: knowledge[data.topic] };
}, { description: "查询知识库" });

// 工具 3: 记忆存储
agent.registerFunction("agent::remember", async (data) => {
  await agent.trigger({
    function_id: "state::set",
    payload: { scope: "agent-memory", key: data.key, value: data.value },
  });
  return { saved: true };
}, { description: "保存到记忆" });
```

**验证结果**：
```
✅ 注册了 3 个工具: agent::calculate, agent::lookup, agent::remember
```

---

## 步骤 3：实现决策循环

```typescript
async function agentThink(userInput) {
  return await withSpan("agent.think", {}, async () => {
    logger.info("Agent 开始思考", { input: userInput });

    // 决策逻辑（实际中由 LLM 完成）
    let toolId, payload;
    if (userInput.match(/\d+\s*[\+\-\*\/]\s*\d+/)) {
      // 数学题 → 调用 calculate
      const [a, op, b] = userInput.match(/(\d+)\s*([\+\-\*\/])\s*(\d+)/).slice(1);
      toolId = "agent::calculate";
      payload = { a: Number(a), op, b: Number(b) };
    } else if (userInput.startsWith("什么是")) {
      // 知识题 → 调用 lookup
      toolId = "agent::lookup";
      payload = { topic: userInput.replace("什么是", "").trim() };
    } else {
      // 其他 → 保存到记忆
      toolId = "agent::remember";
      payload = { key: `note-${Date.now()}`, value: userInput };
    }

    logger.info(`Agent 选择工具: ${toolId}`);

    // 调用工具
    const result = await agent.trigger({ function_id: toolId, payload });
    return { tool: toolId, result };
  });
}
```

**验证结果**：
```
  输入: "3 + 5" → 工具: agent::calculate → 结果: 8
  输入: "什么是 III" → 工具: agent::lookup → 结果: III 是一个开源后端引擎...
  输入: "12 * 7" → 工具: agent::calculate → 结果: 84
```

---

## 步骤 4：记忆系统

```typescript
// 保存记忆
await agent.trigger({
  function_id: "state::set",
  payload: {
    scope: "agent-memory",
    key: "user-preference",
    value: { language: "zh-CN", level: "实习生" },
  },
});

// 读取记忆
const memory = await agent.trigger({
  function_id: "state::get",
  payload: { scope: "agent-memory", key: "user-preference" },
});
```

**验证结果**：
```
  保存: user-preference
  读取: language=zh-CN, level=实习生
```

---

## 步骤 5：在 Console 中观测

```bash
# 启动 Console
iii console
# 浏览器打开 http://127.0.0.1:3113
```

在 Console 中你可以看到：

| 页面 | 看到什么 |
|------|---------|
| **Workers** | `my-first-agent` — connected，3 个 Function |
| **Functions** | `agent::calculate`, `agent::lookup`, `agent::remember` |
| **Traces** | `agent.think` → `execute agent::calculate` 嵌套 span |
| **Logs** | "Agent 开始思考"、"Agent 选择工具: ..." |

**验证结果**：
```
  Agent 相关 spans: 4
  Agent 日志: 自动关联 trace context
```

---

## 关键洞察

### 1. Agent 代码 = 业务代码

你的 Agent 代码里**没有**：
- ❌ 手动埋点
- ❌ HTTP 客户端
- ❌ SDK 初始化（队列、数据库）
- ❌ 重试逻辑
- ❌ 日志配置

只有：
- ✅ 工具实现（纯函数）
- ✅ 决策逻辑（选择哪个工具）
- ✅ 调用工具（`worker.trigger`）

### 2. Harness 自动获得

因为 Agent 是 Worker，引擎自动提供：
- ✅ 分布式 trace（跨 Worker 调用自动追踪）
- ✅ 结构化日志（自动关联 trace context）
- ✅ 持久化状态（`state::*`）
- ✅ 实时可观测（Console 实时查看）
- ✅ 实时发现（新工具注册即刻全局可见）

### 3. 扩展只需加 Worker

想给 Agent 加新能力？

```bash
# 加沙箱（安全执行代码）
iii worker add iii-sandbox

# 加定时任务（定时触发 Agent）
iii worker add cron

# 加队列（异步处理）
iii worker add queue
```

Agent 立即可以使用这些能力——无需修改 Agent 代码。

---

## 一句话总结

> **构建 Agent Harness = 写一个 Worker + 注册几个 Function + 实现决策逻辑。可观测性、持久化、编排全部由引擎提供。你只写业务逻辑，剩下的交给 III。**

---

## 下一步

- 运行所有验证：`node docs/iii/verify/*.mjs`
- 阅读 [iii 官方文档](https://iii.dev/docs)
- 探索 [Worker 注册中心](https://workers.iii.dev)

---

> **本文件所有结论均来自代码实际运行**。运行 `node docs/iii/verify/05-build-harness.mjs` 即可复现。
