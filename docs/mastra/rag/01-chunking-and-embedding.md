# 文档分块与嵌入

> **目标读者**：刚开始学习 RAG 的实习生
> **阅读时间**：15 分钟
> **验证代码**：[verify/01-chunking-and-embedding.mjs](./verify/01-chunking-and-embedding.mjs)

---

## 一句话结论

**MDocument 将原始文档转换为可检索的 chunks，嵌入模型将 chunks 转换为向量——这是 RAG 的基础。**

---

## RAG 流程总览

```
原始文档
  ↓ MDocument.fromText/HTML/Markdown/JSON
文档对象
  ↓ .chunk(strategy, size, overlap)
文本块 (chunks)
  ↓ embedMany(model, values)
嵌入向量 (embeddings)
  ↓ upsert(vectorStore)
向量数据库
  ↓ query(queryVector, topK)
检索结果
```

---

## 1. 文档初始化

MDocument 支持 4 种输入格式：

```javascript
import { MDocument } from "@mastra/rag";

// 纯文本
const doc1 = MDocument.fromText("III 是开源后端引擎...");

// HTML
const doc2 = MDocument.fromHTML("<h1>III 框架</h1><p>III 是开源后端引擎。</p>");

// Markdown
const doc3 = MDocument.fromMarkdown("# III 框架\n\nIII 是开源后端引擎。\n\n## 特性\n\n- Worker\n- Function");

// JSON
const doc4 = MDocument.fromJSON('{"title": "III", "content": "开源后端引擎"}');
```

> **验证结果**：
> ```
> ✓ fromText: 1 个文档对象
> ✓ fromHTML: 1 个文档对象
> ✓ fromMarkdown: 1 个文档对象
> ✓ fromJSON: 1 个文档对象
> ```

---

## 2. 分块策略

### 9 种策略一览

| 策略 | 适用场景 | 参数 |
|------|---------|------|
| `recursive` | 通用文本（推荐首选） | `maxSize`, `overlap`, `separators` |
| `sentence` | 自然语言段落 | `maxSize`, `minSize`, `overlap` |
| `character` | 固定长度切分 | `maxSize`, `overlap` |
| `token` | Token 感知切分 | `maxSize`, `overlap` |
| `markdown` | Markdown 文档 | `maxSize`, `overlap` |
| `semantic-markdown` | 按标题语义分组 | `joinThreshold`, `modelName` |
| `html` | HTML 结构文档 | 需要 headers/sections |
| `json` | JSON 结构化数据 | 需要 JSON 结构 |
| `latex` | LaTeX 文档 | 需要 LaTeX 结构 |

### Recursive 策略（最常用）

```javascript
const chunks = await doc.chunk({
  strategy: "recursive",
  maxSize: 512,    // 每个 chunk 最大字符数
  overlap: 50,     // 相邻 chunk 重叠字符数
  separators: ["\n"], // 分隔符优先级
  extract: {
    metadata: true, // 提取元数据
  },
});
```

> **验证结果**：
> ```
> ✓ recursive (maxSize=120, overlap=20): 4 chunks
> ✓ sentence (maxSize=200): 4 chunks
> ✓ character (maxSize=80, overlap=10): 6 chunks
> ✓ token (maxSize=50, overlap=5): 6 chunks
> ✓ markdown (maxSize=100, overlap=10): 6 chunks
> ```

### 关键参数说明

| 参数 | 作用 | 推荐值 |
|------|------|--------|
| `maxSize` | chunk 最大长度 | 256-1024（取决于模型） |
| `overlap` | 相邻 chunk 重叠量 | 10-20% of maxSize |
| `separators` | 分隔符优先级 | `["\n", ".", " "]` |

**overlap 的作用**：防止上下文在 chunk 边界处被切断。

```
无 overlap:  [chunk1aaaaaa][chunk2bbbbbb]  ← 边界处信息丢失
有 overlap:  [chunk1aaaaaaxx][xxachunk2bbbb]  ← 重叠区保留上下文
```

---

## 3. 嵌入生成

嵌入模型将文本转换为高维向量，语义相近的文本向量距离更近。

### 使用硅基流动嵌入 API

```javascript
const response = await fetch("https://api.siliconflow.cn/v1/embeddings", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": "Bearer " + process.env.SILICONFLOW_CN_API_KEY,
  },
  body: JSON.stringify({
    model: "BAAI/bge-m3",              // 嵌入模型
    input: chunks.map((c) => c.text),  // 文本数组
  }),
});
const { data } = await response.json();
const embeddings = data.map((d) => d.embedding);
```

### 嵌入维度

| 模型 | 维度 | 特点 |
|------|------|------|
| BAAI/bge-m3 | 1024 | 多语言支持，检索效果好 |
| openai/text-embedding-3-small | 1536 (可裁剪到 256) | 高质量，支持降维 |
| cohere/embed-english-v3.0 | 1024 | 英语优化 |

> **验证结果**：
> ```
> ✓ BAAI/bge-m3 嵌入维度: 1024
> ✓ 4 个 chunks → 4 个嵌入向量
> ✓ 每个向量长度: 1024
> ```

---

## 4. 完整示例

```javascript
import { MDocument } from "@mastra/rag";

// 1. 创建文档
const doc = MDocument.fromText(`
  III 是一个开源后端引擎，用三个原语统一了分布式后端设计。
  Worker 是 III 系统的参与者。
  Function 是 Worker 中命名的处理器。
  Trigger 是绑定事件源到 Function 的触发器。
`);

// 2. 分块
const chunks = await doc.chunk({
  strategy: "recursive",
  maxSize: 120,
  overlap: 20,
});

// 3. 生成嵌入
const response = await fetch("https://api.siliconflow.cn/v1/embeddings", {
  method: "POST",
  headers: { "Content-Type": "application/json", "Authorization": "Bearer " + apiKey },
  body: JSON.stringify({ model: "BAAI/bge-m3", input: chunks.map((c) => c.text) }),
});
const { data } = await response.json();
const embeddings = data.map((d) => d.embedding);

console.log(`文档 → ${chunks.length} chunks → ${embeddings.length} 个 ${embeddings[0].length} 维向量`);
```

> **验证结果**：
> ```
> ✓ 文档 → 4 chunks → 4 个 1024 维向量
> ```

---

## 常见踩坑

| 问题 | 原因 | 解决 |
|------|------|------|
| chunk 太大 | maxSize 超过模型限制 | 保持 maxSize ≤ 1024 |
| 上下文断裂 | overlap = 0 | 设置 overlap = 10-20% |
| 嵌入维度不匹配 | 模型与向量库维度不一致 | 创建索引时指定正确维度 |
| character/token 报错 | overlap ≥ maxSize | overlap 必须 < maxSize |

---

## 下一步

- [第 2 篇：向量检索](./02-vector-retrieval.md)
- [返回系列目录](./README.md)
