# Agent 记忆与会话持久化

> **目标读者**：已掌握多 Agent 工作流的实习生
> **阅读时间**：15 分钟
> **验证代码**：[verify/03-agent-memory.mjs](./verify/03-agent-memory.mjs)

---

## 一句话结论

**iii-state 存储 Agent 会话历史，实现跨调用记忆——Agent 记得"你是谁"和"你之前说过什么"。**

---

## 为什么 Agent 需要记忆？

没有记忆的 Agent 每次都是"初次见面"：

```
❌ 无记忆:
  用户: "我叫 Alice"
  客服: "你好 Alice！"
  用户: "你还记得我叫什么吗？"
  客服: "抱歉，我不记得了..."  ← 每轮调用是独立的

✅ 有记忆:
  用户: "我叫 Alice"
  客服: "你好 Alice！"
  用户: "你还记得我叫什么吗？"
  客服: "当然记得，你是 Alice！"  ← 从 iii-state 读取历史
```

---

## 实战：为 Agent 添加跨会话记忆

### 核心模式

```
用户输入 → 读取 iii-state(历史) → 构建带上下文的 prompt → Agent 生成 → 写回 iii-state
```

### 代码实现

```javascript
worker.registerFunction("agent::chat-with-memory", async (data) => {
  const userId = data.userId || "anonymous";
  const userMessage = data.message;

  // 1. 读取会话历史
  const prev = await worker.trigger({
    function_id: "state::get",
    payload: { scope: "agent-memory", key: userId },
  });

  const history = prev?.history || [];

  // 2. 构建带上下文的 prompt
  const context = history
    .slice(-4)  // 取最近 4 轮
    .map((h) => `${h.role}: ${h.content}`)
    .join("\n");
  const prompt = context
    ? `【历史对话】\n${context}\n\n【当前问题】${userMessage}`
    : userMessage;

  // 3. 调用 Agent
  const resp = await agent.generate(prompt);

  // 4. 写回历史
  history.push({ role: "user", content: userMessage });
  history.push({ role: "assistant", content: resp.text });

  await worker.trigger({
    function_id: "state::set",
    payload: {
      scope: "agent-memory",
      key: userId,
      value: { history: history.slice(-10) },  // 保留最近 10 条
    },
  });

  return {
    body: { reply: resp.text, historyLength: history.length },
    statusCode: 200,
  };
});
```

> **验证结果**（实际运行输出）：
> ```
> Round 1: "我是 Dave，DevOps 工程师"
>   → "【已确认身份】你是 Dave，我的 DevOps 专家助手。" (2条)
>
> Round 2: "我擅长 K8s 和 Terraform"
>   → "了解，K8s和Terraform是你的主力技术。" (4条)
>
> Round 3: "你还记得我的职业吗？"
>   → "Dave，当然记得。您是 DevOps 工程师，主攻 K8s 与 Te" (6条)
>
> Round 4: "我之前说过擅长什么工具？"
>   → "您的擅长工具是 K8s 和 Terraform。" (8条)
> ```

---

## 关键发现

### 1. State 作用域隔离

不同用户/会话的记忆互不干扰：

```javascript
// 用户 A 的记忆
await worker.trigger({
  function_id: "state::set",
  payload: { scope: "agent-memory", key: "user-alice", value: { history: [...] } },
});

// 用户 B 的记忆（完全隔离）
await worker.trigger({
  function_id: "state::set",
  payload: { scope: "agent-memory", key: "user-bob", value: { history: [...] } },
});
```

> **验证结果**：
> ```
> user-alice 的 history[0].content: "我叫 Alice"
> user-bob   的 history[0].content: "我叫 Bob"
> ✓ Scope 隔离有效：同名 key 在不同 scope 下数据独立
> ```

### 2. 记忆窗口控制

保留全部历史会很快超出 LLM 上下文限制。推荐**滑动窗口**：

```javascript
// 保留最近 10 条（5 轮对话）
value: { history: history.slice(-10) }

// 或只保留最近 3 轮作为摘要
const recent = history.slice(-6);
```

> **验证结果**：
> ```
> ✓ history.slice(-10) 有效控制记忆长度
> ✓ 4 轮对话后记忆为 8 条（每轮 2 条）
> ```

### 3. State API 速查

| 操作 | Function | Payload |
|------|----------|---------|
| 读取 | `state::get` | `{ scope, key }` |
| 写入 | `state::set` | `{ scope, key, value }` |
| 删除 | `state::delete` | `{ scope, key }` |
| 列出 keys | `state::list` | `{ scope }` |
| 列出 scopes | `state::list_groups` | `{}` |
| 更新合并 | `state::update` | `{ scope, key, value }` |

> **验证结果**：
> ```
> ✓ state::get → 返回 { history: [...] }
> ✓ state::set → 写入成功
> ✓ state::list_groups → ["agent-memory", "agent-tasks", ...]
> ```

---

## 架构视角

```
┌─────────────────────────────────────────────────────────┐
│                     III Engine                           │
│                                                         │
│  ┌─────────────┐     ┌─────────────┐                   │
│  │ HTTP/SDK    │────▶│ Agent       │                   │
│  │ Trigger     │     │ Function    │                   │
│  └─────────────┘     └──────┬──────┘                   │
│                             │                           │
│                    ┌────────▼────────┐                  │
│                    │  iii-state      │                  │
│                    │  scope: memory   │                  │
│                    │  key: user-123   │                  │
│                    │  value: {       │                  │
│                    │    history: [   │                  │
│                    │      {role,     │                  │
│                    │       content}, │                  │
│                    │      ...        │                  │
│                    │    ]           │                  │
│                    │  }             │                  │
│                    └─────────────────┘                  │
└─────────────────────────────────────────────────────────┘
```

---

## 常见踩坑

| 问题 | 原因 | 解决 |
|------|------|------|
| 记忆丢失 | Worker 重启但 State 未持久化 | 默认 file_based adapter 已持久化 |
| 记忆太长 | 未做滑动窗口截断 | `history.slice(-10)` |
| 不同用户串记忆 | 未使用 userId 作为 key | key 包含用户标识 |
| State 读取为 null | 首次对话无历史 | `prev?.history \|\| []` |

---

## 下一步

- [第 4 篇：Agent 工具调用](./04-agent-tools.md)
- [返回系列目录](./README.md)
