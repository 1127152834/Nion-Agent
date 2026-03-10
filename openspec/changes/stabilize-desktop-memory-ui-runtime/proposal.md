## Why

后端长期记忆主链路当前已经能够写入并读取真实 `memory.json` 数据，但桌面开发态仍可能在前端源码未稳定编译或旧产物残留时继续暴露过期 UI 行为，导致“设置 → 记忆”页面显示为空，并持续请求当前后端并未提供的旧 memory 扩展接口。

这会让手测结果失真：用户会误以为长期记忆系统没有工作，而实际故障在桌面前端运行时未稳定对齐当前源码。本次变更的目标，是在不改记忆核心的前提下，恢复桌面端记忆页显示，并为开发态 Electron 增加最小防呆，避免前端编译失败时继续挂着旧页面运行。

## What Changes

- 新增桌面端记忆页运行时对齐热修文档与 OpenSpec 规格
- 开发态 Electron 启动前，清理安全范围内的前端临时构建产物，避免旧 bundle 残留
- 桌面前端启动后，增加工作区主路由健康探测与编译阻塞检查
- 继续保持记忆设置页只通过 `/api/memory` 读取数据，不新增 memory-v2 展示接口
- 补充验证与手测要求，确保普通会话、`temporary_chat`、显式 `memory_*` 语义不回归

## Capabilities

- Added: `memory-ui-runtime-alignment`

## Impact

- `desktop/electron/src/process-manager.ts`
- `frontend/src/*`（仅在主工作区直依赖存在编译阻塞时做最小修补）
- `docs/memoh/plan/2026-03-10-phase-2-desktop-memory-ui-alignment.md`
- `openspec/changes/stabilize-desktop-memory-ui-runtime/*`
