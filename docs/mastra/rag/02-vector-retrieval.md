# 向量检索 — 语义搜索

> **目标读者**：已掌握文档分块的实习生
> **阅读时间**：15 分钟
> **验证代码**：[verify/02-vector-retrieval.mjs](./verify/02-vector-retrieval.mjs)

---

## 一句话结论

**余弦相似度 + topK 检索 = 基础 RAG 的核心——从向量数据库中找到与查询最相似的文本块。**

---

## 检索流程

```
用户查询
  ↓ embed(query)
查询向量 (1024维)
  ↓ cosineSimilarity(queryVector, docVector)
相似度分数 (0-1)
  ↓ sort by score descending
排序结果
  ↓ topK
Top K 相关文本块
```

---

## 1. 余弦相似度

余弦相似度衡量两个向量的方向是否一致：

```
cosine_similarity(A, B) = (A · B) / (||A|| × ||B||)

值域: [-1, 1]
  1.0 = 完全相同方向（语义最相似）
  0.0 = 正交（无关）
 -1.0 = 完全相反方向
```

```javascript
function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
```

> **验证结果**：
> ```
> ✓ 相同文本相似度: 1.0000
> ✓ 相关文本相似度: 0.6688
> ✓ 无关文本相似度: 0.3421
> ```

---

## 2. 完整检索流程

```javascript
import { MDocument } from "@mastra/rag";

// Step 1: 准备文档库
const documents = [
  "III 是开源后端引擎，用三个原语统一分布式后端设计",
  "Worker 是 III 系统的参与者，可以是 Python、TypeScript 或浏览器",
  "Function 是 Worker 中命名的处理器，payload-in / result-out",
  "Trigger 将事件源绑定到 Function，支持 HTTP、Queue、Cron",
  "Mastra 是 TypeScript AI Agent 框架，支持 Workflow 和 RAG",
  "RAG 流程包括分块、嵌入、存储、检索、重排序",
  "Python 是一种广泛使用的编程语言",
];

// Step 2: 生成文档嵌入
const docResp = await fetch("https://api.siliconflow.cn/v1/embeddings", {
  method: "POST",
  headers: { "Content-Type": "application/json", "Authorization": "Bearer " + apiKey },
  body: JSON.stringify({ model: "BAAI/bge-m3", input: documents }),
});
const docEmbeddings = (await docResp.json()).data.map((d) => d.embedding);

// Step 3: 查询嵌入
const query = "III 的 Function 是什么？";
const queryResp = await fetch("https://api.siliconflow.cn/v1/embeddings", {
  method: "POST",
  headers: { "Content-Type": "application/json", "Authorization": "Bearer " + apiKey },
  body: JSON.stringify({ model: "BAAI/bge-m3", input: query }),
});
const queryVector = (await queryResp.json()).data[0].embedding;

// Step 4: 计算相似度并排序
const results = docEmbeddings.map((vec, i) => ({
  text: documents[i],
  score: cosineSimilarity(queryVector, vec),
})).sort((a, b) => b.score - a.score);

// Step 5: 取 Top K
const topK = results.slice(0, 3);
```

> **验证结果**：
> ```
> 查询: "III 的 Function 是什么？"
> #1 (score: 0.7102) Function 是 Worker 中命名的处理器...
> #2 (score: 0.5432) III 是开源后端引擎...
> #3 (score: 0.4891) Trigger 将事件源绑定到 Function...
> ```

---

## 3. Top K 的选择

| topK | 优点 | 缺点 | 适用场景 |
|------|------|------|---------|
| 1-3 | 精确、省 token | 可能遗漏信息 | 简单事实查询 |
| 3-5 | 平衡 | 适中 | **推荐默认值** |
| 5-10 | 覆盖全面 | 噪声多、耗 token | 复杂推理 |
| 10+ | 最全面 | 大量噪声 | 研究/探索 |

> **验证结果**：
> ```
> topK=3: 3 个相关结果，0 个噪声
> topK=5: 4 个相关结果，1 个噪声
> ```

---

## 4. 元数据过滤

实际应用中，检索通常需要结合元数据过滤：

```javascript
// 带过滤的检索
const results = docEmbeddings
  .map((vec, i) => ({ text: documents[i], score: cosineSimilarity(queryVector, vec), metadata: docMetadata[i] }))
  .filter((r) => r.metadata.category === "iii")  // 只保留 III 相关文档
  .sort((a, b) => b.score - a.score)
  .slice(0, topK);
```

> **验证结果**：
> ```
> 无过滤: 7 个结果 (含 Python、Mastra 等无关内容)
> 过滤后: 4 个结果 (仅 III 相关)
> ✓ 元数据过滤有效缩小搜索范围
> ```

---

## 常见踩坑

| 问题 | 原因 | 解决 |
|------|------|------|
| 检索结果不相关 | 嵌入模型不适合领域 | 换领域专用模型 |
| 相似度都很低 | 查询和文档分布差异大 | 用 query expansion |
| topK 太小遗漏信息 | K 值不够 | 增大 K + 重排序 |
| 检索慢 | 向量库无索引 | 创建 ANN 索引 |

---

## 下一步

- [第 3 篇：重排序 Reranker](./03-reranker.md)
- [返回系列目录](./README.md)
