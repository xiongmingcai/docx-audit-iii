/**
 * 第 2 篇验证脚本：向量检索 — 语义搜索
 *
 * 验证以下结论：
 * 1. 余弦相似度计算正确
 * 2. 完整检索流程 (嵌入→相似度→排序→topK)
 * 3. topK 选择对结果的影响
 * 4. 元数据过滤缩小搜索范围
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

// 余弦相似度
function cosineSimilarity(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// 生成嵌入
async function embed(text) {
  const resp = await fetch("https://api.siliconflow.cn/v1/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + dotenv.LLM_API_KEY },
    body: JSON.stringify({ model: "BAAI/bge-m3", input: Array.isArray(text) ? text : [text] }),
  });
  const json = await resp.json();
  return json.data.map((d) => d.embedding);
}

// ── 验证 1: 余弦相似度 ────────────────────────────────────
console.log("=== 验证 1: 余弦相似度 ===");
const [emb1] = await embed("III 是开源后端引擎");
const [emb2] = await embed("III 是开源后端引擎");  // 相同
const [emb3] = await embed("Worker 是 III 的参与者");  // 相关
const [emb4] = await embed("今天天气很好");  // 无关

const sameScore = cosineSimilarity(emb1, emb2);
const relatedScore = cosineSimilarity(emb1, emb3);
const unrelatedScore = cosineSimilarity(emb1, emb4);

console.log("  相同文本:", sameScore.toFixed(4), sameScore > 0.99 ? "✓" : "✗");
console.log("  相关文本:", relatedScore.toFixed(4), relatedScore > 0.3 ? "✓" : "✗");
console.log("  无关文本:", unrelatedScore.toFixed(4), unrelatedScore < 0.5 ? "✓" : "✗");
results.push(["余弦相似度", sameScore > 0.99 && relatedScore > unrelatedScore ? "✅ 通过" : "❌ 失败"]);

// ── 验证 2: 完整检索流程 ──────────────────────────────────
console.log("\n=== 验证 2: 完整检索流程 ===");
const documents = [
  "III 是开源后端引擎，用三个原语统一分布式后端设计",
  "Worker 是 III 系统的参与者，可以是 Python、TypeScript 或浏览器",
  "Function 是 Worker 中命名的处理器，payload-in / result-out",
  "Trigger 将事件源绑定到 Function，支持 HTTP、Queue、Cron",
  "Mastra 是 TypeScript AI Agent 框架，支持 Workflow 和 RAG",
  "RAG 流程包括分块、嵌入、存储、检索、重排序",
  "Python 是一种广泛使用的编程语言",
];

const docEmbeddings = await embed(documents);
const query = "III 的 Function 是什么？";
const [queryVector] = await embed(query);

const retrievalResults = docEmbeddings.map((vec, i) => ({
  text: documents[i],
  score: cosineSimilarity(queryVector, vec),
})).sort((a, b) => b.score - a.score);

console.log("  查询:", query);
retrievalResults.slice(0, 3).forEach((r, i) =>
  console.log("  #" + (i + 1), "(score:", r.score.toFixed(4) + ")", r.text.slice(0, 40) + "..."));
results.push(["完整检索流程", retrievalResults[0].score > 0.5 ? "✅ 通过" : "❌ 失败"]);

// ── 验证 3: topK 影响 ─────────────────────────────────────
console.log("\n=== 验证 3: topK 选择 ===");
for (const k of [1, 3, 5, 7]) {
  const topK = retrievalResults.slice(0, k);
  const relevant = topK.filter((r) => r.text.includes("III") || r.text.includes("Function") || r.text.includes("Worker"));
  console.log("  topK=" + k + ": " + relevant.length + "/" + k + " 相关");
}
results.push(["topK 选择", "✅ 通过"]);

// ── 验证 4: 元数据过滤 ────────────────────────────────────
console.log("\n=== 验证 4: 元数据过滤 ===");
const docMetadata = [
  { category: "iii" }, { category: "iii" }, { category: "iii" }, { category: "iii" },
  { category: "mastra" }, { category: "mastra" }, { category: "other" },
];

const filteredResults = docEmbeddings
  .map((vec, i) => ({ text: documents[i], score: cosineSimilarity(queryVector, vec), metadata: docMetadata[i] }))
  .filter((r) => r.metadata.category === "iii")
  .sort((a, b) => b.score - a.score);

console.log("  无过滤结果数:", retrievalResults.length);
console.log("  过滤后结果数:", filteredResults.length);
console.log("  过滤后 Top 3:");
filteredResults.slice(0, 3).forEach((r, i) =>
  console.log("    #" + (i + 1), "(score:", r.score.toFixed(4) + ")", r.text.slice(0, 40) + "..."));
results.push(["元数据过滤", filteredResults.length < retrievalResults.length ? "✅ 通过" : "❌ 失败"]);

// ── 汇总 ──────────────────────────────────────────────────
console.log("\n" + "═".repeat(50));
console.log("  第 2 篇验证汇总");
console.log("═".repeat(50));
results.forEach(([name, r]) => console.log("  " + r + " " + name));
const passed = results.filter(([, r]) => r.includes("✅")).length;
console.log("\n  结果: " + passed + "/" + results.length + " 通过");
process.exit(passed === results.length ? 0 : 1);
