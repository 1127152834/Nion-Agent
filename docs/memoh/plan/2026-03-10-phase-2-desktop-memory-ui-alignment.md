# Phase 2 热修：桌面端记忆页运行时对齐与最小防呆

> **定位：** 这是 `Phase 2` 完成后的桌面端运行时热修，不是新的正式阶段，也不是 `Phase 3` 提前实施。
>
> **一句话目标：** 在不改记忆核心链路的前提下，恢复桌面端“设置 → 记忆”页面显示，并避免开发态 Electron 在前端源码未稳定编译时静默暴露过期页面产物。

## 1. 问题诊断

当前后端长期记忆主链路已经可用：

- `/api/memory` 可以返回真实长期记忆数据
- `~/.nion/memory.json` 已有成功写入的 summary 与 facts
- prompt 构建链路已经能注入 `<memory>` 上下文

但桌面端仍出现“记忆页面为空”的表象。进一步排查发现，根因不在 `memory.json`、`provider`、`prompt`、`updater` 或 `MemoryMiddleware`，而在桌面前端运行时未稳定对齐当前源码：

- 开发态 Electron 当前运行的是 `pnpm run dev`
- 运行日志表明前端曾出现编译阻塞或旧产物残留
- 当前仓库源码中的记忆设置页只读取 `/api/memory`
- 但桌面运行时日志中持续出现 `/api/memory/overview`、`/api/memory/timeline`、`/api/memory/items` 等旧接口请求并返回 `400`

这说明当前问题是：**桌面前端实际运行产物与当前源码存在错位**，从而让 UI 看起来像“没有记忆”。

## 2. 为什么现在修

之所以现在先做这个热修，而不是继续推进更大规模的记忆系统重构，是因为它已经影响到最基本的开发闭环：

- 页面看不到后端已经存在的记忆，导致人工验收失真
- 手测无法区分“记忆核心故障”和“前端运行时错位”
- 如果开发态 Electron 可以在编译失败时继续挂着旧页面运行，后续 Phase 2 / Phase 3 的记忆改造会持续被误判

因此这次热修的目标是先恢复**桌面开发态的可验证性**，让页面、日志、后端数据三者重新对齐。

## 3. 本次目标

本次热修只做以下三件事：

1. 确保桌面端记忆设置页继续只走 `/api/memory`
2. 确保开发态 Electron 启动前清理安全范围内的前端临时构建产物，避免旧 bundle 残留
3. 确保前端主工作区路由如果编译失败，启动流程显式失败，而不是继续提供过期 UI

达成后，系统应至少满足：

- 启动桌面开发态后，`/workspace/chats/new` 正常返回可用页面
- 打开“设置 → 记忆”，页面能看到 `张天成 / 30岁 / 喜欢 Java 编程语言` 等已有记忆
- `gateway.log` 不再持续出现旧记忆页面接口的 `400` 噪声
- 普通会话询问“你记得我喜欢什么语言吗”时，回答能利用已存长期记忆

## 4. 非目标

本次热修明确不做以下内容：

- 不改 `backend/src/agents/memory/*` 的核心读写逻辑
- 不改 `memory.json` / `agents/{name}/memory.json` 数据格式
- 不新增 `/api/memory/overview`、`/api/memory/items`、`/api/memory/timeline` 等 memory-v2 展示接口
- 不改 `NionClient` 的 embedded 入口契约透传
- 不推进 `Phase 3` 的结构化存储、维护 API 或 provider 管理平面
- 不处理与本次桌面主工作区启动无关的前端大范围整理

## 5. 实施范围

本次热修的代码范围固定为：

- `desktop/electron/src/process-manager.ts`
  - 开发态启动前清理 `.next/dev` 与 `.next/cache`
  - 启动后新增工作区健康探测
  - 仅检查本次启动追加的前端日志片段，发现编译阻塞时直接失败
- `frontend/src/*`
  - 仅在当前工作区主路径存在直接编译阻塞时做最小修补
  - 不改记忆页 API 契约
- `openspec/changes/stabilize-desktop-memory-ui-runtime/*`
  - 写明问题、约束、设计与任务分解

## 6. 验收方式

### 自动化验收

- `cd frontend && pnpm typecheck`
- `cd backend && uv run pytest tests/test_memory_updater.py tests/test_memory_core_provider.py tests/test_memory_session_policy.py -q`
- `openspec validate stabilize-desktop-memory-ui-runtime --type change --strict`
- `git diff --check`

### 手工验收

1. **桌面主工作区可用**
   - 启动桌面开发态
   - `/workspace/chats/new` 正常可用，不再 500

2. **记忆页显示恢复**
   - 打开“设置 → 记忆”
   - 页面显示当前已有长期记忆数据，而不是空白

3. **记忆接口对齐**
   - 打开记忆页期间，`~/.nion/logs/desktop/gateway.log` 中应看到 `GET /api/memory 200`
   - 不再持续出现 `/api/memory/overview|items|timeline|backup/list` 的 `400`

4. **行为不回归**
   - 普通会话仍可读写长期记忆
   - `temporary_chat` 仍默认读开写关

## 7. 当前进展

- 已建立 OpenSpec change：`stabilize-desktop-memory-ui-runtime`
- 已确认后端 `/api/memory` 与 `~/.nion/memory.json` 数据一致
- 已确认记忆设置页源码仍只读取 `/api/memory`
- 已确认问题集中在桌面前端运行时对齐，而非记忆核心逻辑
