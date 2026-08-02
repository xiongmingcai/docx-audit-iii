/**
 * 验证脚本 00: 数据库连接与基础能力检查
 *
 * 验证以下结论：
 * 1. PostgreSQL + pgvector 可连接，支持向量类型
 * 2. MongoDB 可连接，支持文档存储
 * 3. pgvector 支持向量创建、索引、相似度查询
 * 4. MongoDB 支持 CRUD 操作
 */

import pg from "pg";
import { MongoClient } from "mongodb";

const results = [];

function ok(step) {
  results.push([step, "✅"]);
  console.log(`  ✓ ${step}`);
}

function fail(step, err) {
  results.push([step, "❌"]);
  console.log(`  ✗ ${step}: ${err}`);
}

const { Pool } = pg;

// ── 配置 ──────────────────────────────────────────────────
const PG_CONFIG = {
  host: "localhost",
  port: 8009,
  user: "username",
  password: "password",
  database: "postgres",
};

const MONGO_URL = "mongodb://username:bohuai123@localhost:8008";

async function main() {
  console.log("══════════════════════════════════════════════════");
  console.log("  验证 00: 数据库连接与基础能力");
  console.log("══════════════════════════════════════════════════");

  // ── PostgreSQL ──────────────────────────────────────────
  console.log("\n── PostgreSQL + pgvector ──");
  const pool = new Pool(PG_CONFIG);

  try {
    // 1. 连接测试
    const client = await pool.connect();
    const version = await client.query("SELECT version()");
    ok("PostgreSQL 连接");
    console.log("    " + version.rows[0].version.split(",")[0]);
    client.release();

    // 2. pgvector 扩展
    await pool.query("CREATE EXTENSION IF NOT EXISTS vector");
    const ext = await client.query("SELECT extversion FROM pg_extension WHERE extname = 'vector'");
    ok("pgvector 扩展", `版本 ${ext.rows[0].extversion}`);

    // 3. 创建测试表
    await pool.query(`
      DROP TABLE IF EXISTS rag_test_vectors;
      CREATE TABLE rag_test_vectors (
        id SERIAL PRIMARY KEY,
        content TEXT,
        metadata JSONB,
        embedding vector(3)
      )
    `);
    ok("创建向量表 (dim=3)");

    // 4. 插入测试向量
    await pool.query(
      `INSERT INTO rag_test_vectors (content, embedding) VALUES
       ('apple', '[1, 0, 0]'),
       ('banana', '[0, 1, 0]'),
       ('car', '[0, 0, 1]'),
       ('fruit salad', '[0.5, 0.5, 0]')`,
    );
    ok("插入 4 条测试向量");

    // 5. 余弦相似度查询
    const searchResult = await pool.query(
      `SELECT content, embedding <=> '[1, 0, 0]' AS distance
       FROM rag_test_vectors
       ORDER BY distance
       LIMIT 3`,
    );
    ok("余弦相似度查询");
    searchResult.rows.forEach((r) => console.log(`    ${r.content}: ${r.distance.toFixed(4)}`));

    // 6. 创建 ANN 索引
    await pool.query(
      `CREATE INDEX IF NOT EXISTS rag_test_idx ON rag_test_vectors
       USING ivfflat (embedding vector_cosine_ops) WITH (lists = 10)`,
    );
    ok("创建 ANN 索引 (ivfflat)");

    // 清理
    await pool.query("DROP TABLE IF EXISTS rag_test_vectors");
    ok("清理测试表");
  } catch (e) {
    fail("PostgreSQL", e.message);
  }

  // ── MongoDB ─────────────────────────────────────────────
  console.log("\n── MongoDB ──");
  let mongoClient;

  try {
    mongoClient = new MongoClient(MONGO_URL);
    await mongoClient.connect();
    ok("MongoDB 连接");

    const db = mongoClient.db("rag_test");
    const collection = db.collection("documents");

    // 1. 插入测试文档
    await collection.insertMany([
      { title: "Apple", content: "A red fruit", tags: ["fruit", "red"] },
      { title: "Banana", content: "A yellow fruit", tags: ["fruit", "yellow"] },
      { title: "Car", content: "A vehicle", tags: ["vehicle"] },
    ]);
    ok("插入 3 条测试文档");

    // 2. 查询文档
    const docs = await collection.find({ tags: "fruit" }).toArray();
    ok("标签查询", `找到 ${docs.length} 条文档`);

    // 3. 更新文档
    await collection.updateOne({ title: "Apple" }, { $set: { color: "red" } });
    ok("更新文档");

    // 4. 删除文档
    await collection.deleteOne({ title: "Car" });
    ok("删除文档");

    // 清理
    await db.dropDatabase();
    ok("清理测试数据库");
  } catch (e) {
    fail("MongoDB", e.message);
  } finally {
    await mongoClient?.close();
  }

  // ── 汇总 ────────────────────────────────────────────────
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
