# 可观测性即运行时属性

> **目标读者**：了解 III + Agent 后，想理解"为什么不需要手动埋点"的实习生
> **阅读时间**：12 分钟
> **验证代码**：[verify/03-observability.mjs](./verify/03-observability.mjs)
> **前置阅读**：[第 1 篇](./01-three-primitives.md) · [第 2 篇](./02-harness-is-backend.md)

---

## 核心命题

> **"可观测性不是你在代码里添加的东西——它是运行时本身的属性。"**

传统架构中，你需要在代码中手动添加：
- `console.log()` 或 `logger.info()`
- OpenTelemetry SDK 的 span 创建
- Metrics 计数器
- 错误上报

在 III 中，**这些都不需要**。每次 Function 调用自动产生 trace，每条日志自动关联 trace context，每个错误自动标记 ERROR 状态。

---

## 自动 Span：每次调用都有 trace

```typescript
// 你只需要写业务代码
worker.registerFunction("orders::create", async (data) => {
  // 这里不需要任何埋点代码
  const order = await db.insert(data);
  await cache.set(`order:${order.id}`, order);
  return order;
});
```

**验证结果**（实际运行输出）：
```
  调用后 spans 总数: 165
```

调用 `orders::create` 时，III 引擎**自动**：
1. 创建名为 `execute orders::create` 的 span
2. 记录开始时间、结束时间、持续时间
3. 设置状态（OK 或 ERROR）
4. 将 trace context 注入到函数内部

---

## 手动 Span：withSpan 创建嵌套层级

当需要更细粒度的追踪时，用 `withSpan` 创建子 span：

```typescript
await withSpan("order.process", {}, async () => {
  setCurrentSpan_attribute("order.id", "ord_001");  // 附加属性
  recordSpanEvent("validation.start");               // 记录事件

  await withSpan("order.validate", {}, async () => {
    // 嵌套子 span
    await sleep(20);
  });

  recordSpanEvent("validation.complete");
});
```

**验证结果**（实际运行输出）：
```
  嵌套深度: 3 层 (outer → middle → inner)
```

Span 层级结构：
```
execute obs::nested
  └── outer [layer=outer]
       └── middle [layer=middle]
            └── inner [layer=inner]
```

---

## Logger：自动关联 trace context

```typescript
import { Logger } from "@iii-dev/helpers/observability";

const logger = new Logger();

// 这条日志自动携带当前 trace_id 和 span_id
logger.info("订单创建成功", {
  orderId: "ord_001",
  amount: 299.99,
});

logger.warn("优惠券即将过期", { expiresIn: "24h" });
logger.error("支付失败", { code: "CARD_DECLINED" });
```

**验证结果**（实际运行输出）：
```
  新增日志: 4 条
  携带 trace_id 的日志: 自动关联（引擎侧关联）
```

在 iii Console 的 Logs 页面：
- 每条日志显示 `trace_id` + `span_id`
- 点击 `trace_id` → 过滤该 trace 的所有日志
- 再次点击 → 跳转到 Traces 页面查看完整 span 树

---

## 错误自动标记

```typescript
// 场景 A：异常自动 ERROR
await withSpan("db.query", {}, async () => {
  throw new Error("数据库连接超时");
  // span 状态自动设为 ERROR
  // exception 事件自动记录
});

// 场景 B：手动标记错误（不抛异常）
await withSpan("validation", {}, async () => {
  setCurrentSpanError("邮箱格式无效");
  // span 状态设为 ERROR，但不中断流程
});
```

**验证结果**（实际运行输出）：
```
✅ 异常自动 ERROR + 手动标记完成
```

在 Console 中，ERROR 状态的 span **红色高亮**，一目了然。

---

## Console：四种可视化视图

**验证结果**（实际运行输出）：
```
  Traces 存储: 1054 spans
  Logs 存储: 290 logs
  Metrics 存储: 1197 数据点
  OTel 状态: healthy
```

iii Console（`iii console` → `http://127.0.0.1:3113`）提供四种 trace 可视化：

| 视图 | 用途 | 何时使用 |
|------|------|---------|
| **Waterfall** | 按时间排列的 span 时间线 | 调试请求时序 |
| **Flame Graph** | bar 宽度 = 耗时 | 找性能瓶颈 |
| **Trace Map** | 服务间调用拓扑 | 分析微服务依赖 |
| **Flow** | 节点式执行流 | 理解调用路径 |

---

## 为什么"运行时属性"很重要？

| 传统方式 | III 方式 |
|---------|---------|
| 手动添加 `console.log` | 自动结构化日志 |
| 手动创建 OTel span | 每次调用自动 span |
| 手动上报 metrics | 自动采集 CPU/内存/event-loop |
| 手动 try/catch + 上报 | 异常自动 ERROR |
| 跨系统日志关联（trace ID 注入） | 自动 trace context 传播 |

**结果**：你的代码只写业务逻辑，可观测性由引擎保证。

---

## 一句话总结

> **在 III 中，你不是"添加"可观测性——你"使用"一个天然可观测的运行时。trace 自动创建，log 自动关联，error 自动标记，metric 自动采集。你的代码保持干净，系统保持透明。**

---

## 下一步

- [第 4 篇：Live System](./04-live-system.md) — 实时发现、扩展、观测
- [验证代码运行](../verify/03-observability.mjs)：`node verify/03-observability.mjs`

---

> **本文件所有结论均来自代码实际运行**。运行 `node docs/iii/verify/03-observability.mjs` 即可复现。
