/**
 * 验证脚本 4: 错误码与排查
 *
 * 验证以下结论：
 * 1. 错误响应格式统一
 * 2. 成功响应 code=0
 * 3. 各种错误码触发
 * 4. 错误处理最佳实践
 */

const TOKEN = "sk-7YEq9cOSL0gFLxtQnKWIFSf6zfh8SeMH6fCHirYfMAedDlzA";
const results = [];

// ── 验证 1: 成功响应格式 ──────────────────────────────────
console.log("=== 验证 1: 成功响应格式 ===");
const okResp = await fetch("https://mineru.net/api/v4/extract/task", {
  method: "POST",
  headers: { "Content-Type": "application/json", "Authorization": "Bearer " + TOKEN },
  body: JSON.stringify({ url: "https://cdn-mineru.openxlab.org.cn/demo/example.pdf" }),
});
const okJson = await okResp.json();
console.log("  code:", okJson.code, "(期望 0)");
console.log("  msg:", okJson.msg);
console.log("  trace_id:", okJson.trace_id);
console.log("  data.task_id:", okJson.data?.task_id ? "有" : "无");
results.push(["成功响应格式", okJson.code === 0 && okJson.data?.task_id ? "✅ 通过" : "❌ 失败"]);

// ── 验证 2: 无效 Token ────────────────────────────────────
console.log("\n=== 验证 2: 无效 Token ===");
const badTokenResp = await fetch("https://mineru.net/api/v4/extract/task", {
  method: "POST",
  headers: { "Content-Type": "application/json", "Authorization": "Bearer invalid-token" },
  body: JSON.stringify({ url: "https://example.com/test.pdf" }),
});
const badTokenJson = await badTokenResp.json();
console.log("  code:", badTokenJson.code);
console.log("  msg:", badTokenJson.msg);
results.push(["无效 Token", badTokenJson.code !== 0 ? "✅ 通过" : "❌ 失败"]);

// ── 验证 3: 空参数 ────────────────────────────────────────
console.log("\n=== 验证 3: 空参数 ===");
const emptyResp = await fetch("https://mineru.net/api/v4/extract/task", {
  method: "POST",
  headers: { "Content-Type": "application/json", "Authorization": "Bearer " + TOKEN },
  body: JSON.stringify({}),
});
const emptyJson = await emptyResp.json();
console.log("  code:", emptyJson.code);
console.log("  msg:", emptyJson.msg);
results.push(["空参数", emptyJson.code !== 0 ? "✅ 通过" : "❌ 失败"]);

// ── 验证 4: 无效 URL ──────────────────────────────────────
console.log("\n=== 验证 4: 无效 URL ===");
const invalidResp = await fetch("https://mineru.net/api/v4/extract/task", {
  method: "POST",
  headers: { "Content-Type": "application/json", "Authorization": "Bearer " + TOKEN },
  body: JSON.stringify({ url: "https://invalid-url-12345.com/file.pdf" }),
});
const invalidJson = await invalidResp.json();
console.log("  code:", invalidJson.code);
console.log("  msg:", invalidJson.msg);
results.push(["无效 URL", invalidJson.code !== 0 ? "✅ 通过" : "❌ 失败"]);

// ── 验证 5: 查询不存在的任务 ──────────────────────────────
console.log("\n=== 验证 5: 不存在任务 ===");
const notFoundResp = await fetch("https://mineru.net/api/v4/extract/task/00000000-0000-0000-0000-000000000000", {
  headers: { "Authorization": "Bearer " + TOKEN },
});
const notFoundJson = await notFoundResp.json();
console.log("  code:", notFoundJson.code);
console.log("  msg:", notFoundJson.msg);
results.push(["不存在任务", notFoundJson.code !== 0 ? "✅ 通过" : "❌ 失败"]);

// ── 汇总 ──────────────────────────────────────────────────
console.log("\n" + "═".repeat(50));
console.log("  验证 4 汇总");
console.log("═".repeat(50));
results.forEach(([name, r]) => console.log("  " + r + " " + name));
const passed = results.filter(([, r]) => r.includes("✅")).length;
console.log("\n  结果: " + passed + "/" + results.length + " 通过");
process.exit(passed === results.length ? 0 : 1);
