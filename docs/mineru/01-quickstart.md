# MinerU 快速开始

> **目标读者**：第一次使用 MinerU API 的实习生
> **阅读时间**：10 分钟
> **验证代码**：[verify/01-quickstart.mjs](./verify/01-quickstart.mjs)

---

## 一句话结论

**MinerU 将 PDF/Word/PPT/Excel/图片转换为 Markdown——提交 URL → 获取 task_id → 轮询结果 → 下载 ZIP → 提取 Markdown。**

---

## 两种 API 模式

| 模式 | 接口 | Token | 适用场景 |
|------|------|-------|---------|
| **精准解析** | `/api/v4/extract/task` | ✅ 需要 | 大文件、批量、高精度 |
| **Agent 轻量** | `/api/v1/agent/parse/url` | ❌ 无需 | 小文件、快速、Agent 集成 |

---

## 快速开始：精准解析 API

### 步骤 1: 创建解析任务

```javascript
const TOKEN = "sk-7YEq9cOSL0gFLxtQnKWIFSf6zfh8SeMH6fCHirYfMAedDlzA";

const response = await fetch("https://mineru.net/api/v4/extract/task", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": "Bearer " + TOKEN,
  },
  body: JSON.stringify({
    url: "https://cdn-mineru.openxlab.org.cn/demo/example.pdf",
    model_version: "pipeline",  // pipeline(默认) / vlm / MinerU-HTML
  }),
});
const { data } = await response.json();
const taskId = data.task_id;
```

> **验证结果**：
> ```
> POST /api/v4/extract/task
> → { code: 0, data: { task_id: "3b4014b3-..." }, msg: "ok" }
> ✓ 任务创建成功
> ```

### 步骤 2: 轮询查询结果

```javascript
async function pollTask(taskId, timeout = 300) {
  const start = Date.now();
  while (Date.now() - start < timeout * 1000) {
    const resp = await fetch(`https://mineru.net/api/v4/extract/task/${taskId}`, {
      headers: { "Authorization": "Bearer " + TOKEN },
    });
    const { data } = await resp.json();

    if (data.state === "done") {
      return data.full_zip_url;  // 返回 ZIP 下载链接
    }
    if (data.state === "failed") {
      throw new Error(data.err_msg);
    }
    // running / pending → 等待 3 秒后重试
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error("轮询超时");
}
```

> **验证结果**：
> ```
> GET /api/v4/extract/task/{task_id}
> → { data: { state: "done", full_zip_url: "https://..." } }
> ✓ 任务完成，返回 ZIP 链接
> ```

### 步骤 3: 下载 ZIP 并提取 Markdown

```javascript
import fs from "fs";

// 下载 ZIP
const zipResp = await fetch(zipUrl);
fs.writeFileSync("/tmp/result.zip", Buffer.from(await zipResp.arrayBuffer()));

// 解压 (需要 unzip 命令)
import { execSync } from "child_process";
execSync("unzip -o /tmp/result.zip -d /tmp/result");

// 读取 Markdown
const markdown = fs.readFileSync("/tmp/result/full.md", "utf-8");
console.log(markdown.slice(0, 200));
```

> **验证结果**：
> ```
> ✓ ZIP 下载: 969KB
> ✓ 解压文件: full.md + JSON + 图片
> ✓ Markdown 内容: "# The response of flow duration curves..."
> ```

---

## 快速开始：Agent 轻量 API

### URL 模式

```javascript
const response = await fetch("https://mineru.net/api/v1/agent/parse/url", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    url: "https://example.com/document.pdf",
    language: "ch",
  }),
});
const { data } = await response.json();
const taskId = data.task_id;
```

### 查询结果

```javascript
const resp = await fetch(`https://mineru.net/api/v1/agent/parse/${taskId}`);
const { data } = await resp.json();
if (data.state === "done") {
  const markdownUrl = data.markdown_url;  // Markdown CDN 链接
  const md = await (await fetch(markdownUrl)).text();
}
```

> **验证结果**：
> ```
> ✓ Agent URL 模式: 无需 Token
> ✓ Agent 查询: state=done, 返回 markdown_url
> ```

---

## 模型版本选择

| 模型 | 说明 | 适用场景 |
|------|------|---------|
| `pipeline` | 默认模型，平衡速度精度 | 通用文档 |
| `vlm` | 视觉语言模型，精度更高 | 复杂版式、扫描件 |
| `MinerU-HTML` | 专用 HTML 解析 | HTML 文件 |

> **验证结果**：
> ```
> ✓ pipeline: 成功解析学术论文 PDF
> ✓ vlm: 可用（更高精度）
> ✓ MinerU-HTML: 可用（HTML 专用）
> ```

---

## 支持的文件格式

| 格式 | 精准解析 | Agent 轻量 |
|------|---------|-----------|
| PDF | ✅ | ✅ |
| Doc/Docx | ✅ | ✅ |
| Ppt/Pptx | ✅ | ✅ |
| Xls/Xlsx | ✅ | ✅ |
| 图片 | ✅ | ✅ |
| HTML | ✅ | ❌ |

---

## 下一步

- [第 2 篇：精准解析 API](./02-precise-api.md)
- [返回目录](./README.md)
