# RAG 完整流水线

> **目标读者**：已掌握分块、检索、重排序的实习生
> **阅读时间**：20 分钟
> **验证代码**：[verify/04-full-pipeline.mjs](./verify/04-full-pipeline.mjs)

---

## 一句话结论

**分块 → 嵌入 → 存储 → 检索 → 重排序 → 生成 = 完整的 RAG 端到端流水线。**

---

## 流水线全景

```
┌─────────────────────────────────────────────────────────────────────┐
│                         RAG 完整流水线                               │
│                                                                     │
│  离线阶段 (一次性)                                                   │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ 原始文档 → MDocument → chunk() → embedMany() → 向量存储     │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                              │                                      │
│                              ▼                                      │
│  在线阶段 (每次查询)                                                 │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ 用户查询 → embed() → 向量检索(topK=10) → 重排序(topK=3)    │  │
│  │ → 构建 prompt → LLM 生成 → 返回答案                         │  │
│  └──────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 1. 离线阶段：索引构建

```javascript
import { MDocument } from "@mastra/rag";
import { registerWorker } from "iii-sdk";

const worker = registerWorker("ws://localhost:49134", { workerName: "rag-pipeline" });

// 1.1 加载文档
const doc = MDocument.fromText(`
  III 是一个开源后端引擎，用三个原语统一了分布式后端设计。
  Worker 是 III 系统的参与者，任何能打开 WebSocket 连接的东西都可以是 Worker。
  Function 是 Worker 中命名的处理器，接收 payload 返回结果。
  Trigger 是绑定事件源到 Function 的触发器，支持 HTTP、Queue、Cron 等类型。
  Mastra 是 TypeScript AI Agent 框架，支持 Workflow 和 RAG。
  RAG 流程包括分块、嵌入、存储、检索、重排序。
`);

// 1.2 分块
const chunks = await doc.chunk({ strategy: "recursive", maxSize: 120, overlap: 20 });

// 1.3 生成嵌入
const chunkTexts = chunks.map((c) => c.text);
const embResp = await fetch("https://api.siliconflow.cn/v1/embeddings", {
  method: "POST",
  headers: { "Content-Type": "application/json", "Authorization": "Bearer " + apiKey },
  body: JSON.stringify({ model: "BAAI/bge-m3", input: chunkTexts }),
});
const embeddings = (await embResp.json()).data.map((d) => d.embedding);

// 1.4 存储到 iii State (生产环境用 PgVector/Pinecone)
await worker.trigger({
  function_id: "state::set",
  payload: { scope: "rag-knowledge", index: "docs", value: { vectors: embeddings, texts: chunkTexts } },
});
```

> **验证结果**：
> ```
> ✓ 文档分块: 4 chunks
> ✓ 嵌入生成: 4 个 1024 维向量
> ✓ 存储成功: iii State scope=rag-knowledge
> ```

---

## 2. 在线阶段：查询与生成

```javascript
// 2.1 获取查询嵌入
const query = "III 的 Function 是什么？";
const [queryVector] = await embed(query);

// 2.2 从存储读取向量
const stored = await worker.trigger({
  function_id: "state::get",
  payload: { scope: "rag-knowledge", index: "docs" },
});

// 2.3 向量检索 (召回 topK=10)
const candidates = stored.vectors
  .map((vec, i) => ({ text: stored.texts[i], score: cosineSimilarity(queryVector, vec) }))
  .sort((a, b) => b.score - a.score)
  .slice(0, 10);

// 2.4 重排序 (精炼 topK=3)
const reranked = await rerank(query, candidates.map((c) => c.text), 3);

// 2.5 构建上下文
const context = reranked.map((r) => candidates[r.index].text).join("\n");

// 2.6 构建 prompt
const prompt = `基于以下上下文回答问题：

上下文：
${context}

问题：${query}
回答：`;

// 2.7 LLM 生成
const answer = await llm.generate(prompt);
```

> **验证结果**：
> ```
> ✓ 查询嵌入: 1024 维
> ✓ 召回: 4 个候选
> ✓ 精炼: 3 个精确结果
> ✓ 上下文构建: 完成
> ✓ LLM 生成: "Function 是 Worker 中命名的处理器..."
> ```

---

## 3. 封装为 iii Function

```javascript
worker.registerFunction("rag::query", async (data) => {
  const { query, topK = 3 } = data;

  // 检索
  const [queryVec] = await embed(query);
  const stored = await worker.trigger({ function_id: "state::get", payload: { scope: "rag-knowledge", index: "docs" } });
  const candidates = stored.vectors
    .map((vec, i) => ({ text: stored.texts[i], score: cosineSimilarity(queryVec, vec) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  // 重排序
  const reranked = await rerank(query, candidates.map((c) => c.text), topK);

  // 构建上下文
  const context = reranked.map((r) => candidates[r.index].text).join("\n");

  return {
    body: {
      query,
      context,
      sources: reranked.map((r) => ({ text: candidates[r.index].text, score: r.relevance_score })),
    },
    statusCode: 200,
  };
});
```

> **验证结果**：
> ```
> ✓ rag::query 注册成功
> ✓ SDK 调用返回上下文 + 来源
> ✓ HTTP 调用 status: 200
> ```

---

## 4. 性能指标

| 阶段 | 耗时 | 说明 |
|------|------|------|
| 分块 | < 10ms | 纯文本处理 |
| 嵌入 | 200-500ms | API 调用 |
| 检索 | < 5ms | 内存计算 |
| 重排序 | 100-300ms | API 调用 |
| LLM 生成 | 1-3s | API 调用 |
| **总计** | **1.5-4s** | 端到端 |

> **验证结果**：
> ```
> 分块: 2ms
> 嵌入: 350ms
> 检索: 1ms
> 重排序: 180ms
> LLM: 1200ms
> 总计: ~1.7s
> ```

---

## 常见踩坑

| 问题 | 原因 | 解决 |
|------|------|------|
| 答案不相关 | 检索结果质量差 | 增大召回 topK + 重排序 |
| 上下文太长 | chunk 太大 | 减小 maxSize |
| 上下文断裂 | overlap = 0 | 设置 overlap = 10-20% |
| 响应慢 | 每步串行 | 并行执行嵌入和检索 |

---

## 下一步

- [第 5 篇：GraphRAG 图谱增强](./05-graph-rag.md)
- [返回系列目录](./README.md)
