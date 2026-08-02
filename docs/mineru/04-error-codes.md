# 错误码与排查

> **目标读者**：遇到 API 报错的实习生
> **阅读时间**：10 分钟
> **验证代码**：[verify/04-error-codes.mjs](./verify/04-error-codes.mjs)

---

## 一句话结论

**MinerU API 使用统一的错误码体系——`code: 0` 表示成功，非 0 表示失败，`msg` 包含具体原因。**

---

## 错误响应格式

```json
{
  "code": -500,
  "msg": "传参错误",
  "trace_id": "c876cd60b202f2396de1f9e39a1b0172",
  "data": null
}
```

| 字段 | 说明 |
|------|------|
| `code` | 错误码 (0=成功) |
| `msg` | 错误描述 |
| `trace_id` | 请求 ID (联系技术支持时使用) |
| `data` | 失败时为 null |

---

## 完整错误码表

### 认证相关

| 错误码 | 说明 | 解决 |
|--------|------|------|
| `A0202` | Token 错误 | 检查 Token 是否正确，是否有 Bearer 前缀 |
| `A0211` | Token 过期 | 更换新 Token |

### 参数相关

| 错误码 | 说明 | 解决 |
|--------|------|------|
| `-500` | 传参错误 | 检查参数类型及 Content-Type |
| `-10002` | 请求参数错误 | 检查请求参数格式 |
| `-60002` | 获取文件格式失败 | 确保文件名/链接有正确后缀 |
| `-60004` | 空文件 | 上传有效文件 |
| `-60005` | 文件大小超出限制 | 检查文件大小，最大 200MB |
| `-60006` | 文件页数超过限制 | 拆分文件后重试 |
| `-60008` | 文件读取超时 | 检查 URL 可访问性 |
| `-60012` | 找不到任务 | 确保 task_id 有效且未删除 |
| `-60013` | 没有权限访问该任务 | 只能访问自己提交的任务 |

### 服务相关

| 错误码 | 说明 | 解决 |
|--------|------|------|
| `-10001` | 服务异常 | 稍后再试 |
| `-60001` | 生成上传 URL 失败 | 稍后再试 |
| `-60007` | 模型服务暂时不可用 | 稍后再试或联系技术支持 |
| `-60009` | 任务提交队列已满 | 稍后再试 |
| `-60010` | 解析失败 | 稍后再试 |
| `-60017` | 重试次数达到上限 | 等模型升级后重试 |
| `-60018` | 每日解析任务数量已达上限 | 明日再来 |
| `-60019` | HTML 解析额度不足 | 明日再来 |

### 文件相关

| 错误码 | 说明 | 解决 |
|--------|------|------|
| `-60003` | 文件读取失败 | 检查文件是否损坏 |
| `-60011` | 获取有效文件失败 | 确保文件已上传 |
| `-60014` | 删除运行中的任务 | 运行中的任务暂不支持删除 |
| `-60015` | 文件转换失败 | 手动转为 PDF 再上传 |
| `-60016` | 文件转换失败 | 尝试其他格式导出 |
| `-60020` | 文件拆分失败 | 稍后再试 |
| `-60021` | 读取文件页数失败 | 稍后再试 |
| `-60022` | 网页读取失败 | 网络问题或限频，稍后再试 |

### Agent 轻量 API 专属

| 错误码 | 说明 | 解决 |
|--------|------|------|
| `-30001` | 文件大小超出轻量接口限制 (10MB) | 使用标准 API 或拆分文件 |
| `-30002` | 轻量接口不支持该文件类型 | 上传 PDF/图片/Doc/PPT/Excel |
| `-30003` | 文件页数超出轻量接口限制 | 使用标准 API 或指定 page_range |
| `-30004` | 请求参数错误 | 检查必填参数 |

---

## 常见问题排查

### 任务一直处于 pending/running

```
原因: 队列积压或大文件解析耗时
解决:
  1. 等待更长时间 (大文件可能需 5-10 分钟)
  2. 检查 trace_id 联系技术支持
  3. 避开高峰期提交
```

### 解析失败 (state=failed)

```
原因: 文件损坏、格式不支持、OCR 失败
解决:
  1. 检查 err_msg 获取具体原因
  2. 尝试用不同模型版本 (pipeline → vlm)
  3. 手动转为 PDF 后重新上传
```

### Token 相关错误

```
原因: Token 错误或过期
解决:
  1. 检查 Authorization 格式: "Bearer sk-xxx"
  2. 检查 Token 是否有空格或换行
  3. 在 API 管理页面重新生成 Token
```

---

## 错误处理代码示例

```javascript
async function safeParse(token, url) {
  // 1. 创建任务
  const createResp = await fetch("https://mineru.net/api/v4/extract/task", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
    body: JSON.stringify({ url, model_version: "pipeline" }),
  });
  const createJson = await createResp.json();

  if (createJson.code !== 0) {
    throw new Error(`创建任务失败 [${createJson.code}]: ${createJson.msg}`);
  }

  const taskId = createJson.data.task_id;

  // 2. 轮询等待
  for (let i = 0; i < 100; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const resp = await fetch(`https://mineru.net/api/v4/extract/task/${taskId}`, {
      headers: { "Authorization": "Bearer " + token },
    });
    const json = await resp.json();

    if (json.data?.state === "done") {
      return json.data.full_zip_url;
    }
    if (json.data?.state === "failed") {
      throw new Error(`解析失败: ${json.data.err_msg}`);
    }
  }
  throw new Error("轮询超时");
}
```

> **验证结果**：
> ```
> ✓ 错误格式: { code, msg, trace_id, data }
> ✓ 成功: code=0
> ✓ 认证失败: A0202
> ✓ 参数错误: -500
> ✓ 文件超限: -60005
> ```

---

## 下一步

- [返回目录](./README.md)
