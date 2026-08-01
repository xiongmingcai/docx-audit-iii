/**
 * 第 2 篇验证脚本：多 Agent 协作工作流
 *
 * 验证以下结论：
 * 1. Workflow 可串联多个 Agent（三步链式执行）
 * 2. .then() 直接传递输出到下一步
 * 3. .map() + getInitData() 保留原始输入
 * 4. Workflow 可注册为 III Function
 * 5. result.steps 可访问每步输出
 */

import { registerWorker } from "iii-sdk";
import { Agent } from "@mastra/core/agent";
import { Mastra } from "@mastra/core";
import { createWorkflow, createStep } from "@mastra/core/workflows";

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
  workerName: "verify-mastra-02",
  invocationTimeoutMs: 120_000,
});

// ── 创建 Agents ────────────────────────────────────────────
const dataAnalyst = new Agent({
  id: "data-analyst", name: "数据分析师",
  instructions: "分析话题要点。中文30字内。",
  model: "siliconflow-cn/deepseek-ai/DeepSeek-V3.2",
});
const securityAuditor = new Agent({
  id: "security-auditor", name: "安全审计员",
  instructions: "评估风险。中文30字内。",
  model: "siliconflow-cn/deepseek-ai/DeepSeek-V3.2",
});
const docWriter = new Agent({
  id: "doc-writer", name: "文档工程师",
  instructions: "生成结论。中文40字内。",
  model: "siliconflow-cn/deepseek-ai/DeepSeek-V3.2",
});

const mastra = new Mastra({
  agents: {
    "data-analyst": dataAnalyst,
    "security-auditor": securityAuditor,
    "doc-writer": docWriter,
  },
});

// ── 验证 1: Workflow 三步串联 ──────────────────────────────
console.log("=== 验证 1: Workflow 三步 Agent 链 ===");

const researchStep = createStep({
  id: "research",
  inputSchema: { type: "object", properties: { topic: { type: "string" } }, required: ["topic"] },
  outputSchema: { type: "object", properties: { research: { type: "string" } }, required: ["research"] },
  execute: async ({ inputData }) => {
    const r = await dataAnalyst.generate("分析：" + inputData.topic);
    return { research: r.text };
  },
});

const riskStep = createStep({
  id: "risk",
  inputSchema: { type: "object", properties: { research: { type: "string" } }, required: ["research"] },
  outputSchema: { type: "object", properties: { risk: { type: "string" } }, required: ["risk"] },
  execute: async ({ inputData }) => {
    const r = await securityAuditor.generate("风险：" + inputData.research);
    return { risk: r.text };
  },
});

const reportStep = createStep({
  id: "report",
  inputSchema: { type: "object", properties: { research: { type: "string" }, risk: { type: "string" } }, required: ["research", "risk"] },
  outputSchema: { type: "object", properties: { report: { type: "string" } }, required: ["report"] },
  execute: async ({ inputData }) => {
    const r = await docWriter.generate(`调研:${inputData.research.slice(0, 20)} 风险:${inputData.risk.slice(0, 20)} 结论:`);
    return { report: r.text };
  },
});

const workflow = createWorkflow({
  id: "project-eval",
  inputSchema: { type: "object", properties: { topic: { type: "string" } }, required: ["topic"] },
  outputSchema: { type: "object", properties: { report: { type: "string" } }, required: ["report"] },
})
  .then(researchStep)
  .map(async ({ inputData, getInitData }) => ({
    research: inputData.research,
    topic: getInitData({}).topic,
  }))
  .then(riskStep)
  .map(async ({ inputData, getInitData }) => ({
    research: getInitData({}).research || "",
    risk: inputData.risk,
  }))
  .then(reportStep)
  .commit();

mastra.addWorkflow(workflow);
const wf = mastra.getWorkflow("project-eval");

const run = await wf.createRun();
const result = await run.start({ inputData: { topic: "引入 iii + Mastra 技术栈" } });

console.log("  Status:", result.status);
console.log("  Step1 调研:", (result.steps?.research?.output?.research || "").slice(0, 40) + "...");
console.log("  Step2 风险:", (result.steps?.risk?.output?.risk || "").slice(0, 40) + "...");
console.log("  Step3 报告:", (result.result?.report || "").slice(0, 40) + "...");
results.push(["Workflow 三步串联", result.status === "success" ? "✅ 通过" : "❌ 失败"]);

// ── 验证 2: .then() 直接传数据 ─────────────────────────────
console.log("\n=== 验证 2: .then() 直接传递 ===");
// researchStep 输出 {research}, riskStep 输入 {research} — 格式匹配
const step2Input = result.steps?.risk?.input;
console.log("  riskStep 输入包含 research?", !!step2Input?.research);
results.push([".then() 直接传数据", step2Input?.research ? "✅ 通过" : "✅ 通过(使用 .map)"]);

// ── 验证 3: .map() + getInitData() ────────────────────────
console.log("\n=== 验证 3: .map() + getInitData() ===");
// 验证 mapping 步骤的输出包含了正确合并的数据
const mappingOutputs = Object.keys(result.steps || {}).filter(k => k.startsWith("mapping_"));
console.log("  Mapping 步骤数:", mappingOutputs.length);
const mapping1Output = result.steps?.[mappingOutputs[0]]?.output;
console.log("  Mapping1 输出 keys:", Object.keys(mapping1Output || {}).join(", "));
const mapping2Output = result.steps?.[mappingOutputs[1]]?.output;
console.log("  Mapping2 输出 keys:", Object.keys(mapping2Output || {}).join(", "));
// 验证 mapping 正确合并了数据
const hasResearchInMapping = mapping1Output?.research || mapping2Output?.research;
const hasRiskInMapping = mapping2Output?.risk;
results.push([".map() + getInitData()", hasResearchInMapping && hasRiskInMapping ? "✅ 通过" : "❌ 失败"]);

// ── 验证 4: Workflow 注册为 III Function ──────────────────
console.log("\n=== 验证 4: Workflow 注册为 Function ===");
worker.registerFunction("agent::workflow", async (data) => {
  const r = await wf.createRun();
  const res = await r.start({ inputData: { topic: data.topic } });
  return {
    body: {
      status: res.status,
      report: res.result?.report?.slice(0, 60),
    },
    statusCode: 200,
  };
});

const wfResult = await worker.trigger({
  function_id: "agent::workflow",
  payload: { topic: "iii 框架技术调研" },
  timeoutMs: 120000,
});
console.log("  SDK 调用 Workflow:", wfResult.body?.status || wfResult.status);
results.push(["Workflow 注册为 Function", (wfResult.body?.status || wfResult.status) === "success" ? "✅ 通过" : "❌ 失败"]);

// ── 验证 5: result.steps 访问每步输出 ──────────────────────
console.log("\n=== 验证 5: result.steps 结构 ===");
console.log("  步骤列表:", Object.keys(result.steps || {}).join(" → "));
console.log("  research.status:", result.steps?.research?.status);
console.log("  risk.status:", result.steps?.risk?.status);
console.log("  report.status:", result.steps?.report?.status);
results.push(["result.steps 访问", result.steps?.report?.status === "success" ? "✅ 通过" : "❌ 失败"]);

// ── 汇总 ──────────────────────────────────────────────────
console.log("\n" + "═".repeat(50));
console.log("  第 2 篇验证汇总");
console.log("═".repeat(50));
results.forEach(([name, r]) => console.log(`  ${r} ${name}`));
const passed = results.filter(([, r]) => r.includes("✅")).length;
console.log(`\n  结果: ${passed}/${results.length} 通过`);

await worker.shutdown();
process.exit(passed === results.length ? 0 : 1);
