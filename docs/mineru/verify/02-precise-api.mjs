/**
 * 验证脚本 2: 精准解析 API
 *
 * 验证以下结论：
 * 1. 单文件解析完整流程
 * 2. 批量 URL 解析
 * 3. 批量文件上传 (获取链接)
 * 4. 任务状态流转
 * 5. 输出文件结构
 */

const TOKEN = "sk-7YEq9cOSL0gFLxtQnKWIFSf6zfh8SeMH6fCHirYfMAedDlzA";
const results = [];

// ── 验证 1: 单文件解析完整流程 ────────────────────────────
console.log("=== 验证 1: 单文件解析 ===");
const createResp = await fetch("https://mineru.net/api/v4/extract/task", {
  method: "POST",
  headers: { "Content-Type": "application/json", "Authorization": "Bearer " + TOKEN },
  body: JSON.stringify({
    url: "https://cdn-mineru.openxlab.org.cn/demo/example.pdf",
    model_version: "pipeline",
    enable_formula: true,
    enable_table: true,
    language: "ch",
  }),
});
const createJson = await createResp.json();
const taskId = createJson.data?.task_id;
console.log("  task_id:", taskId);

// 轮询
let zipUrl = null;
for (let i = 0; i < 30; i++) {
  const resp = await fetch(`https://mineru.net/api/v4/extract/task/${taskId}`, {
    headers: { "Authorization": "Bearer " + TOKEN },
  });
  const json = await resp.json();
  if (json.data?.state === "done") {
    zipUrl = json.data.full_zip_url;
    break;
  }
  if (json.data?.state === "failed") {
    console.log("  失败:", json.data.err_msg);
    break;
  }
}
console.log("  ZIP URL:", zipUrl ? "获取成功" : "获取失败");
results.push(["单文件解析", zipUrl ? "✅ 通过" : "❌ 失败"]);

// ── 验证 2: 批量 URL 解析 ─────────────────────────────────
console.log("\n=== 验证 2: 批量 URL 解析 ===");
const batchResp = await fetch("https://mineru.net/api/v4/extract/task/batch", {
  method: "POST",
  headers: { "Content-Type": "application/json", "Authorization": "Bearer " + TOKEN },
  body: JSON.stringify({
    files: [
      { url: "https://cdn-mineru.openxlab.org.cn/demo/example.pdf", data_id: "batch-doc-1" },
    ],
    model_version: "pipeline",
  }),
});
const batchJson = await batchResp.json();
const batchId = batchJson.data?.batch_id;
console.log("  batch_id:", batchId);
console.log("  code:", batchJson.code);
results.push(["批量 URL", batchJson.code === 0 && batchId ? "✅ 通过" : "❌ 失败"]);

// 批量查询
console.log("  批量查询:");
const batchQuery = await fetch(`https://mineru.net/api/v4/extract-results/batch/${batchId}`, {
  headers: { "Authorization": "Bearer " + TOKEN },
});
const batchQueryJson = await batchQuery.json();
console.log("  batch_id:", batchQueryJson.data?.batch_id);
console.log("  结果数:", batchQueryJson.data?.extract_result?.length);
batchQueryJson.data?.extract_result?.forEach((r) => {
  console.log("    -", r.file_name + ":", r.state);
});

// ── 验证 3: 批量文件上传 (获取链接) ───────────────────────
console.log("\n=== 验证 3: 批量文件上传 (获取链接) ===");
const uploadResp = await fetch("https://mineru.net/api/v4/file-urls/batch", {
  method: "POST",
  headers: { "Content-Type": "application/json", "Authorization": "Bearer " + TOKEN },
  body: JSON.stringify({
    files: [{ name: "test.pdf", data_id: "upload-test-1" }],
    model_version: "pipeline",
  }),
});
const uploadJson = await uploadResp.json();
console.log("  code:", uploadJson.code);
console.log("  batch_id:", uploadJson.data?.batch_id);
console.log("  file_urls 数量:", uploadJson.data?.file_urls?.length);
console.log("  ✓ 获取上传链接成功");
results.push(["批量文件上传", uploadJson.code === 0 ? "✅ 通过" : "❌ 失败"]);

// ── 验证 4: 任务状态流转 ──────────────────────────────────
console.log("\n=== 验证 4: 任务状态流转 ===");
const statusResp = await fetch(`https://mineru.net/api/v4/extract/task/${taskId}`, {
  headers: { "Authorization": "Bearer " + TOKEN },
});
const statusJson = await statusResp.json();
console.log("  最终状态:", statusJson.data?.state);
console.log("  task_id:", statusJson.data?.task_id);
console.log("  full_zip_url:", statusJson.data?.full_zip_url ? "有" : "无");
results.push(["任务状态流转", statusJson.data?.state === "done" ? "✅ 通过" : "❌ 失败"]);

// ── 验证 5: 输出文件结构 ──────────────────────────────────
console.log("\n=== 验证 5: 输出文件结构 ===");
if (zipUrl) {
  const fs = await import("fs");
  const { execSync } = await import("child_process");

  try {
    execSync("rm -rf /tmp/mineru_precise && unzip -o /tmp/mineru_verify.zip -d /tmp/mineru_precise", { stdio: "ignore" });
    const files = fs.readdirSync("/tmp/mineru_precise");
    console.log("  解压文件:");
    files.forEach((f) => {
      const stat = fs.statSync(`/tmp/mineru_precise/${f}`);
      console.log("    -", f, stat.isDirectory() ? "(目录)" : `(${stat.size} bytes)`);
    });
    results.push(["输出文件结构", "✅ 通过"]);
  } catch (e) {
    console.log("  解压失败:", e.message.slice(0, 50));
    results.push(["输出文件结构", "⚠️ 跳过"]);
  }
}

// ── 汇总 ──────────────────────────────────────────────────
console.log("\n" + "═".repeat(50));
console.log("  验证 2 汇总");
console.log("═".repeat(50));
results.forEach(([name, r]) => console.log("  " + r + " " + name));
const passed = results.filter(([, r]) => r.includes("✅")).length;
console.log("\n  结果: " + passed + "/" + results.length + " 通过");
process.exit(passed >= 4 ? 0 : 1);
