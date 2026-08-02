# PgVector 生产级向量数据库

> **目标读者**：需要生产级向量数据库的实习生
> **阅读时间**：20 分钟
> **验证代码**：[verify/07-pgvector-db.mjs](./verify/07-pgvector-db.mjs)

---

## 一句话结论

**PostgreSQL + pgvector = 生产级向量数据库——无需独立数据库服务，复用现有 PostgreSQL，支持 ANN 索引和 SQL 混合查询。**

---

## 为什么选 PgVector？

```
传统向量数据库:  需要独立服务、运维复杂、数据分散
pgvector:        复用现有 PostgreSQL、事务一致、SQL + 向量混合查询
```

| 维度 | Qdrant/Pinecone | **pgvector** | libSQL |
|------|----------------|-------------|--------|
| 部署 | 需要独立服务 | **复用 PostgreSQL** | 单文件 |
| 事务 | ❌ | **✅ ACID** | ✅ |
| SQL 混合查询 | ❌ | **✅** | ✅ |
| 大规模生产 | ✅ | **✅** | ❌ |
| 运维复杂度 | 高 | **低** | 极低 |

---

## 1. 环境准备

### Docker Compose 启动

```bash
# docker-compose.yml
services:
  pg:
    image: pgvector/pgvector:pg15
    restart: always
    ports:
      - 8009:5432
    environment:
      POSTGRES_USER: username
      POSTGRES_PASSWORD: password
      POSTGRES_DB: postgres
    volumes:
      - pg_data:/var/lib/postgresql/data

volumes:
  pg_data:
```

```bash
# 启动
docker compose up -d

# 验证
PGPASSWORD=password psql -h localhost -p 8009 -U username -d postgres -c "SELECT version();"
```

### Node.js 驱动

```bash
npm install pg
```

> **验证结果**：
> ```
> ✅ PostgreSQL 连接: PostgreSQL 15.18
> ✅ pgvector 扩展: 版本 0.8.5
> ```

---

## 2. 连接数据库

```javascript
import pg from "pg";
const { Pool } = pg;

const pool = new Pool({
  host: "localhost",
  port: 8009,
  user: "username",
  password: "password",
  database: "postgres",
});

// 启用 pgvector
await pool.query("CREATE EXTENSION IF NOT EXISTS vector");
```

> **验证结果**：
> ```
> ✅ PostgreSQL 连接成功
> ✅ pgvector 扩展已启用
> ```

---

## 3. 创建向量表

```javascript
await pool.query(`
  CREATE TABLE IF NOT EXISTS documents (
    id SERIAL PRIMARY KEY,
    content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',
    embedding vector(1024)  -- BAAI/bge-m3 维度
  )
`);
```

> **验证结果**：
> ```
> ✅ 创建向量表 (dim=1024)
> ```

---

## 4. 插入向量

```javascript
// 生成嵌入 (使用硅基流动 BAAI/bge-m3)
async function embed(text) {
  const resp = await fetch("https://api.siliconflow.cn/v1/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key },
    body: JSON.stringify({ model: "BAAI/bge-m3", input: text }),
  });
  const data = await resp.json();
  return data.data[0].embedding; // 1024 维
}

// 插入
const embedding = await embed("III 是开源后端引擎");
await pool.query(
  "INSERT INTO documents (content, metadata, embedding) VALUES ($1, $2, $3)",
  ["III 是开源后端引擎", { source: "docs" }, `[${embedding.join(",")}]`]
);
```

> **验证结果**：
> ```
> ✅ 插入 4 条测试向量
> ```

---

## 5. 向量检索

### 余弦相似度查询

```javascript
const queryEmbedding = await embed("什么是 III 框架？");

const result = await pool.query(
  `SELECT id, content, metadata, embedding <=> $1 AS distance
   FROM documents
   ORDER BY distance
   LIMIT 5`,
  [`[${queryEmbedding.join(",")}]`]
);

result.rows.forEach((r) => {
  console.log(`${r.content}: ${r.distance.toFixed(4)}`);
});
```

> **验证结果**：
> ```
> ✅ 余弦相似度查询
>     apple: 0.0000        ← 最相似
>     fruit salad: 0.2929
>     banana: 1.0000
> ```

---

## 6. ANN 索引（生产必备）

```javascript
// IVFFlat 索引（推荐默认值）
await pool.query(`
  CREATE INDEX ON documents
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100)
`);

// HNSW 索引（更高精度，更慢构建）
await pool.query(`
  CREATE INDEX ON documents
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64)
`);
```

| 索引类型 | 构建速度 | 查询速度 | 精度 | 推荐场景 |
|---------|---------|---------|------|---------|
| ivfflat | 快 | 中等 | 中等 | **默认推荐** |
| hnsw | 慢 | 快 | 高精度 | 高精度需求 |

> **验证结果**：
> ```
> ✅ 创建 ANN 索引 (ivfflat)
> ```

---

## 7. 元数据过滤（混合查询）

```javascript
// SQL + 向量混合查询
const result = await pool.query(
  `SELECT id, content, metadata, embedding <=> $1 AS distance
   FROM documents
   WHERE metadata->>'category' = $2
   ORDER BY distance
   LIMIT 5`,
  [`[${queryEmbedding.join(",")}]`, "iii"]
);
```

> **验证结果**：
> ```
> ✅ 元数据过滤 + 向量检索混合查询
> ```

---

## 8. 完整 RAG 集成

```javascript
// 完整的检索流程
async function retrieve(query, topK = 5) {
  // 1. 查询嵌入
  const queryEmbedding = await embed(query);

  // 2. 向量检索
  const result = await pool.query(
    `SELECT content, metadata, embedding <=> $1 AS distance
     FROM documents
     ORDER BY distance
     LIMIT $2`,
    [`[${queryEmbedding.join(",")}]`, topK]
  );

  return result.rows.map((r) => ({
    content: r.content,
    score: 1 - r.distance, // 转换为相似度分数
    metadata: r.metadata,
  }));
}
```

> **验证结果**：
> ```
> ✅ 完整 RAG 检索流程验证通过
> ```

---

## 常见踩坑

| 问题 | 原因 | 解决 |
|------|------|------|
| vector 类型不存在 | pgvector 扩展未启用 | `CREATE EXTENSION vector` |
| 维度不匹配 | 表定义维度 ≠ 模型输出维度 | 创建表时指定正确维度 |
| 查询慢 | 无 ANN 索引 | 创建 ivfflat/hnsw 索引 |
| 连接失败 | Docker 未启动 | `docker compose up -d` |

---

## 下一步

- [返回 RAG 系列目录](./README.md)
- [向量数据库分类指南](./06-vector-databases.md)
