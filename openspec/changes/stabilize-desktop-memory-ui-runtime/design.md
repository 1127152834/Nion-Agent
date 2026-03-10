## Context

当前后端长期记忆已经能够：

- 从 `~/.nion/memory.json` 成功读取数据
- 通过 `/api/memory` 返回真实 summary 与 facts
- 在 prompt 构建时注入 `<memory>` 内容

同时，桌面端当前存在以下运行时风险：

- Electron 开发态通过 `pnpm run dev` 启动前端
- `.next` 临时产物可能残留旧 bundle
- 前端源码若发生编译阻塞，桌面仍可能继续暴露过期页面行为
- 这会让 UI 持续请求 `/api/memory/overview`、`/api/memory/items`、`/api/memory/timeline` 等当前后端并未提供的接口

因此本次修复的重点是：**让桌面前端运行时稳定对齐当前源码，并在主工作区编译失败时显式失败**。

## Goals

- 确保桌面记忆设置页继续只通过 `/api/memory` 读取数据
- 确保开发态 Electron 不再复用旧前端临时产物
- 确保工作区主路由编译失败时，启动流程显式失败
- 确保本次修复不影响 Phase 1 / Phase 2 的记忆读写语义

## Non-Goals

- 不新增 memory-v2 的展示接口或维护 API
- 不改 `memory.json` / `provider` / `updater` / `MemoryMiddleware` / `NionClient`
- 不处理 packaged frontend 路径
- 不开启 Phase 3 的结构化存储或 retrieval 重构

## Decisions

### 1. 仅修桌面 dev runtime

本次只处理 `frontendServerEntry === null` 的开发态 Electron 启动路径。打包态路径保持不变，避免扩大影响面。

### 2. 启动前只清理安全范围内的前端临时产物

仅清理 `frontend/.next/dev` 与 `frontend/.next/cache`，不触碰源码目录、打包产物、用户数据或其他 repo-tracked 文件。

### 3. 工作区健康探测使用真实落点

`/workspace` 在 Next.js 下可能先 307 跳转到 `/workspace/chats/new`。因此健康探测以 `/workspace/chats/new` 为准，确保真正的工作区主页面已经可用。

### 4. 编译阻塞检查只看本次启动追加日志

为了避免历史 `frontend.log` 内容误伤当前启动，本次只分析本次启动后新增的日志片段，并用有限关键词识别明显编译阻塞，如：

- `Parsing ecmascript source code failed`
- `Module not found`
- `Unexpected character`
- `Error:`

### 5. 不通过补后端旧接口兜底

本次不为旧或扩展 UI 补 `/api/memory/overview|items|timeline|backup/list` 等接口，避免把“运行时错位”问题误修成“兼容旧页面”问题。

## Risks / Trade-offs

- 这是一个开发态运行时热修，不是记忆核心重构
- 启动前清理 `.next/dev` 与 `.next/cache` 会让首次前端冷启动稍慢，但能显著降低旧 bundle 误导手测的风险
- 工作区健康探测只保证主页面与核心设置链路可用，不负责覆盖所有懒加载页面；这是本次“最小修复”的有意边界
