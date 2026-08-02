# Agent 轻量解析 API

> **目标读者**：需要在 AI Agent 中集成文档解析的实习生
> **阅读时间**：15 分钟
> **验证代码**：[verify/03-agent-api.mjs](./verify/03-agent-api.mjs)

---

## 一句话结论

**Agent 轻量 API 无需 Token，通过 IP 限频防滥用——专为 AI Agent 工作流设计，输出纯 Markdown CDN 链接。**

---

## 与精准解析 API 对比

| 维度 | 精准解析 | Agent 轻量 |
|------|---------|-----------|
| Token | ✅ 需要 | ❌ 无需 |
| 文件大小 | ≤ 200MB | ≤ 10MB |
| 页数 | ≤ 200 页 | ≤ 20 页 |
| 批量 | ✅ ≤ 200 个 | ❌ 单文件 |
| 输出 | Zip (MD+JSON+图片) | Markdown (CDN) |
| 模型 | pipeline/vlm/HTML | 固定 pipeline |
| 限频 | 按 Token | 按 IP |

---

## 1. URL 解析接口

### 创建任务

```javascript
const response = await fetch("https://mineru.net/api/v1/agent/parse/url", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    url: "https://example.com/document.pdf",
    language: "ch",
    enable_table: true,
    is_ocr: false,
    enable_formula: true,
    page_range: "1-10",
  }),
});
const { data } = await response.json();
const taskId = data.task_id;
```

### 请求参数

| 参数 | 类型 | 必选 | 说明 |
|------|------|------|------|
| url | string | ✅ | 远程文件 URL |
| file_name | string | 否 | 文件名 (用于判断类型) |
| language | string | 否 | 语言，默认 ch |
| enable_table | bool | 否 | 表格识别，默认 true |
| is_ocr | bool | 否 | OCR，默认 false |
| enable_formula | bool | 否 | 公式识别，默认 true |
| page_range | string | 否 | 页码范围，如 "1-10" |

### 查询结果

```javascript
const resp = await fetch(`https://mineru.net/api/v1/agent/parse/${taskId}`);
const { data } = await resp.json();
// state: uploading / pending / running / done / failed
// data.markdown_url — Markdown CDN 链接
```

> **验证结果**：
> ```
> ✓ URL 模式: 无需 Token
> ✓ 查询: state=done, markdown_url 返回
> ✓ Markdown: CDN 链接可直接下载
> ```

---

## 2. 文件上传接口（签名上传）

### 步骤 1: 获取签名上传 URL

```javascript
const response = await fetch("https://mineru.net/api/v1/agent/parse/file", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    file_name: "document.pdf",
    language: "ch",
    enable_table: true,
    is_ocr: false,
    enable_formula: true,
    page_range: "1-10",
  }),
});
const { data } = await response.json();
const taskId = data.task_id;
const fileUrl = data.file_url;  // OSS 签名上传 URL
```

### 步骤 2: PUT 上传文件

```javascript
const fileBuffer = fs.readFileSync("./document.pdf");
await fetch(fileUrl, { method: "PUT", body: fileBuffer });
// 上传后自动开始解析
```

### 步骤 3: 查询结果

```javascript
const resp = await fetch(`https://mineru.net/api/v1/agent/parse/${taskId}`);
const { data } = await resp.json();
if (data.state === "done") {
  const md = await (await fetch(data.markdown_url)).text();
}
```

> **验证结果**：
> ```
> ✓ 获取签名 URL: task_id + file_url 返回
> ✓ PUT 上传: 文件上传成功
> ✓ 自动解析: 上传后自动开始
> ```

---

## 3. 任务状态说明

| 状态 | 含义 |
|------|------|
| waiting-file | 等待文件上传 (文件上传模式) |
| uploading | 文件下载中 |
| pending | 排队中 |
| running | 解析中 |
| done | 完成 |
| failed | 失败 |

---

## 4. 语言取值

| 值 | 说明 |
|------|------|
| `ch` | 中英文（默认） |
| `ch_server` | 中日英文 |
| `en` | 纯英文 |
| `japan` | 日文为主 |
| `korean` | 韩文 |
| `latin` | 拉丁语系 |
| `arabic` | 阿拉伯语系 |
| `cyrillic` | 西里尔语系 |
| `devanagari` | 天城文语系 |

---

## 5. 错误码

| 错误码 | 说明 |
|--------|------|
| -30001 | 文件大小超出轻量接口限制 (10MB) |
| -30002 | 轻量接口不支持该文件类型 |
| -30003 | 文件页数超出轻量接口限制 |
| -30004 | 请求参数错误 |

---

## 6. 完整封装示例

```javascript
class MinerUAgent {
  constructor() {
    this.baseUrl = "https://mineru.net/api/v1/agent";
  }

  async parseByUrl(url, options = {}) {
    const resp = await fetch(`${this.baseUrl}/parse/url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, language: "ch", ...options }),
    });
    const { data } = await resp.json();
    return this.pollResult(data.task_id);
  }

  async parseByFile(filePath, options = {}) {
    const fileName = filePath.split("/").pop();
    // 获取签名 URL
    const resp = await fetch(`${this.baseUrl}/parse/file`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_name: fileName, language: "ch", ...options }),
    });
    const { data } = await resp.json();
    // 上传文件
    const fs = await import("fs");
    await fetch(data.file_url, { method: "PUT", body: fs.readFileSync(filePath) });
    return this.pollResult(data.task_id);
  }

  async pollResult(taskId, timeout = 300) {
    const start = Date.now();
    while (Date.now() - start < timeout * 1000) {
      const resp = await fetch(`${this.baseUrl}/parse/${taskId}`);
      const { data } = await resp.json();
      if (data.state === "done") {
        return await (await fetch(data.markdown_url)).text();
      }
      if (data.state === "failed") {
        throw new Error(data.err_msg);
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
    throw new Error("轮询超时");
  }
}
```

> **验证结果**：
> ```
> ✓ parseByUrl(): 返回 Markdown 文本
> ✓ parseByFile(): 签名上传 + 返回 Markdown
> ✓ pollResult(): 轮询直到完成
> ```

---

## 下一步

- [第 4 篇：错误码与排查](./04-error-codes.md)
- [返回目录](./README.md)
