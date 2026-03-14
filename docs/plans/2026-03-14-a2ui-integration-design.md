# Nion Chat 引入 A2UI 的集成设计（草案 v0.1）

日期：2026-03-14  
作者：Codex（协作）  
范围：Nion-Agent（Gateway + LangGraph + Next.js 前端工作台）

## 1. 背景与动机

目前 Nion 的聊天体验以“文本 + 工具调用链路”为主，已经具备：

- **Tool Calls 可视化**：Chain-of-Thought 折叠卡片可展示工具调用及结果（支持 `ui_card`）。
- **人机交互**：`ask_clarification`（选择题/追问）、`cli_interactive`（CLI 交互输入）等专用卡片。

但当场景需要“结构化输入、表单收集、分步向导、确认操作、复杂选项配置”时，纯文本追问的体验会出现：

- 普通用户需要在文本里理解并逐项填写，**认知负担大**，且容易漏填/填错格式。
- 同一类输入（如配置、授权、定时任务）在多个工具里重复出现，**一致性差**。
- 结果难以做到“可视化、可编辑、可复用”，导致“对话式 UI”长期难以产品化。

A2UI（Agent-to-UI）提供了一套“LLM 生成结构化 UI 描述，前端用本地组件库渲染”的协议能力，适合把“需要用户输入/确认”的环节产品化成**可交互 UI**，并保持跨端/跨实现的可演进性。

## 2. 目标与非目标

### 2.1 目标（v1）

- 在 **不替换现有 LangGraph 聊天链路** 的前提下，引入 A2UI 作为“对话中的结构化 UI 表达”。
- 对普通用户友好：在常见场景里，尽量用 UI（表单/按钮/列表）完成输入与确认，减少“复制粘贴 JSON/命令”的需求。
- 可靠性：对 A2UI payload 做基础校验与降级，避免 UI 不显示或阻塞对话。
- 安全边界清晰：UI 渲染只允许 catalog 白名单组件；对来自 agent 的 UI 视为不可信输入。

### 2.2 非目标（v1）

- 不在 v1 引入全新的 transport（例如全面迁移到 AG-UI 协议栈），避免大规模改动。
- 不在 v1 覆盖全部 A2UI 组件与复杂主题系统，优先覆盖高频组件（表单、按钮、列表、卡片、提示）。
- 不在 v1 做“任意外部 agent 的 UI 信任与签名”体系；先按“本系统 agent 可控”处理。

## 3. 现状梳理：Nion Chat 业务链路

### 3.1 前端（Next.js）

- 消息来源：`@langchain/langgraph-sdk/react` 的 `useStream()`，`streamMode` 使用 `["values", "messages-tuple", "custom"]`。
- 消息分组：`frontend/src/core/messages/utils.ts` 的 `groupMessages()` 将消息分为：
  - human / assistant（正文）
  - assistant:processing（思考/工具调用折叠）
  - assistant:clarification（追问卡片）
  - assistant:cli-interactive（CLI 交互卡片）
  - assistant:present-files（产物文件列表）
  - assistant:subagent（子任务卡片）
- UI 扩展点：
  - Tool 结果里可包含 `ui_card`，`frontend/src/components/workspace/messages/message-group.tsx` 会在 tool result 里识别并渲染 `ToolActionCard`。
  - 专用卡片（Clarification/CLIInteractive）是“工具消息 + additional_kwargs”的渲染分支。

结论：前端已经具备“按 tool message 的 `additional_kwargs` 做专用渲染”的结构，可直接新增 `assistant:a2ui` 分组与卡片组件。

### 3.2 后端（LangGraph / Middlewares）

- `lead_agent` 通过 middleware 链路处理：
  - `ClarificationMiddleware`：拦截 `ask_clarification` tool call，插入 tool message 并 `goto=END`，等待用户下一条 human message。
  - `CLIInteractiveMiddleware`：拦截需要输入的 `cli_*` tool call，插入 tool message 并 `goto=END`，用户回复后执行命令并更新 tool message。
- 管理类工具常用 `build_management_response()` 返回 JSON 字符串，内含 `ui_card` 等字段。

结论：后端也具备“拦截 tool call -> 注入 tool message additional_kwargs -> 中断执行等待用户”的成熟模式，可平滑复制到 A2UI。

## 4. 外部成熟方案与可借鉴点（GitHub 调研结论）

### 4.1 A2UI 官方现状

- v0.8 协议稳定；核心消息类型：`surfaceUpdate` / `dataModelUpdate` / `beginRendering` / `deleteSurface`。
- LangGraph/LangChain 的“官方一键集成”目前更多处于 **roadmap/社区兴趣** 阶段，而非官方 SDK 内置的 drop-in adapter。
- 官方提供：
  - React 渲染器（`@a2ui/react`）和 message processor（以 `processMessages` 为核心）。
  - Python agent SDK（schema/prompt/validator/fixer），强调“解析、校验、修复、再下发”。

### 4.2 AG-UI 生态：现成的 LangGraph + A2UI 组合

AG-UI 仓库里存在一条相对成熟的组合链路，核心思路是：

- `@ag-ui/langgraph`：把 LangGraph agent 适配到 AG-UI 事件流（含 interrupt/human-in-the-loop）。
- `@ag-ui/a2ui-middleware`：在 agent 侧注入 `send_a2ui_json_to_client` tool，并把 A2UI payload 转成前端可渲染的 “activity” 事件；同时把用户点击行为注入为 `log_a2ui_event` 的 tool call + tool result，确保 agent 能“看到”用户交互结果并继续推进流程。

这套模式对我们很有价值：即便我们不迁移到 AG-UI，也可以复用“**用户交互 -> 注入成 tool 事件 -> agent 继续**”的语义与 prompt 约定。

### 4.3 前端渲染器的选择建议

候选方向：

1. `@a2ui/react`（官方）：协议一致性强，但默认样式体系与 Nion 可能不一致，需要主题变量与组件覆写。
2. `@a2ui-bridge/react-shadcn`（社区）：把 A2UI 组件映射到 shadcn/ui，更符合我们当前技术栈，UI 统一性更好。
3. `@a2ui-sdk/react`（社区）：同样基于 shadcn/ui + Tailwind，提供较完整的协议处理与组件实现。

推荐策略：

- v1 内测先用 **官方渲染器**跑通协议与交互闭环（减少不确定性）。
- v1 产品化落地（尤其面向普通用户）建议逐步走向“映射到我们既有 UI 体系”，避免在一个产品里出现两套视觉语言。

## 5. 推荐集成方案（Nion v1）

### 5.1 核心设计：A2UI 作为一种“专用工具消息卡片”

引入一个新工具（名称待定，推荐对齐生态命名）：

- `send_a2ui_json_to_client(a2ui_json: list[dict], surface_id?: str, catalog_id?: str, ...)`

并新增一个后端 middleware：

- `A2UIMiddleware`：拦截该 tool call
  - 校验 `a2ui_json` 至少包含 `surfaceUpdate` 和 `beginRendering`（首次渲染）或满足更新规则（后续更新）。
  - 生成一个 `ToolMessage(name="send_a2ui_json_to_client", additional_kwargs={"a2ui": {...}})` 写入消息历史。
  - `goto=END` 中断执行，让前端先渲染 UI，等待用户交互。

前端新增一个 message group：

- `assistant:a2ui`：识别 `tool` 消息且 `additional_kwargs.a2ui` 存在，渲染 `A2UICard`。
- 同时在 Chain-of-Thought 的工具列表里 **隐藏** `send_a2ui_json_to_client`，避免普通用户看到“工具细节”，只看到 UI 卡片。

### 5.2 用户交互回传：避免污染对话、保证 agent 能理解

关键难点：用户点击/表单提交必须“可被 agent 可靠消费”，且不应该作为普通用户可见的对话内容。

推荐 v1 的务实方案（最小侵入、可演进）：

1. 前端 `A2UICard` 的 `onAction` 回调拿到 A2UI `userAction` 事件。
2. 前端向 LangGraph 提交一条“内部 human message”，内容使用明确的机器可解析 tag，例如：
   - `<a2ui_action>{"userAction": {...}}</a2ui_action>`
3. 前端展示层过滤该内部消息（不渲染，或标记为系统事件）。
4. 后端 `A2UIMiddleware.before_agent` 检测到该 tag：
   - 解析 JSON
   - 将这条 human message 转写为一条结构化 `ToolMessage(name="log_a2ui_event", content="User performed action ... Context: {...}")`
   - 或者保留 human message 但将其内容替换为更适合模型消费的简洁描述（避免模型直接看到 tag + 原始 JSON）。

这一步的设计要点：我们要保证“模型看到的内容”是稳定、低噪声、可指令化的，而不是让模型去猜 UI 点击意味着什么。

### 5.3 SurfaceId 策略

为了避免多个 UI 卡片互相覆盖，建议每次渲染都生成唯一 surfaceId：

- `chat:{thread_id}:{tool_call_id}`（或 `chat:{thread_id}:{message_id}`）

同一个卡片的后续更新复用同一 surfaceId。

## 6. 面向普通用户的 v1 目标场景（建议优先级）

优先挑“高频 + 结构化输入明显收益”的场景，作为验收目标。

### 场景 A：配置向导（模型 / Key / 连接检查）

用户说：“帮我配置模型/Key/代理/记忆策略”。  
目标：Agent 返回 A2UI 表单（provider 下拉、key 密码框、测试连接按钮、保存按钮），用户不需要阅读长说明。

### 场景 B：创建定时任务（Scheduler Wizard）

用户说：“每天 9 点提醒我……”。  
目标：Agent 返回 A2UI 表单（名称、提示词、频率、时区、是否启用、预览），提交后直接落库并给出结果回显。

### 场景 C：接入 MCP（授权/参数收集）

用户说：“接入 GitHub MCP”。  
目标：Agent 返回 A2UI 卡片，展示可选授权方式与下一步按钮（打开 OAuth/输入 token/确认 scopes），最终完成连接并提示可用工具。

### 场景 D：高风险操作确认（安全可控）

当工具安全中间件要求确认时，Agent 使用 A2UI 显示“确认/取消”与风险摘要，而不是让用户在文本里回复“yes”。

## 7. 可靠性与安全要点（必须落地）

- **Catalog 白名单**：只允许标准 catalog 或 Nion 自定义 catalog；禁止任意组件类型。
- **Payload 校验与降级**：缺少 `beginRendering`、root 不存在、组件数过多时：
  - 记录错误
  - 降级为文本说明 + 要求重试生成
- **复杂度限制**：限制 component 数量、嵌套深度（尽管是 adjacency list 也要限制引用数量），防 DoS。
- **不渲染外部不可信 HTML**：坚持 A2UI 组件渲染，不走 `dangerouslySetInnerHTML` 的自由内容路线。

## 8. 里程碑与发布策略

建议按“闭环优先”的节奏：

1. P0：前端能渲染 A2UI（静态样例）+ 不破坏现有聊天 UI。
2. P1：后端 tool + middleware + 前端卡片，完成“显示 UI 卡片”的闭环。
3. P2：支持 userAction 回传 + agent 能继续推进（不暴露内部消息）。
4. P3：把一个真实业务场景（Scheduler 或 MCP）做成端到端演示，并加测试与监控。

## 9. 开放问题（需要你拍板的一项）

v1 的前端渲染器选型：

- 你希望优先用官方 `@a2ui/react` 先跑通闭环，还是直接走更贴近我们 UI 的 `@a2ui-bridge/react-shadcn` / `@a2ui-sdk/react`？

