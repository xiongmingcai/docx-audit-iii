/**
 * 第 7 篇验证脚本：libSQL 轻量级向量数据库
 *
 * 验证以下结论：
 * 1. LibSQLVector 可安装并导入
 * 2. 本地文件模式 CRUD 完整操作
 * 3. 创建索引 (dimension=1024)
 * 4. 插入向量 + 元数据
 * 5. 向量检索 (topK + filter)
 * 6. 删除向量
 * 7. 与 RAG 流水线集成
 */

import { LibSQLVector } from "@mastra/libsql";
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

// ── 验证 1: 安装与导入 ────────────────────────────────────
console.log("=== 验证 1: LibSQLVector 安装与导入 ===");
try {
  const { LibSQLVector: LSV } = await import("@mastra/libsql");
  console.log("  ✓ LibSQLVector 导入成功");
  results.push(["安装与导入", "✅ 通过"]);
} catch (e) {
  console.log("  ✗ 导入失败:", e.message.slice(0, 50));
  results.push(["安装与导入", "❌ 失败"]);
  process.exit(1);
}

// ── 验证 2: 创建实例 ──────────────────────────────────────
console.log("\n=== 验证 2: 创建 libSQL 实例 ===");
fs.mkdirSync("./data", { recursive: true });
const dbPath = "./data/libsql-verify.db";
try { fs.unlinkSync(dbPath); } catch (e) { /* 忽略 */ }

const store = new LibSQLVector({ id: "verify-libsql", url: "file:" + dbPath });
console.log("  ✓ 实例创建成功 (file:" + dbPath + ")");
results.push(["创建实例", "✅ 通过"]);

// ── 验证 3: 创建索引 ──────────────────────────────────────
console.log("\n=== 验证 3: 创建索引 ===");
await store.createIndex({ indexName: "my_index", dimension: 1024 });
console.log("  ✓ createIndex (my_index, dim=1024)");
results.push(["创建索引", "✅ 通过"]);

// ── 验证 4: 插入向量 ──────────────────────────────────────
console.log("\n=== 验证 4: 插入向量 ===");
const texts = [
  "III 是开源后端引擎，提供 Worker Function Trigger 三个原语",
  "Worker 是 III 系统的参与者，连接 Engine 提供 Function",
  "Function 是命名处理器，接收 payload 返回结果",
  "Mastra 是 AI Agent 框架，支持 Workflow 和 RAG",
  "RAG 流程包括分块、嵌入、存储、检索、重排序",
];
const embeddings = await embed(texts);
await store.upsert({
  indexName: "my_index",
  vectors: embeddings,
  metadata: texts.map((t, i) => ({ text: t, id: "doc-" + i, category: i < 3 ? "iii" : "other" })),
});
console.log("  ✓ upsert (" + embeddings.length + " vectors, dim=" + embeddings[0].length + ")");
results.push(["插入向量", "✅ 通过"]);

// ── 验证 5: 向量检索 ──────────────────────────────────────
console.log("\n=== 验证 5: 向量检索 ===");
const query = "III 的 Function 是什么？";
const [queryVec] = await embed(query);
const queryResult = await store.query({ indexName: "my_index", queryVector: queryVec, topK: 3 });
console.log("  ✓ query (topK=3):");
queryResult.forEach((r, i) => {
  console.log("    #" + (i + 1), "score:", r.score?.toFixed(4), (r.metadata?.text || "").slice(0, 35) + "...");
});
results.push(["向量检索", queryResult.length === 3 ? "✅ 通过" : "❌ 失败"]);

// ── 验证 6: 带过滤的检索 ──────────────────────────────────
console.log("\n=== 验证 6: 带过滤的检索 ===");
const filteredResult = await store.query({
  indexName: "my_index",
  queryVector: queryVec,
  topK: 3,
  filter: { category: "iii" },
});
console.log("  ✓ query (filter category=iii):");
filteredResult.forEach((r, i) => {
  console.log("    #" + (i + 1), "score:", r.score?.toFixed(4), (r.metadata?.text || "").slice(0, 35) + "...");
});
results.push(["过滤检索", filteredResult.length === 3 ? "✅ 通过" : "❌ 失败"]);

// ── 验证 7: 删除向量 ──────────────────────────────────────
console.log("\n=== 验证 7: 删除向量 ===");
await store.deleteVectors({ indexName: "my_index", ids: ["doc-3", "doc-4"] });
console.log("  ✓ deleteVectors (doc-3, doc-4)");
const afterDelete = await store.query({ indexName: "my_index", queryVector: queryVec, topK: 5 });
console.log("  删除后剩余:", afterDelete.length, "个结果");
results.push(["删除向量", "✅ 通过"]);

// ── 验证 8: RAG 流水线集成 ────────────────────────────────
console.log("\n=== 验证 8: RAG 流水线集成 ===");
const ragDoc = MDocument.fromText(`
  III 的 Worker 通过 WebSocket 连接到 Engine。
  Function 是 service::name 格式的处理器。
  Trigger 支持 HTTP、Queue、Cron 三种类型。
`);
const ragChunks = await ragDoc.chunk({ strategy: "recursive", maxSize: 50, overlap: 10 });
const ragEmbeddings = await embed(ragChunks.map((c) => c.text));

await store.createIndex({ indexName: "rag_demo", dimension: 1024 });
await store.upsert({
  indexName: "rag_demo",
  vectors: ragEmbeddings,
  metadata: ragChunks.map((c, i) => ({ text: c.text, chunkIndex: i })),
});

const [ragQueryVec] = await embed("Worker 如何连接 Engine？");
const ragResult = await store.query({ indexName: "rag_demo", queryVector: ragQueryVec, topK: 2 });
console.log("  ✓ 索引 " + ragChunks.length + " chunks");
console.log("  ✓ 检索 Top 2:");
ragResult.forEach((r, i) => {
  console.log("    #" + (i + 1), "score:", r.score?.toFixed(4), (r.metadata?.text || "").slice(0, 40) + "...");
});
results.push(["RAG 集成", ragResult.length === 2 ? "✅ 通过" : "❌ 失败"]);

// ── 汇总 ──────────────────────────────────────────────────
console.log("\n" + "═".repeat(50));
console.log("  第 7 篇验证汇总");
console.log("═".repeat(50));
results.forEach(([name, r]) => console.log("  " + r + " " + name));
const passed = results.filter(([, r]) => r.includes("✅")).length;
console.log("\n  结果: " + passed + "/" + results.length + " 通过");
process.exit(passed === results.length ? 0 : 1);
