/**
 * 文件上传测试 - 方案 A: mineru::upload + 前端 PUT
 *
 * 不依赖 Channel，直接使用签名 URL 模式：
 * 1. 调用 mineru::upload 获取签名 URL
 * 2. 前端直接 PUT 文件到 OSS
 * 3. 轮询 mineru::batch_status
 * 4. 获取 Markdown 结果
 */

import { registerWorker } from "iii-sdk";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_URL = "ws://localhost:49134";
const TEST_FILE = path.join(__dirname, "test-sample.pdf");

const results = [];

function log(step, msg) {
  console.log(`\n▶ ${step}`);
  if (msg) console.log("  ", msg);
}

function ok(step, data) {
  results.push([step, "✅"]);
  console.log(`  ✓ ${step}`);
  if (data) console.log("    ", typeof data === "string" ? data : JSON.stringify(data, null, 2).slice(0, 200));
}

function fail(step, err) {
  results.push([step, "❌"]);
  console.log(`  ✗ ${step}: ${err}`);
}

async function main() {
  console.log("══════════════════════════════════════════════════");
  console.log("  文件上传测试 - 方案 A: 签名 URL + PUT");
  console.log("══════════════════════════════════════════════════");

  // 1. 连接引擎
  log("Step 1: 连接 iii 引擎");
  const worker = registerWorker(ENGINE_URL, {
    workerName: "verify-upload-simple",
    invocationTimeoutMs: 300_000,
  });
  await new Promise((r) => setTimeout(r, 1000));
  ok("连接引擎", ENGINE_URL);

  // 2. 准备测试文件
  log("Step 2: 准备测试文件");
  if (!fs.existsSync(TEST_FILE)) {
    const pdfContent = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>
endobj
4 0 obj
<< /Length 44 >>
stream
BT
/F1 24 Tf
100 700 Td
(Hello MinerU Test) Tj
ET
endstream
endobj
xref
0 5
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000115 00000 n
0000000206 00000 n
trailer
<< /Size 5 /Root 1 0 R >>
startxref
298
%%EOF`;
    fs.writeFileSync(TEST_FILE, pdfContent);
  }
  const fileBuffer = fs.readFileSync(TEST_FILE);
  const fileName = path.basename(TEST_FILE);
  ok("测试文件", `${fileName} (${fileBuffer.length} bytes)`);

  // 3. 获取签名上传 URL
  log("Step 3: 获取签名上传 URL (mineru::upload)");
  const uploadResult = await worker.trigger({
    function_id: "mineru::upload",
    payload: { filename: fileName, model_version: "pipeline" },
  });

  if (!uploadResult.ok || !uploadResult.batch_id || !uploadResult.upload_url) {
    fail("获取签名 URL", uploadResult.error || "未知错误");
    await worker.shutdown();
    process.exit(1);
  }
  ok("获取签名 URL", `batch_id: ${uploadResult.batch_id}`);
  const { batch_id, upload_url } = uploadResult;

  // 4. PUT 文件到 OSS
  log("Step 4: PUT 文件到 OSS");
  const putResp = await fetch(upload_url, {
    method: "PUT",
    body: fileBuffer,
  });
  if (putResp.ok) {
    ok("PUT 上传", `HTTP ${putResp.status}`);
  } else {
    fail("PUT 上传", `HTTP ${putResp.status}`);
    await worker.shutdown();
    process.exit(1);
  }

  // 5. 轮询进度
  log("Step 5: 轮询转换进度");
  let done = false;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const status = await worker.trigger({
      function_id: "mineru::batch_status",
      payload: { batch_id },
    });

    if (status.ok && status.results && status.results.length > 0) {
      const r = status.results[0];
      console.log(`  [${i + 1}] 状态: ${r.state}${r.err_msg ? " - " + r.err_msg : ""}`);

      if (r.state === "done") {
        ok("转换完成", `file: ${r.file_name}`);
        done = true;
        break;
      } else if (r.state === "failed") {
        fail("转换失败", r.err_msg || "未知错误");
        break;
      }
    }
  }
  if (!done) {
    fail("转换超时", "30 次轮询后仍未完成");
  }

  // 6. 获取 Markdown 结果
  log("Step 6: 获取 Markdown 结果");
  try {
    const result = await worker.trigger({
      function_id: "mineru::result",
      payload: { batch_id },
    });

    if (result.ok && result.markdown) {
      ok("获取 Markdown", `${result.markdown.length} 字符`);
      const outputPath = path.join(__dirname, "output-simple.md");
      fs.writeFileSync(outputPath, result.markdown);
      console.log("    已保存到:", outputPath);
      console.log("    预览:", result.markdown.slice(0, 100) + "...");
    } else {
      fail("获取 Markdown", result.error || "无内容");
    }
  } catch (e) {
    fail("获取 Markdown", e.message);
  }

  // ── 汇总 ────────────────────────────────────────────────
  console.log("\n══════════════════════════════════════════════════");
  console.log("  测试汇总");
  console.log("══════════════════════════════════════════════════");
  results.forEach(([step, status]) => {
    console.log(`  ${status} ${step}`);
  });

  const passed = results.filter(([, s]) => s === "✅").length;
  const total = results.length;
  console.log(`\n  结果: ${passed}/${total} 通过`);

  await worker.shutdown();
  process.exit(passed === total ? 0 : 1);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
