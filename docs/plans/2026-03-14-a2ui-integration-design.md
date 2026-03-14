# Nion Chat 引入 A2UI 的集成设计（草案 v0.2）

日期：2026-03-14  
作者：Codex（协作）  
范围：Nion-Agent（Gateway + LangGraph + Next.js 前端工作台）  
关键决策：仅使用 LangGraph；不引入 AG-UI 作为 transport（但**参考 AG-UI 的 A2UI middleware 语义**来设计双向交互闭环）

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

AG-UI 仓库里存在一条相对成熟的组合链路，核心思路是（我们会复用其语义，而不是直接引入其协议栈）：

- `@ag-ui/langgraph`：把 LangGraph agent 适配到 AG-UI 事件流（含 interrupt/human-in-the-loop）。
- `@ag-ui/a2ui-middleware`：
  - 在 agent 侧**注入** `send_a2ui_json_to_client` tool（并强制覆盖 schema，避免前端/转换器产生空 schema 导致 LLM 乱填参数）。
  - 将 agent 输出的 A2UI operations 归并为「按 surfaceId 分组」的 UI activity（delta + snapshot），前端用 renderer 直接渲染。
  - 将用户交互（userAction）通过 `forwardedProps.a2uiAction.userAction` 回传，并在 agent 输入 messages 尾部**合成**一组消息：`log_a2ui_event` tool call + tool result（这一步非常关键，让模型稳定地“看到用户刚刚点了什么/提交了什么”。）

这套模式对我们很有价值：即便我们不迁移到 AG-UI，也可以复用“**用户交互 -> 注入成 tool 事件 -> agent 继续**”的语义与 prompt 约定。

### 4.3（新增）我们在 LangGraph 中复用 AG-UI 语义的方式

由于 Nion 后端是 Python（LangGraph + 自有 middleware），无法直接复用 TS 的 `@ag-ui/a2ui-middleware` 实现；但可以在**语义层**对齐：

- **Tool 名称对齐**：复用 `send_a2ui_json_to_client` / `log_a2ui_event`，降低 prompt 与生态示例迁移成本。
- **userAction 透传方式对齐**：AG-UI 用 `forwardedProps`，我们改成 LangGraph 的 `configurable`（也就是前端 `thread.submit(..., { context })` 里的 runtimeContext）透传：`context.a2ui_action.user_action`。
- **合成消息对齐**：在 `A2UIMiddleware.before_agent()` 中把 `a2ui_action` 合成为 `log_a2ui_event` tool call + tool result（并标记为 UI 不展示的 internal 消息）。
- **中断式交互对齐**：沿用 Nion 现有 Clarification/CLIInteractive 的模式：拦截 `send_a2ui_json_to_client` tool call，写入 ToolMessage（包含 A2UI payload），然后 `goto=END` 等待用户交互。

### 4.3 前端渲染器的选择建议

候选方向：

1. `@a2ui/react`（官方）：协议一致性强，但默认样式体系与 Nion 可能不一致，需要主题变量与组件覆写。
2. `@a2ui-bridge/react-shadcn`（社区）：把 A2UI 组件映射到 shadcn/ui，更符合我们当前技术栈，UI 统一性更好。
3. `@a2ui-sdk/react`（社区）：同样基于 shadcn/ui + Tailwind，提供较完整的协议处理与组件实现。

推荐策略：

- v1 内测先用 **官方渲染器**跑通协议与交互闭环（减少不确定性）。
- v1 产品化落地（尤其面向普通用户）建议逐步走向“映射到我们既有 UI 体系”，避免在一个产品里出现两套视觉语言。

## 5. 推荐集成方案（Nion v1，LangGraph 原生接入，参考 AG-UI 语义）

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

### 5.2 用户交互回传：避免污染对话、保证 agent 能理解（参考 AG-UI 语义）

关键难点：用户点击/表单提交必须“可被 agent 可靠消费”，且不应该作为普通用户可见的对话内容。

推荐 v1 的务实方案（对齐 AG-UI：用 context 透传 + 合成 tool 消息，不往对话里塞隐藏 human message）：

1. 前端 `A2UICard` 的 `onAction` 回调拿到 A2UI `userAction` 事件。
2. 前端调用 `thread.submit()` 发起一次“恢复/继续”运行：
   - `input.messages` 为空数组（不新增 human message，不污染聊天记录）。
   - `context` 里携带 `a2ui_action.user_action`（结构见下方）。
3. 后端 `A2UIMiddleware.before_agent()` 检测到 `runtime.context["a2ui_action"]`：
   - 读取 `user_action`
   - 将其**合成为**两条消息追加到 state.messages 末尾：
     - `AIMessage(tool_calls=[{name: "log_a2ui_event", args: user_action_json}])`
     - `ToolMessage(name="log_a2ui_event", content="User performed action ... Context: {...}")`
   - 同时在 UI 层将 `log_a2ui_event` 标记为 internal（不在普通用户界面展示）。

这一步的设计要点：

- 对模型：它“像看到真实 tool call 一样”看到用户刚刚的点击/提交，从而稳定驱动后续步骤。
- 对用户：聊天记录里不会出现一条奇怪的隐藏 human message，也不会出现“log_a2ui_event”这类内部工具。

**`a2ui_action.user_action` 推荐结构（参考 AG-UI）：**

```json
{
  "name": "submit",
  "surface_id": "chat:{thread_id}:{tool_call_id}",
  "source_component_id": "submit-btn",
  "context": {
    "userName": "Alice",
    "plan": "pro"
  },
  "timestamp": "2026-03-14T22:00:00+08:00"
}
```

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

## 9. 前端渲染器选型结论（产品化优先）

结论：v1 选择 **shadcn 映射渲染**，落地实现使用 `@a2ui-sdk/react/0.8`。

原因（面向产品化）：

- 与 Nion 前端栈一致：React 19 + Tailwind v4（本仓库已在使用），UI 视觉更容易做到“像系统原生”，避免引入第二套视觉语言。
- 标准 catalog 覆盖完整：开箱支持 A2UI 标准组件集合，后续只需按需 override 少量组件即可逐步贴合 Nion 设计系统。
- 版本隔离清晰：通过 `@a2ui-sdk/react/0.8` 显式锁定协议版本，降低 A2UI Public Preview 演进对线上产品的影响面。

同时保留官方 `@a2ui/react` 作为协议对照实现，用于排查兼容性/行为差异，但不作为 v1 产品化首选渲染器。

## 10. 是否引入 AG-UI：收益/成本/风险评估（结论性版本）

我们只用 LangGraph 的前提下，AG-UI 的引入可以拆成三档（从轻到重）：

- 档位 A（推荐，v1）：**不引入 AG-UI 协议栈，仅复用其 A2UI middleware 语义**
  - 收益：最小改动拿到“userAction -> tool 事件 -> agent 继续”的成熟范式；prompt/工具命名与生态对齐。
  - 成本：实现一个 Python 版 `A2UIMiddleware` + 前端 A2UI 卡片；把 `log_a2ui_event` 设为 internal 不展示。
  - 风险：主要是协议仍在 Public Preview（A2UI v0.8），需要做 payload 校验与降级。

- 档位 B（可选，后续）：**局部引入 AG-UI 的事件层/Activity 形态（前端）**
  - 收益：多 surface、多 delta/snapshot 的 UI 流更标准化。
  - 成本：需要把现有 LangGraph message 流转成 AG-UI event 流，或在前端维护两套渲染数据流；收益不一定覆盖复杂度。
  - 风险：会扩大回归面（消息分组、tool 可视化、历史记录、重连逻辑）。

- 档位 C（不建议）：**全面引入 AG-UI（transport + event + agent 适配）**
  - 收益：全链路标准化，生态组件更多。
  - 成本：等价于“重写聊天协议层与前端流式渲染”，几乎必然触发大量 UI/状态管理重构。
  - 风险：回归面巨大，且与我们现有 Clarification/CLIInteractive/Artifacts 体系存在语义冲突，需要逐个重新适配。

结论：v1 选档位 A，先把 A2UI 作为“可中断的结构化 UI 卡片”跑通闭环；未来如果多 surface / streaming UI 更新的需求明确，再评估档位 B。
