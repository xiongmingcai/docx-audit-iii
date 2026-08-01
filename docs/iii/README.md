# III + Agent 实习生教程系列

> **用代码验证每一句话的 III 教程**

本系列从零开始，带你理解 III（发音 "three eye"）这个开源后端引擎，以及它如何重新定义 Agent 基础设施。

---

## 文章列表

| # | 文章 | 核心结论 | 验证代码 |
|---|------|---------|---------|
| 1 | [III 是什么 — 三个原语统一一切](./01-three-primitives.md) | Worker + Trigger + Function = 一切 | [运行](../verify/01-three-primitives.mjs) |
| 2 | [Harness 即后端 — Agent 不是特殊物种](./02-harness-is-backend.md) | Agent = Worker，工具 = Function | [运行](../verify/02-harness-is-backend.mjs) |
| 3 | [可观测性即运行时属性](./03-observability.md) | 无需手动埋点，trace 自动注入 | [运行](../verify/03-observability.mjs) |
| 4 | [Live System — 实时发现、扩展、观测](./04-live-system.md) | Worker 连接即刻上线，断开自动清理 | [运行](../verify/04-live-system.mjs) |
| 5 | [构建你的第一个 Agent Harness](./05-build-harness.md) | 实战：构建最小 Agent Harness | [运行](../verify/05-build-harness.mjs) |

---

## 5 分钟快速体验

```bash
# 1. 确保 III 引擎运行中
iii --config config.yaml

# 2. 运行任意验证脚本
node docs/iii/verify/01-three-primitives.mjs

# 3. 打开 Console 查看可视化
iii console  # → http://127.0.0.1:3113
```

---

## 学习路径

```
第 1 篇（概念）
  ↓ 理解三个原语
第 2 篇（Agent）
  ↓ 理解 Agent 在 III 中的位置
第 3 篇（观测）
  ↓ 理解自动可观测性
第 4 篇（动态）
  ↓ 理解 Live System
第 5 篇（实战）
  → 构建你的第一个 Agent Harness
```

---

## 验证结果总览

| 篇 | 验证项 | 结果 |
|---|--------|------|
| 1 | Worker 注册、Function 注册、直接调用、全局可见、注册表可见、跨 Worker 调用 | ✅ 6/6 |
| 2 | Agent 即 Worker、工具=Function、记忆=state::*、编排=Trigger、Agent 调用=Worker 间调用、Agent 无特殊性 | ✅ 6/6 |
| 3 | 自动创建 span、嵌套 span 层级、Logger 关联 trace、错误自动标记、Console 可查询 | ✅ 5/5 |
| 4 | 连接前基线、即刻可见、即刻可调用、全局列表更新、断开自动清理、Function 同步移除 | ✅ 6/6 |
| 5 | 创建 Agent Worker、注册工具、决策循环、可观测性、记忆持久化、Agent 注册表 | ✅ 6/6 |

**总计：29/29 项验证全部通过**

---

## 关于 III

III 是一个开源后端引擎，用三个原语（Worker、Trigger、Function）统一了分布式后端设计。

- 官网：https://iii.dev
- 文档：https://iii.dev/docs
- 源码：https://github.com/iii-hq/iii
- Worker 注册中心：https://workers.iii.dev
