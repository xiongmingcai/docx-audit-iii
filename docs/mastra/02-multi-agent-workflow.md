# 多 Agent 协作 — 工作流编排

> **目标读者**：已掌握 Mastra Agent 接入 III 的实习生
> **阅读时间**：20 分钟
> **验证代码**：[verify/02-multi-agent-workflow.mjs](./verify/02-multi-agent-workflow.mjs)

---

## 一句话结论

**Mastra Workflow 将复杂任务分解为多步，每步由不同 Agent 执行；III 负责触发、调度和状态跟踪。**

---

## 为什么需要多 Agent？

单个 Agent 擅长单一任务。但现实中的复杂需求（如"分析项目可行性"）需要多个专业角色协作：

```
单 Agent:
  用户 → Agent(什么都做) → 结果（可能不专业）

多 Agent 协作:
  用户 → 分析师(调研) → 审计员(风险评估) → 文档员(生成报告) → 结果
```

**Mastra Workflow** 提供了 `.then()` 链式编排能力，III 提供了触发和调度能力。

---

## 实战：项目评估流水线

### 三步工作流

```
输入: { topic: "引入 iii + Mastra 技术栈" }
        │
        ▼
┌──────────────────┐
│ Step 1: 调研分析  │ ← 数据分析师 Agent
│ 输出: { research }│
└────────┬─────────┘
         │ .map() 传递数据
         ▼
┌──────────────────┐
│ Step 2: 风险评估  │ ← 安全审计员 Agent
│ 输出: { risk }    │
└────────┬─────────┘
         │ .map() 传递数据
         ▼
┌──────────────────┐
│ Step 3: 生成报告  │ ← 文档工程师 Agent
│ 输出: { report }  │
└──────────────────┘
```

### 代码实现

```javascript
import { createWorkflow, createStep } from "@mastra/core/workflows";

// Step 1: 调研分析
const researchStep = createStep({
  id: "research",
  inputSchema: { type: "object", properties: { topic: { type: "string" } }, required: ["topic"] },
  outputSchema: { type: "object", properties: { research: { type: "string" } }, required: ["research"] },
  execute: async ({ inputData }) => {
    const resp = await dataAnalystAgent.generate("调研分析：" + inputData.topic);
    return { research: resp.text };
  },
});

// Step 2: 风险评估
const riskStep = createStep({
  id: "risk",
  inputSchema: { type: "object", properties: { research: { type: "string" } }, required: ["research"] },
  outputSchema: { type: "object", properties: { risk: { type: "string" } }, required: ["risk"] },
  execute: async ({ inputData }) => {
    const resp = await securityAgent.generate("风险评估：" + inputData.research);
    return { risk: resp.text };
  },
});

// Step 3: 生成报告
const reportStep = createStep({
  id: "report",
  inputSchema: { type: "object", properties: { research: { type: "string" }, risk: { type: "string" } }, required: ["research", "risk"] },
  outputSchema: { type: "object", properties: { report: { type: "string" } }, required: ["report"] },
  execute: async ({ inputData }) => {
    const resp = await docAgent.generate(`基于调研(${inputData.research.slice(0, 30)})和风险(${inputData.risk.slice(0, 30)})写结论`);
    return { report: resp.text };
  },
});

// 组合 Workflow（关键：用 .map() 传递数据）
const workflow = createWorkflow({
  id: "project-evaluation",
  inputSchema: { type: "object", properties: { topic: { type: "string" } }, required: ["topic"] },
  outputSchema: { type: "object", properties: { report: { type: "string" } }, required: ["report"] },
})
  .then(researchStep)
  .map(async ({ inputData, getInitData }) => ({
    research: inputData.research,
    topic: getInitData({}).topic,
  }))
  .then(riskStep)
  .map(async ({ inputData, getInitData }) => ({
    research: getInitData({}).research || "",
    risk: inputData.risk,
  }))
  .then(reportStep)
  .commit();
```

> **验证结果**（实际运行输出）：
> ```
> ✅ Workflow 创建成功
> ✅ Step1 调研: "引入iii+Mastra技术栈有助于提升技术选型的多样性..."
> ✅ Step2 风险: "该项目定位符合当前技术趋势..."
> ✅ Step3 报告: "基于调研与风险评估，我们得出以下结论..."
> ✅ 三步 Agent 链完整执行
> ```

---

## 关键发现

### 1. .then() 与 .map() 的区别

| 方法 | 行为 | 何时使用 |
|------|------|---------|
| `.then(step)` | 上一步输出 → 下一步输入 | 步骤间数据格式匹配时 |
| `.map(fn)` | 自由转换/合并数据 | 步骤间数据格式不匹配时 |

**核心规则**：每个 step 的 `outputSchema` 必须与下一个 step 的 `inputSchema` 匹配。不匹配时用 `.map()` 桥接。

### 2. getInitData() 保留原始输入

`.map()` 中的 `getInitData()` 可以获取 Workflow 的**原始输入**，解决数据在步骤间丢失的问题：

```javascript
.then(researchStep)  // 输出: { research }
.map(async ({ inputData, getInitData }) => ({
  research: inputData.research,           // 上一步的输出
  topic: getInitData({}).topic,           // 原始输入（已传过 researchStep）
}))
.then(riskStep)      // 输入: { research, topic }
```

> **验证结果**：
> ```
> ✅ getInitData() 可访问原始 topic
> ✅ inputData 可访问上一步输出
> ✅ .map() 合并两者后传递给下一步
> ```

### 3. Workflow 注册为 III Function

Workflow 与 Agent 一样，可以注册为 III Function：

```javascript
worker.registerFunction("agent::workflow", async (data) => {
  const run = await workflow.createRun();
  const result = await run.start({ inputData: { topic: data.topic } });
  return {
    body: {
      status: result.status,
      research: result.steps?.research?.output?.research?.slice(0, 50),
      risk: result.steps?.risk?.output?.risk?.slice(0, 50),
      report: result.result?.report?.slice(0, 50),
    },
    statusCode: 200,
  };
});
```

> **验证结果**：
> ```
> ✅ Workflow SDK 调用: status=success
> ✅ 三步结果均可通过 result.steps 访问
> ✅ 最终结果通过 result.result 访问
> ```

### 4. Workflow 执行耗时

多步 Workflow 的执行时间是各步骤之和：

```
验证: 3步 Workflow 耗时
  Step 1 (调研): ~2s
  Step 2 (风险): ~2s
  Step 3 (报告): ~2s
  总计: ~6s（串行执行）
```

---

## 架构视角

```
┌────────────────────────────────────────────────────────────────┐
│                        III Engine                               │
│                                                                │
│  HTTP ──────────────────────────────────────────┐              │
│  SDK  ──────────────────────────────────────────┼──► Function  │
│  Queue ─────────────────────────────────────────┘    │         │
│                                                      ▼         │
│                                    ┌────────────────────────┐ │
│                                    │  Mastra Workflow       │ │
│                                    │                        │ │
│                                    │  Agent1 → Agent2 → Agent3│
│                                    │  (调研)  (风险)  (报告) │ │
│                                    └────────────────────────┘ │
│                                                      │         │
│                                                      ▼         │
│                                    ┌────────────────────────┐ │
│                                    │  iii-state (可选)      │ │
│                                    │  保存中间结果/进度      │ │
│                                    └────────────────────────┘ │
└────────────────────────────────────────────────────────────────┘
```

---

## 常见踩坑

| 问题 | 原因 | 解决 |
|------|------|------|
| Step 输入校验失败 | outputSchema ≠ 下一 step inputSchema | 用 `.map()` 转换数据格式 |
| 原始输入丢失 | `.then()` 只传上一步输出 | 用 `getInitData()` 保留 |
| Workflow 超时 | 步骤过多，默认 30s | 设置 `timeoutMs: 120000` |
| Agent 返回空 | instructions 不清晰 | 明确指定语言和字数限制 |

---

## 下一步

- [第 3 篇：Agent 记忆与会话持久化](./03-agent-memory.md)
- [返回系列目录](./README.md)
