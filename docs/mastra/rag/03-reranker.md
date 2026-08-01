# 重排序 — Reranker 精炼

> **目标读者**：已掌握向量检索的实习生
> **阅读时间**：15 分钟
> **验证代码**：[verify/03-reranker.mjs](./verify/03-reranker.mjs)

---

## 一句话结论

**BAAI/bge-reranker-v2-m3 对向量检索结果重排序，用更精确的相关性评分替换粗粒度的余弦相似度，显著提升 RAG 质量。**

---

## 为什么需要重排序？

向量检索用余弦相似度快速找到候选，但它是"粗筛"：

```
向量检索 (快但粗)    重排序 (慢但精)
────────────────    ────────────────
余弦相似度          交叉注意力
只看向量距离        理解词序和精确匹配
topK=10 候选        topK=3 精确结果
毫秒级             百毫秒级
```

**两阶段检索**：先用向量检索快速召回候选，再用重排序精确打分。

---

## 1. 重排序 API（硅基流动）

```javascript
const response = await fetch("https://api.siliconflow.cn/v1/rerank", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": "Bearer " + process.env.SILICONFLOW_CN_API_KEY,
  },
  body: JSON.stringify({
    model: "BAAI/bge-reranker-v2-m3",
    query: "III 的 Function 是什么？",
    documents: [
      "Function 是 Worker 中命名的处理器",
      "III 是开源后端引擎",
      "Python 是编程语言",
      "Trigger 绑定事件源到 Function",
    ],
    top_n: 3,
  }),
});
const { results } = await response.json();
// results: [{ index: 0, relevance_score: 0.9473 }, ...]
```

> **验证结果**：
> ```
> 模型: BAAI/bge-reranker-v2-m3
> #1 index: 0 score: 0.9473 → "Function 是 Worker 中命名的处理器"
> #2 index: 3 score: 0.5093 → "Trigger 绑定事件源到 Function"
> #3 index: 1 score: 0.0034 → "III 是开源后端引擎"
> ```

---

## 2. 对比：检索 vs 重排序

| 维度 | 向量检索 | 重排序 |
|------|---------|--------|
| 算法 | 余弦相似度 | 交叉注意力 |
| 速度 | 快 (ms) | 较慢 (100ms) |
| 精度 | 中等 | 高 |
| 用途 | 召回候选 | 精炼排序 |
| 成本 | 低 | 中等 |

> **验证结果**（同一查询对比）：
> ```
> 向量检索 Top 3:           重排序 Top 3:
> #1 score: 0.6364         #1 score: 0.9473 (Function)
> #2 score: 0.5619         #2 score: 0.5093 (Trigger)
> #3 score: 0.4256         #3 score: 0.0034 (III)
>
> ✓ 重排序让正确答案 (#1) 的分数更高，排序更合理
> ```

---

## 3. 两阶段检索流程

```javascript
// Phase 1: 向量检索召回 (快)
const candidates = await vectorStore.query({
  queryVector,
  topK: 10,  // 召回更多候选
});

// Phase 2: 重排序精炼 (精)
const rerankResp = await fetch("https://api.siliconflow.cn/v1/rerank", {
  method: "POST",
  headers: { "Content-Type": "application/json", "Authorization": "Bearer " + apiKey },
  body: JSON.stringify({
    model: "BAAI/bge-reranker-v2-m3",
    query: userQuery,
    documents: candidates.map((c) => c.text),
    topK: 3,  // 最终只保留 Top 3
  }),
});
const { results: reranked } = await rerankResp.json();

// 按重排序结果重组
const finalResults = reranked.map((r) => ({
  text: candidates[r.index].text,
  relevance: r.relevance_score,
}));
```

> **验证结果**：
> ```
> Phase 1 召回: 10 个候选
> Phase 2 精炼: 3 个精确结果
> ✓ 两阶段检索兼顾速度和精度
> ```

---

## 4. 重排序模型选择

| 模型 | 来源 | 特点 |
|------|------|------|
| BAAI/bge-reranker-v2-m3 | 硅基流动 | 多语言、高精度 |
| Qwen/Qwen3-Reranker-8B | 硅基流动 | 大模型重排序 |
| Cohere rerank-v3.5 | Cohere | 英语优化 |
| ZeroEntropy zerank-1 | ZeroEntropy | 快速 |

---

## 常见踩坑

| 问题 | 原因 | 解决 |
|------|------|------|
| document 字段为 null | SiliconFlow 返回格式 | 用 index 从原文档数组取 |
| 重排序后顺序变了 | 正常行为 | 按 reranked[index] 取值 |
| 分数都很低 | 查询与文档不相关 | 检查查询质量 |
| topN > 文档数 | 超出范围 | topN ≤ documents.length |

---

## 下一步

- [第 4 篇：RAG 完整流水线](./04-full-pipeline.md)
- [返回系列目录](./README.md)
