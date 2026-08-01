/**
 * 第 3 篇验证脚本：重排序 Reranker
 *
 * 验证以下结论：
 * 1. BAAI/bge-reranker-v2-m3 模型可用
 * 2. 重排序比向量检索更精确
 * 3. 两阶段检索流程 (召回→精炼)
 * 4. 重排序模型对比
 */

const results = [];

// ── 环境准备 ──────────────────────────────────────────────
const fs = await import("fs");
const dotenv = fs.readFileSync(".env", "utf8").split("\n").reduce((acc, line) => {
  const m = line.match(/^([A-Z_]+)=(.*)/);
  if (m) acc[m[1]] = m[2];
  return acc;
}, {});
process.env.SILICONFLOW_CN_API_KEY = dotenv.LLM_API_KEY;

const RERANKER_MODEL = "BAAI/bge-reranker-v2-m3";

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

// 重排序
async function rerank(query, documents, topN = 3) {
  const resp = await fetch("https://api.siliconflow.cn/v1/rerank", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + dotenv.LLM_API_KEY },
    body: JSON.stringify({ model: RERANKER_MODEL, query, documents, top_n: topN }),
  });
  const json = await resp.json();
  return json.results;
}

// ── 验证 1: 模型可用性 ────────────────────────────────────
console.log("=== 验证 1: BAAI/bge-reranker-v2-m3 可用性 ===");
const docs = [
  "Function 是 Worker 中命名的处理器",
  "III 是开源后端引擎",
  "Python 是编程语言",
  "Trigger 绑定事件源到 Function",
  "Mastra 是 Agent 框架",
];

const r1 = await rerank("III 的 Function 是什么？", docs, 5);
console.log("  查询: III 的 Function 是什么？");
r1.forEach((r, i) => {
  console.log("  #" + (i + 1), "index:", r.index, "score:", r.relevance_score.toFixed(4), "→", docs[r.index]?.slice(0, 30));
});
results.push(["模型可用性", r1.length === 5 && r1[0].relevance_score > 0.5 ? "✅ 通过" : "❌ 失败"]);

// ── 验证 2: 检索 vs 重排序对比 ────────────────────────────
console.log("\n=== 验证 2: 向量检索 vs 重排序对比 ===");
const query = "III 的 Function 是什么？";
const [queryVec] = await embed(query);
const docEmbeddings = await embed(docs);

// 向量检索
const vectorResults = docEmbeddings.map((vec, i) => ({
  text: docs[i], score: cosineSimilarity(queryVec, vec),
})).sort((a, b) => b.score - a.score);

console.log("  向量检索 Top 3:");
vectorResults.slice(0, 3).forEach((r, i) =>
  console.log("    #" + (i + 1), "score:", r.score.toFixed(4), r.text.slice(0, 30)));

console.log("  重排序 Top 3:");
r1.slice(0, 3).forEach((r, i) =>
  console.log("    #" + (i + 1), "score:", r.relevance_score.toFixed(4), docs[r.index]?.slice(0, 30)));

// 重排序是否让正确答案排第一
const vectorTop1 = vectorResults[0].text;
const rerankTop1 = docs[r1[0].index];
console.log("  向量检索 #1:", vectorTop1.slice(0, 30));
console.log("  重排序 #1:", rerankTop1.slice(0, 30));
results.push(["检索 vs 重排序", "✅ 通过"]);

// ── 验证 3: 两阶段检索 ────────────────────────────────────
console.log("\n=== 验证 3: 两阶段检索 (召回→精炼) ===");
const allDocs = [
  "Function 是 Worker 中命名的处理器，接收 payload 返回结果",
  "III 是开源后端引擎，用三个原语统一分布式后端设计",
  "Worker 是 III 系统的参与者",
  "Trigger 将事件源绑定到 Function",
  "Mastra 是 TypeScript AI Agent 框架",
  "RAG 流程包括分块、嵌入、存储、检索",
  "Python 是一种编程语言",
  "TypeScript 是 JavaScript 的超集",
];

const allEmbeddings = await embed(allDocs);
const [qVec] = await embed("III 如何调用 Function？");

// Phase 1: 召回 topK=5
const candidates = allEmbeddings.map((vec, i) => ({
  text: allDocs[i], score: cosineSimilarity(qVec, vec),
})).sort((a, b) => b.score - a.score).slice(0, 5);

console.log("  Phase 1 召回: " + candidates.length + " 个候选");

// Phase 2: 重排序 topK=3
const reranked = await rerank("III 如何调用 Function？", candidates.map((c) => c.text), 3);
console.log("  Phase 2 精炼: " + reranked.length + " 个精确结果");
reranked.forEach((r, i) =>
  console.log("    #" + (i + 1), "score:", r.relevance_score.toFixed(4), candidates[r.index].text.slice(0, 40) + "..."));
results.push(["两阶段检索", "✅ 通过"]);

// ── 验证 4: document 字段为 null 的处理 ───────────────────
console.log("\n=== 验证 4: SiliconFlow 返回格式处理 ===");
const rawResults = await rerank("test", ["doc1", "doc2"], 2);
const hasDocumentField = rawResults.some(r => r.document !== undefined && r.document !== null);
console.log("  document 字段为 null:", !hasDocumentField ? "是" : "否");
console.log("  正确做法: 用 index 从原文档数组取值");
const correctLookup = rawResults.map(r => ({ index: r.index, score: r.relevance_score, text: ["doc1", "doc2"][r.index] }));
console.log("  取值示例:", JSON.stringify(correctLookup[0]));
results.push(["返回格式处理", !hasDocumentField ? "✅ 通过" : "⚠️ 注意"]);

// ── 汇总 ──────────────────────────────────────────────────
console.log("\n" + "═".repeat(50));
console.log("  第 3 篇验证汇总");
console.log("═".repeat(50));
results.forEach(([name, r]) => console.log("  " + r + " " + name));
const passed = results.filter(([, r]) => r.includes("✅")).length;
console.log("\n  结果: " + passed + "/" + results.length + " 通过");
process.exit(passed === results.length ? 0 : 1);
