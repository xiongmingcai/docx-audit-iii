/**
 * obs-demo Worker — iii Observability 能力验证
 *
 * 本 Worker 系统性演示 iii 可观测性（Observability）的核心能力与使用技巧：
 *
 * 1. Logger 结构化日志     — 自动关联 trace/span context
 * 2. withSpan 分布式追踪   — 手动创建 span、设置属性、记录事件
 * 3. Baggage 上下文传播    — 跨 span 传递业务上下文
 * 4. Metrics 指标采集      — 注册 worker 资源 gauges（CPU/内存/event-loop）
 * 5. Span 错误处理         — 设置 span 错误状态、记录异常
 * 6. Trace 查询            — 调用 engine::* 函数查询 traces/logs
 *
 * Console 可视化专项（展示 iii Console 各页面的可视化能力）：
 * 7. Waterfall 瀑布图      — 多嵌套 span 的时间线视图
 * 8. Flame Graph 火焰图    — 不同持续时间的 span 堆叠
 * 9. Service Map 服务拓扑  — 跨服务调用的 Trace Map
 * 10. Logs Correlation     — 结构化日志 + trace ID 关联
 * 11. Full Dashboard       — 综合全栈遥测（Traces + Logs + Metrics）
 *
 * 每个能力都暴露为一个独立 Function（obs::demo_*），可单独触发验证。
 * obs::demo_all 一次性跑全部演示。
 *
 * 触发方式：
 *   - CLI:  iii trigger obs::demo_all
 *   - HTTP: GET http://localhost:3111/obs/demo
 *
 * 触发后打开 iii Console（iii console → http://127.0.0.1:3113）查看可视化效果。
 */

import { registerWorker, type IIIClient, type InitOptions } from "iii-sdk";
import {
  Logger,
  withSpan,
  initOtel,
  currentTraceId,
  currentSpanId,
  currentSpanIsRecording,
  setCurrentSpanAttribute,
  setCurrentSpanError,
  recordSpanEvent,
  setBaggageEntry,
  getBaggageEntry,
  getAllBaggage,
  injectTraceparent,
  extractTraceparent,
  flushOtel,
  shutdownOtel,
  type OtelConfig,
} from "@iii-dev/helpers/observability";

// ── 配置 ─────────────────────────────────────────────────

const ENGINE_URL = process.env.III_ENGINE_URL ?? "ws://localhost:49134";
const WORKER_NAME = "obs-demo";

// 初始化 OTel（对齐 iii-observability worker 标准配置）
const otelConfig: OtelConfig = {
  serviceName: WORKER_NAME,
  serviceNamespace: "iii-demos",
  serviceVersion: "0.1.0",
  enabled: true,
  metricsEnabled: true,
  // spansFlushIntervalMs: 100,  // 默认 100ms，本地调试可显式设置
};
initOtel(otelConfig);

// Logger 实例（自动捕获当前 trace/span context）
const logger = new Logger();

// ── Worker 注册 ──────────────────────────────────────────

const initOptions: InitOptions = {
  workerName: WORKER_NAME,
  workerDescription:
    "Observability 能力验证 Worker：Logger / Span / Baggage / Metrics / Traces",
  invocationTimeoutMs: 30_000,
  // InitOptions.otel 是 Omit<OtelConfig, "engineWsUrl">，引擎自动从 address 推断
  otel: otelConfig,
};

const worker: IIIClient = registerWorker(ENGINE_URL, initOptions);

logger.info(`${WORKER_NAME} worker registered`, {
  engineUrl: ENGINE_URL,
  workerName: WORKER_NAME,
  pid: process.pid,
});

// ── 演示 1：Logger 结构化日志 ─────────────────────────────

async function demoLogger(): Promise<Record<string, unknown>> {
  logger.info("=== 演示 1: Logger 结构化日志 ===");

  // 基础日志
  logger.info("Worker 已连接", { worker: WORKER_NAME, pid: process.pid });

  // 结构化数据（支持 dashboard 过滤/聚合）
  logger.info("处理订单", {
    orderId: "ord_12345",
    amount: 49.99,
    currency: "CNY",
    items: 3,
  });

  // 不同级别
  logger.debug("缓存查找", { key: "user:42", hit: false });
  logger.warn("重试上游", { attempt: 2, maxRetries: 5, endpoint: "/api/charge" });
  logger.error("支付失败", {
    orderId: "ord_12345",
    gateway: "stripe",
    errorCode: "card_declined",
  });

  // 验证当前 trace context 是否自动注入
  const traceId = currentTraceId();
  const spanId = currentSpanId();

  logger.info("Trace context 自动关联", {
    traceId,
    spanId,
    isRecording: currentSpanIsRecording(),
  });

  return {
    demo: "logger",
    traceId,
    spanId,
    levels: ["debug", "info", "warn", "error"],
    tip: "每条日志自动携带 trace_id/span_id，可在 iii Console 中关联查看",
  };
}

// ── 演示 2：withSpan 分布式追踪 ──────────────────────────

async function demoSpan(): Promise<Record<string, unknown>> {
  logger.info("=== 演示 2: withSpan 分布式追踪 ===");

  // 基础 span
  const result1 = await withSpan(
    "obs.process_order",
    { kind: 1 /* SpanKind.INTERNAL */ },
    async () => {
      // 设置 span 属性
      setCurrentSpanAttribute("order.id", "ord_67890");
      setCurrentSpanAttribute("order.amount", 199.99);
      setCurrentSpanAttribute("order.currency", "CNY");

      // 记录里程碑事件
      recordSpanEvent("validation.started", { step: "check_inventory" });

      // 模拟业务处理
      await sleep(50);

      recordSpanEvent("validation.completed", {
        step: "check_inventory",
        result: "ok",
      });

      // 模拟子 span（嵌套追踪）
      const subResult = await withSpan(
        "obs.charge_payment",
        {},
        async () => {
          setCurrentSpanAttribute("payment.gateway", "alipay");
          await sleep(30);
          return { transactionId: "txn_" + Date.now() };
        },
      );

      return { orderId: "ord_67890", payment: subResult };
    },
  );

  // 跨服务传播示例：注入 traceparent 到外部请求头
  const traceparent = injectTraceparent();
  logger.info("Traceparent 注入（用于跨服务传播）", { traceparent });

  // 解析 traceparent 回 context
  if (traceparent) {
    const ctx = extractTraceparent(traceparent);
    logger.info("从 traceparent 提取 context", {
      extracted: ctx !== undefined,
    });
  }

  return {
    demo: "span",
    result: result1,
    traceparent,
    attributes: ["order.id", "order.amount", "order.currency", "payment.gateway"],
    events: ["validation.started", "validation.completed"],
    tip: "withSpan 创建 span，setCurrentSpanAttribute 设属性，recordSpanEvent 记事件",
  };
}

// ── 演示 3：Baggage 上下文传播 ───────────────────────────

async function demoBaggage(): Promise<Record<string, unknown>> {
  logger.info("=== 演示 3: Baggage 上下文传播 ===");

  // 设置 baggage 条目（跨 span 自动传播的业务上下文）
  setBaggageEntry("tenant.id", "tenant_42");
  setBaggageEntry("user.id", "user_123");
  setBaggageEntry("request.id", "req_" + Date.now());

  // 读取单个条目
  const tenantId = getBaggageEntry("tenant.id");

  // 读取全部
  const allBaggage = getAllBaggage();

  logger.info("Baggage 已设置", { tenantId, allBaggage });

  // 在嵌套 span 中验证 baggage 自动传播
  const nestedResult = await withSpan(
    "obs.baggage_propagation_test",
    {},
    async () => {
      // 内层 span 自动继承外层 baggage
      const innerTenantId = getBaggageEntry("tenant.id");
      const innerUserId = getBaggageEntry("user.id");
      const innerAll = getAllBaggage();
      return { innerTenantId, innerUserId, innerAll };
    },
  );

  return {
    demo: "baggage",
    set: { tenantId, allBaggage },
    propagatedToNestedSpan: nestedResult,
    tip: "Baggage 在 span 间自动传播，适合传递 tenant/user/request 等上下文",
  };
}

// ── 演示 4：Metrics 指标采集 ─────────────────────────────

async function demoMetrics(): Promise<Record<string, unknown>> {
  logger.info("=== 演示 4: Metrics 指标采集 ===");

  // 采集当前进程资源指标
  const memUsage = process.memoryUsage();
  const cpuUsage = process.cpuUsage();

  // 注册 worker gauges（CPU / 内存 / event-loop 延迟）
  // 注意：registerWorkerGauges 需要 meter 实例，这里演示采集逻辑
  // 实际注册在 worker 启动时通过 @iii-dev/helpers/observability 完成
  logger.info("Worker 资源指标采集", {
    memoryRss: `${(memUsage.rss / 1024 / 1024).toFixed(1)} MB`,
    memoryHeapUsed: `${(memUsage.heapUsed / 1024 / 1024).toFixed(1)} MB`,
    memoryHeapTotal: `${(memUsage.heapTotal / 1024 / 1024).toFixed(1)} MB`,
    cpuUser: `${(cpuUsage.user / 1000).toFixed(1)} ms`,
    cpuSystem: `${(cpuUsage.system / 1000).toFixed(1)} ms`,
    uptimeSeconds: process.uptime().toFixed(0),
  });

  // 模拟业务指标
  const metrics = {
    requestsTotal: 1024,
    requestsPerSecond: 42.5,
    errorRate: 0.02,
    p99LatencyMs: 156,
    activeConnections: 12,
  };

  logger.info("业务指标上报", metrics);

  return {
    demo: "metrics",
    processMetrics: {
      memoryRssMB: +(memUsage.rss / 1024 / 1024).toFixed(1),
      memoryHeapUsedMB: +(memUsage.heapUsed / 1024 / 1024).toFixed(1),
      cpuUserMs: +(cpuUsage.user / 1000).toFixed(1),
      uptimeSeconds: +process.uptime().toFixed(0),
    },
    businessMetrics: metrics,
    tip: "registerWorkerGauges 注册 CPU/内存/event-loop 自动采集；业务指标通过 logger.info 结构化上报",
  };
}

// ── 演示 5：Span 错误处理 ────────────────────────────────

async function demoError(): Promise<Record<string, unknown>> {
  logger.info("=== 演示 5: Span 错误处理 ===");

  // 场景 A：捕获异常 → span 自动设 ERROR 状态
  let errorResult: Record<string, unknown> = {};
  try {
    await withSpan(
      "obs.risky_operation",
      {},
      async () => {
        setCurrentSpanAttribute("operation.type", "database_query");
        await sleep(20);
        throw new Error("数据库连接超时: connection timeout after 30s");
      },
    );
  } catch (err) {
    errorResult = {
      caught: true,
      errorMessage: (err as Error).message,
      tip: "异常会设置 span 状态为 ERROR 并记录 error.message",
    };
    logger.error("操作失败（已捕获）", {
      error: (err as Error).message,
    });
  }

  // 场景 B：手动设置 span 错误（不抛异常）
  await withSpan(
    "obs.manual_error_mark",
    {},
    async () => {
      setCurrentSpanAttribute("validation.field", "email");
      setCurrentSpanAttribute("validation.rule", "format_check");
      setCurrentSpanError("邮箱格式无效: user@");
      // 不抛异常，仅标记 span 为错误
    },
  );

  // 场景 C：嵌套 span 中的错误传播
  let nestedError: Record<string, unknown> = {};
  try {
    await withSpan("obs.parent_operation", {}, async () => {
      setCurrentSpanAttribute("batch.id", "batch_001");
      await withSpan("obs.child_operation", {}, async () => {
        throw new Error("子操作失败: 外部 API 返回 503");
      });
    });
  } catch (err) {
    nestedError = {
      propagatedFrom: "child_operation",
      message: (err as Error).message,
      tip: "子 span 异常向上传播，parent span 也会被标记",
    };
  }

  return {
    demo: "error",
    scenarioA_caught: errorResult,
    scenarioB_manualError: "setCurrentSpanError() 手动标记",
    scenarioC_nestedPropagation: nestedError,
    tip: "三种错误处理：(1)异常自动ERROR (2)setCurrentSpanError手动标记 (3)嵌套span错误传播",
  };
}

// ── 演示 6：Trace 查询（调用 engine::* 函数）─────────────

async function demoTraceQuery(): Promise<Record<string, unknown>> {
  logger.info("=== 演示 6: Trace 查询 ===");

  const currentTrace = currentTraceId();

  // 查询 engine health
  let health: Record<string, unknown> = {};
  try {
    const res = await worker.trigger({
      function_id: "engine::health::check",
      payload: {},
    });
    health = (res as Record<string, unknown>) ?? { status: "unknown" };
  } catch (e) {
    health = { error: (e as Error).message };
  }

  // 查询 traces 列表
  let tracesInfo: Record<string, unknown> = {};
  try {
    const res = await worker.trigger({
      function_id: "engine::traces::list",
      payload: {},
    });
    tracesInfo = (res as Record<string, unknown>) ?? {};
  } catch (e) {
    tracesInfo = { error: (e as Error).message };
  }

  // 查询 logs 列表
  let logsInfo: Record<string, unknown> = {};
  try {
    const res = await worker.trigger({
      function_id: "engine::logs::list",
      payload: {},
    });
    logsInfo = (res as Record<string, unknown>) ?? {};
  } catch (e) {
    logsInfo = { error: (e as Error).message };
  }

  // 查询当前 trace 的 span tree
  let traceTree: Record<string, unknown> = {};
  if (currentTrace) {
    try {
      const res = await worker.trigger({
        function_id: "engine::traces::tree",
        payload: { trace_id: currentTrace },
      });
      traceTree = (res as Record<string, unknown>) ?? {};
    } catch (e) {
      traceTree = { error: (e as Error).message };
    }
  }

  return {
    demo: "trace_query",
    currentTraceId: currentTrace,
    health,
    tracesInfo,
    logsInfo,
    traceTree,
    tip: "通过 engine::* 函数查询 traces/logs/health；engine::traces::tree 可查看 span 树",
  };
}

// ── 演示 7：Console Waterfall 瀑布图 ──────────────────────
/**
 * 生成适合 iii Console Traces > Waterfall 视图展示的 trace。
 *
 * Waterfall 视图：span 按开始时间和持续时间排列为时间线。
 * 本演示生成一个典型的"HTTP 请求处理"场景，包含：
 * - 顶层请求 span
 * - 认证、数据库查询、缓存查找等子 span
 * - 并行子操作（日志 + 指标上报）
 * - 不同持续时间（展示瀑布效果）
 */
async function demoWaterfall(): Promise<Record<string, unknown>> {
  const traceId = currentTraceId();
  logger.info("=== 演示 7: Console Waterfall 瀑布图 ===", { traceId });

  // 顶层：HTTP 请求处理
  const result = await withSpan(
    "http.request",
    { kind: 1 /* SERVER */ },
    async () => {
      setCurrentSpan_attribute("http.method", "POST");
      setCurrentSpan_attribute("http.path", "/api/orders");
      setCurrentSpan_attribute("http.host", "api.example.com");
      recordSpanEvent("request.received", { payload_size: 2048 });

      // Phase 1: 认证（快速）
      const user = await withSpan("auth.verify", {}, async () => {
        setCurrentSpan_attribute("auth.method", "jwt");
        await sleep(15);
        setCurrentSpan_attribute("user.id", "user_42");
        recordSpanEvent("auth.success");
        return { id: "user_42", role: "admin" };
      });

      // Phase 2: 数据库查询（中等耗时）
      const order = await withSpan("db.query", {}, async () => {
        setCurrentSpan_attribute("db.system", "postgresql");
        setCurrentSpan_attribute("db.operation", "SELECT");
        setCurrentSpan_attribute("db.table", "orders");
        recordSpanEvent("db.query.start", {
          query: "SELECT * FROM orders WHERE user_id = $1",
        });
        await sleep(80);
        recordSpanEvent("db.query.complete", { rows_returned: 1 });
        return { id: "ord_001", total: 299.99 };
      });

      // Phase 3: 缓存查找（快速，但 miss）
      const cacheResult = await withSpan("cache.lookup", {}, async () => {
        setCurrentSpan_attribute("cache.system", "redis");
        setCurrentSpan_attribute("cache.key", `order:${order.id}`);
        await sleep(5);
        setCurrentSpan_attribute("cache.hit", false);
        recordSpanEvent("cache.miss");
        return null;
      });

      // Phase 4: 业务逻辑（核心处理）
      const processed = await withSpan("order.process", {}, async () => {
        setCurrentSpan_attribute("order.id", order.id);
        setCurrentSpan_attribute("order.amount", order.total);
        await sleep(45);

        // 并行子操作
        await Promise.all([
          withSpan("order.validate", {}, async () => {
            await sleep(20);
            recordSpanEvent("validation.complete", { checks: 5 });
          }),
          withSpan("order.enrich", {}, async () => {
            await sleep(30);
            setCurrentSpan_attribute("enrich.fields", "customer,address");
          }),
        ]);

        recordSpanEvent("order.processed");
        return { ...order, processed: true };
      });

      // Phase 5: 响应序列化
      await withSpan("http.response", {}, async () => {
        setCurrentSpan_attribute("http.status_code", 200);
        setCurrentSpan_attribute("response.size", 1024);
        await sleep(10);
        recordSpanEvent("response.sent");
      });

      return { user, order: processed, cacheHit: cacheResult !== null };
    },
  );

  logger.info("Waterfall trace 生成完成", {
    traceId,
    tip: "打开 iii Console → Traces → 选择 Waterfall 视图查看时间线",
  });

  return {
    demo: "waterfall",
    traceId,
    result,
    spanTree: [
      "http.request (SERVER)",
      "  ├── auth.verify",
      "  ├── db.query",
      "  ├── cache.lookup",
      "  ├── order.process",
      "  │   ├── order.validate",
      "  │   └── order.enrich",
      "  └── http.response",
    ],
    consoleView: "Traces > Waterfall",
    tip: "在 iii Console Traces 页面选择此 trace，切换 Waterfall/Flame Graph/Trace Map/Flow 四种视图",
  };
}

// 辅助：避免与内置的 setCurrentSpanAttribute 冲突
function setCurrentSpan_attribute(key: string, value: string | number | boolean) {
  setCurrentSpanAttribute(key, value);
}

// ── 演示 8：Console Flame Graph 火焰图 ────────────────────
/**
 * 生成适合 iii Console Traces > Flame Graph 视图展示的 trace。
 *
 * Flame Graph：越宽的 bar = 越耗时的 span（堆叠视图）。
 * 本演示生成一个"批处理任务"场景，各步骤耗时差异显著，
 * 在火焰图中形成明显的宽窄对比。
 */
async function demoFlameGraph(): Promise<Record<string, unknown>> {
  const traceId = currentTraceId();
  logger.info("=== 演示 8: Console Flame Graph 火焰图 ===", { traceId });

  const result = await withSpan("batch.job", { kind: 1 }, async () => {
    setCurrentSpan_attribute("batch.id", "batch_20260801_001");
    setCurrentSpan_attribute("batch.total_records", 50000);
    recordSpanEvent("batch.started");

    // 步骤 1: 数据加载（最宽 = 最耗时）
    await withSpan("batch.load_data", {}, async () => {
      setCurrentSpan_attribute("load.source", "s3://data/exports/");
      setCurrentSpan_attribute("load.format", "parquet");
      await sleep(200); // 最耗时
      recordSpanEvent("load.complete", { records: 50000 });
    });

    // 步骤 2: 数据清洗（中等）
    await withSpan("batch.clean", {}, async () => {
      await sleep(100);
      recordSpanEvent("clean.null_removed", { count: 1234 });
      recordSpanEvent("clean.dedup", { removed: 567 });
    });

    // 步骤 3: 并行转换（多个等宽 bar）
    await withSpan("batch.transform", {}, async () => {
      await Promise.all([
        withSpan("transform.normalize", {}, async () => {
          await sleep(60);
        }),
        withSpan("transform.aggregate", {}, async () => {
          await sleep(80);
        }),
        withSpan("transform.filter", {}, async () => {
          await sleep(40);
        }),
      ]);
    });

    // 步骤 4: 写入（中等偏长）
    await withSpan("batch.write", {}, async () => {
      setCurrentSpan_attribute("write.destination", "postgresql");
      await sleep(120);
      recordSpanEvent("write.complete", { written: 49433 });
    });

    // 步骤 5: 验证（最短 = 最窄 bar）
    await withSpan("batch.verify", {}, async () => {
      await sleep(20);
      setCurrentSpan_attribute("verify.checksum", "sha256:abc123");
    });

    recordSpanEvent("batch.complete");
  });

  logger.info("Flame Graph trace 生成完成", {
    traceId,
    tip: "火焰图中 batch.load_data 最宽（200ms），batch.verify 最窄（20ms）",
  });

  return {
    demo: "flame_graph",
    traceId,
    result,
    spanWidths: {
      "batch.load_data": "200ms (最宽)",
      "batch.clean": "100ms",
      "batch.write": "120ms",
      "batch.transform": "180ms (含并行子 span)",
      "batch.verify": "20ms (最窄)",
    },
    consoleView: "Traces > Flame Graph",
    tip: "火焰图中宽 bar = 耗时操作，一眼看出性能瓶颈",
  };
}

// ── 演示 9：Console Service Map 服务拓扑 ──────────────────
/**
 * 生成适合 iii Console Traces > Trace Map 视图展示的 trace。
 *
 * Trace Map：拓扑图，通过父子 span 显示服务间调用边。
 * 本演示生成一个"微服务调用链"场景，模拟跨服务调用。
 */
async function demoServiceMap(): Promise<Record<string, unknown>> {
  const traceId = currentTraceId();
  logger.info("=== 演示 9: Console Service Map 服务拓扑 ===", { traceId });

  const result = await withSpan("api.gateway", { kind: 1 }, async () => {
    setCurrentSpan_attribute("service.name", "api-gateway");
    setCurrentSpan_attribute("service.version", "2.1.0");
    setCurrentSpan_attribute("http.method", "POST");
    setCurrentSpan_attribute("http.path", "/checkout");
    recordSpanEvent("gateway.route_decision", { target: "checkout-flow" });

    // 调用认证服务
    const auth = await withSpan("service.auth", {}, async () => {
      setCurrentSpan_attribute("rpc.service", "auth-service");
      setCurrentSpan_attribute("rpc.method", "VerifyToken");
      await sleep(25);
      recordSpanEvent("auth.token_valid");
      return { userId: "user_42", scopes: ["read", "write"] };
    });

    // 调用订单服务
    const order = await withSpan("service.orders", {}, async () => {
      setCurrentSpan_attribute("rpc.service", "order-service");
      setCurrentSpan_attribute("rpc.method", "CreateOrder");
      await sleep(60);

      // 订单服务内部调用库存
      await withSpan("service.inventory", {}, async () => {
        setCurrentSpan_attribute("rpc.service", "inventory-service");
        setCurrentSpan_attribute("rpc.method", "ReserveStock");
        await sleep(40);
        recordSpanEvent("inventory.reserved", { sku: "SKU-001", qty: 2 });
      });

      // 订单服务内部调用定价
      await withSpan("service.pricing", {}, async () => {
        setCurrentSpan_attribute("rpc.service", "pricing-service");
        setCurrentSpan_attribute("rpc.method", "CalculateDiscount");
        await sleep(30);
        setCurrentSpan_attribute("discount.applied", "10%");
      });

      return { orderId: "ord_001", total: 299.99 };
    });

    // 调用支付服务
    const payment = await withSpan("service.payment", {}, async () => {
      setCurrentSpan_attribute("rpc.service", "payment-service");
      setCurrentSpan_attribute("rpc.method", "Charge");
      await sleep(90);
      setCurrentSpan_attribute("payment.method", "stripe");
      recordSpanEvent("payment.authorized", { txnId: "txn_xyz" });
      return { status: "authorized" };
    });

    // 并行：通知服务 + 分析服务
    await Promise.all([
      withSpan("service.notification", {}, async () => {
        setCurrentSpan_attribute("rpc.service", "notification-service");
        setCurrentSpan_attribute("rpc.method", "SendEmail");
        await sleep(35);
        setCurrentSpan_attribute("notification.type", "order_confirmation");
      }),
      withSpan("service.analytics", {}, async () => {
        setCurrentSpan_attribute("rpc.service", "analytics-service");
        setCurrentSpan_attribute("rpc.method", "TrackEvent");
        await sleep(20);
        setCurrentSpan_attribute("analytics.event", "purchase_complete");
      }),
    ]);

    recordSpanEvent("checkout.complete");
    return { auth, order, payment };
  });

  logger.info("Service Map trace 生成完成", {
    traceId,
    services: ["api-gateway", "auth", "orders", "inventory", "pricing", "payment", "notification", "analytics"],
  });

  return {
    demo: "service_map",
    traceId,
    result,
    topology: [
      "api.gateway",
      "  ├── service.auth",
      "  ├── service.orders",
      "  │   ├── service.inventory",
      "  │   └── service.pricing",
      "  ├── service.payment",
      "  ├── service.notification (parallel)",
      "  └── service.analytics (parallel)",
    ],
    consoleView: "Traces > Trace Map",
    tip: "Trace Map 显示服务间调用拓扑：api-gateway → auth/orders/payment/notification/analytics",
  };
}

// ── 演示 10：Console Logs 关联 ────────────────────────────
/**
 * 生成适合 iii Console Logs 页面展示的关联日志。
 *
 * Logs 页面特性：
 * - 按严重级（DEBUG/INFO/WARN/ERROR）过滤
 * - trace ID 可点击 → 过滤该 trace 的所有日志 → 跳转到 Traces 页面
 * - 自动关联 trace/span context
 *
 * 本演示在单个 trace 内生成多级别结构化日志，
 * 展示 Logs → Traces 的导航联动。
 */
async function demoLogsCorrelation(): Promise<Record<string, unknown>> {
  const traceId = currentTraceId();
  logger.info("=== 演示 10: Console Logs 关联 ===", { traceId });

  await withSpan("order.checkout", { kind: 1 }, async () => {
    setCurrentSpan_attribute("order.id", "ord_789");
    setCurrentSpan_attribute("user.id", "user_42");

    // INFO: 流程开始
    logger.info("开始订单处理流程", {
      orderId: "ord_789",
      userId: "user_42",
      items: 3,
      total: 299.99,
    });

    // DEBUG: 详细调试信息
    logger.debug("加载用户配置", {
      userId: "user_42",
      preferences: { currency: "CNY", locale: "zh-CN" },
      cacheHit: true,
    });

    // INFO: 库存检查
    logger.info("库存检查通过", {
      sku: "SKU-001",
      requested: 2,
      available: 150,
    });

    // WARN: 值得注意但不致命
    logger.warn("优惠券即将过期", {
      couponId: "CPN-2026",
      expiresAt: "2026-08-02T00:00:00Z",
      discount: "15%",
    });

    await sleep(30);

    // ERROR: 非致命错误（已处理）
    logger.error("推荐服务调用失败，降级为默认推荐", {
      service: "recommendation-service",
      error: "connection timeout after 5000ms",
      fallback: "default_recommendations",
      impact: "low",
    });

    // INFO: 支付成功
    logger.info("支付授权成功", {
      gateway: "stripe",
      txnId: "txn_abc123",
      amount: 299.99,
      currency: "CNY",
    });

    // DEBUG: 性能指标
    logger.debug("处理耗时", {
      totalMs: 156,
      authMs: 12,
      inventoryMs: 28,
      paymentMs: 89,
      otherMs: 27,
    });

    // INFO: 完成
    logger.info("订单处理完成", {
      orderId: "ord_789",
      status: "confirmed",
      estimatedDelivery: "2026-08-05",
    });

    recordSpanEvent("checkout.complete");
  });

  // 额外生成一些独立的日志（不同 trace），展示日志列表的丰富度
  logger.info("系统心跳", { uptime: process.uptime(), memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024) });
  logger.debug("GC 统计", { gcRuns: 12, heapReleased: "2.3MB" });

  logger.info("Logs Correlation 演示完成", {
    traceId,
    tip: "打开 iii Console → Logs → 点击 trace ID 过滤 → 跳转到 Traces 页面",
  });

  return {
    demo: "logs_correlation",
    traceId,
    logLevels: {
      DEBUG: 3, // 加载用户配置, 处理耗时, GC 统计
      INFO: 5,  // 开始流程, 库存检查, 支付成功, 完成, 心跳
      WARN: 1,  // 优惠券即将过期
      ERROR: 1, // 推荐服务失败
    },
    totalLogs: 9,
    consoleView: "Logs",
    features: [
      "按严重级过滤（DEBUG/INFO/WARN/ERROR）",
      "trace ID 可点击 → 过滤该 trace 全部日志",
      "点击 trace ID → 跳转到 Traces 页面查看 span 树",
      "结构化属性支持过滤/聚合",
    ],
    tip: "在 Logs 页面点击 trace ID，体验 Logs → Traces 的导航联动",
  };
}

// ── 演示 11：Console Full Dashboard 全栈遥测 ──────────────
/**
 * 生成全栈遥测数据，一次性展示 iii Console 的所有核心页面：
 * - Traces（Waterfall + Flame Graph + Trace Map）
 * - Logs（多级别 + trace 关联）
 * - Metrics（进程资源指标）
 * - Workers（Worker 元数据）
 * - Functions（Function 列表）
 */
async function demoFullDashboard(): Promise<Record<string, unknown>> {
  const traceId = currentTraceId();
  const startTime = Date.now();
  logger.info("=== 演示 11: Console Full Dashboard 全栈遥测 ===", { traceId });

  // ── Phase 1: 生成丰富 trace ──
  await withSpan("dashboard.request", { kind: 1 }, async () => {
    setCurrentSpan_attribute("scenario", "full_dashboard_demo");

    // 认证
    await withSpan("auth.verify", {}, async () => {
      await sleep(12);
      logger.info("认证成功", { user: "admin", method: "jwt" });
    });

    // 数据库（含 WARN）
    await withSpan("db.query", {}, async () => {
      await sleep(65);
      logger.warn("慢查询检测", { query: "SELECT * FROM large_table", durationMs: 65, thresholdMs: 50 });
    });

    // 缓存
    await withSpan("cache.lookup", {}, async () => {
      await sleep(3);
      logger.debug("缓存命中", { key: "user:admin:profile", hit: true });
    });

    // 外部 API（含 ERROR）
    await withSpan("external.api", {}, async () => {
      await sleep(110);
      logger.error("外部 API 超时", { service: "payment-gateway", timeout: 10000, retry: 2 });
      setCurrentSpanError("外部 API 响应慢（已重试成功）");
    });

    // 并行处理
    await Promise.all([
      withSpan("process.image", {}, async () => {
        await sleep(45);
        logger.info("图片处理完成", { width: 1920, height: 1080, format: "webp" });
      }),
      withSpan("process.index", {}, async () => {
        await sleep(30);
        logger.info("索引更新完成", { documents: 1500 });
      }),
    ]);

    recordSpanEvent("dashboard.phase1.complete");
    return { phase: "trace_generation", status: "ok" };
  });

  // ── Phase 2: 生成结构化日志 ──
  await withSpan("dashboard.logs", {}, async () => {
    logger.info("Dashboard 演示: 全栈遥测数据生成中", { phase: 2 });
    logger.debug("Worker 资源快照", {
      cpuUsage: process.cpuUsage(),
      memory: process.memoryUsage(),
      uptime: process.uptime(),
    });
    logger.warn("内存使用偏高", { rssMB: Math.round(process.memoryUsage().rss / 1024 / 1024), threshold: 100 });
    return { phase: "logs_generation", count: 3 };
  });

  // ── Phase 3: 系统指标 ──
  await withSpan("dashboard.metrics", {}, async () => {
    const mem = process.memoryUsage();
    const cpu = process.cpuUsage();
    logger.info("系统指标采集", {
      memoryRssMB: Math.round(mem.rss / 1024 / 1024),
      memoryHeapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
      cpuUserMs: Math.round(cpu.user / 1000),
      uptimeSeconds: Math.round(process.uptime()),
    });
    return {
      phase: "metrics_collection",
      memoryRssMB: Math.round(mem.rss / 1024 / 1024),
      cpuUserMs: Math.round(cpu.user / 1000),
    };
  });

  const duration = Date.now() - startTime;
  logger.info("Full Dashboard 演示完成", { traceId, durationMs: duration });

  return {
    demo: "full_dashboard",
    traceId,
    durationMs: duration,
    summary: {
      traces: "dashboard.request → auth/cache/db/external/process（含 error + warn）",
      logs: "INFO/WARN/DEBUG 多级别结构化日志",
      metrics: "CPU + 内存 + uptime",
    },
    consolePages: {
      Traces: "Waterfall / Flame Graph / Trace Map / Flow 四种视图",
      Logs: "9+ 条日志，支持 trace ID 点击跳转",
      Metrics: "进程资源指标",
      Workers: "obs-demo worker 元数据 + 实时指标",
      Functions: "13 个注册 Function",
      Triggers: "7 个 HTTP Trigger",
    },
    tip: "打开 iii Console（http://127.0.0.1:3113），逐一浏览每个页面查看此 demo 生成的遥测数据",
  };
}

// ── 演示全部 ─────────────────────────────────────────────

async function demoAll(): Promise<Record<string, unknown>> {
  const startTime = Date.now();
  logger.info("🚀 开始 Observability 全流程演示");

  const loggerResult = await withSpan("obs.demo.logger", {}, () => demoLogger());
  const spanResult = await withSpan("obs.demo.span", {}, () => demoSpan());
  const baggageResult = await withSpan("obs.demo.baggage", {}, () => demoBaggage());
  const metricsResult = await withSpan("obs.demo.metrics", {}, () => demoMetrics());
  const errorResult = await withSpan("obs.demo.error", {}, () => demoError());
  const traceResult = await withSpan("obs.demo.trace_query", {}, () => demoTraceQuery());

  const duration = Date.now() - startTime;
  const traceId = currentTraceId();

  logger.info("✅ Observability 全流程演示完成", {
    durationMs: duration,
    traceId,
  });

  return {
    ok: true,
    traceId,
    durationMs: duration,
    summary: {
      logger: loggerResult,
      span: spanResult,
      baggage: baggageResult,
      metrics: metricsResult,
      error: errorResult,
      traceQuery: traceResult,
    },
    consoleTip: `在 iii Console 中查看 trace: ${traceId}`,
  };
}

// ── Health Check ─────────────────────────────────────────

async function health(): Promise<Record<string, unknown>> {
  return {
    ok: true,
    worker: WORKER_NAME,
    traceId: currentTraceId(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    pid: process.pid,
  };
}

// ── 工具函数 ─────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Function 注册 ────────────────────────────────────────

// 闭包注入 worker 客户端，使内部 trigger 可走引擎
const wrap =
  (fn: () => Promise<Record<string, unknown>>) =>
  async () =>
    fn();

worker.registerFunction("obs::demo_all", wrap(demoAll), {
  description: "一次性运行全部 Observability 演示（Logger/Span/Baggage/Metrics/Error/Trace）",
});
worker.registerFunction("obs::demo_logger", wrap(demoLogger), {
  description: "演示 Logger 结构化日志：多级别日志 + 自动 trace context 关联",
});
worker.registerFunction("obs::demo_span", wrap(demoSpan), {
  description: "演示 withSpan 分布式追踪：创建 span + 属性 + 事件 + 嵌套 span + traceparent 传播",
});
worker.registerFunction("obs::demo_baggage", wrap(demoBaggage), {
  description: "演示 Baggage 上下文传播：set/get/getAll + 嵌套 span 自动继承",
});
worker.registerFunction("obs::demo_metrics", wrap(demoMetrics), {
  description: "演示 Metrics 指标采集：进程资源指标 + 业务指标结构化上报",
});
worker.registerFunction("obs::demo_error", wrap(demoError), {
  description: "演示 Span 错误处理：异常自动 ERROR + setCurrentSpanError 手动标记 + 嵌套传播",
});
worker.registerFunction("obs::demo_trace_query", wrap(demoTraceQuery), {
  description: "演示 Trace 查询：engine::health::check + engine::traces::list + engine::traces::tree",
});
worker.registerFunction("obs::demo_waterfall", wrap(demoWaterfall), {
  description: "📊 Console Waterfall：生成 HTTP 请求处理的多嵌套 span 时间线",
});
worker.registerFunction("obs::demo_flame_graph", wrap(demoFlameGraph), {
  description: "📊 Console Flame Graph：生成批处理任务的不同宽度 span 堆叠",
});
worker.registerFunction("obs::demo_service_map", wrap(demoServiceMap), {
  description: "📊 Console Service Map：生成微服务调用链的拓扑图",
});
worker.registerFunction("obs::demo_logs_correlation", wrap(demoLogsCorrelation), {
  description: "📊 Console Logs：生成多级别结构化日志 + trace ID 关联",
});
worker.registerFunction("obs::demo_full_dashboard", wrap(demoFullDashboard), {
  description: "📊 Console Full Dashboard：全栈遥测（Traces + Logs + Metrics）",
});
worker.registerFunction("obs::health", wrap(health), {
  description: "健康检查：返回 worker 状态、traceId、内存、uptime",
});

// HTTP Trigger（引擎侧经 iii-http worker 路由）
// 注意：http trigger 的 config 需要 api_path（而非 path）
const httpTriggers: Array<{ id: string; path: string }> = [
  { id: "obs::demo_all", path: "/obs/demo" },
  { id: "obs::demo_logger", path: "/obs/logger" },
  { id: "obs::demo_span", path: "/obs/span" },
  { id: "obs::demo_baggage", path: "/obs/baggage" },
  { id: "obs::demo_metrics", path: "/obs/metrics" },
  { id: "obs::demo_error", path: "/obs/error" },
  { id: "obs::demo_trace_query", path: "/obs/trace" },
  { id: "obs::demo_waterfall", path: "/obs/waterfall" },
  { id: "obs::demo_flame_graph", path: "/obs/flame" },
  { id: "obs::demo_service_map", path: "/obs/service-map" },
  { id: "obs::demo_logs_correlation", path: "/obs/logs" },
  { id: "obs::demo_full_dashboard", path: "/obs/dashboard" },
];
for (const t of httpTriggers) {
  try {
    worker.registerTrigger({
      type: "http",
      function_id: t.id,
      config: { method: "GET", api_path: t.path },
    });
  } catch (e) {
    logger.warn(`HTTP trigger ${t.path} 注册失败（将在 iii.worker.yaml 中声明）`, {
      error: (e as Error).message,
    });
  }
}
logger.info("HTTP triggers registration attempted");

// ── 优雅关闭 ─────────────────────────────────────────────

async function gracefulShutdown(signal: string): Promise<void> {
  logger.info(`收到 ${signal}，正在优雅关闭...`);
  await flushOtel(); // 确保待发送的 spans/metrics/logs 送达
  await shutdownOtel();
  await worker.shutdown();
  process.exit(0);
}

process.on("SIGTERM", () => void gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => void gracefulShutdown("SIGINT"));

// ── 启动完成日志 ─────────────────────────────────────────

logger.info(`${WORKER_NAME} 启动完成`, {
  functions: [
    "obs::demo_all",
    "obs::demo_logger",
    "obs::demo_span",
    "obs::demo_baggage",
    "obs::demo_metrics",
    "obs::demo_error",
    "obs::demo_trace_query",
    "obs::demo_waterfall",
    "obs::demo_flame_graph",
    "obs::demo_service_map",
    "obs::demo_logs_correlation",
    "obs::demo_full_dashboard",
    "obs::health",
  ],
  engineUrl: ENGINE_URL,
  observabilityCapabilities: [
    "Logger 结构化日志",
    "withSpan 分布式追踪",
    "Baggage 上下文传播",
    "Metrics 指标采集",
    "Span 错误处理",
    "Trace 查询（engine::*）",
    "Console Waterfall 瀑布图",
    "Console Flame Graph 火焰图",
    "Console Service Map 服务拓扑",
    "Console Logs 关联",
    "Console Full Dashboard 全栈遥测",
  ],
  consoleTip: "iii console → http://127.0.0.1:3113",
});

console.log(`[${WORKER_NAME}] Observability demo worker ready → ${ENGINE_URL}`);
console.log(`[${WORKER_NAME}] Core: obs::demo_all | obs::demo_logger | obs::demo_span | obs::demo_baggage | obs::demo_metrics | obs::demo_error | obs::demo_trace_query`);
console.log(`[${WORKER_NAME}] Console: obs::demo_waterfall | obs::demo_flame_graph | obs::demo_service_map | obs::demo_logs_correlation | obs::demo_full_dashboard`);
console.log(`[${WORKER_NAME}] 📊 触发后打开 iii Console: http://127.0.0.1:3113`);
