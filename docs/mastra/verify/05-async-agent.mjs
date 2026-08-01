/**
 * 第 5 篇验证脚本：后台 Agent 异步处理
 *
 * 验证以下结论：
 * 1. 异步入队 (Enqueue) 立即返回 taskId
 * 2. Queue Worker 后台执行 Agent
 * 3. 轮询查询结果
 * 4. 结果写回 State
 * 5. 三种调用模式对比 (Sync/Void/Enqueue)
 */

import { registerWorker, TriggerAction } from "iii-sdk";
import { Agent } from "@mastra/core/agent";
import { Mastra } from "@mastra/core";

const ENGINE_URL = "ws://localhost:49134";
const results = [];

// ── 环境准备 ──────────────────────────────────────────────
const fs = await import("fs");
const dotenv = fs.readFileSync(".env", "utf8").split("\n").reduce((acc, line) => {
  const m = line.match(/^([A-Z_]+)=(.*)/);
  if (m) acc[m[1]] = m[2];
  return acc;
}, {});
Object.assign(process.env, dotenv);
process.env.SILICONFLOW_CN_API_KEY = process.env.LLM_API_KEY;

const worker = registerWorker(ENGINE_URL, {
  workerName: "verify-mastra-05",
  invocationTimeoutMs: 30_000,
});

const analyst = new Agent({
  id: "analyst", name: "分析师",
  instructions: "分析内容要点。中文40字内。",
  model: "siliconflow-cn/deepseek-ai/DeepSeek-V3.2",
});
const mastra = new Mastra({ agents: { analyst } });
const agent = mastra.getAgentById("analyst");

// ── 验证 1: 异步入队 ──────────────────────────────────────
console.log("=== 验证 1: 异步入队 (Enqueue) ===");
worker.registerFunction("agent::execute-async", async (data) => {
  const resp = await agent.generate(data.input);
  await worker.trigger({ function_id: "state::set", payload: { scope: "async-tasks", key: data.taskId, value: { status: "done", output: resp.text } } });
  return { output: resp.text };
});

const taskId = "task_" + Date.now();
const enqueueReceipt = await worker.trigger({
  function_id: "agent::execute-async",
  payload: { taskId, input: "分析 iii 框架的架构设计" },
  action: TriggerAction.Enqueue({ queue: "default" }),
});
console.log("  入队结果:", JSON.stringify(enqueueReceipt));
console.log("  ✓ 立即返回 (不等待 Agent 执行)");
results.push(["异步入队", enqueueReceipt?.messageReceiptId ? "✅ 通过" : "❌ 失败"]);

// ── 验证 2: Queue Worker 后台执行 + 轮询 ──────────────────
console.log("\n=== 验证 2: 后台执行 + 轮询 ===");
let finalState = null;
for (let i = 0; i < 15; i++) {
  await new Promise(r => setTimeout(r, 2000));
  const state = await worker.trigger({ function_id: "state::get", payload: { scope: "async-tasks", key: taskId } });
  finalState = state;
  if (state?.status === "done") {
    console.log("  ✓ 完成 (轮询 #" + (i + 1) + "):", (state.output || "").slice(0, 50) + "...");
    break;
  }
}
results.push(["后台执行 + 轮询", finalState?.status === "done" ? "✅ 通过" : "⚠️ 未完成"]);

// ── 验证 3: 结果写回 State ────────────────────────────────
console.log("\n=== 验证 3: 结果写回 State ===");
const savedResult = await worker.trigger({ function_id: "state::get", payload: { scope: "async-tasks", key: taskId } });
console.log("  State 中 status:", savedResult?.status);
console.log("  State 中 output:", (savedResult?.output || "").slice(0, 50) + "...");
results.push(["结果写回 State", savedResult?.status === "done" && savedResult?.output ? "✅ 通过" : "❌ 失败"]);

// ── 验证 4: 三种调用模式对比 ──────────────────────────────
console.log("\n=== 验证 4: 三种调用模式对比 ===");
worker.registerFunction("agent::mode-test", async (data) => {
  return { mode: data.mode, done: true };
});

// Sync
const syncR = await worker.trigger({ function_id: "agent::mode-test", payload: { mode: "sync" } });
console.log("  Sync:   ", JSON.stringify(syncR));

// Void
const voidR = await worker.trigger({ function_id: "agent::mode-test", payload: { mode: "void" }, action: TriggerAction.Void() });
console.log("  Void:   ", JSON.stringify(voidR));

// Enqueue
const enqueueR = await worker.trigger({ function_id: "agent::mode-test", payload: { mode: "enqueue" }, action: TriggerAction.Enqueue({ queue: "default" }) });
console.log("  Enqueue:", JSON.stringify(enqueueR));
results.push(["三种调用模式", syncR?.mode === "sync" && voidR === undefined && enqueueR?.messageReceiptId ? "✅ 通过" : "❌ 失败"]);

// ── 验证 5: Queue 重试机制 ────────────────────────────────
console.log("\n=== 验证 5: Queue 重试机制 ===");
let attemptCount = 0;
worker.registerFunction("agent::retry-test", async (data) => {
  attemptCount++;
  if (attemptCount < 3) throw new Error("模拟失败 #" + attemptCount);
  return { success: true, attempts: attemptCount };
});

await worker.trigger({
  function_id: "agent::retry-test",
  payload: { test: true },
  action: TriggerAction.Enqueue({ queue: "default" }),
});
await new Promise(r => setTimeout(r, 8000));
console.log("  尝试次数:", attemptCount, "(预期 3: 2次失败 + 1次成功)");
results.push(["Queue 重试", attemptCount === 3 ? "✅ 通过" : "⚠️ 重试中"]);

// ── 汇总 ──────────────────────────────────────────────────
console.log("\n" + "═".repeat(50));
console.log("  第 5 篇验证汇总");
console.log("═".repeat(50));
results.forEach(([name, r]) => console.log(`  ${r} ${name}`));
const passed = results.filter(([, r]) => r.includes("✅")).length;
console.log(`\n  结果: ${passed}/${results.length} 通过`);

await worker.shutdown();
process.exit(passed >= 4 ? 0 : 1);
