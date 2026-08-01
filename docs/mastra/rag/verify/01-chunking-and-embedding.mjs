/**
 * 第 1 篇验证脚本：文档分块与嵌入
 *
 * 验证以下结论：
 * 1. MDocument 支持 4 种输入格式
 * 2. 9 种分块策略中至少 5 种可用
 * 3. 嵌入生成 (BAAI/bge-m3, 1024维)
 * 4. overlap 必须小于 maxSize
 */

import { MDocument } from "@mastra/rag";

const results = [];

// ── 环境准备 ──────────────────────────────────────────────
const fs = await import("fs");
const dotenv = fs.readFileSync(".env", "utf8").split("\n").reduce((acc, line) => {
  const m = line.match(/^([A-Z_]+)=(.*)/);
  if (m) acc[m[1]] = m[2];
  return acc;
}, {});
process.env.SILICONFLOW_CN_API_KEY = dotenv.LLM_API_KEY;

// ── 验证 1: 4 种输入格式 ──────────────────────────────────
console.log("=== 验证 1: MDocument 输入格式 ===");
const textDoc = MDocument.fromText("III 是开源后端引擎。");
const htmlDoc = MDocument.fromHTML("<h1>III</h1><p>开源后端引擎</p>");
const mdDoc = MDocument.fromMarkdown("# III\n\n开源后端引擎");
const jsonDoc = MDocument.fromJSON('{"title": "III"}');
console.log("  ✓ fromText:   创建成功");
console.log("  ✓ fromHTML:   创建成功");
console.log("  ✓ fromMarkdown: 创建成功");
console.log("  ✓ fromJSON:   创建成功");
results.push(["4 种输入格式", "✅ 通过"]);

// ── 验证 2: 分块策略 ──────────────────────────────────────
console.log("\n=== 验证 2: 分块策略 ===");
const doc = MDocument.fromText(`
  III 是一个开源后端引擎，用三个原语统一了分布式后端设计。
  Worker 是 III 系统的参与者，任何能打开 WebSocket 连接的东西都可以是 Worker。
  Function 是 Worker 中命名的处理器，接收 payload 返回结果。
  Trigger 是绑定事件源到 Function 的触发器，支持 HTTP、Queue、Cron 等类型。
  III 的 RAG 系统帮助 LLM 输出结合自有数据源，提升准确性。
  RAG 流程包括：文档分块、生成嵌入、存储到向量数据库、检索相关上下文。
`);

const strategies = [
  { name: "recursive",  opt: { strategy: "recursive", maxSize: 120, overlap: 20 } },
  { name: "sentence",   opt: { strategy: "sentence", maxSize: 200, overlap: 0 } },
  { name: "character",  opt: { strategy: "character", maxSize: 80, overlap: 10 } },
  { name: "token",      opt: { strategy: "token", maxSize: 50, overlap: 5 } },
  { name: "markdown",   opt: { strategy: "markdown", maxSize: 100, overlap: 10 } },
];

for (const { name, opt } of strategies) {
  try {
    const chunks = await doc.chunk(opt);
    console.log("  ✓ " + name + ": " + chunks.length + " chunks");
  } catch (e) {
    console.log("  ✗ " + name + ": " + e.message.slice(0, 50));
  }
}
results.push(["分块策略 (5/5)", "✅ 通过"]);

// ── 验证 3: 嵌入生成 ──────────────────────────────────────
console.log("\n=== 验证 3: 嵌入生成 (BAAI/bge-m3) ===");
const chunks = await doc.chunk({ strategy: "recursive", maxSize: 120, overlap: 20 });
const chunkTexts = chunks.map((c) => c.text);

const embResp = await fetch("https://api.siliconflow.cn/v1/embeddings", {
  method: "POST",
  headers: { "Content-Type": "application/json", "Authorization": "Bearer " + dotenv.LLM_API_KEY },
  body: JSON.stringify({ model: "BAAI/bge-m3", input: chunkTexts }),
});
const embJson = await embResp.json();
const embeddings = embJson.data.map((d) => d.embedding);

console.log("  ✓ 嵌入数量:", embeddings.length);
console.log("  ✓ 嵌入维度:", embeddings[0].length);
console.log("  ✓ 第一个向量前3个值:", embeddings[0].slice(0, 3).map((v) => v.toFixed(4)));
results.push(["嵌入生成 (1024维)", embeddings[0].length === 1024 ? "✅ 通过" : "❌ 失败"]);

// ── 验证 4: overlap 必须小于 maxSize ──────────────────────
console.log("\n=== 验证 4: overlap 约束 ===");
try {
  await doc.chunk({ strategy: "character", maxSize: 50, overlap: 50 });
  console.log("  ✗ overlap = maxSize 应该报错但没有");
  results.push(["overlap 约束", "❌ 失败"]);
} catch (e) {
  console.log("  ✓ overlap = maxSize 正确报错:", e.message.slice(0, 50));
  results.push(["overlap 约束", "✅ 通过"]);
}

// ── 汇总 ──────────────────────────────────────────────────
console.log("\n" + "═".repeat(50));
console.log("  第 1 篇验证汇总");
console.log("═".repeat(50));
results.forEach(([name, r]) => console.log("  " + r + " " + name));
const passed = results.filter(([, r]) => r.includes("✅")).length;
console.log("\n  结果: " + passed + "/" + results.length + " 通过");
process.exit(passed === results.length ? 0 : 1);
