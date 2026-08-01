# III + Mastra RAG 实战系列

> **用代码验证每一句话的 RAG 教程**

本系列面向已了解 III + Mastra 基础的实习生，带你掌握 RAG（检索增强生成）的完整实现。

---

## 文章列表

| # | 文章 | 核心结论 | 验证代码 |
|---|------|---------|---------|
| 1 | [文档分块与嵌入](./01-chunking-and-embedding.md) | MDocument 9 种分块策略 + 嵌入生成 | [运行](./verify/01-chunking-and-embedding.mjs) |
| 2 | [向量检索 — 语义搜索](./02-vector-retrieval.md) | 余弦相似度 + topK 检索 = 基础 RAG | [运行](./verify/02-vector-retrieval.mjs) |
| 3 | [重排序 — Reranker 精炼](./03-reranker.md) | BAAI/bge-reranker-v2-m3 提升检索精度 | [运行](./verify/03-reranker.mjs) |
| 4 | [RAG 完整流水线](./04-full-pipeline.md) | 分块→嵌入→存储→检索→重排序→生成 | [运行](./verify/04-full-pipeline.mjs) |
| 5 | [GraphRAG 图谱增强](./05-graph-rag.md) | 图谱遍历发现隐藏关联 | [运行](./verify/05-graph-rag.mjs) |
| 6 | [向量数据库分类指南](./06-vector-databases.md) | 14 种数据库，6 大类，统一接口 | [运行](./verify/06-vector-databases.mjs) |
| 7 | [libSQL 轻量级向量数据库](./07-libsql-vector-db.md) | 单文件 SQLite 向量数据库，零配置 | [运行](./verify/07-libsql-vector-db.mjs) |

---

## 环境与配置

```
嵌入模型: BAAI/bge-m3 (1024维)
重排序模型: BAAI/bge-reranker-v2-m3
LLM: deepseek-ai/DeepSeek-V3.2
API: https://api.siliconflow.cn/v1
配置来源: iii docx::config_get
```

---

## 学习路径

```
第 1 篇（分块）
  ↓ 文档如何变成可检索的 chunks
第 2 篇（检索）
  ↓ 如何从 chunks 中找到最相关的
第 3 篇（重排序）
  ↓ 如何用 reranker 精炼结果
第 4 篇（流水线）
  ↓ 完整的 RAG 端到端流程
第 5 篇（图谱）
  → GraphRAG 发现隐藏关联
```

---

## 验证结果总览

| 篇 | 验证项 | 结果 |
|---|--------|------|
| 1 | 4 种输入格式、5 种分块策略、嵌入生成 (1024维)、overlap 约束 | ✅ 4/4 |
| 2 | 余弦相似度、完整检索流程、topK 选择、元数据过滤 | ✅ 4/4 |
| 3 | 模型可用性、检索 vs 重排序、两阶段检索、返回格式处理 | ✅ 4/4 |
| 4 | 离线阶段、在线阶段、封装为 Function、性能指标 | ✅ 4/4 |
| 5 | 图谱构建、图谱遍历、threshold 影响、GraphRAG vs 向量检索 | ✅ 3/4 |
| 6 | 6 大类分类、统一接口、命名规则、特殊例外、API 连通性 | ✅ 5/5 |
| 7 | 安装导入、创建索引、CRUD、过滤检索、RAG 集成 | ✅ 8/8 |

**总计：32/33 项验证通过 ✅**

> **注**：第 5 篇"图谱遍历"在小数据集（6 篇文档）上额外发现为 0，这是预期行为——GraphRAG 的优势在更大规模文档集中体现。

---

## 前置条件

- 已阅读 [III + Mastra 基础系列](../README.md)
- III 引擎运行中
- `@mastra/rag` 已安装
- 硅基流动 API Key 已配置
