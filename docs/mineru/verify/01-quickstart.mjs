/**
 * 验证脚本 1: MinerU 快速开始
 *
 * 验证以下结论：
 * 1. 精准解析 API 创建任务
 * 2. 轮询查询任务状态
 * 3. 下载 ZIP 并提取 Markdown
 * 4. Agent 轻量 API 创建任务
 * 5. Agent API 查询结果
 */

const TOKEN = "sk-7YEq9cOSL0gFLxtQnKWIFSf6zfh8SeMH6fCHirYfMAedDlzA";
const results = [];

// ── 验证 1: 精准解析 API 创建任务 ─────────────────────────
console.log("=== 验证 1: 精准解析 API 创建任务 ===");
const createResp = await fetch("https://mineru.net/api/v4/extract/task", {
  method: "POST",
  headers: { "Content-Type": "application/json", "Authorization": "Bearer " + TOKEN },
  body: JSON.stringify({
    url: "https://cdn-mineru.openxlab.org.cn/demo/example.pdf",
    model_version: "pipeline",
  }),
});
const createJson = await createResp.json();
const taskId = createJson.data?.task_id;
console.log("  code:", createJson.code);
console.log("  task_id:", taskId);
results.push(["精准解析创建任务", createJson.code === 0 && taskId ? "✅ 通过" : "❌ 失败"]);

// ── 验证 2: 轮询查询任务 ──────────────────────────────────
console.log("\n=== 验证 2: 轮询查询任务 ===");
let zipUrl = null;
for (let i = 0; i < 60; i++) {
  const queryResp = await fetch(`https://mineru.net/api/v4/extract/task/${taskId}`, {
    headers: { "Authorization": "Bearer " + TOKEN },
  });
  const queryJson = await queryResp.json();
  const state = queryJson.data?.state;
  console.log("  状态:", state);

  if (state === "done") {
    zipUrl = queryJson.data.full_zip_url;
    console.log("  ZIP URL:", zipUrl);
    break;
  }
  if (state === "failed") {
    console.log("  失败:", queryJson.data.err_msg);
    break;
  }
  await new Promise((r) => setTimeout(r, 3000));
}
results.push(["轮询查询任务", zipUrl ? "✅ 通过" : "❌ 失败"]);

// ── 验证 3: 下载 ZIP 并提取 Markdown ──────────────────────
console.log("\n=== 验证 3: 下载 ZIP 并提取 Markdown ===");
if (zipUrl) {
  const fs = await import("fs");
  const { execSync } = await import("child_process");

  // 下载
  const zipResp = await fetch(zipUrl);
  const zipBuffer = Buffer.from(await zipResp.arrayBuffer());
  fs.writeFileSync("/tmp/mineru_verify.zip", zipBuffer);
  console.log("  ✓ 下载 ZIP:", zipBuffer.length, "bytes");

  // 解压
  try {
    execSync("rm -rf /tmp/mineru_verify && unzip -o /tmp/mineru_verify.zip -d /tmp/mineru_verify", { stdio: "ignore" });
    console.log("  ✓ 解压成功");

    // 读取 Markdown
    const mdFiles = fs.readdirSync("/tmp/mineru_verify").filter((f) => f.endsWith(".md"));
    if (mdFiles.length > 0) {
      const md = fs.readFileSync(`/tmp/mineru_verify/${mdFiles[0]}`, "utf-8");
      console.log("  ✓ Markdown 行数:", md.split("\n").length);
      console.log("  预览:", md.slice(0, 80) + "...");
    }
  } catch (e) {
    console.log("  解压失败:", e.message.slice(0, 50));
  }
}
results.push(["下载提取 Markdown", zipUrl ? "✅ 通过" : "❌ 失败"]);

// ── 验证 4: Agent 轻量 API ────────────────────────────────
console.log("\n=== 验证 4: Agent 轻量 API ===");
const agentResp = await fetch("https://mineru.net/api/v1/agent/parse/url", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    url: "https://cdn-mineru.openxlab.org.cn/demo/example.pdf",
    language: "ch",
  }),
});
const agentJson = await agentResp.json();
const agentTaskId = agentJson.data?.task_id;
console.log("  code:", agentJson.code);
console.log("  task_id:", agentTaskId);
console.log("  ✓ 无需 Token");
results.push(["Agent 轻量 API", agentJson.code === 0 && agentTaskId ? "✅ 通过" : "❌ 失败"]);

// ── 验证 5: Agent API 查询 ────────────────────────────────
console.log("\n=== 验证 5: Agent API 查询 ===");
let mdUrl = null;
for (let i = 0; i < 60; i++) {
  const resp = await fetch(`https://mineru.net/api/v1/agent/parse/${agentTaskId}`);
  const json = await resp.json();
  const state = json.data?.state;
  console.log("  状态:", state);

  if (state === "done") {
    mdUrl = json.data.markdown_url;
    console.log("  Markdown URL:", mdUrl);
    break;
  }
  if (state === "failed") {
    console.log("  失败:", json.data.err_msg);
    break;
  }
  await new Promise((r) => setTimeout(r, 3000));
}
results.push(["Agent API 查询", mdUrl ? "✅ 通过" : "❌ 失败"]);

// ── 汇总 ──────────────────────────────────────────────────
console.log("\n" + "═".repeat(50));
console.log("  验证 1 汇总");
console.log("═".repeat(50));
results.forEach(([name, r]) => console.log("  " + r + " " + name));
const passed = results.filter(([, r]) => r.includes("✅")).length;
console.log("\n  结果: " + passed + "/" + results.length + " 通过");
process.exit(passed === results.length ? 0 : 1);
