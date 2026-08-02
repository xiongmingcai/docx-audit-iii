/**
 * 文件上传测试 - 方案 B: Channel 模式 (iii-browser-sdk)
 *
 * 使用 iii-browser-sdk 的 Channel API：
 * 1. 创建 Channel
 * 2. 触发 mineru::channel_upload
 * 3. 流式写入文件字节
 * 4. 轮询进度
 * 5. 获取 Markdown 结果
 */

import { registerWorker } from "iii-browser-sdk";
import { createChannel } from "iii-browser-sdk/helpers";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// 注意：iii-browser-sdk@0.20.0 的 Channel API：
//   writer: { ensureConnected, sendMessage, sendBinary, close, sendRaw }
//   reader: { ensureConnected, onMessage, onBinary, readAll, close }
// 没有 .stream.write()，需要用 sendBinary() 发送二进制帧

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_URL = "ws://localhost:49134";
const TEST_FILE = path.join(__dirname, "real-sample.pdf");

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
  console.log("  文件上传测试 - 方案 B: Channel 模式");
  console.log("══════════════════════════════════════════════════");

  // 1. 连接引擎
  log("Step 1: 连接 iii 引擎 (iii-browser-sdk)");
  const worker = registerWorker(ENGINE_URL, {
    workerName: "verify-channel-upload",
    invocationTimeoutMs: 300_000,
  });
  await new Promise((r) => setTimeout(r, 1000));
  ok("连接引擎", ENGINE_URL);

  // 2. 准备测试文件
  log("Step 2: 准备测试文件");
  if (!fs.existsSync(TEST_FILE)) {
    console.log("  真实 PDF 不存在，请先下载");
    await worker.shutdown();
    process.exit(1);
  }
  const fileBuffer = fs.readFileSync(TEST_FILE);
  const fileName = path.basename(TEST_FILE);
  ok("测试文件", `${fileName} (${fileBuffer.length} bytes)`);

  // 3. 创建 Channel
  log("Step 3: 创建 Channel");
  let channel;
  try {
    channel = await createChannel(worker);
    ok("创建 Channel", `readerRef: ${JSON.stringify(channel.readerRef).slice(0, 60)}...`);
  } catch (e) {
    fail("创建 Channel", e.message);
    await worker.shutdown();
    process.exit(1);
  }

  // 4. 触发 Worker
  log("Step 4: 触发 mineru::channel_upload");
  const uploadPromise = worker.trigger({
    function_id: "mineru::channel_upload",
    payload: {
      reader: channel.readerRef,
      filename: fileName,
      model_version: "pipeline",
      language: "ch",
    },
  });
  ok("触发 Worker", "mineru::channel_upload");

  // 5. 流式写入文件字节（使用 sendBinary）
  log("Step 5: 流式写入文件字节到 Channel");
  await channel.writer.ensureConnected();
  const chunkSize = 64 * 1024; // 64KB
  let offset = 0;
  let chunkCount = 0;

  while (offset < fileBuffer.length) {
    const end = Math.min(offset + chunkSize, fileBuffer.length);
    const chunk = fileBuffer.subarray(offset, end);
    channel.writer.sendBinary(chunk);
    offset = end;
    chunkCount++;

    // 每 10 个 chunk 报告进度
    if (chunkCount % 10 === 0) {
      console.log(`    已发送 ${chunkCount} chunks (${offset}/${fileBuffer.length} bytes)`);
    }
  }
  channel.writer.close();
  ok("写入文件字节", `${chunkCount} chunks, ${fileBuffer.length} bytes`);

  // 6. 等待 Worker 完成
  log("Step 6: 等待 Worker 完成上传");
  let uploadResult;
  try {
    uploadResult = await uploadPromise;
    if (uploadResult.ok && uploadResult.batch_id) {
      ok("Worker 上传完成", `batch_id: ${uploadResult.batch_id}`);
    } else {
      fail("Worker 上传", uploadResult.error || "未知错误");
    }
  } catch (e) {
    fail("Worker 上传", e.message);
  }

  // 7. 轮询进度
  if (uploadResult?.batch_id) {
    log("Step 7: 轮询转换进度");
    const batchId = uploadResult.batch_id;
    let done = false;

    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const status = await worker.trigger({
        function_id: "mineru::batch_status",
        payload: { batch_id: batchId },
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
  }

  // 8. 获取 Markdown 结果
  if (uploadResult?.batch_id) {
    log("Step 8: 获取 Markdown 结果");
    try {
      const result = await worker.trigger({
        function_id: "mineru::result",
        payload: { batch_id: uploadResult.batch_id },
      });

      if (result.ok && result.markdown) {
        ok("获取 Markdown", `${result.markdown.length} 字符`);
        const outputPath = path.join(__dirname, "output-channel.md");
        fs.writeFileSync(outputPath, result.markdown);
        console.log("    已保存到:", outputPath);
        console.log("    预览:", result.markdown.slice(0, 100) + "...");
      } else {
        fail("获取 Markdown", result.error || "无内容");
      }
    } catch (e) {
      fail("获取 Markdown", e.message);
    }
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
