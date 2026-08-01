# Agent 注册中心与智能路由

> **目标读者**：已掌握所有 Agent 模式的实习生
> **阅读时间**：20 分钟
> **验证代码**：[verify/06-agent-registry.mjs](./verify/06-agent-registry.mjs)

---

## 一句话结论

**多个专业 Agent 统一注册为 III Function，Router Agent 自动分析用户意图并分发到最合适的 Agent——这就是 Agent 注册中心。**

---

## 为什么需要注册中心？

随着 Agent 数量增长，问题来了：

```
3 个 Agent: 手动选就行
10 个 Agent: 需要文档说明哪个 Agent 干什么
100 个 Agent: 必须有一个"调度中心"
```

**Agent 注册中心**解决三个问题：
1. **发现**：有哪些 Agent 可用？
2. **描述**：每个 Agent 擅长什么？
3. **路由**：用户请求应该发给谁？

---

## 实战：构建 Agent 注册中心

### 架构

```
                         ┌──────────────────┐
                         │  Router Agent    │
                         │  (轻量决策)       │
                         └────────┬─────────┘
                                  │ 路由决策
              ┌───────────────────┼───────────────────┐
              ▼                   ▼                   ▼
     ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
     │ 研究员       │   │ 批评家       │   │ 总结者       │
     │ agent::      │   │ agent::      │   │ agent::      │
     │ researcher   │   │ critic       │   │ summarizer   │
     └──────────────┘   └──────────────┘   └──────────────┘
```

### 代码实现

```javascript
// 步骤 1: 注册专业 Agent
const agents = {
  researcher: new Agent({
    id: "researcher", name: "研究员",
    instructions: "深入研究话题。中文30字内。",
    model: "siliconflow-cn/deepseek-ai/DeepSeek-V3.2",
  }),
  critic: new Agent({
    id: "critic", name: "批评家",
    instructions: "批判性分析。中文30字内。",
    model: "siliconflow-cn/deepseek-ai/DeepSeek-V3.2",
  }),
  summarizer: new Agent({
    id: "summarizer", name: "总结者",
    instructions: "总结归纳。中文30字内。",
    model: "siliconflow-cn/deepseek-ai/DeepSeek-V3.2",
  }),
};

// 每个 Agent 注册为 iii Function
for (const [key, agent] of Object.entries(agents)) {
  mastra.addAgent(agent);
  worker.registerFunction("agent::" + key, async (data) => {
    const resp = await agent.generate(data.input);
    return { output: resp.text };
  });
}

// 步骤 2: 注册 Router Agent
const router = new Agent({
  id: "router", name: "路由器",
  instructions: "选择最合适的Agent。只返回: researcher, critic, summarizer。",
  model: "siliconflow-cn/deepseek-ai/DeepSeek-V3.2",
});
mastra.addAgent(router);

// 步骤 3: 路由函数
worker.registerFunction("agent::router", async (data) => {
  // Router Agent 决策
  const route = (await router.generate("任务：" + data.input)).text.trim();
  // 匹配第一个有效的 Agent 名称
  const validAgents = ["researcher", "critic", "summarizer"];
  const matched = validAgents.find((a) => route.toLowerCase().includes(a)) || "summarizer";

  // 调用目标 Agent
  const target = mastra.getAgentById(matched);
  const resp = await target.generate(data.input);

  return { routed_to: matched, output: resp.text };
});
```

> **验证结果**（实际运行输出）：
> ```
> "分析 iii 技术架构" → [researcher] iii技术架构指信息智能接口...
> "评估方案风险"     → [critic]   可从以下四个维度评估方案风险...
> "总结会议要点"     → [summarizer] 好的，这是为您总结的会议要点...
> ```

---

## 关键发现

### 1. Agent 发现机制

通过 `engine::functions::list` 可发现所有已注册的 Agent Function：

```javascript
const fns = await worker.trigger({ function_id: "engine::functions::list", payload: {} });
const agentFns = fns.functions?.filter(f => f.function_id.startsWith("agent::"));
// → ["agent::researcher", "agent::critic", "agent::summarizer", "agent::router"]
```

> **验证结果**：
> ```
> ✓ agent::researcher  — 研究员
> ✓ agent::critic     — 批评家
> ✓ agent::summarizer  — 总结者
> ✓ agent::router     — 路由器
> ```

### 2. Router Agent 的准确性

Router Agent 使用轻量 LLM 做决策（不执行实际任务），速度快、成本低：

```
Router 决策耗时: ~1.5s（仅分类，不生成内容）
实际 Agent 执行: ~2-3s（生成内容）
```

> **验证结果**：
> ```
> "分析 iii 技术架构" → researcher ✓
> "评估方案风险"     → critic    ✓
> "总结会议要点"     → summarizer ✓
> ```

### 3. 注册中心的扩展模式

```javascript
// 添加新 Agent 只需 3 步:
// 1. 创建 Agent
const newAgent = new Agent({ id: "translator", name: "翻译", ... });
// 2. 注册到 Mastra
mastra.addAgent(newAgent);
// 3. 注册为 iii Function
worker.registerFunction("agent::translator", async (data) => {
  const r = await newAgent.generate(data.input);
  return { output: r.text };
});
// 4. 更新 Router 的 validAgents 列表
```

---

## 架构视角

```
┌────────────────────────────────────────────────────────────────┐
│                        III Engine                               │
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │                Agent 注册中心                              │ │
│  │  agent::researcher | agent::critic | agent::summarizer   │ │
│  │  agent::translator | agent::coder | agent::reviewer ...  │ │
│  └──────────────────────────────────────────────────────────┘ │
│                              │                                 │
│                    ┌─────────▼─────────┐                      │
│                    │   Router Agent    │                      │
│                    │   (智能分发)       │                      │
│                    └───────────────────┘                      │
│                                                                │
│  发现: engine::functions::list → 过滤 agent::*               │
│  路由: Router Agent 分析意图 → 匹配最佳 Agent                 │
│  执行: 目标 Agent 处理 → 返回结果                             │
└────────────────────────────────────────────────────────────────┘
```

---

## 总结：III + Agent 完整模式

| 模式 | III 能力 | Mastra 能力 | 篇 |
|------|---------|------------|---|
| Agent 作为 Worker | Function 注册 | Agent.generate() | 1 |
| 多 Agent 协作 | Workflow 触发 | Workflow + .then() | 2 |
| Agent 记忆 | State 持久化 | 上下文感知 | 3 |
| Agent 工具 | Function 作为 Tool | Tool → iii Function | 4 |
| 异步处理 | Queue + State | 后台处理 | 5 |
| 注册中心 | Function 发现 | Router Agent | 6 |

---

## 下一步

- [返回系列目录](./README.md)
- [III 三原语系列](../iii/README.md)
