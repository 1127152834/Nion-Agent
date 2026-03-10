## Why

当前 Nion 的长期记忆能力已经能运行，但读写注入、写回队列、存储路径、记忆读取和后续维护能力仍然直接耦合在 V2 单体链路里。Phase 1 已经把 `session_mode`、`memory_read`、`memory_write` 的运行时语义修正到位，如果 Phase 2 继续让上层直接依赖 `queue.py`、`updater.py`、`prompt.py` 里的 V2 细节，后续 `storefs`、`usage / compact / rebuild`、provider lifecycle 只会继续堆在旧链路上。

本阶段要解决的不是“把记忆做得更强”，而是先把记忆系统从“可运行单体”变成“可演进内核”：建立最小 `Memory Core` 骨架，让旧逻辑挂到新边界下运行，并保持当前外部行为基本兼容。

## What Changes

- 新增最小 `Memory Core` 骨架：`MemoryProvider`、`MemoryRuntime`、`MemoryRegistry`
- 复用现有 `policy.py` 作为会话语义裁决层，不重新定义 Phase 1 的读写策略
- 引入默认 `v2-compatible` provider，把当前 `memory.json` / `agents/{name}/memory.json` 读写逻辑包装到 runtime 下
- 让 prompt 注入、memory write、memory 只读接口开始依赖 `Memory Core` 抽象，而不是直接依赖 V2 细节文件
- 补齐默认 provider、默认 runtime、兼容写回和 Phase 1 读写 gating 的自动化测试

## Capabilities

### New Capabilities
- `memory-core`: 为长期记忆系统提供最小 provider/runtime/registry 骨架，并为后续结构化存储与维护能力提供稳定挂点

### Modified Capabilities
- `memory-session-policy`: 继续作为 Memory Core 的会话语义来源，驱动注入与写回 gating

## Impact

- 后端记忆核心模块：`backend/src/agents/memory/*`
- 读写链路接线：`backend/src/agents/lead_agent/prompt.py`、`backend/src/agents/middlewares/memory_middleware.py`
- memory 只读接口：`backend/src/gateway/routers/memory.py`、`backend/src/client.py`
- 自动化测试与阶段文档：`backend/tests/*`、`backend/CLAUDE.md`、`README.md`、`docs/memoh/plan/2026-03-09-phase-2-memory-core.md`
