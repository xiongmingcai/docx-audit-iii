# 精准解析 API

> **目标读者**：需要高精度文档解析的实习生
> **阅读时间**：15 分钟
> **验证代码**：[verify/02-precise-api.mjs](./verify/02-precise-api.mjs)

---

## 一句话结论

**精准解析 API 支持单文件、批量 URL、批量文件上传三种模式，输出包含 Markdown + JSON + 图片的完整 ZIP 包。**

---

## 接口总览

| 操作 | 方法 | 路径 |
|------|------|------|
| 单文件解析 | POST | `/api/v4/extract/task` |
| 查询任务 | GET | `/api/v4/extract/task/{task_id}` |
| 批量 URL | POST | `/api/v4/extract/task/batch` |
| 批量上传链接 | POST | `/api/v4/file-urls/batch` |
| 批量查询 | GET | `/api/v4/extract-results/batch/{batch_id}` |

---

## 1. 单文件解析

### 创建任务

```javascript
const TOKEN = "sk-***";
const response = await fetch("https://mineru.net/api/v4/extract/task", {
  method: "POST",
  headers: { "Content-Type": "application/json", "Authorization": "Bearer " + TOKEN },
  body: JSON.stringify({
    url: "https://example.com/document.pdf",
    model_version: "vlm",       // pipeline / vlm / MinerU-HTML
    is_ocr: false,              // 是否 OCR
    enable_formula: true,       // 公式识别
    enable_table: true,         // 表格识别
    language: "ch",             // 语言
    data_id: "doc-001",         // 自定义 ID
    callback: "https://...",    // 回调 URL
    extra_formats: ["docx"],    // 额外导出格式
    page_ranges: "1-10",        // 页码范围
    no_cache: false,            // 绕过缓存
  }),
});
const { data } = await response.json();
const taskId = data.task_id;
```

### 请求参数

| 参数 | 类型 | 必选 | 说明 |
|------|------|------|------|
| url | string | ✅ | 文件 URL |
| model_version | string | 否 | pipeline(默认) / vlm / MinerU-HTML |
| is_ocr | bool | 否 | OCR 识别，默认 false |
| enable_formula | bool | 否 | 公式识别，默认 true |
| enable_table | bool | 否 | 表格识别，默认 true |
| language | string | 否 | 语言，默认 ch |
| data_id | string | 否 | 自定义数据 ID (≤128字符) |
| callback | string | 否 | 回调通知 URL |
| seed | string | 否 | 回调签名随机串 |
| extra_formats | string[] | 否 | docx / html / latex |
| page_ranges | string | 否 | 页码范围，如 "1-10,15" |
| no_cache | bool | 否 | 绕过缓存 |
| cache_tolerance | int | 否 | 缓存容忍时间 (秒) |

### 查询任务

```javascript
const resp = await fetch(`https://mineru.net/api/v4/extract/task/${taskId}`, {
  headers: { "Authorization": "Bearer " + TOKEN },
});
const { data } = await resp.json();
// state: pending / running / done / failed / converting
// data.full_zip_url — 下载链接
// data.extract_progress — 进度信息
```

> **验证结果**：
> ```
> ✓ 创建任务: code=0, task_id 返回
> ✓ 查询任务: state=done, full_zip_url 返回
> ✓ 进度信息: extracted_pages / total_pages / start_time
> ```

---

## 2. 批量 URL 解析

### 创建批量任务

```javascript
const response = await fetch("https://mineru.net/api/v4/extract/task/batch", {
  method: "POST",
  headers: { "Content-Type": "application/json", "Authorization": "Bearer " + TOKEN },
  body: JSON.stringify({
    files: [
      { url: "https://example.com/doc1.pdf", data_id: "doc-001" },
      { url: "https://example.com/doc2.pdf", data_id: "doc-002" },
    ],
    model_version: "vlm",
  }),
});
const { data } = await response.json();
const batchId = data.batch_id;
```

### 批量查询

```javascript
const resp = await fetch(`https://mineru.net/api/v4/extract-results/batch/${batchId}`, {
  headers: { "Authorization": "Bearer " + TOKEN },
});
const { data } = await resp.json();
// data.extract_result[].state — 每个文件的状态
// data.extract_result[].full_zip_url — 每个文件的下载链接
```

> **验证结果**：
> ```
> ✓ 批量 URL: batch_id 返回
> ✓ 批量查询: 每个文件独立状态
> ```

---

## 3. 批量文件上传

### 步骤 1: 获取上传链接

```javascript
const response = await fetch("https://mineru.net/api/v4/file-urls/batch", {
  method: "POST",
  headers: { "Content-Type": "application/json", "Authorization": "Bearer " + TOKEN },
  body: JSON.stringify({
    files: [{ name: "demo.pdf", data_id: "doc-001" }],
    model_version: "vlm",
  }),
});
const { data } = await response.json();
const uploadUrl = data.file_urls[0];
const batchId = data.batch_id;
```

### 步骤 2: 上传文件

```javascript
const fileBuffer = fs.readFileSync("./demo.pdf");
await fetch(uploadUrl, { method: "PUT", body: fileBuffer });
// 上传后自动开始解析，无需额外调用
```

### 步骤 3: 查询结果

```javascript
const resp = await fetch(`https://mineru.net/api/v4/extract-results/batch/${batchId}`, {
  headers: { "Authorization": "Bearer " + TOKEN },
});
```

> **验证结果**：
> ```
> ✓ 获取上传链接: file_urls 返回
> ✓ 上传文件: PUT 上传成功
> ✓ 自动解析: 上传后自动开始
> ```

---

## 4. 任务状态说明

| 状态 | 含义 |
|------|------|
| pending | 排队中 |
| running | 正在解析 |
| done | 完成 |
| failed | 失败 |
| converting | 格式转换中 |
| waiting-file | 等待文件上传 (批量上传模式) |

---

## 5. 输出文件结构

```
下载 ZIP 解压后:
├── full.md                    # Markdown 主文件
├── *.content_list.json        # 内容列表
├── *.content_list_v2.json     # 内容列表 v2
├── *.model.json               # 模型输出
├── *.origin.pdf               # 原始 PDF
├── layout.json                # 布局信息
└── images/                    # 提取的图片
    ├── xxx.jpg
    └── yyy.png
```

> **验证结果**：
> ```
> ✓ full.md: Markdown 主文件
> ✓ content_list.json: 内容结构
> ✓ images/: 提取的图片
> ```

---

## 下一步

- [第 3 篇：Agent 轻量 API](./03-agent-api.md)
- [返回目录](./README.md)
