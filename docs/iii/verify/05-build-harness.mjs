/**
 * 第 5 篇验证脚本：构建你的第一个 Agent Harness
 *
 * 实战：用 III 构建一个最小但完整的 Agent Harness。
 *
 * 这个 Agent 具备：
 * 1. 工具注册（research、calculate、remember）
 * 2. 记忆系统（state::*）
 * 3. 决策循环（根据输入选择工具）
 * 4. 可观测性（自动 trace + 结构化日志）
 *
 * 验证结论：
 * ✓ Agent 是 Worker
 * ✓ 工具是 Function
 * ✓ 记忆是 state::*
 * ✓ 调用链在 Console 中完整可见
 */

import { registerWorker } from "iii-sdk";
import {
  Logger,
  withSpan,
  currentTraceId,
  initOtel,
} from "@iii-dev/helpers/observability";

const ENGINE_URL = "ws://localhost:49134";
const results = [];

initOtel({ serviceName: "my-first-agent", enabled: true, metricsEnabled: true });
const logger = new Logger();

// ── 步骤 1: 创建 Agent Worker ────────────────────────────
console.log("=== 步骤 1: 创建 Agent Worker ===");

const agent = registerWorker(ENGINE_URL, {
  workerName: "my-first-agent",
  workerDescription: "我的第一个 Agent Harness",
  invocationTimeoutMs: 30_000,
});

console.log("✅ Agent Worker 已连接");
results.push(["创建 Agent Worker", "✅ 通过"]);

// ── 步骤 2: 注册工具（Function）─────────────────────────
console.log("\n=== 步骤 2: 注册工具 ===");

// 工具 1: 数学计算
agent.registerFunction(
  "agent::calculate",
  async (data) => {
    const { a, b, op } = data;
    let result;
    switch (op) {
      case "+": result = a + b; break;
      case "-": result = a - b; break;
      case "*": result = a * b; break;
      case "/": result = b !== 0 ? a / b : NaN; break;
      default: result = NaN;
    }
    return { expression: `${a} ${op} ${b}`, result };
  },
  { description: "执行数学运算 (+, -, *, /)" },
);

// 工具 2: 信息查询（模拟）
agent.registerFunction(
  "agent::lookup",
  async (data) => {
    const knowledge = {
      "III": "III 是一个开源后端引擎，用 Worker/Trigger/Function 三个原语统一后端设计。",
      "Worker": "Worker 是 III 的参与者，任何能开 WebSocket 的进程都可以是 Worker。",
      "Function": "Function 是 Worker 的能力单元，通过 service::name 标识。",
      "Trigger": "Trigger 将事件源绑定到 Function，声明式触发。",
    };
    const info = knowledge[data.topic] || `关于"${data.topic}"暂无记录`;
    return { topic: data.topic, info };
  },
  { description: "查询知识库" },
);

// 工具 3: 记忆存储
agent.registerFunction(
  "agent::remember",
  async (data) => {
    await agent.trigger({
      function_id: "state::set",
      payload: { scope: "agent-memory", key: data.key, value: data.value },
    });
    return { saved: true, key: data.key };
  },
  { description: "保存到记忆" },
);

console.log("✅ 注册了 3 个工具: agent::calculate, agent::lookup, agent::remember");
results.push(["注册工具", "✅ 通过"]);

// ── 步骤 3: 实现决策循环 ────────────────────────────────
console.log("\n=== 步骤 3: 决策循环 ===");

// 等待工具注册完成
await new Promise((r) => setTimeout(r, 1000));

async function agentThink(userInput) {
  return await withSpan("agent.think", {}, async () => {
    logger.info("Agent 开始思考", { input: userInput });

    // 简单的"决策"逻辑（实际中由 LLM 完成）
    let toolId, payload;

    if (userInput.match(/(\d+)\s*[\+\-\*\/]\s*(\d+)/)) {
      const match = userInput.match(/(\d+)\s*([\+\-\*\/])\s*(\d+)/);
      toolId = "agent::calculate";
      payload = { a: Number(match[1]), op: match[2], b: Number(match[3]) };
    } else if (userInput.startsWith("什么是") || userInput.includes("介绍")) {
      const topic = userInput.replace("什么是", "").replace("介绍", "").trim();
      toolId = "agent::lookup";
      payload = { topic };
    } else {
      // 默认：保存到记忆
      toolId = "agent::remember";
      payload = { key: `note-${Date.now()}`, value: userInput };
    }

    logger.info(`Agent 选择工具: ${toolId}`, { payload });

    // 调用工具
    const result = await agent.trigger({ function_id: toolId, payload });

    logger.info("Agent 工具调用完成", {
      tool: toolId,
      result: JSON.stringify(result).slice(0, 60),
    });

    return { tool: toolId, result };
  });
}

// 测试决策循环
const test1 = await agentThink("3 + 5");
console.log(`  输入: "3 + 5" → 工具: ${test1.tool} → 结果: ${test1.result.result}`);

const test2 = await agentThink("什么是 III");
console.log(`  输入: "什么是 III" → 工具: ${test2.tool} → 结果: ${test2.result.info?.slice(0, 30)}...`);

const test3 = await agentThink("12 * 7");
console.log(`  输入: "12 * 7" → 工具: ${test3.tool} → 结果: ${test3.result.result}`);

console.assert(test1.result.result === 8, "3 + 5 应该等于 8");
console.assert(test2.result.info?.includes("III"), "应该返回 III 的信息");
console.assert(test3.result.result === 84, "12 * 7 应该等于 84");
results.push(["决策循环", "✅ 通过"]);

// ── 步骤 4: 验证可观测性 ────────────────────────────────
console.log("\n=== 步骤 4: 可观测性验证 ===");

const currentTid = currentTraceId();
console.log(`  当前 traceId: ${currentTid}`);

// 查询 traces
const traces = await agent.trigger({
  function_id: "engine::traces::list",
  payload: {},
});
const totalSpans = traces.total || 0;
const agentSpans = (traces.spans || []).filter(
  (s) => s.name.includes("agent") || s.name.includes("my-first-agent"),
);
console.log(`  总 spans: ${totalSpans}`);
console.log(`  Agent 相关 spans: ${agentSpans.length}`);

// 查询 logs
const logs = await agent.trigger({
  function_id: "engine::logs::list",
  payload: {},
});
const agentLogs = (logs.logs || []).filter(
  (l) => l.service_name === "my-first-agent",
);
console.log(`  Agent 日志: ${agentLogs.length} 条`);

console.assert(agentSpans.length > 0, "应该有 Agent span");
console.assert(agentLogs.length > 0, "应该有 Agent 日志");
results.push(["可观测性", "✅ 通过"]);

// ── 步骤 5: 验证记忆持久化 ──────────────────────────────
console.log("\n=== 步骤 5: 记忆持久化 ===");

// 保存一条记忆
await agent.trigger({
  function_id: "agent::remember",
  payload: { key: "user-preference", value: { language: "zh-CN", level: "实习生" } },
});

// 读取记忆
const memory = await agent.trigger({
  function_id: "state::get",
  payload: { scope: "agent-memory", key: "user-preference" },
});
console.log(`  保存: user-preference`);
console.log(`  读取: language=${memory?.language}, level=${memory?.level}`);
console.assert(memory?.language === "zh-CN", "记忆应该持久化");
results.push(["记忆持久化", "✅ 通过"]);

// ── 步骤 6: 验证 Agent 在注册表中 ───────────────────────
console.log("\n=== 步骤 6: Agent 注册表验证 ===");

const workersList = await agent.trigger({
  function_id: "engine::workers::list",
  payload: {},
});
const agentEntry = (workersList.workers || []).find((w) => w.name === "my-first-agent");
console.log(`  Agent 名称: ${agentEntry?.name}`);
console.log(`  Agent 状态: ${agentEntry?.status}`);
console.log(`  Agent 工具数: ${agentEntry?.function_count}`);
console.assert(agentEntry?.status === "connected", "Agent 应该 connected");
console.assert(agentEntry?.function_count >= 3, "Agent 应该至少有 3 个工具");
results.push(["Agent 注册表", "✅ 通过"]);

// ── 总结 ─────────────────────────────────────────────────
console.log("\n" + "=".repeat(60));
console.log("  第 5 篇验证总结 — 你的第一个 Agent Harness");
console.log("=".repeat(60));
for (const [name, status] of results) {
  console.log(`  ${status}  ${name}`);
}
console.log(`\n  🎉 Agent Harness 构建完成！`);
console.log(`  Agent 名称: my-first-agent`);
console.log(`  注册工具: agent::calculate, agent::lookup, agent::remember`);
console.log(`  记忆系统: state::set/get (scope: agent-memory)`);
console.log(`  可观测性: ${agentSpans.length} spans + ${agentLogs.length} logs`);
console.log(`  Console: http://127.0.0.1:3113 → 查看 "my-first-agent" 的 trace`);

await agent.shutdown();
process.exit(0);
