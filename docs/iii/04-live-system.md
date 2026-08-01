# Live System — 实时发现、扩展、观测

> **目标读者**：理解 III 可观测性后，想体验"活的系统"的实习生
> **阅读时间**：10 分钟
> **验证代码**：[verify/04-live-system.mjs](./verify/04-live-system.mjs)
> **前置阅读**：[第 1 篇](./01-three-primitives.md) · [第 3 篇](./03-observability.md)

---

## 核心命题

> **III 系统不是"部署后固定的拓扑"——它是一个活的、不断演化的表面。**

三个"Live"特性：
1. **Live Discovery**（实时发现）：Worker 连接后，其 Function 即刻全局可见
2. **Live Extensibility**（实时扩展）：新 Worker 加入无需重启引擎
3. **Live Observability**（实时可观测）：所有调用实时产生 trace

---

## Live Discovery：实时发现

当 Worker 连接到 Engine，它的 Function 和 Trigger **即刻**对所有其他 Worker 可见。

```typescript
// Worker A 注册了一个新 Function
workerA.registerFunction("payments::refund", handler);

// Worker B 可以立即调用——无需配置、无需重启
const result = await workerB.trigger({
  function_id: "payments::refund",
  payload: { orderId: "ord_123" },
});
```

**验证结果**（实际运行输出）：
```
  注册后 Worker 数: 16
  dynamic-worker-04 状态: connected
  dynamic::hello("实习生") = "Hello from dynamic worker, 实习生!"
  全局 Function 总数: 59
  dynamic::* Function: 2
    - dynamic::hello
    - dynamic::time
```

---

## Live Extensibility：实时扩展

添加新能力 = 连接一个新 Worker。不需要修改配置、不需要重启引擎。

```bash
# 添加沙箱能力
iii worker add iii-sandbox

# 添加队列能力
iii worker add queue

# 添加定时任务能力
iii worker add cron
```

**验证结果**（实际运行输出）：
```
  连接前 Worker 数: 14
  注册后 Worker 数: 16
  新增: 2 个 Worker
```

Worker 连接 → Function 即刻全局可调用 → **零停机扩展**。

---

## Live Observability：实时可观测

每次 Function 调用实时产生 trace，每次日志实时关联 trace context。

```typescript
// 这条调用实时产生 trace
await worker.trigger({
  function_id: "orders::create",
  payload: { item: "book", qty: 1 },
});
// → 立即在 iii Console Traces 页面可见
```

**验证结果**（实际运行输出）：
```
  dynamic::time() = 2026-08-01T10:42:53.168Z
  （调用后立即在 Console 中可见对应 span）
```

---

## Worker 断开：自动清理

当 Worker 断开（崩溃、关机、网络中断），引擎自动：
1. 从注册表移除该 Worker
2. 移除该 Worker 注册的所有 Function
3. 移除该 Worker 注册的所有 Trigger
4. 取消进行中的调用

**验证结果**（实际运行输出）：
```
  断开后 Worker 数: 15
  减少: 1 个 Worker
  dynamic-worker-04 仍存在: 否（已自动移除）
  断开后 dynamic::* Function: 0
```

---

## 引擎内省函数

III 提供一组 `engine::*` 函数让你实时查看系统状态：

| 函数 | 作用 |
|------|------|
| `engine::workers::list` | 列出所有已连接 Worker |
| `engine::functions::list` | 列出所有已注册 Function |
| `engine::triggers::list` | 列出所有已注册 Trigger |
| `engine::traces::list` | 列出所有 trace span |
| `engine::logs::list` | 列出所有日志 |
| `engine::health::check` | 检查引擎健康状态 |

```typescript
// 实时查看系统拓扑
const workers = await worker.trigger({
  function_id: "engine::workers::list",
  payload: {},
});
console.log(`${workers.workers.length} 个 Worker 已连接`);
```

**验证结果**（实际运行输出）：
```
  全局 Function 总数: 59
  dynamic::* Function: 2
  断开后 dynamic::* Function: 0
```

---

## Agent 为什么需要 Live System？

Agent 的核心挑战之一是**工具发现**：

| 传统方式 | III Live System |
|---------|----------------|
| 静态工具菜单（MCP） | 实时注册表（只含在线工具） |
| 工具上线需重启 Agent | 工具上线即刻对 Agent 可见 |
| 工具文档可能过期 | 工具 schema 始终准确 |
| Agent 需预先知道所有工具 | Agent 按需查询可用工具 |

> **"The agent does not browse a static catalog. It queries a live system that only contains what is actually connected right now."**

---

## 一句话总结

> **III 是一个 Live System：Worker 连接即刻上线，断开自动清理，无需重启引擎。Agent 查询注册表时，看到的永远是系统当前的真实状态——不多不少。**

---

## 下一步

- [第 5 篇：构建你的第一个 Agent Harness](./05-build-harness.md) — 实战
- [验证代码运行](../verify/04-live-system.mjs)：`node verify/04-live-system.mjs`

---

> **本文件所有结论均来自代码实际运行**。运行 `node docs/iii/verify/04-live-system.mjs` 即可复现。
