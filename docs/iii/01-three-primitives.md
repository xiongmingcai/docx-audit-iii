# III 是什么 — 三个原语统一一切

> **目标读者**：刚接触 III 的实习生
> **阅读时间**：10 分钟
> **验证代码**：[verify/01-three-primitives.mjs](./verify/01-three-primitives.mjs)

---

## 一句话定义

**III**（读作 "three eye"）是一个开源后端引擎，用 **三个原语** 统一了分布式后端的所有概念：

> **Worker**（工人）+ **Trigger**（触发器）+ **Function**（函数）= 一切

没有队列、没有服务网格、没有 API 网关、没有 cron 调度器——这些东西在 III 里都是 **Worker**。

---

## 三大原语

### 1. Worker（工人）

Worker 是 III 系统的**参与者**。任何能打开 WebSocket 连接的东西都可以是 Worker：

- Python 机器学习服务
- TypeScript API 服务器
- 浏览器标签页
- 树莓派上的 IoT 传感器
- **一个 AI Agent**

```typescript
// TypeScript Worker 示例
import { registerWorker } from "iii-sdk";

const worker = registerWorker("ws://localhost:49134", {
  workerName: "my-first-worker",
  workerDescription: "我的第一个 III Worker",
});
```

```python
# Python Worker 示例
from iii import register_worker

worker = register_worker("ws://localhost:49134")
```

**验证结果**（实际运行输出）：
```
✅ Worker 已连接到 Engine
  已连接 Worker 总数: 15
  verify-article-01 状态: connected
```

### 2. Function（函数）

Function 是 Worker 暴露的**能力单元**。每个 Function 有一个稳定的标识符，遵循 `service::name` 约定：

```typescript
// 注册 Function
worker.registerFunction(
  "math::add",                    // 标识符：service::name
  async (data: { a: number; b: number }) => {
    return { result: data.a + data.b };
  },
  { description: "两数相加" }
);
```

**验证结果**（实际运行输出）：
```
  verify::add(3, 5) = 8
  verify::greet("实习生") = "Hello, 实习生!"
  全局 Function 总数: 60
  verify::* Function 数量: 3
    - verify::add
    - verify::greet
    - verify::multiply
```

### 3. Trigger（触发器）

Trigger 将**事件源**绑定到 **Function**。它声明"当 X 发生时，运行 Y"：

```typescript
// HTTP Trigger：当收到 POST /calculate 时，运行 math::add
worker.registerTrigger({
  type: "http",
  function_id: "math::add",
  config: { method: "POST", api_path: "/calculate" },
});
```

III 内置的 Trigger 类型：

| Trigger 类型 | 事件源 | 示例 |
|-------------|--------|------|
| `http` | HTTP 请求 | `POST /api/orders` → `orders::create` |
| `cron` | 定时调度 | `0 * * * *` → `cache::warmup` |
| `queue` | 队列消息 | `orders` topic → `orders::process` |
| `state` | 状态变更 | `scope.key` 变更 → `notify::send` |
| `stream` | 流事件 | 实时数据 → `analytics::track` |

---

## Engine：薄层协调者

Engine 是 III 的**运行时**。它只做三件事：

1. **连接管理**：接受 Worker 的 WebSocket 连接
2. **注册表**：追踪所有 Worker、Function、Trigger
3. **路由**：将调用从发起者路由到提供目标 Function 的 Worker

```
┌──────────────────────────────────────────────────┐
│                  iii Engine                       │
│                                                   │
│  ┌─────────┐     WebSocket     ┌─────────┐       │
│  │ Worker A │◄──────────────►│ Worker B │       │
│  │ (Python) │                 │ (TypeScript)    │
│  │          │    路由调用      │          │       │
│  │ orders::create ─────────► inventory::check   │
│  └─────────┘                 └─────────┘       │
│                                                   │
│  注册表: { workers, functions, triggers }         │
└──────────────────────────────────────────────────┘
```

**关键特性**：路由与语言无关。Python Worker 调用 TypeScript Worker 的 Function，和调用同一个 Worker 内的 Function 完全一样。

**验证结果**（实际运行输出）：
```
✅ TypeScript → Python 跨语言调用成功
   docx::config_get 返回: {"allowed_keys":["EMBEDDING_API_KEY",...]}
```

---

## 最小可运行系统

下面是一个完整的 III 系统，包含两个 Worker：

```typescript
// ── math-worker.ts（工具 Worker）──────────────────────
import { registerWorker } from "iii-sdk";

const mathWorker = registerWorker("ws://localhost:49134", {
  workerName: "math-tools",
});

mathWorker.registerFunction("math::add", async (data) => {
  return { result: data.a + data.b };
});

mathWorker.registerFunction("math::multiply", async (data) => {
  return { result: data.a * data.b };
});
```

```typescript
// ── caller-worker.ts（调用者 Worker）──────────────────
import { registerWorker } from "iii-sdk";

const caller = registerWorker("ws://localhost:49134", {
  workerName: "caller",
});

// 调用 math Worker 的函数
const result = await caller.trigger({
  function_id: "math::add",
  payload: { a: 3, b: 5 },
});

console.log(result.result); // → 8
```

**验证结果**（实际运行输出）：
```
  verify::add(3, 5) = 8
  verify::greet("实习生") = "Hello, 实习生!"
```

---

## 为什么是三个？

III 的赌注是：**三个原语足够统一一切**。

历史上成功的范式都是通过"类别坍缩"获胜的：

| 范式 | 坍缩前 | 坍缩后 |
|------|--------|--------|
| Unix | 各种 I/O 设备 | **一切皆文件** |
| React | 各种 UI 组件 | **一切皆组件** |
| III | 队列/HTTP/cron/沙箱/Agent | **一切皆 Worker** |

当所有东西都用同一种"语言"表达时：
- 集成成本 → 零
- 认知负担 → 最小
- 扩展方式 → 始终相同：`iii worker add`

---

## 下一步

- [第 2 篇：Harness 即后端](./02-harness-is-backend.md) — Agent 不是特殊物种
- [验证代码运行](../verify/01-three-primitives.mjs)：`node verify/01-three-primitives.mjs`

---

> **本文件所有结论均来自代码实际运行**。运行 `node docs/iii/verify/01-three-primitives.mjs` 即可复现。
