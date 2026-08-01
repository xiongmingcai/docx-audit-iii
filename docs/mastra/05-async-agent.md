# 后台 Agent 异步处理

> **目标读者**：已掌握 Agent 工具调用的实习生
> **阅读时间**：15 分钟
> **验证代码**：[verify/05-async-agent.mjs](./verify/05-async-agent.mjs)

---

## 一句话结论

**iii Queue 驱动长时间 Agent 任务——提交后立即返回，后台异步处理，轮询获取结果。**

---

## 为什么需要异步？

有些 Agent 任务耗时较长（文档分析、多步推理、批量处理）。同步调用会让用户等很久，还可能超时：

```
❌ 同步:
  用户 ──等待 30s──▶ Agent ──▶ 结果
  问题: 超时风险、HTTP 连接占用、用户体验差

✅ 异步:
  用户 ──提交──▶ Queue ──▶ 立即返回 taskId
  用户 ──轮询──▶ State ──▶ 结果（完成后）
```

---

## 实战：异步文档分析

### 架构

```
┌────────┐     ┌──────────┐     ┌─────────────────┐
│HTTP API│────▶│iii Queue │────▶│Agent Workflow   │
│提交任务│     │异步调度   │     │(后台多步处理)    │
└────────┘     └──────────┘     └────────┬────────┘
     │                                    │
     │              ┌──────────┐          │
     └─────────────▶│iii State │◀─────────┘
        轮询查询     │结果存储   │ 处理完成写入
                    └──────────┘
```

### 代码实现

```javascript
import { TriggerAction } from "iii-sdk";

// 步骤 1: 提交任务（HTTP 接口）
worker.registerFunction("agent::submit-task", async (data) => {
  const taskId = "task_" + Date.now();
  const input = data.body?.input || data.input;

  // 初始化状态
  await worker.trigger({
    function_id: "state::set",
    payload: { scope: "agent-tasks", key: taskId, value: { status: "pending", input } },
  });

  // 入队异步处理
  await worker.trigger({
    function_id: "agent::execute-task",
    payload: { taskId, input },
    action: TriggerAction.Enqueue({ queue: "default" }),
  });

  return { body: { taskId, status: "pending" }, statusCode: 202 };
});

// 步骤 2: 后台执行（Queue Worker 调用）
worker.registerFunction("agent::execute-task", async (data) => {
  const { taskId, input } = data;

  // 更新: running
  await worker.trigger({
    function_id: "state::set",
    payload: { scope: "agent-tasks", key: taskId, value: { status: "running" } },
  });

  // 执行 Agent（可能是多步 Workflow）
  const agent = mastra.getAgentById("analyst");
  const resp = await agent.generate(input);

  // 更新: done
  await worker.trigger({
    function_id: "state::set",
    payload: { scope: "agent-tasks", key: taskId, value: { status: "done", output: resp.text } },
  });

  return { output: resp.text };
});

// 步骤 3: 查询结果
worker.registerFunction("agent::get-task", async (data) => {
  const taskId = data.body?.taskId || data.taskId;
  const state = await worker.trigger({
    function_id: "state::get",
    payload: { scope: "agent-tasks", key: taskId },
  });
  return { body: state, statusCode: 200 };
});
```

> **验证结果**（实际运行输出）：
> ```
> 提交任务: task_1785566774517 | status: pending
> 轮询 #1: running
> 轮询 #2: running
> 轮询 #3: running
> 轮询 #4: done → "iii框架采用三层架构设计..."
> ```

---

## 关键发现

### 1. 三种调用模式对比

| 模式 | 返回 | 适用场景 |
|------|------|---------|
| Sync (默认) | 直接结果 | 快速任务 (< 30s) |
| `TriggerAction.Void()` | `undefined` | 即发即忘，不需要结果 |
| `TriggerAction.Enqueue({ queue })` | `{ messageReceiptId }` | 长时间任务，需轮询 |

> **验证结果**：
> ```
> Sync:   返回 { output: "..." }       (等待完成)
> Void:   返回 undefined              (立即返回)
> Enqueue:返回 { messageReceiptId }   (异步处理)
> ```

### 2. Queue 重试机制

失败的 Queue 消息会自动重试（默认 3 次），最终进入 DLQ（死信队列）：

```
执行失败 → 重试 #1 → 重试 #2 → 重试 #3 → DLQ (dead letter queue)
```

> **验证结果**：
> ```
> 模拟失败 3 次后成功: attemptCount = 3 ✓
> DLQ 记录: engine::queue::dlq_messages 可查询 ✓
> ```

### 3. 轮询策略

```javascript
// 轮询等待结果
let result = null;
for (let i = 0; i < 15; i++) {
  await new Promise(r => setTimeout(r, 2000));  // 每 2s 查一次
  const state = await worker.trigger({ function_id: "state::get", payload: { scope: "agent-tasks", key: taskId } });
  if (state?.status === "done") {
    result = state;
    break;
  }
}
```

> **验证结果**：
> ```
> ✓ 2s 间隔轮询有效
> ✓ 4 轮后获取到结果
> ```

---

## 常见踩坑

| 问题 | 原因 | 解决 |
|------|------|------|
| 任务丢失 | Queue 未持久化 | 默认 file_based 已持久化 |
| 重复消费 | 未做幂等 | taskId 唯一 + 状态检查 |
| 轮询太频繁 | 间隔太短 | 2-5s 间隔 |
| 结果丢失 | State 未持久化 | file_based adapter 保证 |

---

## 下一步

- [第 6 篇：Agent 注册中心与智能路由](./06-agent-registry.md)
- [返回系列目录](./README.md)
