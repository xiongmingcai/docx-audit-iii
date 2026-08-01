# GraphRAG — 图谱增强检索

> **目标读者**：已掌握完整 RAG 流水线的实习生
> **阅读时间**：15 分钟
> **验证代码**：[verify/05-graph-rag.mjs](./verify/05-graph-rag.mjs)

---

## 一句话结论

**GraphRAG 在向量检索基础上增加图谱遍历，发现跨文档的隐藏关联——当答案分散在多个文档中时，比纯向量检索更有效。**

---

## 什么时候用 GraphRAG？

```
纯向量检索 (语义相似)     GraphRAG (语义 + 关联)
────────────────────     ────────────────────────
"III 的 Function 是什么"  "III 和 Mastra 如何配合？"
  → 单文档可回答           → 需要跨文档推理
  → 找最相似的 chunk       → 找关联的 chunks 网络
```

| 场景 | 推荐方式 |
|------|---------|
| 简单事实查询 | 向量检索 |
| 单文档内检索 | 向量检索 |
| **跨文档关联** | **GraphRAG** |
| **概念关系推理** | **GraphRAG** |
| 引用链追踪 | GraphRAG |

---

## 1. GraphRAG 工作原理

```
Step 1: 向量检索召回候选
  query → embed → topK=10 候选 chunks

Step 2: 构建知识图谱
  chunk A ←→ chunk B  (相似度 > threshold)
  chunk B ←→ chunk C
  chunk A ←→ chunk D

Step 3: 图谱遍历
  从最相关的 chunk 出发，沿边遍历
  发现间接关联的 chunk

Step 4: 返回结果
  直接相关 + 间接关联的 chunks
```

> **验证结果**：
> ```
> 向量检索: 找到 3 个直接相关 chunk
> GraphRAG: 找到 3 个直接 + 2 个间接关联 chunk
> ✓ GraphRAG 多发现 2 个隐藏关联
> ```

---

## 2. 核心 API

```javascript
import { createGraphRAGTool } from "@mastra/rag";
import { ModelRouterEmbeddingModel } from "@mastra/core/llm";

const graphQueryTool = createGraphRAGTool({
  vectorStoreName: "pgVector",
  indexName: "embeddings",
  model: new ModelRouterEmbeddingModel("siliconflow-cn/BAAI/bge-m3"),
  graphOptions: {
    threshold: 0.7,   // 相似度阈值
    dimension: 1024,  // 嵌入维度
  },
});
```

### 配置参数

| 参数 | 作用 | 推荐值 |
|------|------|--------|
| `threshold` | 图谱边连接的相似度阈值 | 0.6-0.8 |
| `dimension` | 嵌入维度 | 与模型一致 (BAAI/bge-m3 = 1024) |

### Threshold 调优

```
threshold = 0.9  ──→  只有强关联才连接 (稀疏图，精确)
threshold = 0.7  ──→  平衡 (推荐起始值)
threshold = 0.5  ──→  弱关联也连接 (稠密图，覆盖广)
```

> **验证结果**：
> ```
> threshold=0.9: 2 条边 (极少关联)
> threshold=0.7: 5 条边 (平衡)
> threshold=0.5: 8 条边 (较多关联)
> ```

---

## 3. 与 Agent 集成

```javascript
import { Agent } from "@mastra/core/agent";

const ragAgent = new Agent({
  id: "graph-rag-agent",
  name: "GraphRAG Agent",
  instructions: `你是一个知识助手。使用 graphQueryTool 查询相关信息。
当问题涉及多个概念之间的关系时，特别需要使用图谱检索。`,
  model: "siliconflow-cn/deepseek-ai/DeepSeek-V3.2",
  tools: { graphQueryTool },
});
```

---

## 4. 图谱构建验证

```javascript
// 模拟图谱构建过程
function buildGraph(chunks, threshold) {
  const graph = {};
  for (let i = 0; i < chunks.length; i++) {
    graph[i] = [];
    for (let j = 0; j < chunks.length; j++) {
      if (i !== j) {
        const sim = cosineSimilarity(chunks[i].vector, chunks[j].vector);
        if (sim > threshold) {
          graph[i].push({ node: j, weight: sim });
        }
      }
    }
  }
  return graph;
}

// 图谱遍历 (BFS)
function traverseGraph(graph, startNode, depth = 2) {
  const visited = new Set();
  const queue = [{ node: startNode, depth: 0 }];
  const results = [];

  while (queue.length > 0) {
    const { node, depth } = queue.shift();
    if (visited.has(node) || depth > 2) continue;
    visited.add(node);
    results.push(node);

    for (const edge of graph[node] || []) {
      if (!visited.has(edge.node)) {
        queue.push({ node: edge.node, depth: depth + 1 });
      }
    }
  }
  return results;
}
```

> **验证结果**：
> ```
> 图谱节点数: 6
> 图谱边数 (threshold=0.7): 8 条
> 从节点 0 遍历可达: [0, 1, 2, 3, 4] (5 个节点)
> ✓ 图谱构建和遍历工作正常
> ```

---

## 5. GraphRAG vs 向量检索对比

| 维度 | 向量检索 | GraphRAG |
|------|---------|----------|
| 检索方式 | 语义相似度 | 相似度 + 图谱遍历 |
| 覆盖范围 | 直接相关 | 直接 + 间接关联 |
| 速度 | 快 | 稍慢 (多图谱构建) |
| 适用场景 | 简单查询 | 复杂关联推理 |
| 实现复杂度 | 低 | 中 |

> **验证结果**（同一查询 "III 和 Mastra 的关系"）：
> ```
> 向量检索: 找到 3 个直接相关 chunk
> GraphRAG:  找到 3 个直接 + 2 个间接关联 chunk
> ✓ GraphRAG 多发现 2 个隐藏关联
> ```

---

## 常见踩坑

| 问题 | 原因 | 解决 |
|------|------|------|
| 图谱太稠密 | threshold 太低 | 提高 threshold |
| 图谱太稀疏 | threshold 太高 | 降低 threshold |
| 遍历太深 | depth 太大 | 限制 depth ≤ 2 |
| 维度不匹配 | graphOptions.dimension ≠ 模型维度 | 设为一致 |

---

## 总结：RAG 系列回顾

| 篇 | 主题 | 核心能力 |
|---|------|---------|
| 1 | 分块与嵌入 | MDocument + 嵌入生成 |
| 2 | 向量检索 | 余弦相似度 + topK |
| 3 | 重排序 | BAAI/bge-reranker-v2-m3 |
| 4 | 完整流水线 | 端到端 RAG |
| 5 | GraphRAG | 图谱增强检索 |

---

## 下一步

- [返回系列目录](./README.md)
- [III + Mastra 基础系列](../README.md)
