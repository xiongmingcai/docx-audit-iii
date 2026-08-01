# Mastra 向量数据库分类指南

> **目标读者**：已掌握 RAG 流水线的实习生
> **阅读时间**：20 分钟
> **验证代码**：[verify/06-vector-databases.mjs](./verify/06-vector-databases.mjs)

---

## 一句话结论

**Mastra 支持 13 种向量数据库，分为 6 大类——所有数据库共享统一的 `createIndex/upsert/query` 接口，切换数据库只需改 import 和配置。**

---

## 6 大类向量数据库

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Mastra 向量数据库分类                             │
│                                                                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                │
│  │ PostgreSQL  │  │   云服务     │  │  专用向量   │                │
│  │ PgVector    │  │ Pinecone    │  │ Qdrant      │                │
│  │             │  │ Upstash     │  │ Chroma      │                │
│  │             │  │ Cloudflare  │  │ Lance       │                │
│  │             │  │ S3 Vectors  │  │             │                │
│  └─────────────┘  └─────────────┘  └─────────────┘                │
│                                                                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                │
│  │ 全文搜索    │  │ 多模型      │  │  嵌入式     │                │
│  │ OpenSearch  │  │ MongoDB     │  │ libSQL      │                │
│  │ Elasticsearch│ │ Couchbase   │  │             │                │
│  │             │  │ Astra       │  │             │                │
│  └─────────────┘  └─────────────┘  └─────────────┘                │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 第 1 类：PostgreSQL 生态

### PgVector (`@mastra/pg`)

**适用场景**：已用 PostgreSQL，不想引入新组件

```typescript
import { PgVector } from "@mastra/pg";

const store = new PgVector({
  id: "pg-vector",
  connectionString: process.env.POSTGRES_CONNECTION_STRING,
});
await store.createIndex({ indexName: "my_index", dimension: 1024 });
await store.upsert({ indexName: "my_index", vectors: embeddings });
const results = await store.query({ indexName: "my_index", queryVector, topK: 5 });
```

| 维度 | 说明 |
|------|------|
| 优点 | 复用现有 PostgreSQL，事务一致 |
| 缺点 | 大规模向量性能不如专用库 |
| 命名 | `my_index_123` (字母数字下划线) |
| 维度 | 1024 (BAAI/bge-m3) |

> **验证结果**：
> ```
> ✓ 接口: createIndex / upsert / query
> ✓ 命名: 仅字母数字下划线
> ```

---

## 第 2 类：云服务（托管服务）

### Pinecone (`@mastra/pinecone`)

**适用场景**：快速上手，无需运维

```typescript
import { PineconeVector } from "@mastra/pinecone";

const store = new PineconeVector({
  id: "pinecone",
  apiKey: process.env.PINECONE_API_KEY,
});
```

| 维度 | 说明 |
|------|------|
| 优点 | 全托管，自动扩缩容 |
| 缺点 | 费用较高，数据在第三方 |
| 命名 | `my-index-123` (小写字母数字短横线) |
| 特殊 | 支持 namespace 隔离多租户 |

### Upstash (`@mastra/upstash`)

**适用场景**：Serverless 架构，按量付费

```typescript
import { UpstashVector } from "@mastra/upstash";

const store = new UpstashVector({
  id: "upstash",
  url: process.env.UPSTASH_URL,
  token: process.env.UPSTASH_TOKEN,
});
// 无需 createIndex，首次 upsert 自动创建 namespace
```

| 维度 | 说明 |
|------|------|
| 优点 | Serverless，按请求计费 |
| 缺点 | 冷启动延迟 |
| 命名 | `MyNamespace123` (2-100字符) |
| 特殊 | **无需 createIndex** |

### Cloudflare (`@mastra/vectorize`)

**适用场景**：Cloudflare Workers 生态

```typescript
import { CloudflareVector } from "@mastra/vectorize";

const store = new CloudflareVector({
  id: "cloudflare",
  accountId: process.env.CF_ACCOUNT_ID,
  apiToken: process.env.CF_API_TOKEN,
});
```

| 维度 | 说明 |
|------|------|
| 优点 | 边缘部署，低延迟 |
| 缺点 | 仅限 Cloudflare 生态 |
| 命名 | `my-index-123` (< 32字符) |

### S3 Vectors (`@mastra/s3vectors`)

**适用场景**：AWS 生态，S3 存储

```typescript
import { S3Vectors } from "@mastra/s3vectors";

const store = new S3Vectors({
  id: "s3-vectors",
  vectorBucketName: "my-vector-bucket",
  clientConfig: { region: "us-east-1" },
});
```

| 维度 | 说明 |
|------|------|
| 优点 | 与 S3 集成，成本低 |
| 缺点 | 仅限 AWS 生态 |
| 命名 | `my-index.123` (3-63字符) |

> **验证结果**：
> ```
> ✓ Pinecone: 小写字母数字短横线
> ✓ Upstash: 无需 createIndex
> ✓ Cloudflare: < 32字符
> ✓ S3: 3-63字符
> ```

---

## 第 3 类：专用向量数据库

### Qdrant (`@mastra/qdrant`)

**适用场景**：高性能向量搜索，过滤能力强

```typescript
import { QdrantVector } from "@mastra/qdrant";

const store = new QdrantVector({
  id: "qdrant",
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY,
});
```

| 维度 | 说明 |
|------|------|
| 优点 | 高性能，过滤能力强 |
| 缺点 | 需要运维 |
| 命名 | `my_collection_123` (1-255字符) |

### Chroma (`@mastra/chroma`)

**适用场景**：本地开发，轻量级

```typescript
import { ChromaVector } from "@mastra/chroma";

// 本地模式（无需配置）
const localStore = new ChromaVector();

// Cloud 模式
const cloudStore = new ChromaVector({
  id: "chroma",
  apiKey: process.env.CHROMA_API_KEY,
  tenant: process.env.CHROMA_TENANT,
  database: process.env.CHROMA_DATABASE,
});
```

| 维度 | 说明 |
|------|------|
| 优点 | 本地模式零配置 |
| 缺点 | 不适合大规模生产 |
| 命名 | `my-collection-123` (3-63字符) |

### Lance (`@mastra/lance`)

**适用场景**：嵌入式，文件存储

```typescript
import { LanceVectorStore } from "@mastra/lance";

const store = await LanceVectorStore.create("/path/to/db");
await store.createIndex({ tableName: "myVectors", indexName: "myCollection", dimension: 1024 });
await store.upsert({ tableName: "myVectors", vectors: embeddings });
```

| 维度 | 说明 |
|------|------|
| 优点 | 嵌入式，无需服务 |
| 缺点 | 单机性能 |
| 特殊 | 使用 `tableName` 而非 `indexName` |

> **验证结果**：
> ```
> ✓ Qdrant: 高性能过滤
> ✓ Chroma: 本地零配置
> ✓ Lance: 嵌入式文件存储
> ```

---

## 第 4 类：全文搜索引擎

### OpenSearch (`@mastra/opensearch`)

**适用场景**：已有 OpenSearch 集群

```typescript
import { OpenSearchVector } from "@mastra/opensearch";

const store = new OpenSearchVector({
  id: "opensearch",
  node: process.env.OPENSEARCH_URL,
});
```

| 维度 | 说明 |
|------|------|
| 优点 | 向量 + 全文搜索合一 |
| 缺点 | 资源消耗大 |
| 命名 | `my-index-123` (仅小写) |

### Elasticsearch (`@mastra/elasticsearch`)

**适用场景**：已有 Elastic 集群

```typescript
import { ElasticSearchVector } from "@mastra/elasticsearch";

const store = new ElasticSearchVector({
  id: "elasticsearch",
  url: process.env.ELASTICSEARCH_URL,
  auth: { apiKey: process.env.ELASTICSEARCH_API_KEY },
});
```

| 维度 | 说明 |
|------|------|
| 优点 | 成熟的搜索生态 |
| 缺点 | 配置复杂 |
| 命名 | `my-index-123` (仅小写) |

> **验证结果**：
> ```
> ✓ OpenSearch: 向量+全文
> ✓ Elasticsearch: 成熟生态
> ```

---

## 第 5 类：多模型数据库

### MongoDB (`@mastra/mongodb`)

**适用场景**：已有 MongoDB，需要混合查询

```typescript
import { MongoDBVector } from "@mastra/mongodb";

const store = new MongoDBVector({
  id: "mongodb",
  uri: process.env.MONGODB_URI,
  dbName: process.env.MONGODB_DB_NAME,
});

// 混合搜索 (向量 + 全文)
await store.createSearchIndex({ indexName: "docs", fields: ["text"] });
const results = await store.hybridQuery({
  indexName: "docs",
  queryVector: embedding,
  query: "search terms",
  paths: ["text"],
  topK: 10,
});
```

| 维度 | 说明 |
|------|------|
| 优点 | 向量+文档+全文合一 |
| 缺点 | 向量性能不如专用库 |
| 命名 | `my_collection.123` (可含点) |
| 特殊 | **混合搜索** (向量 + BM25) |

### Couchbase (`@mastra/couchbase`)

**适用场景**：已有 Couchbase 集群

```typescript
import { CouchbaseVector } from "@mastra/couchbase";

const store = new CouchbaseVector({
  id: "couchbase",
  connectionString: process.env.COUCHBASE_CONNECTION_STRING,
  username: process.env.COUCHBASE_USERNAME,
  password: process.env.COUCHBASE_PASSWORD,
  bucketName: process.env.COUCHBASE_BUCKET,
  scopeName: process.env.COUCHBASE_SCOPE,
  collectionName: process.env.COUCHBASE_COLLECTION,
});
```

### Astra (`@mastra/astra`)

**适用场景**：DataStax 生态

```typescript
import { AstraVector } from "@mastra/astra";

const store = new AstraVector({
  id: "astra",
  token: process.env.ASTRA_DB_TOKEN,
  endpoint: process.env.ASTRA_DB_ENDPOINT,
  keyspace: process.env.ASTRA_DB_KEYSPACE,
});
```

> **验证结果**：
> ```
> ✓ MongoDB: 混合搜索 (向量+BM25)
> ✓ Couchbase: 多模型
> ✓ Astra: DataStax
> ```

---

## 第 6 类：嵌入式/边缘

### libSQL (`@mastra/core/vector/libsql`)

**适用场景**：轻量级，边缘部署，Turso 兼容

```typescript
import { LibSQLVector } from "@mastra/core/vector/libsql";

const store = new LibSQLVector({
  id: "libsql",
  url: process.env.DATABASE_URL,
  authToken: process.env.DATABASE_AUTH_TOKEN, // Turso 可选
});
```

| 维度 | 说明 |
|------|------|
| 优点 | 轻量，SQLite 兼容 |
| 缺点 | 单机性能 |
| 命名 | `my_index_123` (字母数字下划线) |

> **验证结果**：
> ```
> ✓ libSQL: 嵌入式 SQLite
> ```

---

## 统一接口

所有向量数据库共享相同的 CRUD 接口：

```typescript
// 创建索引
await store.createIndex({ indexName: "my_index", dimension: 1024 });

// 插入/更新
await store.upsert({
  indexName: "my_index",
  vectors: embeddings,
  metadata: chunks.map((c) => ({ text: c.text })),
});

// 查询
const results = await store.query({
  indexName: "my_index",
  queryVector: embedding,
  topK: 5,
});

// 删除
await store.deleteVectors({ indexName: "my_index", filter: { id: "doc-1" } });
```

**例外**：
- Upstash：无需 `createIndex`（首次 upsert 自动创建）
- Lance：使用 `tableName` 而非 `indexName`
- MongoDB：额外支持 `hybridQuery`

---

## 命名规则速查

| 数据库 | 命名规则 | 示例 |
|--------|---------|------|
| PgVector | 字母数字下划线 | `my_index_123` |
| Pinecone | 小写字母数字短横线 | `my-index-123` |
| Qdrant | 不含特殊字符 | `my_collection_123` |
| Chroma | 3-63字符 | `my-collection-123` |
| Astra | ≤48字符 | `my_collection_123` |
| libSQL | 字母数字下划线 | `my_index_123` |
| Upstash | 2-100字符 | `MyNamespace123` |
| Cloudflare | <32字符小写 | `my-index-123` |
| OpenSearch | 仅小写 | `my-index-123` |
| Elasticsearch | 仅小写 | `my-index-123` |
| MongoDB | 可含点 | `my_collection.123` |
| S3 Vectors | 3-63字符 | `my-index.123` |

---

## 选择指南

```
需要运维少？
  ├─ 是 → Pinecone / Upstash / Cloudflare
  └─ 否 ↓

已有数据库？
  ├─ PostgreSQL → PgVector
  ├─ MongoDB → MongoDB (混合搜索)
  ├─ Elasticsearch → OpenSearch/Elasticsearch
  └─ 无 ↓

需要高性能？
  ├─ 是 → Qdrant
  └─ 否 ↓

本地开发？
  ├─ 是 → Chroma (零配置) / libSQL
  └─ 生产 → Qdrant / Pinecone
```

---

## 下一步

- [返回 RAG 系列目录](./README.md)
