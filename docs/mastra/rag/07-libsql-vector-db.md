# libSQL 轻量级向量数据库

> **目标读者**：需要在本地或边缘环境部署 RAG 的实习生
> **阅读时间**：15 分钟
> **验证代码**：[verify/07-libsql-vector-db.mjs](./verify/07-libsql-vector-db.mjs)

---

## 一句话结论

**libSQL 是 SQLite 的向量扩展——无需独立数据库服务，一个文件即可存储向量 + 元数据，是本地开发和轻量级部署的最佳选择。**

---

## 为什么选 libSQL？

```
传统向量数据库:  需要独立服务、运维复杂、资源占用大
libSQL:         一个文件、零配置、嵌入应用
```

| 维度 | PgVector | Pinecone | Chroma | **libSQL** |
|------|---------|---------|--------|-----------|
| 部署 | 需要 PG 服务 | 云服务 | 本地/云 | **单文件** |
| 运维 | 中 | 无 | 低 | **零** |
| 资源 | 高 | 付费 | 中 | **极低** |
| 事务 | ✅ | ❌ | ❌ | **✅** |
| 向量+全文 | ❌ | ❌ | ❌ | **✅** |
| 适用规模 | 大规模 | 大规模 | 中小 | **中小** |

**适用场景**：
- 本地开发调试
- 边缘部署（IoT、移动端）
- 轻量级生产（< 100 万向量）
- 需要事务一致性的场景

---

## 1. 安装

```bash
npm install @mastra/libsql
```

依赖 `@libsql/client`（libSQL 的 Node.js 客户端），无需额外安装数据库服务。

> **验证结果**：
> ```
> ✓ @mastra/libsql 安装成功
> ✓ LibSQLVector 可导入
> ```

---

## 2. 快速上手

### 本地文件模式

```typescript
import { LibSQLVector } from "@mastra/libsql";
import fs from "fs";

// 创建本地数据库文件
fs.mkdirSync("./data", { recursive: true });

const store = new LibSQLVector({
  id: "my-libsql",
  url: "file:./data/vectors.db",  // 本地文件路径
});
```

### Turso 云模式

```typescript
const store = new LibSQLVector({
  id: "my-libsql",
  url: process.env.DATABASE_URL,        // Turso 数据库 URL
  authToken: process.env.DATABASE_AUTH_TOKEN,  // Turso 认证 Token
});
```

> **验证结果**：
> ```
> ✓ 本地文件模式: file:./data/vectors.db
> ✓ Turso 云模式: libsql://xxx.turso.io
> ```

---

## 3. 完整 CRUD 操作

### 创建索引

```typescript
await store.createIndex({
  indexName: "my_index",  // 索引名
  dimension: 1024,        // 嵌入维度 (BAAI/bge-m3 = 1024)
});
```

### 插入向量

```typescript
await store.upsert({
  indexName: "my_index",
  vectors: embeddings,  // number[][] 嵌入向量数组
  metadata: [
    { text: "III 是开源后端引擎", id: "doc-0", category: "iii" },
    { text: "Mastra 是 Agent 框架", id: "doc-1", category: "mastra" },
  ],
});
```

### 查询向量

```typescript
const results = await store.query({
  indexName: "my_index",
  queryVector: embedding,  // 查询向量
  topK: 3,                 // 返回 Top 3
});
// results: [{ score: 0.68, metadata: { text: "...", id: "doc-0" } }, ...]
```

### 带过滤的查询

```typescript
const results = await store.query({
  indexName: "my_index",
  queryVector: embedding,
  topK: 3,
  filter: { category: "iii" },  // 元数据过滤
});
```

### 删除向量

```typescript
// 按 ID 删除
await store.deleteVectors({
  indexName: "my_index",
  ids: ["doc-0", "doc-1"],
});

// 按元数据过滤删除
await store.deleteVectors({
  indexName: "my_index",
  filter: { category: "iii" },
});
```

> **验证结果**：
> ```
> ✓ createIndex: my_index (dim=1024)
> ✓ upsert: 5 vectors
> ✓ query: topK=3, score 0.68/0.56/0.48
> ✓ query+filter: category=iii 过滤有效
> ✓ deleteVectors: 按 ID 删除成功
> ```

---

## 4. 命名规则

libSQL 的索引命名规则：

| 规则 | 说明 | 示例 |
|------|------|------|
| 首字符 | 字母或下划线 | `my_index` ✓ |
| 允许字符 | 字母、数字、下erscore | `index_123` ✓ |
| 禁止字符 | 短横线、特殊字符 | `my-index` ✗ |

---

## 5. 与 RAG 流水线集成

```typescript
import { MDocument } from "@mastra/rag";
import { LibSQLVector } from "@mastra/libsql";

// 初始化
const store = new LibSQLVector({ id: "rag-libsql", url: "file:./data/rag.db" });
await store.createIndex({ indexName: "knowledge", dimension: 1024 });

// 离线：索引文档
async function indexDocuments(texts: string[]) {
  const doc = MDocument.fromText(texts.join("\n"));
  const chunks = await doc.chunk({ strategy: "recursive", maxSize: 512, overlap: 50 });

  // 生成嵌入
  const { embeddings } = await embedMany({
    model: "siliconflow-cn/BAAI/bge-m3",
    values: chunks.map((c) => c.text),
  });

  // 存储
  await store.upsert({
    indexName: "knowledge",
    vectors: embeddings,
    metadata: chunks.map((c, i) => ({ text: c.text, chunkIndex: i })),
  });

  return chunks.length;
}

// 在线：检索
async function search(query: string, topK = 3) {
  const { embedding } = await embed({ value: query, model: "siliconflow-cn/BAAI/bge-m3" });
  return await store.query({ indexName: "knowledge", queryVector: embedding, topK });
}
```

> **验证结果**：
> ```
> ✓ 索引 5 个文档
> ✓ 检索 "III 的 Function" 返回 Top 3
> ✓ 结果按相似度排序
> ```

---

## 6. 性能特征

| 指标 | 值 |
|------|------|
| 插入 5 个向量 | < 50ms |
| 查询 topK=3 | < 10ms |
| 数据库文件大小 | ~50KB (5 个 1024 维向量) |
| 内存占用 | < 10MB |

> **验证结果**：
> ```
> ✓ 插入: 5 vectors < 50ms
> ✓ 查询: topK=3 < 10ms
> ✓ 文件大小: 5 个向量 ~50KB
> ```

---

## 7. 与 iii 集成

将 libSQL 封装为 iii Function：

```typescript
worker.registerFunction("rag::libsql-query", async (data) => {
  const { query, topK = 3 } = data;

  // 生成查询嵌入
  const { embedding } = await embed({
    value: query,
    model: "siliconflow-cn/BAAI/bge-m3",
  });

  // 检索
  const results = await store.query({
    indexName: "knowledge",
    queryVector: embedding,
    topK,
  });

  return {
    body: {
      results: results.map((r) => ({
        text: r.metadata?.text,
        score: r.score,
      })),
    },
    statusCode: 200,
  };
});
```

---

## 常见踩坑

| 问题 | 原因 | 解决 |
|------|------|------|
| 维度不匹配 | 索引维度 ≠ 模型输出维度 | 创建索引时指定正确维度 |
| 文件权限 | 无写入权限 | 确保目录可写 |
| 并发写入 | SQLite 写锁 | 串行化写入或使用 WAL 模式 |
| 向量数量多 | 性能下降 | 超过 100 万考虑 PgVector/Qdrant |

---

## 下一步

- [返回 RAG 系列目录](./README.md)
- [向量数据库分类指南](./06-vector-databases.md)
