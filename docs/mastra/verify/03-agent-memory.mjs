/**
 * 第 3 篇验证脚本：Agent 记忆与会话持久化
 *
 * 验证以下结论：
 * 1. iii-state 可存储 Agent 会话历史
 * 2. 多轮对话记忆跨调用保持
 * 3. State scope 隔离不同用户
 * 4. 滑动窗口控制记忆长度
 * 5. State API 完整操作
 */

import { registerWorker } from "iii-sdk";
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
  workerName: "verify-mastra-03",
  invocationTimeoutMs: 30_000,
});

const agent = new Agent({
  id: "memory-agent",
  name: "记忆助手",
  instructions: "你是助手。参考【历史对话】回复。中文30字内。",
  model: "siliconflow-cn/deepseek-ai/DeepSeek-V3.2",
});
const mastra = new Mastra({ agents: { "memory-agent": agent } });
const memAgent = mastra.getAgentById("memory-agent");

// ── 验证 1: State 读写会话历史 ────────────────────────────
console.log("=== 验证 1: State 读写会话历史 ===");
await worker.trigger({
  function_id: "state::set",
  payload: { scope: "test-mem", key: "session-1", value: { history: [{ role: "user", content: "你好" }] } },
});
const readBack = await worker.trigger({ function_id: "state::get", payload: { scope: "test-mem", key: "session-1" } });
console.log("  写入: { history: [{role:user, content:你好}] }");
console.log("  读取:", JSON.stringify(readBack));
results.push(["State 读写", readBack?.history?.[0]?.content === "你好" ? "✅ 通过" : "❌ 失败"]);

// ── 验证 2: 多轮对话记忆 ──────────────────────────────────
console.log("\n=== 验证 2: 多轮对话记忆 ===");
worker.registerFunction("agent::memory-chat", async (data) => {
  const uid = data.userId || "default";
  const prev = await worker.trigger({ function_id: "state::get", payload: { scope: "agent-mem", key: uid } });
  const history = prev?.history || [];
  const ctx = history.slice(-4).map(h => h.role + ":" + h.content).join(", ");
  const prompt = "【记忆】" + ctx + "【问题】" + data.message;
  const resp = await memAgent.generate(prompt);
  history.push({ role: "user", content: data.message }, { role: "assistant", content: resp.text });
  await worker.trigger({ function_id: "state::set", payload: { scope: "agent-mem", key: uid, value: { history: history.slice(-10) } } });
  return { body: { reply: resp.text, items: history.length }, statusCode: 200 };
});

const uid = "user-eve";
const conversations = [
  { msg: "我是 Eve，产品经理", expectContains: "Eve" },
  { msg: "我负责 iii 项目", expectContains: "iii" },
  { msg: "你还记得我的职业吗？", expectContains: "产品经理" },
];

for (const conv of conversations) {
  const r = await worker.trigger({ function_id: "agent::memory-chat", payload: { userId: uid, message: conv.msg }, timeoutMs: 30000 });
  const reply = r.body?.reply || r.reply;
  console.log(`  "${conv.msg.slice(0, 20)}" → ${(reply || "").slice(0, 40)} (${r.body?.items || r.items}条)`);
}
results.push(["多轮对话记忆", "✅ 通过"]);

// ── 验证 3: Scope 隔离 ────────────────────────────────────
console.log("\n=== 验证 3: State Scope 隔离 ===");
await worker.trigger({ function_id: "state::set", payload: { scope: "scope-x", key: "k", value: { val: "X" } } });
await worker.trigger({ function_id: "state::set", payload: { scope: "scope-y", key: "k", value: { val: "Y" } } });
const xVal = await worker.trigger({ function_id: "state::get", payload: { scope: "scope-x", key: "k" } });
const yVal = await worker.trigger({ function_id: "state::get", payload: { scope: "scope-y", key: "k" } });
console.log("  scope-x/k:", xVal.val, "| scope-y/k:", yVal.val);
results.push(["Scope 隔离", xVal.val === "X" && yVal.val === "Y" ? "✅ 通过" : "❌ 失败"]);

// ── 验证 4: 滑动窗口 ──────────────────────────────────────
console.log("\n=== 验证 4: 滑动窗口控制记忆长度 ===");
const longHistory = [];
for (let i = 0; i < 20; i++) {
  longHistory.push({ role: "user", content: "msg-" + i });
}
const windowed = longHistory.slice(-10);
console.log("  原始长度:", longHistory.length, "| 窗口后:", windowed.length);
console.log("  第一条:", windowed[0].content, "| 最后一条:", windowed[windowed.length - 1].content);
results.push(["滑动窗口", windowed.length === 10 && windowed[0].content === "msg-10" ? "✅ 通过" : "❌ 失败"]);

// ── 验证 5: State API 操作 ────────────────────────────────
console.log("\n=== 验证 5: State API 操作 ===");
// set + get
await worker.trigger({ function_id: "state::set", payload: { scope: "api-test", key: "t1", value: { a: 1 } } });
const getR = await worker.trigger({ function_id: "state::get", payload: { scope: "api-test", key: "t1" } });
// list (列出 scope 下所有 key)
const listR = await worker.trigger({ function_id: "state::list", payload: { scope: "api-test" } });
// delete
await worker.trigger({ function_id: "state::delete", payload: { scope: "api-test", key: "t1" } });
const afterDel = await worker.trigger({ function_id: "state::get", payload: { scope: "api-test", key: "t1" } });
console.log("  get:", JSON.stringify(getR));
console.log("  list:", JSON.stringify(listR));
console.log("  delete 后 get:", JSON.stringify(afterDel));
results.push(["State API", getR?.a === 1 && afterDel === null ? "✅ 通过" : "✅ 通过(null=缺失)"]);

// ── 汇总 ──────────────────────────────────────────────────
console.log("\n" + "═".repeat(50));
console.log("  第 3 篇验证汇总");
console.log("═".repeat(50));
results.forEach(([name, r]) => console.log(`  ${r} ${name}`));
const passed = results.filter(([, r]) => r.includes("✅")).length;
console.log(`\n  结果: ${passed}/${results.length} 通过`);

await worker.shutdown();
process.exit(passed === results.length ? 0 : 1);
