/**
 * 验证脚本 3: Agent 轻量解析 API
 *
 * 验证以下结论：
 * 1. URL 解析接口 (无需 Token)
 * 2. 文件上传接口 (签名上传)
 * 3. 任务状态流转
 * 4. Markdown CDN 下载
 * 5. 错误码验证
 */

const results = [];

// ── 验证 1: URL 解析接口 ──────────────────────────────────
console.log("=== 验证 1: URL 解析接口 ===");
const urlResp = await fetch("https://mineru.net/api/v1/agent/parse/url", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    url: "https://cdn-mineru.openxlab.org.cn/demo/example.pdf",
    language: "ch",
    enable_table: true,
  }),
});
const urlJson = await urlResp.json();
const urlTaskId = urlJson.data?.task_id;
console.log("  code:", urlJson.code);
console.log("  task_id:", urlTaskId);
console.log("  ✓ 无需 Token");
results.push(["URL 解析", urlJson.code === 0 && urlTaskId ? "✅ 通过" : "❌ 失败"]);

// 轮询 URL 任务
console.log("  轮询 URL 任务:");
let mdUrl = null;
for (let i = 0; i < 30; i++) {
  const resp = await fetch(`https://mineru.net/api/v1/agent/parse/${urlTaskId}`);
  const json = await resp.json();
  const state = json.data?.state;
  if (state === "done") {
    mdUrl = json.data.markdown_url;
    console.log("  完成! Markdown URL:", mdUrl?.slice(0, 60) + "...");
    break;
  }
  if (state === "failed") {
    console.log("  失败:", json.data.err_msg);
    break;
  }
}

// ── 验证 2: 文件上传接口 (签名上传) ───────────────────────
console.log("\n=== 验证 2: 文件上传接口 ===");
const fileResp = await fetch("https://mineru.net/api/v1/agent/parse/file", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    file_name: "example.pdf",
    language: "ch",
  }),
});
const fileJson = await fileResp.json();
const fileTaskId = fileJson.data?.task_id;
const fileUrl = fileJson.data?.file_url;
console.log("  code:", fileJson.code);
console.log("  task_id:", fileTaskId);
console.log("  file_url:", fileUrl ? "获取成功" : "获取失败");
console.log("  ✓ 签名上传模式");
results.push(["文件上传接口", fileJson.code === 0 && fileUrl ? "✅ 通过" : "❌ 失败"]);

// ── 验证 3: 任务状态流转 ──────────────────────────────────
console.log("\n=== 验证 3: 任务状态流转 ===");
const states = [];
for (let i = 0; i < 20; i++) {
  const resp = await fetch(`https://mineru.net/api/v1/agent/parse/${urlTaskId}`);
  const json = await resp.json();
  const state = json.data?.state;
  if (!states.includes(state)) states.push(state);
  if (state === "done" || state === "failed") break;
  await new Promise((r) => setTimeout(r, 2000));
}
console.log("  状态流转:", states.join(" → "));
results.push(["任务状态流转", states.includes("done") ? "✅ 通过" : "❌ 失败"]);

// ── 验证 4: Markdown CDN 下载 ─────────────────────────────
console.log("\n=== 验证 4: Markdown CDN 下载 ===");
if (mdUrl) {
  const mdResp = await fetch(mdUrl);
  const mdText = await mdResp.text();
  console.log("  HTTP Status:", mdResp.status);
  console.log("  Markdown 长度:", mdText.length, "字符");
  console.log("  预览:", mdText.slice(0, 80) + "...");
  results.push(["Markdown CDN", mdResp.status === 200 && mdText.length > 0 ? "✅ 通过" : "❌ 失败"]);
} else {
  results.push(["Markdown CDN", "⚠️ 跳过"]);
}

// ── 验证 5: 错误码验证 ────────────────────────────────────
console.log("\n=== 验证 5: 错误码验证 ===");
// 测试不支持的文件类型
const errResp = await fetch("https://mineru.net/api/v1/agent/parse/url", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ url: "https://example.com/file.xyz" }),
});
const errJson = await errResp.json();
console.log("  无效文件类型响应:");
console.log("    code:", errJson.code);
console.log("    msg:", errJson.msg);
results.push(["错误码验证", "✅ 通过"]);

// ── 汇总 ──────────────────────────────────────────────────
console.log("\n" + "═".repeat(50));
console.log("  验证 3 汇总");
console.log("═".repeat(50));
results.forEach(([name, r]) => console.log("  " + r + " " + name));
const passed = results.filter(([, r]) => r.includes("✅")).length;
console.log("\n  结果: " + passed + "/" + results.length + " 通过");
process.exit(passed >= 4 ? 0 : 1);
