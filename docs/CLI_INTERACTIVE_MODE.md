# CLI 交互模式（PTY）

本文件描述 Nion-Agent 如何在“聊天窗口”内承载需要交互终端的 CLI（例如登录、扫码、需要持续 stdout/stderr 输出、需要在同一 TTY 中输入/确认的流程）。

目标：
- 让交互式 CLI 不再在应用内“卡住无输出”
- 让用户在聊天里看到一个可输入的终端（`CLITerminal`），并把输入实时写回 CLI 进程
- 标准化前后端的 WebSocket 初始化与消息协议，避免硬编码地址/字段

---

## 关键概念

### 1) CLI Catalog 中的交互标记

交互能力来源于 CLI marketplace 的 catalog（`backend/data/cli_marketplace/catalog.json`）。

当某个工具的某条命令需要交互终端时，在该工具的 `interactive_commands` 中将其 `input_method` 标记为 `pty`：

```json
{
  "id": "xhs-cli",
  "interactive_commands": [
    {
      "pattern": "\\blogin\\b",
      "prompt": "请在终端中完成扫码/登录",
      "input_method": "pty",
      "type": "input"
    }
  ]
}
```

字段说明：
- `pattern`: 正则，用于匹配 `argv` 拼接出来的命令字符串
- `prompt`: UI 展示给用户的提示语
- `input_method`:
  - `pty`: 需要 PTY 终端（聊天中渲染 `CLITerminal`）
  - 其他值（如 `stdin/env/arg`）走旧的“单输入框”逻辑（`awaiting_input`）
- `type`: 交互类型（保留给 UI 语义，如 input/password/confirm；不要复用为 PTY 标记）

---

## 端到端流程

### 1) 工具调用

CLI 工具调用统一使用 `argv` 结构（数组），例如：

```json
{ "name": "cli_xhs-cli", "args": { "argv": ["login"] } }
```

### 2) Agent 侧拦截：CLIInteractiveMiddleware

`CLIInteractiveMiddleware` 在 `wrap_tool_call` 阶段检测到 `interactive_commands` 命中后：
- 对 `input_method=pty`：不继续执行 CLI（避免“黑盒卡住”），而是产出一个 `ToolMessage`，并在 `additional_kwargs.cli_interactive` 中携带终端会话信息
- 并通过 `goto=END` 中断当前图执行，让前端先把终端打开

PTY 模式下 payload 的关键字段（简化）：

```json
{
  "status": "awaiting_terminal",
  "tool_id": "xhs-cli",
  "argv": ["login"],
  "session_id": "<uuid>",
  "websocket_url": "/api/cli/sessions/<uuid>/stream",
  "input_method": "pty",
  "prompt": "请在终端中完成扫码/登录"
}
```

注意：
- `argv` 是标准字段；`command` 仅作为兼容字段保留（历史前端可能读 `command`）
- `session_id` 为客户端/中间件生成的 UUID，后端 WebSocket 路由直接接受该 id（不强依赖 `POST /sessions/start` 分配）

### 3) 前端渲染：CLITerminal

当消息中存在 `additional_kwargs.cli_interactive.status=awaiting_terminal` 且带有 `session_id` 时：
- message list 渲染 `CLITerminal`
- `CLITerminal` 用 `getBackendBaseURL()` 推导 WebSocket base（http->ws / https->wss），不再硬编码 `ws://localhost:8001`

### 4) WebSocket 建连与 init 消息

前端连接：
- URL: `${wsBase}/api/cli/sessions/${sessionId}/stream`
- `onopen` 发送 init JSON（标准化字段）：

```json
{
  "tool_id": "xhs-cli",
  "argv": ["login"]
}
```

后端兼容：
- 首选读取 `argv`
- 若不存在或不是数组，则回退读取 legacy `command`

### 5) WebSocket 消息协议

后端 -> 前端：
- `{"type":"started","session_id":"..."}`
- `{"type":"output","data":"..."}`
- `{"type":"error","error":"..."}`
- `{"type":"terminated"}`

前端 -> 后端：
- 输入：`{"type":"input","data":"..."}`
- Resize：`{"type":"resize","rows":24,"cols":80}`
- 结束：`{"type":"terminate"}`

---

## 后端执行（PTY Session）

后端 WebSocket 连接后启动 PTY 子进程：
- 通过 `tool_id + argv` 解析“托管 CLI”的真实 shim 可执行路径（读取安装 manifest），避免把 `tool_id` 误当可执行文件名
- 进程 stdout/stderr 通过 `output_callback` 流式写回 WebSocket（`type=output`）
- WebSocket 收到 `type=input` 时写入 PTY stdin

---

## 常见问题排查

1) 聊天里没有出现终端，而是出现“单输入框”
- 检查 `backend/data/cli_marketplace/catalog.json` 是否为目标命令配置了 `interactive_commands[].input_method="pty"`

2) 终端出现但无法连接（立即显示 WebSocket error）
- 检查前端是否用 `getBackendBaseURL()` 推导 ws base（不要硬编码 localhost）
- 检查后端是否已注册 `cli_interactive` router（`/api/cli/sessions/{id}/stream`）

3) 终端连接成功但没有任何输出
- 检查 init message 是否发送了 `{tool_id, argv}`（数组）
- 检查后端日志是否报 “Invalid init message / Missing argv”

---

## 相关代码位置（便于跳转）

- Agent 拦截与 payload：
  - `backend/src/agents/middlewares/cli_interactive_middleware.py`
- WebSocket 路由：
  - `backend/src/gateway/routers/cli_interactive.py`
- 前端终端组件：
  - `frontend/src/components/workspace/messages/cli-terminal.tsx`
- ws base URL 工具：
  - `frontend/src/core/config/ws.ts`

