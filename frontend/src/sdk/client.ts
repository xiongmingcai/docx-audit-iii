// iii-browser-sdk 薄封装。
//
// 真实 SDK：
//   import { registerWorker } from 'iii-browser-sdk'
//   const worker = registerWorker(address, opts)   // => ISdk
//   worker.trigger({ function_id, payload })
//   worker.addConnectionStateListener(cb)          // () => void
//   worker.shutdown()
//
// 本文件提供 EngineClient 抽象 + 参考实现。
// 当 iii-browser-sdk 安装后，只替换 createEngineClient 真实实现即可，UI 层无需改动。

export type IIIConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'failed';

// StreamChannelRef：引擎分配的通道端点引用，可序列化后放入 trigger payload
export interface StreamChannelRef {
  access_key: string;
  channel_id: string;
  direction: 'read' | 'write';
}

// Channel：创建后拿到的一侧读写端 + 两侧 ref
// 注意：browser-sdk 的 channel 是底层 WebSocket 端点，不是 Web Streams。
//   writer.url / reader.url 是形如 ws://host/ws/channels/{id}?key=...&dir=write|read 的端点，
//   调用方需自行 new WebSocket(url) 连接后收发二进制帧。
export interface Channel {
  reader: {
    stream: null;
    url?: string;
  };
  writer: {
    stream: null;
    url?: string;
    close: () => void;
  };
  readerRef: StreamChannelRef;
  writerRef: StreamChannelRef;
}

export interface EngineClient {
  trigger<TInput, TOutput>(request: {
    function_id: string;
    payload: TInput;
  }): Promise<TOutput>;
  /** 创建流式通道，用于大文件/二进制传输 */
  createChannel(bufferSize?: number): Promise<Channel>;
  /**
   * 注册一个可被引擎推送调用的 Function。
   * 后端通过 trigger(docx::ui_progress, ...) 即可经引擎把 payload 推到浏览器。
   * handler 返回 void（推送是 fire-and-forget）。
   */
  registerFunction?(function_id: string, handler: (payload: unknown) => void): void;
  onConnectionStateChange(cb: (s: IIIConnectionState) => void): () => void;
  shutdown(): Promise<void>;
}

// ── 参考实现（WebSocket 直连，request/response 按 id 匹配）───────────────
// 装上 iii-browser-sdk 后，可改为 registerWorker 调用。

class ReferenceEngineClient implements EngineClient {
  private ws: WebSocket | null = null;
  private readonly url: string;
  private readonly cbs: Set<(s: IIIConnectionState) => void> = new Set();
  private state: IIIConnectionState = 'disconnected';
  private readonly pending = new Map<
    string,
    { resolve: (v: unknown) => void; reject: (e: unknown) => void }
  >();
  private seq = 0;
  /** 注册的推送 Function 处理表（function_id → handler） */
  private readonly functions = new Map<string, (payload: unknown) => void>();

  constructor(url: string) {
    this.url = url;
    this.connect();
  }

  /** 注册推送 Function（参考实现：仅存储，无法真正接收引擎推送） */
  registerFunction(function_id: string, handler: (payload: unknown) => void): void {
    this.functions.set(function_id, handler);
  }

  // 参考实现不支持真正的 channel（需要引擎中转），给出明确报错
  async createChannel(): Promise<Channel> {
    throw new Error('当前使用参考 WebSocket 客户端，不支持 Channel。请安装 iii-browser-sdk。');
  }

  private setState(s: IIIConnectionState) {
    this.state = s;
    this.cbs.forEach((cb) => cb(s));
  }

  private connect() {
    this.setState('connecting');
    try {
      this.ws = new WebSocket(this.url);
    } catch {
      this.setState('failed');
      return;
    }
    this.ws.onopen = () => this.setState('connected');
    this.ws.onmessage = (ev) => {
      let msg: { id?: string; result?: unknown; error?: string };
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg?.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error));
        else resolve(msg.result);
      }
    };
    this.ws.onclose = () => {
      this.setState('disconnected');
      setTimeout(() => this.connect(), 1500);
    };
    this.ws.onerror = () => this.setState('failed');
  }

  onConnectionStateChange(cb: (s: IIIConnectionState) => void): () => void {
    this.cbs.add(cb);
    cb(this.state);
    return () => this.cbs.delete(cb);
  }

  async trigger<TInput, TOutput>(request: {
    function_id: string;
    payload: TInput;
  }): Promise<TOutput> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('未连接到 iii 引擎');
    }
    const id = `ref-${++this.seq}`;
    const body = JSON.stringify({ id, function_id: request.function_id, payload: request.payload });
    return new Promise<TOutput>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.ws!.send(body);
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error('trigger timeout'));
        }
      }, 600_000);
    });
  }

  async shutdown() {
    this.ws?.close();
    this.ws = null;
    this.setState('disconnected');
  }
}

export async function createEngineClient(url: string): Promise<EngineClient> {
  try {
    // 动态 import 避免在参考实现环境下硬依赖 iii-browser-sdk
    const mod = await import('iii-browser-sdk');
    const helpers = await import('iii-browser-sdk/helpers');
    const registerWorker = mod.registerWorker as (addr: string, opts?: any) => any;
    const createChannel = helpers.createChannel as ((iii: any, size?: number) => Promise<any>) | undefined;
    if (typeof registerWorker === 'function') {
      // Agent LLM 检查耗时较长（90段落≈2-3分钟），需要 600s 超时
      const sdk = registerWorker(url, { workerName: 'docx-audit-ui', invocationTimeoutMs: 600_000 });
      return new BrowserSdkClient(sdk, createChannel, url);
    }
  } catch {
    // iii-browser-sdk 不可用或加载失败 → 回退到参考实现
  }
  return new ReferenceEngineClient(url);
}

// ── iii-browser-sdk 适配 ──────────────────────────────────────────────────
class BrowserSdkClient implements EngineClient {
  constructor(
    private sdk: any,
    private createChannelFn: ((iii: any, size?: number) => Promise<any>) | undefined,
    public readonly url: string,
  ) {}

  async trigger<TInput, TOutput>(request: {
    function_id: string;
    payload: TInput;
  }): Promise<TOutput> {
    return this.sdk.trigger(request) as Promise<TOutput>;
  }

  /** 注册推送 Function 到引擎（经 WebSocket 接收后端 trigger 的调用） */
  registerFunction(function_id: string, handler: (payload: unknown) => void): void {
    if (typeof this.sdk.registerFunction === 'function') {
      this.sdk.registerFunction(function_id, handler);
    }
  }

  onConnectionStateChange(cb: (s: IIIConnectionState) => void): () => void {
    if (typeof this.sdk.addConnectionStateListener === 'function') {
      return this.sdk.addConnectionStateListener(cb);
    }
    // fallback: 立即给一次 connected
    cb('connected');
    return () => {};
  }

  async createChannel(bufferSize?: number): Promise<Channel> {
    if (!this.createChannelFn) {
      throw new Error('当前 iii-browser-sdk 版本不支持 createChannel');
    }
    const ch = await this.createChannelFn(this.sdk, bufferSize);
    // browser-sdk channel 是底层 WebSocket 对象，不是 Web Streams。
    // writer/reader 各有一个 .url（ws://.../ws/channels/{id}?key=...&dir=write|read），
    // 需要调用方自行连接 WebSocket 读写二进制帧。ref 是可序列化的端点引用。
    return {
      reader: { stream: null, url: ch.reader?.url },
      writer: {
        stream: null,
        url: ch.writer?.url,
        close: () => ch.writer?.close?.(),
      },
      readerRef: ch.readerRef,
      writerRef: ch.writerRef,
    };
  }

  async shutdown() {
    if (typeof this.sdk.shutdown === 'function') {
      await this.sdk.shutdown();
    }
  }
}
