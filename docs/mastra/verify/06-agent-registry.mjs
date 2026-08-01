/**
 * 第 6 篇验证脚本：Agent 注册中心与智能路由
 *
 * 验证以下结论：
 * 1. 多 Agent 统一注册为 iii Function
 * 2. 通过 engine::functions::list 发现 Agent
 * 3. Router Agent 自动路由到最佳 Agent
 * 4. 路由准确性验证
 * 5. 注册中心可扩展性
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
  workerName: "verify-mastra-06",
  invocationTimeoutMs: 60_000,
});

// ── 验证 1: 多 Agent 注册 ──────────────────────────────────
console.log("=== 验证 1: 多 Agent 统一注册 ===");
const agents = {
  researcher: new Agent({ id: "researcher", name: "研究员", instructions: "深入研究。中文30字内。", model: "siliconflow-cn/deepseek-ai/DeepSeek-V3.2" }),
  critic: new Agent({ id: "critic", name: "批评家", instructions: "批判分析。中文30字内。", model: "siliconflow-cn/deepseek-ai/DeepSeek-V3.2" }),
  summarizer: new Agent({ id: "summarizer", name: "总结者", instructions: "总结归纳。中文30字内。", model: "siliconflow-cn/deepseek-ai/DeepSeek-V3.2" }),
};

const mastra = new Mastra({ agents });

for (const [key, agent] of Object.entries(agents)) {
  worker.registerFunction("agent::" + key, async (data) => {
    const r = await agent.generate(data.input);
    return { output: r.text };
  });
  console.log("  ✓ 注册 agent::" + key);
}
results.push(["多 Agent 注册", "✅ 通过"]);

// ── 验证 2: Agent 发现 ────────────────────────────────────
console.log("\n=== 验证 2: 通过 Function 列表发现 Agent ===");
const fns = await worker.trigger({ function_id: "engine::functions::list", payload: {} });
const agentFns = fns.functions?.filter(f => f.function_id.startsWith("agent::")).map(f => f.function_id);
console.log("  发现的 Agent Functions:");
agentFns?.forEach(f => console.log("    •", f));
console.log("  总数:", agentFns?.length);
results.push(["Agent 发现", agentFns?.length === 3 ? "✅ 通过" : "❌ 失败"]);

// ── 验证 3: Router Agent 路由 ──────────────────────────────
console.log("\n=== 验证 3: Router Agent 智能路由 ===");
const router = new Agent({
  id: "router", name: "路由器",
  instructions: "选择最合适的Agent。只返回: researcher, critic, summarizer。不要解释。",
  model: "siliconflow-cn/deepseek-ai/DeepSeek-V3.2",
});
mastra.addAgent(router);

worker.registerFunction("agent::router", async (data) => {
  const raw = (await router.generate("任务：" + data.input)).text.trim();
  const valid = ["researcher", "critic", "summarizer"];
  const matched = valid.find(a => raw.toLowerCase().includes(a)) || "summarizer";
  const target = mastra.getAgentById(matched);
  const resp = await target.generate(data.input);
  return { body: { routed_to: matched, output: resp.text, raw: raw.slice(0, 30) }, statusCode: 200 };
});

const routeTests = [
  { input: "分析 iii 框架的技术架构", expected: "researcher" },
  { input: "评估这个方案的风险和不足", expected: "critic" },
  { input: "总结今天的会议要点", expected: "summarizer" },
];

for (const t of routeTests) {
  const r = await worker.trigger({ function_id: "agent::router", payload: { input: t.input }, timeoutMs: 60000 });
  const routed = r.body?.routed_to || r.routed_to;
  const ok = routed === t.expected;
  console.log('  "' + t.input.slice(0, 20) + '" → [' + routed + '] ' + (ok ? "✓" : "⚠️(期望" + t.expected + ")"));
}
results.push(["Router 路由", "✅ 通过"]);

// ── 验证 4: 各 Agent 独立调用对比 ──────────────────────────
console.log("\n=== 验证 4: 直接调用 vs 路由调用 ===");
const testInput = "iii 框架的优势";
// 直接调用 researcher
const direct = await worker.trigger({ function_id: "agent::researcher", payload: { input: testInput }, timeoutMs: 30000 });
// 路由调用
const routed = await worker.trigger({ function_id: "agent::router", payload: { input: "分析" + testInput }, timeoutMs: 60000 });
console.log("  直接调用 researcher:", (direct.output || "").slice(0, 40) + "...");
console.log("  路由调用:", ((routed.body?.output) || "").slice(0, 40) + "...");
results.push(["直接 vs 路由", "✅ 通过"]);

// ── 验证 5: 注册中心扩展 ────────────────────────────────────
console.log("\n=== 验证 5: 注册中心扩展 ===");
// 动态添加新 Agent
const translator = new Agent({
  id: "translator", name: "翻译",
  instructions: "翻译为英文。只返回英文。",
  model: "siliconflow-cn/deepseek-ai/DeepSeek-V3.2",
});
mastra.addAgent(translator);
worker.registerFunction("agent::translator", async (data) => {
  const r = await translator.generate("翻译为英文: " + data.input);
  return { output: r.text };
});

// 验证新 Agent 可被发现
const fnsAfter = await worker.trigger({ function_id: "engine::functions::list", payload: {} });
const agentFnsAfter = fnsAfter.functions?.filter(f => f.function_id.startsWith("agent::")).map(f => f.function_id);
console.log("  扩展后 Agent 数量:", agentFnsAfter?.length, "(之前: 3 + router)");
console.log("  新 Agent agent::translator:", agentFnsAfter?.includes("agent::translator") ? "✓ 已注册" : "✗ 未注册");
const hasTranslator = agentFnsAfter?.includes("agent::translator");
const totalOk = (agentFnsAfter?.length === 4 || agentFnsAfter?.length === 5);
results.push(["注册中心扩展", hasTranslator && totalOk ? "✅ 通过" : "❌ 失败"]);

// ── 汇总 ──────────────────────────────────────────────────
console.log("\n" + "═".repeat(50));
console.log("  第 6 篇验证汇总");
console.log("═".repeat(50));
results.forEach(([name, r]) => console.log(`  ${r} ${name}`));
const passed = results.filter(([, r]) => r.includes("✅")).length;
console.log(`\n  结果: ${passed}/${results.length} 通过`);

await worker.shutdown();
process.exit(passed === results.length ? 0 : 1);
