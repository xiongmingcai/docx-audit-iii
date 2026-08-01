# Agent 工具调用 — 打通 iii 生态

> **目标读者**：已掌握 Agent 记忆的实习生
> **阅读时间**：15 分钟
> **验证代码**：[verify/04-agent-tools.mjs](./verify/04-agent-tools.mjs)

---

## 一句话结论

**Mastra Agent 的 Tool 可以调用 iii 生态中的任意 Function——Agent 能力不再局限于 LLM 自身，而是扩展到整个 III 系统。**

---

## 为什么 Agent 需要工具？

LLM 擅长推理，但不擅长"做事"：查天气、读数据库、发邮件、调用 API。**Tool** 让 Agent 能调用外部系统：

```
无 Tool:
  用户: "北京天气怎么样？"
  Agent: "我无法获取实时天气..."  ← 只能编造

有 Tool:
  用户: "北京天气怎么样？"
  Agent: [调用 getWeather({city: "北京"})] → "北京今天晴，26℃"  ← 实时数据
```

---

## 实战：Agent 调用 iii Function 作为 Tool

### 步骤 1: 在 III 中注册"工具"函数

```javascript
// 这些是普通的三元 Function，但被 Agent 当作 Tool 使用
worker.registerFunction("tool::get-weather", async (data) => {
  const city = data.city || "北京";
  return { city, temp: 25, condition: "晴", humidity: 47 };
});

worker.registerFunction("tool::search-docs", async (data) => {
  const query = data.query || "";
  const docs = [
    { title: "iii 快速入门", url: "/docs/quickstart" },
    { title: "Mastra Agent 指南", url: "/docs/agents" },
    { title: "iii + Mastra 集成", url: "/docs/integration" },
  ].filter((d) => d.title.includes(query));
  return { results: docs, count: docs.length };
});

worker.registerFunction("tool::get-time", async () => {
  return { time: new Date().toISOString(), timezone: "UTC+8" };
});
```

### 步骤 2: 创建 Mastra Tool 包装

```javascript
import { createTool } from "@mastra/core/tools";

const weatherTool = createTool({
  id: "get-weather",
  description: "获取指定城市的实时天气",
  inputSchema: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
  outputSchema: { type: "object", properties: { temp: { type: "number" }, condition: { type: "string" } } },
  execute: async ({ city }) => {
    // Tool 的 execute 内部调用 iii Function
    return await worker.trigger({ function_id: "tool::get-weather", payload: { city } });
  },
});

const docsTool = createTool({
  id: "search-docs",
  description: "搜索技术文档",
  inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  outputSchema: { type: "object", properties: { results: { type: "array" } } },
  execute: async ({ query }) => {
    return await worker.trigger({ function_id: "tool::search-docs", payload: { query } });
  },
});
```

### 步骤 3: 创建带工具的 Agent

```javascript
const toolAgent = new Agent({
  id: "tool-user",
  name: "工具使用者",
  instructions: "你是助手。必须使用工具获取信息回答。中文30字内。",
  model: "siliconflow-cn/deepseek-ai/DeepSeek-V3.2",
  tools: { weatherTool, docsTool },  // ← 注入工具
});
```

> **验证结果**（实际运行输出）：
> ```
> "北京天气怎么样？"
>   → toolCalls: [{ toolName: "get-weather", args: { city: "北京" } }]
>   → toolResults: [{ temp: 25, condition: "晴" }]
>   → text: "北京今天晴，温度25℃"
>
> "搜索 iii 相关文档"
>   → toolCalls: [{ toolName: "search-docs", args: { query: "iii" } }]
>   → toolResults: [{ results: [...], count: 2 }]
>   → text: "找到2篇相关文档"
> ```

---

## 关键发现

### 1. Tool 调用流程

```
用户问题 → Agent 决策(需要工具?) → 选择 Tool → 执行 execute → 获取结果 → 生成回复
```

Agent 自动判断是否需要调用工具，无需手动指定。

### 2. toolCalls 结构

每次 Agent 返回包含 `toolCalls` 和 `toolResults`：

```javascript
const resp = await agent.generate("北京天气怎么样？");
console.log(resp.toolCalls);
// → [{ payload: { toolName: "get-weather", args: { city: "北京" } } }]
console.log(resp.toolResults);
// → [{ payload: { result: { city: "北京", temp: 25, condition: "晴" } } }]
```

> **验证结果**：
> ```
> ✅ toolCalls[0].payload.toolName = "get-weather"
> ✅ toolResults[0].payload.result.temp = 25
> ```

### 3. Tool 调用 vs 直接 Function 调用

| 场景 | 方式 | 决策者 |
|------|------|--------|
| 外部系统直接调用 | `worker.trigger({ function_id: "tool::get-weather" })` | 调用方 |
| Agent 决定调用 | Agent 自动选择 Tool + 执行 | LLM |

**关键区别**：Tool 让 LLM 自己决定"什么时候调用"和"传什么参数"。

### 4. 多个 Tool 协作

Agent 在一次对话中可调用多个 Tool：

```javascript
const resp = await agent.generate("北京天气如何？顺便搜一下 iii 文档");
// resp.toolCalls → [{ get-weather }, { search-docs }]
```

> **验证结果**：
> ```
> ✅ Agent 可在一轮对话中调用多个 Tool
> ✅ 每个 Tool 的结果独立返回
> ```

---

## 架构视角

```
┌─────────────────────────────────────────────────────────┐
│                     III Engine                           │
│                                                         │
│  tool::get-weather  ┐                                  │
│  tool::search-docs  ├─ Mastra Tool 包装 ──▶ Agent      │
│  tool::get-time     ┘        │                         │
│                              │                         │
│                              ▼                         │
│                    ┌──────────────────┐                │
│                    │  LLM 决策        │                │
│                    │  选 Tool + 参数  │                │
│                    └──────────────────┘                │
└─────────────────────────────────────────────────────────┘
```

---

## 常见踩坑

| 问题 | 原因 | 解决 |
|------|------|------|
| Agent 不调用 Tool | instructions 未说明"必须使用工具" | 明确写"必须使用工具获取信息" |
| Tool 执行报错 | execute 函数抛异常 | 添加 try-catch 返回错误信息 |
| Tool 参数错误 | inputSchema 定义不准确 | 明确 required 字段 |
| Tool 返回太大 | 返回完整对象超出上下文 | 只返回必要字段 |

---

## 下一步

- [第 5 篇：后台 Agent 异步处理](./05-async-agent.md)
- [返回系列目录](./README.md)
