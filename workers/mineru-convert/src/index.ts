/**
 * MinerU Convert Worker — Queue 异步架构
 *
 * 基于 III Queue 的异步文档转换：
 *   ① mineru::convert  (HTTP Trigger) — 入队，秒级返回 task_id
 *   ② mineru::process  (Queue Consumer) — 异步消费，调用 MinerU API
 *   ③ mineru::status   (HTTP Trigger) — 查询转换进度
 *   ④ mineru::result   (HTTP Trigger) — 获取 Markdown 结果
 *
 * Queue 配置:
 *   - max_retries: 3
 *   - concurrency: 5
 *   - type: standard
 *   - backoff_ms: 1000
 */

import { registerWorker, TriggerAction } from "iii-sdk";

// ── 配置 ──────────────────────────────────────────────────
const ENGINE_URL = process.env.III_ENGINE_URL || "ws://localhost:49134";
const MINERU_BASE_URL = "https://mineru.net";
const QUEUE_NAME = "mineru-jobs";

// Token 从环境变量或 iii-state 读取（遵循 BACKGROUND-TASKS.md 配置注入约定）
let _cachedMineruToken = process.env.MINERU_TOKEN || "";

async function getMineruToken(workerClient: ReturnType<typeof registerWorker>): Promise<string> {
  if (_cachedMineruToken) return _cachedMineruToken;
  try {
    const cfg = await workerClient.trigger({
      function_id: "state::get",
      payload: { scope: "global", key: "mineru-config" },
    }) as { token?: string } | null;
    if (cfg?.token) {
      _cachedMineruToken = cfg.token;
      return _cachedMineruToken;
    }
  } catch {
    // 忽略读取失败
  }
  return _cachedMineruToken;
}

// ── Worker 注册 ───────────────────────────────────────────
const worker = registerWorker(ENGINE_URL, {
  workerName: "mineru-convert",
  workerDescription: "文档转 Markdown 服务 — Queue 异步架构",
});

// ── 类型定义 ──────────────────────────────────────────────
interface ConvertPayload {
  url?: string;
  filename?: string;
  model_version?: "pipeline" | "vlm" | "MinerU-HTML";
  is_ocr?: boolean;
  enable_formula?: boolean;
  enable_table?: boolean;
  language?: string;
  data_id?: string;
  page_ranges?: string;
  callback?: string;  // 可选：转换完成后的回调 URL
}

interface ConvertResult {
  ok: boolean;
  task_id?: string;
  mineru_task_id?: string;
  state?: string;
  error?: string;
}

interface StatusResult {
  ok: boolean;
  state?: string;
  progress?: { extracted: number; total: number };
  markdown?: string;
  error?: string;
}

// 文件上传模式：获取签名 URL 和 batch_id
interface UploadPayload {
  filename: string;
  model_version?: string;
  language?: string;
}

interface UploadResult {
  ok: boolean;
  batch_id?: string;
  upload_url?: string;  // 前端直接 PUT 到此 URL
  error?: string;
}

// Channel 模式：通过 Channel 流式接收文件字节
interface ChannelUploadResult {
  ok: boolean;
  batch_id?: string;
  error?: string;
}

// 批量任务状态
interface BatchStatusResult {
  ok: boolean;
  error?: string;
  results?: Array<{
    file_name: string;
    state: string;
    full_zip_url?: string;
    err_msg?: string;
  }>;
}

// ── MinerU API 封装 ───────────────────────────────────────

async function submitToMinerU(
  url: string,
  token: string,
  options: Record<string, unknown> = {},
): Promise<{ task_id: string }> {
  const body: Record<string, unknown> = { url, ...options };

  const resp = await fetch(`${MINERU_BASE_URL}/api/v4/extract/task`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  const json = await resp.json();
  if (json.code !== 0) {
    throw new Error(`MinerU 提交失败 [${json.code}]: ${json.msg}`);
  }
  return json.data;
}

async function queryMinerUStatus(
  taskId: string,
  token: string,
): Promise<{
  state: string;
  full_zip_url?: string;
  err_msg?: string;
  extracted_pages?: number;
  total_pages?: number;
}> {
  const resp = await fetch(`${MINERU_BASE_URL}/api/v4/extract/task/${taskId}`, {
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
  });

  const json = await resp.json();
  if (json.code !== 0) {
    throw new Error(`MinerU 查询失败 [${json.code}]: ${json.msg}`);
  }
  return json.data;
}

/**
 * 获取文件上传的签名 URL 和 batch_id
 * 前端拿到 upload_url 后直接 PUT 文件到 OSS
 */
async function getUploadUrl(
  filename: string,
  token: string,
  options: { model_version?: string; language?: string } = {},
): Promise<{ batch_id: string; upload_url: string }> {
  const body: Record<string, unknown> = {
    files: [{ name: filename }],
  };
  if (options.model_version) body.model_version = options.model_version;
  if (options.language) body.language = options.language;

  const resp = await fetch(`${MINERU_BASE_URL}/api/v4/file-urls/batch`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  const json = await resp.json();
  if (json.code !== 0) {
    throw new Error(`获取上传 URL 失败 [${json.code}]: ${json.msg}`);
  }
  return {
    batch_id: json.data.batch_id,
    upload_url: json.data.file_urls[0],
  };
}

/**
 * 通过 Channel 读取文件字节并上传到 MinerU OSS
 *
 * 流程:
 *   1. 从 Channel 读取文件字节（流式，无大小限制）
 *   2. POST /api/v4/file-urls/batch 获取签名上传 URL
 *   3. PUT 文件字节到 OSS
 *   4. 返回 batch_id
 *
 * 优势:
 *   - 文件内容不经过 JSON payload，无 16MB 限制
 *   - 支持任意大小文件（PDF/Docx/PPT/Excel/图片）
 *   - 前端流式写入，Worker 流式读取
 */
async function uploadViaChannel(
  reader: { stream: AsyncIterable<Buffer> },
  filename: string,
  token: string,
  options: { model_version?: string; language?: string } = {},
): Promise<{ batch_id: string }> {
  // Step 1: 从 Channel 读取文件字节
  const chunks: Buffer[] = [];

  for await (const chunk of reader.stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const fileBuffer = Buffer.concat(chunks);

  if (fileBuffer.length === 0) {
    throw new Error("Channel 中未收到文件数据");
  }

  // Step 2: 获取签名上传 URL
  const { batch_id, upload_url } = await getUploadUrl(filename, token, options);

  // Step 3: PUT 文件字节到 OSS
  const putResp = await fetch(upload_url, {
    method: "PUT",
    body: fileBuffer,
  });

  if (!putResp.ok) {
    throw new Error(`上传到 OSS 失败: HTTP ${putResp.status}`);
  }

  return { batch_id };
}

/**
 * 查询批量任务状态
 */
async function queryBatchStatus(
  batchId: string,
  token: string,
): Promise<BatchStatusResult> {
  const resp = await fetch(
    `${MINERU_BASE_URL}/api/v4/extract-results/batch/${batchId}`,
    {
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
    },
  );

  const json = await resp.json();
  if (json.code !== 0) {
    return { ok: false, error: json.msg };
  }
  return {
    ok: true,
    results: json.data?.extract_result?.map((r: any) => ({
      file_name: r.file_name,
      state: r.state,
      full_zip_url: r.full_zip_url,
      err_msg: r.err_msg,
    })),
  };
}

// Token 获取辅助（从缓存或 iii-state）
async function resolveToken(): Promise<string> {
  return await getMineruToken(worker);
}

async function extractMarkdownFromZip(zipUrl: string): Promise<string> {
  const fs = await import("node:fs");
  const { execSync } = await import("node:child_process");

  const zipResp = await fetch(zipUrl);
  if (!zipResp.ok) {
    throw new Error(`下载 ZIP 失败: HTTP ${zipResp.status}`);
  }
  const zipBuffer = Buffer.from(await zipResp.arrayBuffer());

  const tmpDir = `/tmp/mineru-${Date.now()}`;
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.writeFileSync(`${tmpDir}/result.zip`, zipBuffer);

  try {
    execSync(`unzip -o ${tmpDir}/result.zip -d ${tmpDir}`);
  } catch {
    throw new Error("ZIP 解压失败");
  }

  const mdPath = `${tmpDir}/full.md`;
  if (!fs.existsSync(mdPath)) {
    throw new Error("ZIP 中未找到 full.md");
  }

  const markdown = fs.readFileSync(mdPath, "utf-8");
  try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }

  return markdown;
}

// ── Function 1: mineru::convert (HTTP → 入队) ─────────────

/**
 * 提交文档转换任务到 Queue。
 *
 * 流程:
 *   1. 验证输入
 *   2. 提交到 MinerU API 获取 mineru_task_id
 *   3. 将 mineru_task_id 入队等待异步处理
 *   4. 立即返回 { task_id, mineru_task_id }
 */
async function fnConvert(payload: ConvertPayload): Promise<ConvertResult> {
  try {
    if (!payload.url) {
      return { ok: false, error: "缺少 url" };
    }
    const token = await resolveToken();
    if (!token) {
      return { ok: false, error: "MINERU_TOKEN 未配置" };
    }

    // 提交到 MinerU
    const result = await submitToMinerU(payload.url, token, {
      model_version: payload.model_version || "pipeline",
      is_ocr: payload.is_ocr,
      enable_formula: payload.enable_formula,
      enable_table: payload.enable_table,
      language: payload.language || "ch",
      data_id: payload.data_id,
      page_ranges: payload.page_ranges,
    });

    const mineruTaskId = result.task_id;

    // 入队等待异步处理
    const enqueueResult = await worker.trigger({
      function_id: "mineru::process",
      payload: {
        mineru_task_id: mineruTaskId,
        callback: payload.callback,
      },
      action: TriggerAction.Enqueue({ queue: QUEUE_NAME }),
    });

    return {
      ok: true,
      task_id: (enqueueResult as { messageReceiptId?: string })?.messageReceiptId,
      mineru_task_id: mineruTaskId,
      state: "queued",
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ── Function 2: mineru::process (Queue 消费者) ─────────────

/**
 * Queue 消费者：异步处理 MinerU 转换。
 *
 * 流程:
 *   1. 轮询 MinerU API 等待转换完成
 *   2. 下载 ZIP 并提取 Markdown
 *   3. 存储结果到 iii-state
 *   4. 可选：调用 callback URL 通知完成
 *
 * 重试策略: 由 Queue 自动处理 (max_retries: 3, backoff: 1s)
 */
async function fnProcess(payload: {
  mineru_task_id: string;
  callback?: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    if (!payload.mineru_task_id) {
      return { ok: false, error: "缺少 mineru_task_id" };
    }
    const token = await resolveToken();
    if (!token) {
      return { ok: false, error: "MINERU_TOKEN 未配置" };
    }

    // 轮询等待 MinerU 完成 (最多 5 分钟)
    let zipUrl: string | undefined;
    for (let i = 0; i < 100; i++) {
      const status = await queryMinerUStatus(payload.mineru_task_id, token);

      if (status.state === "done") {
        zipUrl = status.full_zip_url;
        break;
      }
      if (status.state === "failed") {
        return { ok: false, error: `MinerU 转换失败: ${status.err_msg}` };
      }

      // 等待 3 秒后重试
      await new Promise((r) => setTimeout(r, 3000));
    }

    if (!zipUrl) {
      return { ok: false, error: "MinerU 转换超时" };
    }

    // 下载 ZIP 并提取 Markdown
    const markdown = await extractMarkdownFromZip(zipUrl);

    // 存储结果到 iii-state
    await worker.trigger({
      function_id: "state::set",
      payload: {
        scope: "mineru-results",
        key: payload.mineru_task_id,
        value: {
          state: "done",
          markdown,
          completedAt: Date.now(),
        },
      },
    });

    // 可选：调用 callback URL
    if (payload.callback) {
      try {
        await fetch(payload.callback, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mineru_task_id: payload.mineru_task_id,
            state: "done",
          }),
        });
      } catch {
        // callback 失败不影响主流程
      }
    }

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ── Function 3: mineru::status (查询状态) ─────────────────

/**
 * 查询转换状态。
 *
 * 返回:
 *   - state: queued | processing | done | failed
 *   - progress: { extracted, total } (processing 时)
 */
async function fnStatus(payload: { mineru_task_id: string }): Promise<StatusResult> {
  try {
    if (!payload.mineru_task_id) {
      return { ok: false, error: "缺少 mineru_task_id" };
    }
    const token = await resolveToken();
    if (!token) {
      return { ok: false, error: "MINERU_TOKEN 未配置" };
    }

    const status = await queryMinerUStatus(payload.mineru_task_id, token);

    return {
      ok: true,
      state: status.state,
      progress: status.extracted_pages !== undefined
        ? { extracted: status.extracted_pages, total: status.total_pages ?? 0 }
        : undefined,
      error: status.err_msg,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ── Function 4: mineru::result (获取结果) ──────────────────

/**
 * 获取转换结果 Markdown。
 *
 * 支持两种模式：
 * - URL 模式：传入 mineru_task_id
 * - 文件上传模式：传入 batch_id
 *
 * 优先从 iii-state 读取缓存结果，否则实时获取。
 */
async function fnResult(payload: {
  mineru_task_id?: string;
  batch_id?: string;
}): Promise<StatusResult> {
  try {
    if (!payload.mineru_task_id && !payload.batch_id) {
      return { ok: false, error: "缺少 mineru_task_id 或 batch_id" };
    }
    const token = await resolveToken();
    if (!token) {
      return { ok: false, error: "MINERU_TOKEN 未配置" };
    }

    // 缓存 key 优先使用 mineru_task_id，否则用 batch_id
    const cacheKey = payload.mineru_task_id || payload.batch_id!;

    // 先从 iii-state 读取缓存
    const cached = await worker.trigger({
      function_id: "state::get",
      payload: { scope: "mineru-results", key: cacheKey },
    }) as { state?: string; markdown?: string } | null;

    if (cached?.state === "done" && cached.markdown) {
      return { ok: true, state: "done", markdown: cached.markdown };
    }

    let zipUrl: string | undefined;

    if (payload.batch_id) {
      // 文件上传模式：通过 batch_id 查询
      const batchResult = await queryBatchStatus(payload.batch_id, token);
      if (!batchResult.ok || !batchResult.results || batchResult.results.length === 0) {
        return { ok: false, error: batchResult.error || "查询批量任务失败" };
      }
      const r = batchResult.results[0];
      if (r.state !== "done") {
        return { ok: false, state: r.state, error: `任务未完成，当前状态: ${r.state}` };
      }
      zipUrl = r.full_zip_url;
    } else {
      // URL 模式：通过 mineru_task_id 查询
      const status = await queryMinerUStatus(payload.mineru_task_id!, token);
      if (status.state !== "done") {
        return { ok: false, state: status.state, error: `任务未完成，当前状态: ${status.state}` };
      }
      zipUrl = status.full_zip_url;
    }

    if (!zipUrl) {
      return { ok: false, error: "未获取到下载链接" };
    }

    const markdown = await extractMarkdownFromZip(zipUrl);

    // 缓存结果
    await worker.trigger({
      function_id: "state::set",
      payload: {
        scope: "mineru-results",
        key: cacheKey,
        value: { state: "done", markdown, completedAt: Date.now() },
      },
    });

    return { ok: true, state: "done", markdown };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ── Function 5: mineru::upload (获取签名上传 URL) ─────────

/**
 * 获取文件上传的签名 URL 和 batch_id。
 *
 * 前端拿到 upload_url 后直接 PUT 文件到 OSS，无需经过 Worker 转发。
 *
 * Input:
 *   - filename: 文件名
 *   - model_version: 模型版本
 *   - language: 语言
 *
 * Output:
 *   - ok: true
 *   - batch_id: 批量任务 ID（用于轮询进度）
 *   - upload_url: 签名上传 URL（前端直接 PUT）
 */
async function fnUpload(payload: UploadPayload): Promise<UploadResult> {
  try {
    if (!payload.filename) {
      return { ok: false, error: "缺少 filename" };
    }
    const token = await resolveToken();
    if (!token) {
      return { ok: false, error: "MINERU_TOKEN 未配置" };
    }

    const result = await getUploadUrl(payload.filename, token, {
      model_version: payload.model_version,
      language: payload.language || "ch",
    });

    return {
      ok: true,
      batch_id: result.batch_id,
      upload_url: result.upload_url,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ── Function 6: mineru::channel_upload (Channel 文件上传) ──

/**
 * 通过 Channel 接收文件字节并上传到 MinerU OSS。
 *
 * 前端流程:
 *   1. 创建 Channel: const channel = await client.createChannel()
 *   2. 触发本函数: client.trigger({ function_id: 'mineru::channel_upload', payload: { reader: channel.readerRef, filename } })
 *   3. 流式写入文件: await writeFileToChannel(channel, file)
 *
 * Input:
 *   - reader: ChannelReader (由 SDK 自动从 readerRef 反序列化)
 *   - filename: 文件名
 *   - model_version: 模型版本
 *   - language: 语言
 *
 * Output:
 *   - ok: true
 *   - batch_id: 批量任务 ID
 */
async function fnChannelUpload(payload: {
  reader: { stream: AsyncIterable<Buffer> };
  filename: string;
  model_version?: string;
  language?: string;
}): Promise<ChannelUploadResult> {
  try {
    if (!payload.reader) {
      return { ok: false, error: "缺少 reader" };
    }
    if (!payload.filename) {
      return { ok: false, error: "缺少 filename" };
    }
    const token = await resolveToken();
    if (!token) {
      return { ok: false, error: "MINERU_TOKEN 未配置" };
    }

    const result = await uploadViaChannel(
      payload.reader,
      payload.filename,
      token,
      {
        model_version: payload.model_version,
        language: payload.language || "ch",
      },
    );

    return { ok: true, batch_id: result.batch_id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ── Function 7: mineru::batch_status (批量任务状态) ────────

/**
 * 查询批量任务状态（文件上传模式）。
 *
 * Input:
 *   - batch_id: 批量任务 ID
 *
 * Output:
 *   - ok: true
 *   - results: [{ file_name, state, full_zip_url, err_msg }]
 */
async function fnBatchStatus(payload: { batch_id: string }): Promise<BatchStatusResult> {
  try {
    if (!payload.batch_id) {
      return { ok: false, error: "缺少 batch_id" };
    }
    const token = await resolveToken();
    if (!token) {
      return { ok: false, error: "MINERU_TOKEN 未配置" };
    }

    return await queryBatchStatus(payload.batch_id, token);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ── 注册 Function ─────────────────────────────────────────

// HTTP Trigger: URL 模式入队
worker.registerFunction("mineru::convert", async (data: ConvertPayload) => {
  return await fnConvert(data);
});

// HTTP Trigger: 获取签名上传 URL（文件上传模式 - 前端直传 OSS）
worker.registerFunction("mineru::upload", async (data: UploadPayload) => {
  return await fnUpload(data);
});

// Channel 模式: 通过 Channel 流式接收文件字节
worker.registerFunction("mineru::channel_upload", async (data: {
  reader: { stream: AsyncIterable<Buffer> };
  filename: string;
  model_version?: string;
  language?: string;
}) => {
  return await fnChannelUpload(data);
});

// HTTP Trigger: 查询批量任务状态
worker.registerFunction("mineru::batch_status", async (data: { batch_id: string }) => {
  return await fnBatchStatus(data);
});

// Queue Consumer: 异步处理
worker.registerFunction("mineru::process", async (data: {
  mineru_task_id: string;
  callback?: string;
}) => {
  return await fnProcess(data);
});

// HTTP Trigger: 查询状态
worker.registerFunction("mineru::status", async (data: { mineru_task_id: string }) => {
  return await fnStatus(data);
});

// HTTP Trigger: 获取结果（支持 URL 模式和文件上传模式）
worker.registerFunction("mineru::result", async (data: {
  mineru_task_id?: string;
  batch_id?: string;
}) => {
  return await fnResult(data);
});

// 注册 Queue Consumer (durable:subscriber)
worker.registerTrigger({
  type: "durable:subscriber",
  function_id: "mineru::process",
  config: { topic: QUEUE_NAME },
});

console.log("✓ MinerU Convert Worker 已注册 (Queue 异步架构):");
console.log("  - mineru::convert         URL 模式 → 入队");
console.log("  - mineru::upload          获取签名上传 URL（前端直传 OSS）");
console.log("  - mineru::channel_upload  Channel 模式（流式传输，无大小限制）");
console.log("  - mineru::batch_status    批量任务状态查询");
console.log("  - mineru::process         Queue 消费者 (异步处理)");
console.log("  - mineru::status          查询任务状态");
console.log("  - mineru::result          获取 Markdown 结果");
console.log(`  - Queue: ${QUEUE_NAME}`);

// ── 保持运行 ──────────────────────────────────────────────
process.on("SIGTERM", async () => {
  await worker.shutdown();
  process.exit(0);
});

process.on("SIGINT", async () => {
  await worker.shutdown();
  process.exit(0);
});
