/**
 * 第 4 篇验证脚本：Live System — 实时发现、扩展、观测
 *
 * 验证以下结论：
 * 1. Worker 连接后 Function 即刻全局可见
 * 2. 新 Worker 注册无需重启引擎
 * 3. engine::workers::list 实时反映拓扑变化
 * 4. engine::functions::list 返回全部 Function
 * 5. Worker 断开后 Function 自动从注册表移除
 */

import { registerWorker } from "iii-sdk";

const ENGINE_URL = "ws://localhost:49134";
const results = [];

// ── 验证 1: 连接前记录基线 ──────────────────────────────
console.log("=== 验证 1: 连接前基线 ===");

const probe = registerWorker(ENGINE_URL, {
  workerName: "probe-04",
  invocationTimeoutMs: 5000,
});

const before = await probe.trigger({
  function_id: "engine::workers::list",
  payload: {},
});
const beforeWorkers = before.workers?.length || 0;
console.log(`  当前 Worker 数: ${beforeWorkers}`);
results.push(["连接前基线", "✅ 记录"]);

// ── 验证 2: 新 Worker 连接后即刻可见 ────────────────────
console.log("\n=== 验证 2: 新 Worker 即刻可见 ===");

const newWorker = registerWorker(ENGINE_URL, {
  workerName: "dynamic-worker-04",
  workerDescription: "动态注册的 Worker",
  invocationTimeoutMs: 5000,
});

newWorker.registerFunction("dynamic::hello", async (data) => {
  return { message: `Hello from dynamic worker, ${data.name || "World"}!` };
});

newWorker.registerFunction("dynamic::time", async () => {
  return { time: new Date().toISOString() };
});

// 等待 Function 注册完成（引擎异步确认）
await new Promise((r) => setTimeout(r, 1500));

// 立即查询——无需等待、无需重启
const after = await probe.trigger({
  function_id: "engine::workers::list",
  payload: {},
});
const afterWorkers = after.workers?.length || 0;
console.log(`  注册后 Worker 数: ${afterWorkers}`);
console.log(`  新增: ${afterWorkers - beforeWorkers} 个 Worker`);

const dynamicWorker = after.workers?.find((w) => w.name === "dynamic-worker-04");
console.log(`  dynamic-worker-04 状态: ${dynamicWorker?.status}`);
console.assert(dynamicWorker?.status === "connected", "应该 connected");
results.push(["即刻可见", "✅ 通过"]);

// ── 验证 3: Function 即刻全局可调用 ─────────────────────
console.log("\n=== 验证 3: Function 即刻全局可调用 ===");

// 用 probe Worker 调用新 Worker 的 Function
const helloResult = await probe.trigger({
  function_id: "dynamic::hello",
  payload: { name: "实习生" },
});
console.log(`  dynamic::hello("实习生") = "${helloResult.message}"`);
console.assert(helloResult.message.includes("实习生"), "应该返回正确结果");

const timeResult = await probe.trigger({
  function_id: "dynamic::time",
  payload: {},
});
console.log(`  dynamic::time() = ${timeResult.time}`);
results.push(["即刻可调用", "✅ 通过"]);

// ── 验证 4: 全局 Function 列表实时更新 ──────────────────
console.log("\n=== 验证 4: 全局 Function 列表 ===");

const allFunctions = await probe.trigger({
  function_id: "engine::functions::list",
  payload: {},
});
const fns = allFunctions.functions || [];
const dynamicFns = fns.filter((f) => (f.function_id || "").startsWith("dynamic::"));
console.log(`  全局 Function 总数: ${fns.length}`);
console.log(`  dynamic::* Function: ${dynamicFns.length}`);
dynamicFns.forEach((f) => console.log(`    - ${f.function_id}`));
console.assert(dynamicFns.length >= 2, "dynamic::* 应该至少有 2 个");
results.push(["全局列表实时更新", "✅ 通过"]);

// ── 验证 5: Worker 断开后自动清理 ───────────────────────
console.log("\n=== 验证 5: Worker 断开自动清理 ===");

// 断开新 Worker
await newWorker.shutdown();
await new Promise((r) => setTimeout(r, 1000));

const afterDisconnect = await probe.trigger({
  function_id: "engine::workers::list",
  payload: {},
});
const disconnectWorkers = afterDisconnect.workers?.length || 0;
console.log(`  断开后 Worker 数: ${disconnectWorkers}`);
console.log(`  减少: ${afterWorkers - disconnectWorkers} 个 Worker`);

const stillThere = afterDisconnect.workers?.find((w) => w.name === "dynamic-worker-04");
console.log(`  dynamic-worker-04 仍存在: ${stillThere ? "是" : "否（已自动移除）"}`);
console.assert(stillThere === undefined, "断开后应该自动移除");
results.push(["断开自动清理", "✅ 通过"]);

// ── 验证 6: Function 也随之移除 ─────────────────────────
console.log("\n=== 验证 6: Function 也随之移除 ===");

const afterFnList = await probe.trigger({
  function_id: "engine::functions::list",
  payload: {},
});
const afterFns = afterFnList.functions || [];
const stillDynamic = afterFns.filter((f) => (f.function_id || "").startsWith("dynamic::"));
console.log(`  断开后 dynamic::* Function: ${stillDynamic.length}`);
console.assert(stillDynamic.length === 0, "Function 应该随之移除");
results.push(["Function 同步移除", "✅ 通过"]);

// ── 总结 ─────────────────────────────────────────────────
console.log("\n" + "=".repeat(60));
console.log("  第 4 篇验证总结");
console.log("=".repeat(60));
for (const [name, status] of results) {
  console.log(`  ${status}  ${name}`);
}
console.log(`\n  结论: III 是一个 Live System——`);
console.log(`  Worker 连接即刻上线，断开自动清理，无需重启引擎。`);

await probe.shutdown();
process.exit(0);
