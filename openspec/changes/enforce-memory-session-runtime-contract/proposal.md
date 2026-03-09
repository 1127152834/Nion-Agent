## Why

前端已经把 `session_mode`、`memory_read`、`memory_write` 作为产品语义透传给聊天线程，但后端运行时并没有统一消费这些字段。结果是 UI 承诺的“临时会话不污染长期记忆”仍然可能被真实运行时破坏，这会直接损伤用户对长期记忆的信任。

## What Changes

- 补齐后端线程状态契约，使其正式支持 `session_mode`、`memory_read`、`memory_write`
- 新增轻量 `policy.py`，集中裁决会话是否允许读取或写入长期记忆
- 让长期记忆读取链路与写回链路都复用同一套策略判断
- 增加自动化测试，锁定普通会话、临时会话和显式禁读/禁写的运行时行为
- 在 OpenSpec 中记录 proposal、spec、design、tasks，作为本阶段 spec-first 入口

## Capabilities

### New Capabilities
- `memory-session-policy`: 定义线程级长期记忆读写策略，以及 `temporary_chat` 的默认读写语义

### Modified Capabilities

## Impact

- 后端线程状态与运行时中间件：`backend/src/agents/thread_state.py`、`backend/src/agents/middlewares/runtime_profile_middleware.py`
- 长期记忆读链路：`backend/src/agents/lead_agent/prompt.py`、`backend/src/agents/lead_agent/agent.py`
- 长期记忆写链路：`backend/src/agents/middlewares/memory_middleware.py`
- 前端线程提交链路：`frontend/src/core/threads/hooks.ts`
- 后端测试与项目文档：`backend/tests/*`、`README.md`、`backend/CLAUDE.md`、`docs/memoh/plan/2026-03-09-phase-1-runtime-contract.md`
