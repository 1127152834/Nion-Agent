# Session Policy As-Built（2026-03-11）

## 变更摘要

- 恢复设置页“会话策略”分区，统一承载：
  - 追问建议模型（Suggestions）
  - 会话标题策略（Title）
  - 自动总结策略（Summarization）
  - 子智能体超时策略（Subagents）
- 模型设置页移除“追问建议模型”入口，避免配置分散。
- 追问建议模型改为全局配置（`config.db`）：
  - 新增 `suggestions.model_name` 配置项。
  - `POST /api/threads/{thread_id}/suggestions` 采用“全局配置优先，请求参数兜底”。
- 标题策略新增 `title.mode`：
  - `fast`（默认）：快速确定性标题
  - `llm`：使用标题模型生成标题
- 标题模型在 `llm` 模式下生效，失败时回退到现有 fallback 逻辑。

## 契约说明

- `suggestions.model_name = null`：表示跟随当前会话模型（由请求 `model_name` 提供）。
- `title.mode = "fast"`：默认策略，保障首轮响应速度。
- `title.mode = "llm"`：启用模型生成标题，支持 `title.model_name` 指定模型。

## 非目标

- 本轮不扩展 per-agent 会话策略配置。
- 不改造 summarization/subagents 内核执行逻辑与存储结构。
