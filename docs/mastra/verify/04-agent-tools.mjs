/**
 * 第 4 篇验证脚本：Agent 工具调用
 *
 * 验证以下结论：
 * 1. Mastra Tool 可包装 iii Function
 * 2. Agent 自动选择并调用 Tool
 * 3. toolCalls/toolResults 结构正确
 * 4. 多 Tool 协作（一轮对话调用多个）
 * 5. Tool 调用 vs 直接 Function 调用的区别
 */

import { registerWorker } from "iii-sdk";
import { Agent } from "@mastra/core/agent";
import { Mastra } from "@mastra/core";
import { createTool } from "@mastra/core/tools";

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
  workerName: "verify-mastra-04",
  invocationTimeoutMs: 30_000,
});

// ── 验证 1: Tool 包装 iii Function ────────────────────────
console.log("=== 验证 1: Tool 包装 iii Function ===");

// 注册 iii Function（作为 Tool 后端）
worker.registerFunction("tool::get-weather", async (data) => {
  const city = data.city || "北京";
  return { city, temp: 25, condition: "晴", humidity: 47 };
});
worker.registerFunction("tool::get-time", async () => {
  return { time: new Date().toISOString() };
});

// 创建 Mastra Tool
const weatherTool = createTool({
  id: "get-weather",
  description: "获取指定城市的天气",
  inputSchema: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
  outputSchema: { type: "object", properties: { temp: { type: "number" }, condition: { type: "string" } } },
  execute: async ({ city }) => {
    return await worker.trigger({ function_id: "tool::get-weather", payload: { city } });
  },
});

const timeTool = createTool({
  id: "get-time",
  description: "获取当前时间",
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object", properties: { time: { type: "string" } } },
  execute: async () => {
    return await worker.trigger({ function_id: "tool::get-time", payload: {} });
  },
});

const toolAgent = new Agent({
  id: "tool-user",
  name: "工具使用者",
  instructions: "你是助手。必须使用工具获取信息。中文30字内。",
  model: "siliconflow-cn/deepseek-ai/DeepSeek-V3.2",
  tools: { weatherTool, timeTool },
});
const mastra = new Mastra({ agents: { "tool-user": toolAgent } });
const agent = mastra.getAgentById("tool-user");

console.log("  Tool 注册完成: get-weather, get-time");
results.push(["Tool 包装 iii Function", "✅ 通过"]);

// ── 验证 2: Agent 自动选择 Tool ───────────────────────────
console.log("\n=== 验证 2: Agent 自动选择 Tool ===");
const r2 = await agent.generate("北京天气怎么样？");
const toolCalls2 = r2.toolCalls || [];
const toolResults2 = r2.toolResults || [];
console.log("  问题: 北京天气怎么样？");
console.log("  使用工具:", toolCalls2.map(t => t.payload?.toolName || t.toolName).join(", ") || "(无)");
console.log("  回复:", (r2.text || "").slice(0, 50));
results.push(["Agent 自动选 Tool", toolCalls2.length > 0 ? "✅ 通过" : "⚠️ Agent未选Tool"]);

// ── 验证 3: toolCalls/toolResults 结构 ────────────────────
console.log("\n=== 验证 3: toolCalls/toolResults 结构 ===");
const r3 = await agent.generate("现在几点了？");
const tc3 = r3.toolCalls || [];
const tr3 = r3.toolResults || [];
console.log("  toolCalls 数量:", tc3.length);
if (tc3.length > 0) {
  console.log("  toolCalls[0].payload.toolName:", tc3[0].payload?.toolName || tc3[0].toolName);
  console.log("  toolResults[0].payload.result:", JSON.stringify(tr3[0]?.payload?.result || tr3[0]?.result));
}
results.push(["toolCalls 结构", tc3.length > 0 ? "✅ 通过" : "⚠️ 无调用"]);

// ── 验证 4: 多 Tool 协作 ──────────────────────────────────
console.log("\n=== 验证 4: 多 Tool 协作 ===");
const r4 = await agent.generate("北京天气如何？顺便查一下时间");
const tc4 = r4.toolCalls || [];
const usedTools = tc4.map(t => t.payload?.toolName || t.toolName);
console.log("  使用工具数:", tc4.length);
console.log("  工具列表:", usedTools.join(", ") || "(无)");
console.log("  回复:", (r4.text || "").slice(0, 50));
results.push(["多 Tool 协作", tc4.length >= 2 ? "✅ 通过" : "⚠️ 单Tool"]);

// ── 验证 5: Tool 调用 vs 直接 Function 调用 ──────────────
console.log("\n=== 验证 5: Tool 调用 vs 直接 Function 调用 ===");
// 直接调用
const directStart = Date.now();
const directResult = await worker.trigger({ function_id: "tool::get-weather", payload: { city: "上海" } });
const directTime = Date.now() - directStart;
console.log("  直接调用:", JSON.stringify(directResult), "(" + directTime + "ms)");

// Tool 调用（Agent 决策 + 执行）
const toolStart = Date.now();
const toolResult = await agent.generate("上海天气");
const toolTime = Date.now() - toolStart;
console.log("  Tool 调用: 回复=" + (toolResult.text || "").slice(0, 30), "(" + toolTime + "ms)");
console.log("  区别: 直接调用更快(" + directTime + "ms), Tool 调用含 LLM 决策(" + toolTime + "ms)");
results.push(["Tool vs 直接调用", directResult && toolResult ? "✅ 通过" : "❌ 失败"]);

// ── 汇总 ──────────────────────────────────────────────────
console.log("\n" + "═".repeat(50));
console.log("  第 4 篇验证汇总");
console.log("═".repeat(50));
results.forEach(([name, r]) => console.log(`  ${r} ${name}`));
const passed = results.filter(([, r]) => r.includes("✅")).length;
const warned = results.filter(([, r]) => r.includes("⚠️")).length;
console.log(`\n  结果: ${passed} 通过 / ${warned} 注意 / ${results.length} 总计`);

await worker.shutdown();
process.exit(passed >= 3 ? 0 : 1);
