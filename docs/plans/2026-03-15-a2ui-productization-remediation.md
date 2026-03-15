# Nion-Agent A2UI 产品级整改与对标方案（LangGraph 原生接入，面向普通用户）

日期：2026-03-15  
作者：Codex（协作）  
仓库：Nion-Agent（Gateway + LangGraph + Next.js 工作台）  
状态：已落地核心链路（修复闭环、产品化失败态、能力声明、最小回归单测），可启动验证

## 1. 目标（从“能跑 Demo”到“可产品化”）

面向普通用户的产品化目标不是“渲染一次成功”，而是“链路可恢复、可观测、不会把协议细节暴露给用户”，具体包含：

- **稳定渲染**：A2UI payload 轻微不规范时可自动修复或降级，不会导致对话中断。
- **可恢复**：UI 渲染失败时，用户可一键重试或改用文字继续，系统可把失败原因回灌给模型自修复。
- **可观测**：错误分层（internal vs. user-visible），日志可定位（attempt、surfaceId、raw payload 摘要）。
- **对齐成熟语义**：对标市场成熟的 A2UI middleware 语义（尤其是“userAction 回流 -> 合成 tool 事件 -> agent 继续”与“生成-校验-修复闭环”），但不引入 AG-UI transport。

## 2. 关键问题与根因（整改前常见现象）

### 2.1 LangGraph BaseURL 误配置导致 `/api/threads/*` 404（P0）

典型踩坑：将 `NEXT_PUBLIC_LANGGRAPH_BASE_URL` 配成 `http://localhost:8001/api`，SDK 会拼出 `/api/threads/*`，但我们的网关正确代理前缀是 `/api/langgraph/*`。

结果：线程读取/确认不稳定，间接导致 A2UI 回合“无 UI / 解析失败 / 回退走偏”。

### 2.2 A2UI 失败缺少“自动修复闭环”，模型没有重试机会（P0）

如果后端一旦发现 payload 不合法就直接终止 run，模型在同一次 run 内无法收到结构化校验错误并修复，普通用户只能看到错误或被迫继续文字交互，且模型容易走偏（例如输出导出 HTML 文件等非产品化 fallback）。

### 2.3 版本与生态差异：v0.8 渲染器严格，模型输出易混用别名（P1）

常见问题：

- `Checkbox/CheckboxGroup`（非标准）与 `CheckBox`（标准）混用
- `dataModelUpdate.contents` 不是数组导致渲染器崩溃
- 多操作被塞进单个 dict（multi-op envelope）
- JSON 双重编码（`"\"[{...}]\""`）

仅靠 prompt 很难 100% 约束，必须有运行时容错与修复闭环。

### 2.4 失败态 UX 暴露 raw payload（P1）

排障信息对开发有用，但对普通用户是噪音且会破坏信任。产品化必须分离“用户可理解提示”和“开发诊断详情”。

## 3. 最终技术方案（已落地的产品化决策）

### 3.1 协议栈策略：内部以 v0.8 为 Canonical，外部输入做最大化兼容

- 前端渲染基座锁定：`@a2ui-sdk/react/0.8`（standard catalog + shadcn 风格，产品一致性更好）。
- 在不引入重型依赖的前提下，额外扩展少量产品组件以覆盖“图表可视化”类诉求（见 `TempRangeChart`）。
- 后端做“协议正确性兜底”：解析 string/list/dict，拆分 multi-op envelope，过滤/丢弃危险或会导致崩溃的形态（例如 `dataModelUpdate.contents` 非数组）。
- 前端做“渲染与 UX 兜底”：渲染异常不炸页面，有可操作的恢复路径。

### 3.2 引入“生成-校验-修复”闭环（核心 P0）

后端 `A2UIMiddleware` 在拦截 `send_a2ui_json_to_client` 时：

1. 解析/规范化 A2UI operations
2. 若失败：
   - **不再直接给用户抛协议错误**
   - 返回一个 **internal** 的 tool result（name 仍为 `send_a2ui_json_to_client`），在 `additional_kwargs.a2ui_validation_error` 中携带结构化错误
   - 模型收到后必须立即修复并重试（最多 2 次，避免死循环）
3. 超过重试次数：
   - 自动降级为 `ask_clarification`（“重试生成界面/改用文字继续”），保证普通用户可继续

### 3.3 userAction 回流对齐成熟 middleware 语义（稳定续跑）

当用户点击/提交 UI 后，前端不插入“隐藏 human message”，而是通过 LangGraph runtime context 透传：

- `context.a2ui_action.user_action`

后端在 `before_agent()` 中将其合成两条 internal 消息：

- `AIMessage(tool_calls=[log_a2ui_event(...)])`
- `ToolMessage(name=log_a2ui_event, content=...)`

这样模型会像处理真实 tool 事件一样稳定消费用户交互。

### 3.4 客户端能力声明与数据快照（提升成功率）

前端每次提交 A2UI action 时附带：

- `client_capabilities`：声明支持的 A2UI 版本、catalog、组件列表（v0.8 canonical）
- `data_model_snapshot`：最佳努力快照（当前实现使用 `action.context` 作为紧凑且稳定的信号）

后端透传并合并进 `log_a2ui_event` args，提示词要求模型参考这些元数据生成可渲染 payload，并尽量保留用户输入。

### 3.5 图表可视化（补齐“可视化”预期）

标准 catalog 本身不包含图表组件，导致模型在“想画图”的情况下容易退化成空白容器或错误使用输入组件作为展示占位。

因此我们在 catalog 上增加了一个轻量级的产品组件：

- `TempRangeChart`：用于小数据量折线图（典型是 7 天温度趋势），输入推荐使用 `literalArray`（数字用字符串编码），客户端用 SVG 绘制，不依赖外部图表库。

### 3.5 前端产品化失败态：不露底，一键重试/文字回退

- 普通用户默认只看到“界面无法显示/渲染失败”的可理解提示 + 两个按钮：
  - “重试生成界面” -> `__a2ui_retry__`
  - “改用文字继续” -> `__a2ui_fallback_text__`
- 开发态（非 production）才允许展开查看“技术详情”（raw payload）

### 3.6 环境与配置：自动纠正 LangGraph BaseURL 误配置

启动时若检测到 `NEXT_PUBLIC_LANGGRAPH_BASE_URL` 以 `/api` 结尾，会自动纠正为 `/api/langgraph` 并打印一次 warning，避免 `/api/threads/*` 404。

## 4. 关键实现落点（代码位置）

### 4.1 后端

- `send_a2ui_json_to_client` 拦截 + 校验失败内部回灌 + 超限降级：
  - `backend/src/agents/middlewares/a2ui_middleware.py`
- userAction -> 合成 `log_a2ui_event`（internal）并透传 `client_capabilities`/`data_model_snapshot`：
  - `backend/src/agents/middlewares/a2ui_middleware.py`
- 提示词强约束（repair loop + 禁止默认导出 HTML + 特殊 action 语义）：
  - `backend/src/agents/lead_agent/prompt.py`

### 4.2 前端

- A2UI 卡片渲染与产品化失败态（按钮、debug gating）：
  - `frontend/src/components/workspace/messages/a2ui-card.tsx`
- Nion 自定义 catalog（基于 standardCatalog 扩展）与图表组件：
  - `frontend/src/core/a2ui/catalog.ts`
  - `frontend/src/core/a2ui/components/temp-range-chart.tsx`
- A2UI action 提交时附带 `client_capabilities`/`data_model_snapshot`：
  - `frontend/src/core/threads/hooks.ts`
- BaseURL 自检与纠错（`.../api` -> `.../api/langgraph`）：
  - `frontend/src/core/config/index.ts`

## 5. 测试与验收（产品门槛）

### 5.1 后端单测（已落地）

文件：`backend/tests/test_a2ui_middleware_repair_loop.py`

覆盖：

- 解析失败 -> internal 校验错误（attempt 1/2）
- 超限 -> `ask_clarification` 降级（goto END）
- 缺 `beginRendering` -> internal 校验错误
- 成功渲染 -> 重置 attempt
- multi-op dict envelope -> 自动拆分并成功

运行：

```bash
cd backend
uv run pytest -q tests/test_a2ui_middleware_repair_loop.py
```

### 5.2 前端单测（已落地）

文件：`frontend/tests/unit/FE-CLI-002.langgraph-base-url-utils.test.ts`

覆盖：

- `/api` 误配置自动纠正
- `/api/langgraph` 保持不变
- 尾斜杠归一化

运行：

```bash
cd frontend
pnpm vitest run tests/unit/FE-CLI-002.langgraph-base-url-utils.test.ts
```

### 5.3 启动验证（已验证）

```bash
make dev
```

验收点：

- 网关 `:2026` 正常启动
- LangGraph 经由 `/api/langgraph/*` 可访问
- A2UI 失败时不暴露协议错误给普通用户（走内部回灌修复或 UI 级回退按钮）

## 6. 面向普通用户的目标场景（我们用来对齐体验）

以下场景是 v1 产品化的“验收目标”，优先保证 UI 可交互、可恢复、状态不丢：

- **确认对话框**：高风险操作（确认/取消）+ 风险摘要
- **表单收集**：TextField + DateTimeInput + MultipleChoice + Submit（提交后继续自动执行）
- **Checklist**：多选项勾选 + 提交（可映射为 CheckBox 列表）

## 7. 风险与后续工作

- **协议演进风险**：A2UI 仍处于演进阶段。当前通过“v0.8 canonical + 兼容/容错 + repair loop”降低线上风险；中期再评估升级到 v0.9+。
- **成本控制**：repair loop 上限固定为 2，避免死循环与成本失控。
- **可观测性**：建议后续把 `a2ui_validation_error.kind/attempt/surface_id` 纳入结构化日志与指标。
- **更强兼容层**：后续可逐步把常见 v0.9 字段差异做 deterministic 适配（当前以“可修复反馈/降级”为主）。
