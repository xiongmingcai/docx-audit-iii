# III + Mastra RAG 实战系列

> **用代码验证每一句话的 RAG 教程**

本系列面向已了解 III + Mastra 基础的实习生，带你掌握 RAG（检索增强生成）的完整实现。

---

## 开发环境

### 数据库服务 (Docker Compose)

```yaml
# docker-compose.yml
services:
  pg:
    image: pgvector/pgvector:pg15    # PostgreSQL 15 + pgvector 扩展
    ports:
      - 8009:5432
    environment:
      POSTGRES_USER: username
      POSTGRES_PASSWORD: password
      POSTGRES_DB: postgres
    volumes:
      - pg_data:/var/lib/postgresql/data

  mongo:
    image: mongo:latest
    ports:
      - 8008:27017
    environment:
      MONGO_INITDB_ROOT_USERNAME: username
      MONGO_INITDB_ROOT_PASSWORD: bohuai123
    volumes:
      - mongo_data:/data/db

volumes:
  pg_data:
  mongo_data:
```

### 连接信息

| 数据库 | 端口 | 用户 | 密码 | 特点 |
|--------|------|------|------|------|
| PostgreSQL + pgvector | 8009 | username | password | 向量搜索、SQL 查询 |
| MongoDB | 8008 | username | bohuai123 | 文档存储、灵活 Schema |

### 启动数据库

```bash
# 启动服务
docker compose up -d

# 验证服务
docker compose ps
# NAME                  STATUS
# docx-audit-iii-pg-1   Up (healthy)
# docx-audit-iii-mongo-1 Up (healthy)

# PostgreSQL 连接
PGPASSWORD=password psql -h localhost -p 8009 -U username -d postgres -c "SELECT 1"

# MongoDB 连接
mongosh --host localhost --port 8008 -u username -p bohuai123 --eval "db.adminCommand('ping')"
```

---

## 文章列表

| # | 文章 | 核心结论 | 数据库验证 |
|---|------|---------|-----------|
| 1 | [文档分块与嵌入](./01-chunking-and-embedding.md) | MDocument 9 种分块策略 + 嵌入生成 | PostgreSQL 持久化 |
| 2 | [向量检索 — 语义搜索](./02-vector-retrieval.md) | 余弦相似度 + topK 检索 = 基础 RAG | pgvector ANN 索引 |
| 3 | [重排序 — Reranker 精炼](./03-reranker.md) | BAAI/bge-reranker-v2-m3 提升检索精度 | MongoDB 缓存 |
| 4 | [RAG 完整流水线](./04-full-pipeline.md) | 分块→嵌入→存储→检索→重排序→生成 | 完整 CRUD |
| 5 | [GraphRAG 图谱增强](./05-graph-rag.md) | 图谱遍历发现隐藏关联 | pgvector + 图谱 |
| 6 | [向量数据库分类指南](./06-vector-databases.md) | 14 种数据库，6 大类，统一接口 | 多库对比 |
| 7 | [PgVector 生产级向量数据库](./07-pgvector-db.md) | PostgreSQL + pgvector，生产级向量搜索 | Docker Compose |

---

## 环境与配置

```
数据库:
  PostgreSQL: localhost:8009 (pgvector 0.8.5)
  MongoDB:    localhost:8008

模型:
  嵌入模型:     BAAI/bge-m3 (1024维)
  重排序模型:   BAAI/bge-reranker-v2-m3
  LLM:         deepseek-ai/DeepSeek-V3.2
  API:         https://api.siliconflow.cn/v1

Node.js 驱动:
  pg:         PostgreSQL 客户端
  mongodb:    MongoDB 客户端

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
第 6 篇（数据库）
  → 14 种向量数据库选型指南
第 7 篇（PgVector）
  → 生产级向量数据库（PostgreSQL + pgvector）
```

---

## 验证结果总览

| 篇 | 验证项 | 结果 |
|---|--------|------|
| 0 | 数据库连接、pgvector 扩展、向量 CRUD、MongoDB CRUD | ✅ 13/13 |
| 1 | 4 种输入格式、5 种分块策略、嵌入生成 (1024维)、overlap 约束、PostgreSQL 持久化 | ✅ 5/5 |
| 2 | 余弦相似度、完整检索流程、topK 选择、元数据过滤、pgvector ANN 索引 | ✅ 5/5 |
| 3 | 模型可用性、检索 vs 重排序、两阶段检索、返回格式处理、MongoDB 缓存 | ✅ 4/4 |
| 4 | 离线阶段、在线阶段、封装为 Function、性能指标、完整 CRUD | ✅ 4/4 |
| 5 | 图谱构建、图谱遍历、threshold 影响、GraphRAG vs 向量检索 | ✅ 3/4 |
| 6 | 6 大类分类、统一接口、命名规则、特殊例外、API 连通性 | ✅ 5/5 |
| 7 | Docker 部署、pgvector 扩展、向量 CRUD、ANN 索引、RAG 集成 | ✅ 8/8 |

**总计：42/43 项验证通过 ✅**

---

## 前置条件

- 已阅读 [III + Mastra 基础系列](../README.md)
- III 引擎运行中
- Docker Compose 数据库运行中
- `@mastra/rag` 已安装
- `pg` + `mongodb` Node.js 驱动已安装
- 硅基流动 API Key 已配置
