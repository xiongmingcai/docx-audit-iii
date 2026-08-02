# MinerU 文档转 Markdown API

> **用代码验证每一句话的 MinerU API 教程**

MinerU 是一个高精度文档解析服务，支持将 PDF、Word、PPT、Excel、图片等格式转换为 Markdown。

---

## 文章列表

| # | 文章 | 核心内容 | 验证代码 |
|---|------|---------|---------|
| 1 | [快速开始](./01-quickstart.md) | API 概述、两种模式对比、首个请求 | [运行](./verify/01-quickstart.mjs) |
| 2 | [精准解析 API](./02-precise-api.md) | 单文件、批量 URL、批量上传 | [运行](./verify/02-precise-api.mjs) |
| 3 | [Agent 轻量 API](./03-agent-api.md) | 免登录 URL 解析、文件上传 | [运行](./verify/03-agent-api.mjs) |
| 4 | [错误码与排查](./04-error-codes.md) | 完整错误码表、常见问题 | [运行](./verify/04-error-codes.mjs) |

---

## 验证结果总览

| 篇 | 验证项 | 结果 |
|---|--------|------|
| 1 | 精准解析创建、轮询、下载、Agent API、Agent 查询 | ✅ 5/5 |
| 2 | 单文件、批量 URL、批量上传、状态流转、文件结构 | ✅ 5/5 |
| 3 | URL 解析、文件上传、状态流转、CDN 下载、错误码 | ✅ 4/5 |
| 4 | 成功格式、无效 Token、空参数、无效 URL、不存在任务 | ✅ 4/5 |

**总计：18/20 项验证通过 ✅**

---

## 两种 API 对比

| 维度 | 精准解析 API | Agent 轻量 API |
|------|-------------|----------------|
| Token | ✅ 需要 | ❌ 无需 |
| 文件大小 | ≤ 200MB | ≤ 10MB |
| 页数 | ≤ 200 页 | ≤ 20 页 |
| 批量 | ✅ ≤ 200 个 | ❌ 单文件 |
| 输出 | Zip (MD+JSON+图片) | Markdown (CDN) |
| 模型 | pipeline / vlm / MinerU-HTML | 固定 pipeline |

---

## 环境配置

```
API Token: 从 mineru.net API 管理页面创建
Base URL:  https://mineru.net
```

> **验证结果**：
> ```
> ✓ 精准解析 API: 创建任务成功
> ✓ 查询任务: state=done, 返回 full_zip_url
> ✓ 下载 ZIP: 包含 full.md + JSON + 图片
> ✓ Agent API: 创建任务成功
> ✓ 文件上传: 签名上传模式
> ```

---

## 快速体验

```bash
# 1. 确保 III 引擎运行中
iii --config config.yaml

# 2. 运行验证脚本
node docs/mineru/verify/01-quickstart.mjs

# 3. 查看转换结果
cat /tmp/mineru_test/full.md | head -20
```
