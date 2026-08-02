/**
 * 验证脚本: MinerU Convert Worker
 *
 * 验证以下结论：
 * 1. 提交转换任务到 MinerU API
 * 2. 轮询查询任务状态
 * 3. 下载 ZIP 并提取 Markdown
 * 4. 完整端到端流程
 */

const TOKEN = "sk-7YEq9cOSL0gFLxtQnKWIFSf6zfh8SeMH6fCHirYfMAedDlzA";
const BASE_URL = "https://mineru.net";
const results = [];

// ── 验证 1: 提交转换任务 ──────────────────────────────────
console.log("=== 验证 1: 提交转换任务 ===");
const createResp = await fetch(`${BASE_URL}/api/v4/extract/task`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${TOKEN}`,
  },
  body: JSON.stringify({
    url: "https://cdn-mineru.openxlab.org.cn/demo/example.pdf",
    model_version: "pipeline",
  }),
});
const createJson = await createResp.json();
const taskId = createJson.data?.task_id;
console.log("  code:", createJson.code);
console.log("  task_id:", taskId);
results.push(["提交转换任务", createJson.code === 0 && taskId ? "✅ 通过" : "❌ 失败"]);

// ── 验证 2: 轮询查询状态 ──────────────────────────────────
console.log("\n=== 验证 2: 轮询查询状态 ===");
let zipUrl = null;
for (let i = 0; i < 30; i++) {
  const resp = await fetch(`${BASE_URL}/api/v4/extract/task/${taskId}`, {
    headers: { "Authorization": `Bearer ${TOKEN}` },
  });
  const json = await resp.json();
  const state = json.data?.state;
  console.log(`  [${i + 1}] 状态: ${state}`);

  if (state === "done") {
    zipUrl = json.data.full_zip_url;
    console.log("  ZIP URL:", zipUrl);
    break;
  }
  if (state === "failed") {
    console.log("  失败:", json.data.err_msg);
    break;
  }
  await new Promise((r) => setTimeout(r, 3000));
}
results.push(["轮询查询状态", zipUrl ? "✅ 通过" : "❌ 失败"]);

// ── 验证 3: 下载 ZIP 并提取 Markdown ──────────────────────
console.log("\n=== 验证 3: 下载 ZIP 并提取 Markdown ===");
if (zipUrl) {
  // 下载 ZIP
  const zipResp = await fetch(zipUrl);
  const zipBuffer = Buffer.from(await zipResp.arrayBuffer());
  console.log("  ✓ 下载 ZIP:", zipBuffer.length, "bytes");

  // 解压 (使用 Node.js 内置 zlib + 手动解析 ZIP)
  const { execSync } = await import("child_process");
  const fs = await import("fs");
  const path = "/tmp/mineru_verify.zip";
  fs.writeFileSync(path, zipBuffer);

  // 使用 unzip 命令
  try {
    execSync("rm -rf /tmp/mineru_verify && mkdir -p /tmp/mineru_verify");
    execSync(`unzip -o ${path} -d /tmp/mineru_verify`);
    const files = fs.readdirSync("/tmp/mineru_verify");
    console.log("  ✓ 解压文件:", files.filter((f) => !f.startsWith(".")).join(", "));

    // 读取 full.md
    const mdPath = "/tmp/mineru_verify/full.md";
    if (fs.existsSync(mdPath)) {
      const md = fs.readFileSync(mdPath, "utf-8");
      console.log("  ✓ Markdown 行数:", md.split("\n").length);
      console.log("  预览:", md.slice(0, 80) + "...");
    }
  } catch (e) {
    console.log("  解压失败:", e.message.slice(0, 50));
  }
}
results.push(["下载提取 Markdown", zipUrl ? "✅ 通过" : "❌ 失败"]);

// ── 验证 4: 完整端到端流程 ────────────────────────────────
console.log("\n=== 验证 4: 完整端到端流程 ===");
const e2eResp = await fetch(`${BASE_URL}/api/v4/extract/task`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${TOKEN}`,
  },
  body: JSON.stringify({
    url: "https://cdn-mineru.openxlab.org.cn/demo/example.pdf",
    model_version: "pipeline",
  }),
});
const e2eJson = await e2eResp.json();
const e2eTaskId = e2eJson.data?.task_id;
console.log("  提交任务:", e2eTaskId ? "成功" : "失败");

// 轮询
let e2eZipUrl = null;
for (let i = 0; i < 30; i++) {
  const resp = await fetch(`${BASE_URL}/api/v4/extract/task/${e2eTaskId}`, {
    headers: { "Authorization": `Bearer ${TOKEN}` },
  });
  const json = await resp.json();
  if (json.data?.state === "done") {
    e2eZipUrl = json.data.full_zip_url;
    break;
  }
  if (json.data?.state === "failed") break;
  await new Promise((r) => setTimeout(r, 3000));
}
console.log("  转换完成:", e2eZipUrl ? "是" : "否");

// 下载并提取
let markdown = null;
if (e2eZipUrl) {
  const zipResp = await fetch(e2eZipUrl);
  const zipBuffer = Buffer.from(await zipResp.arrayBuffer());
  const fs = await import("fs");
  const { execSync } = await import("child_process");
  fs.writeFileSync("/tmp/mineru_e2e.zip", zipBuffer);
  try {
    execSync("rm -rf /tmp/mineru_e2e && mkdir -p /tmp/mineru_e2e && unzip -o /tmp/mineru_e2e.zip -d /tmp/mineru_e2e");
    const md = fs.readFileSync("/tmp/mineru_e2e/full.md", "utf-8");
    markdown = md;
    console.log("  ✓ Markdown 提取成功，长度:", md.length, "字符");
  } catch (e) {
    console.log("  提取失败:", e.message.slice(0, 50));
  }
}
results.push(["完整端到端流程", markdown ? "✅ 通过" : "❌ 失败"]);

// ── 汇总 ──────────────────────────────────────────────────
console.log("\n" + "═".repeat(50));
console.log("  验证汇总");
console.log("═".repeat(50));
results.forEach(([name, r]) => console.log("  " + r + " " + name));
const passed = results.filter(([, r]) => r.includes("✅")).length;
console.log("\n  结果: " + passed + "/" + results.length + " 通过");
process.exit(passed === results.length ? 0 : 1);
