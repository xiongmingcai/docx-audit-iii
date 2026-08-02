/**
 * 验证脚本 07: PgVector 生产级向量数据库
 *
 * 验证以下结论：
 * 1. Docker 部署 PostgreSQL + pgvector
 * 2. pgvector 扩展可用
 * 3. 向量 CRUD 操作
 * 4. ANN 索引创建
 * 5. 元数据过滤 + 向量检索混合查询
 */

import pg from "pg";

const { Pool } = pg;
const results = [];

function ok(step, extra) {
  results.push([step, "✅"]);
  console.log(`  ✓ ${step}${extra ? ": " + extra : ""}`);
}

function fail(step, err) {
  results.push([step, "❌"]);
  console.log(`  ✗ ${step}: ${err}`);
}

const pool = new Pool({
  host: "localhost",
  port: 8009,
  user: "username",
  password: "password",
  database: "postgres",
});

async function main() {
  console.log("══════════════════════════════════════════════════");
  console.log("  验证 07: PgVector 生产级向量数据库");
  console.log("══════════════════════════════════════════════════");

  try {
    // 1. 连接
    const client = await pool.connect();
    ok("PostgreSQL 连接");
    client.release();

    // 2. pgvector 扩展
    await pool.query("CREATE EXTENSION IF NOT EXISTS vector");
    ok("pgvector 扩展");

    // 3. 创建表
    await pool.query(`
      DROP TABLE IF EXISTS rag_documents;
      CREATE TABLE rag_documents (
        id SERIAL PRIMARY KEY,
        content TEXT,
        metadata JSONB DEFAULT '{}',
        embedding vector(3)
      )
    `);
    ok("创建向量表 (dim=3)");

    // 4. 插入向量
    await pool.query(
      `INSERT INTO rag_documents (content, metadata, embedding) VALUES
       ('III 是开源后端引擎', '{"category": "iii"}', '[1, 0, 0]'),
       ('Mastra 是 AI Agent 框架', '{"category": "mastra"}', '[0.8, 0.2, 0]'),
       ('RAG 是检索增强生成', '{"category": "rag"}', '[0.5, 0.5, 0]'),
       ('TypeScript 是 JavaScript 超集', '{"category": "ts"}', '[0, 0, 1]')`,
    );
    ok("插入 4 条测试向量");

    // 5. 向量检索
    const searchResult = await pool.query(
      `SELECT content, embedding <=> '[1, 0, 0]' AS distance
       FROM rag_documents
       ORDER BY distance
       LIMIT 3`,
    );
    ok("向量检索 (topK=3)");
    searchResult.rows.forEach((r) => console.log(`    ${r.content}: ${r.distance.toFixed(4)}`));

    // 6. ANN 索引
    await pool.query(
      `CREATE INDEX ON rag_documents
       USING ivfflat (embedding vector_cosine_ops) WITH (lists = 10)`,
    );
    ok("创建 ANN 索引 (ivfflat)");

    // 7. 元数据过滤
    const filteredResult = await pool.query(
      `SELECT content, metadata, embedding <=> '[1, 0, 0]' AS distance
       FROM rag_documents
       WHERE metadata->>'category' = 'iii'
       ORDER BY distance
       LIMIT 3`,
    );
    ok("元数据过滤 + 向量检索", `找到 ${filteredResult.rows.length} 条`);

    // 清理
    await pool.query("DROP TABLE IF EXISTS rag_documents");
    ok("清理测试表");
  } catch (e) {
    fail("PgVector", e.message);
  }

  // 汇总
  console.log("\n" + "═".repeat(50));
  console.log("  验证汇总");
  console.log("═".repeat(50));
  results.forEach(([step, s]) => console.log(`  ${s} ${step}`));
  const passed = results.filter(([, r]) => r.includes("✅")).length;
  console.log(`\n  结果: ${passed}/${results.length} 通过`);

  await pool.end();
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
