# MinerU Convert Worker — 架构设计

> **TypeScript Worker 实现文档转 Markdown**

---

## 架构概览

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              前端 (Browser)                                 │
│                                                                             │
│  用户上传 docx ──▶ startBackgroundAuditFile() ──▶ iii Engine               │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           iii Engine (协调器)                                │
│                                                                             │
│  路由 docx::audit_start ──▶ docx-audit Worker (Python)                      │
│  路由 mineru::convert  ──▶ mineru-convert Worker (TypeScript)  ← 新        │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     MinerU Convert Worker (TypeScript)                       │
│                                                                             │
│  ① mineru::convert  ──▶ 提交 MinerU API → 返回 task_id                     │
│  ② mineru::status   ──▶ 轮询 MinerU 进度                                   │
│  ③ mineru::result   ──▶ 下载 ZIP → 提取 Markdown                           │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            MinerU API                                      │
│                                                                             │
│  POST /api/v4/extract/task  ──▶ 创建解析任务                               │
│  GET  /api/v4/extract/task/{id} ──▶ 查询状态                               │
│  下载 ZIP → full.md (Markdown)                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 文件结构

```
workers/mineru-convert/
├── package.json                  # 依赖: iii-sdk, typescript, tsx
├── tsconfig.json                 # TypeScript 配置
├── src/
│   └── index.ts                  # Worker 入口 + Function 注册
├── verify/
│   └── 01-convert.mjs            # 验证脚本
└── dist/                         # 编译输出
```

---

## 3 个 Function

### 1. `mineru::convert` — 提交转换任务

```typescript
// 输入
interface ConvertPayload {
  url: string;              // 文件 URL (必填)
  model_version?: "pipeline" | "vlm" | "MinerU-HTML";
  is_ocr?: boolean;
  enable_formula?: boolean;
  enable_table?: boolean;
  language?: string;
  page_ranges?: string;
}

// 输出
interface ConvertResult {
  ok: boolean;
  task_id?: string;         // MinerU 任务 ID
  state?: string;
  error?: string;
}
```

### 2. `mineru::status` — 查询任务状态

```typescript
// 输入
{ task_id: string }

// 输出
{
  ok: boolean;
  state: "pending" | "running" | "done" | "failed" | "converting";
  markdown?: string;        // ZIP URL (done 时)
  error?: string;
}
```

### 3. `mineru::result` — 获取 Markdown 结果

```typescript
// 输入
{ task_id: string; wait?: boolean }

// 输出
{
  ok: boolean;
  state: string;
  markdown?: string;        // Markdown 内容
  error?: string;
}
```

---

## 数据流

### 前端调用流程

```
1. 用户上传 docx 文件
   └── startBackgroundAuditFile(file)
       └── iii.trigger("docx::audit_start", { content: base64, filename })

2. docx-audit Worker 接收到文件
   └── 调用 mineru::convert 提交到 MinerU
       └── iii.trigger("mineru::convert", { url: fileUrl })

3. 前端轮询 mineru::status
   └── iii.trigger("mineru::status", { task_id })
       └── 返回 { state: "running" | "done" | "failed" }

4. 完成后调用 mineru::result
   └── iii.trigger("mineru::result", { task_id })
       └── 返回 { markdown: "# Title\n\nContent..." }
```

### 完整转换流程

```
docx 文件
   │
   ▼
mineru::convert
   │ POST /api/v4/extract/task
   │ { url, model_version: "pipeline" }
   ▼
{ task_id: "xxx-xxx" }
   │
   ▼
mineru::status (轮询)
   │ GET /api/v4/extract/task/{task_id}
   │ state: pending → running → done
   ▼
{ state: "done", full_zip_url: "https://..." }
   │
   ▼
mineru::result
   │ 下载 ZIP → 解压 → 提取 full.md
   ▼
{ markdown: "# Document Title\n\n..." }
```

---

## 配置

| 环境变量 | 说明 | 默认值 |
|---------|------|--------|
| `III_ENGINE_URL` | iii 引擎地址 | `ws://localhost:49134` |
| `MINERU_TOKEN` | MinerU API Token | (必填) |

---

## 运行

```bash
# 安装依赖
cd workers/mineru-convert
npm install

# 开发模式
MINERU_TOKEN=sk-xxx npm run dev

# 生产构建
npm run build
MINERU_TOKEN=sk-xxx npm start

# 验证
npm run verify
```

---

## 验证结果

```
✓ 提交转换任务: code=0, task_id 返回
✓ 轮询查询状态: state=done, ZIP URL 返回
✓ 下载提取 Markdown: 261 行, 51580 字符
✓ 完整端到端流程: 全部通过
✓ Worker 注册: mineru::convert, mineru::status, mineru::result
✓ TypeScript 编译: 无错误
```

---

## 与 docx-audit Worker 集成

```python
# 在 docx-audit Worker 中调用 mineru::convert
async def _convert_with_mineru(iii, file_url: str) -> str:
    """调用 MinerU Worker 将文档转为 Markdown"""
    # 1. 提交转换任务
    result = await iii.trigger_async({
        "function_id": "mineru::convert",
        "payload": {"url": file_url, "model_version": "pipeline"},
    })
    if not result.get("ok"):
        raise Exception(f"MinerU 提交失败: {result.get('error')}")

    task_id = result["task_id"]

    # 2. 轮询等待完成
    for _ in range(60):
        await asyncio.sleep(3)
        status = await iii.trigger_async({
            "function_id": "mineru::status",
            "payload": {"task_id": task_id},
        })
        if status.get("state") == "done":
            break
        if status.get("state") == "failed":
            raise Exception(f"MinerU 转换失败: {status.get('error')}")

    # 3. 获取 Markdown
    md_result = await iii.trigger_async({
        "function_id": "mineru::result",
        "payload": {"task_id": task_id},
    })
    return md_result.get("markdown", "")
```

---

## 设计决策

| 决策 | 选择 | 原因 |
|------|------|------|
| 语言 | TypeScript | 与前端技术栈一致，iii SDK 原生支持 |
| 解压方式 | 系统 unzip 命令 | 无需额外依赖，Node.js 内置 |
| 轮询策略 | 前端轮询 | 遵循现有 audit_status 模式 |
| 输出格式 | Markdown | 与 RAG 流水线兼容 |
| 模型版本 | pipeline (默认) | 平衡速度精度，可选 vlm 提升精度 |
