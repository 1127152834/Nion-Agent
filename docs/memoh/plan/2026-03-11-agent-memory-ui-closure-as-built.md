# As-Built：记忆与智能体管理 UI 收口（2026-03-11）

## 目标

- 设置页记忆收敛为 Global-only 展示。
- 智能体记忆迁移到智能体管理页内查看。
- 智能体管理页改为左导航信息架构。
- 智能体列表与卡片完成产品级可读性与信息密度升级。

## 已落地改动

### 1) 全局记忆页收口（Global-only）

- 移除 global/agent 切换与 agent 选择控件。
- 页面改为结构化模块：
  - KPI 概览
  - 用户画像/历史背景
  - 治理队列（只读）
  - 智能体目录（只读）
  - 条目列表（搜索 + 状态/类型筛选）
- 增加“智能体记忆入口”引导卡，跳转到对应智能体设置页 `?section=memory`。

对应文件：
- `frontend/src/components/workspace/settings/memory-settings-page.tsx`

### 2) 智能体记忆迁移到智能体管理

- 新增 `AgentMemorySection`：
  - 自定义智能体：读取 `scope=agent&agent_name=...` 的记忆视图与条目
  - 默认智能体 `_default`：不再请求 agent 记忆，显示“使用全局记忆”说明并提供全局入口
- 空态提供“去发起对话沉淀记忆”动作。

对应文件：
- `frontend/src/components/workspace/agents/settings/agent-memory-section.tsx`

### 3) 智能体设置页 IA 重构（左导航 + 右内容）

- 从顶部 Tabs 改为左侧分组导航：
  - 概览（Basic/Memory）
  - Persona（SOUL/IDENTITY）
  - Runtime（Heartbeat/Evolution）
  - 观测（Logs/Reports）
- 使用 URL 查询参数同步分区：`?section=...`。
- 顶部加入智能体摘要头部区，支持“发起对话”快捷操作。

对应文件：
- `frontend/src/app/workspace/agents/[agent_name]/settings/page.tsx`

### 4) 智能体列表与卡片升级

- Gallery：新增搜索与筛选（全部/默认/Heartbeat/Evolution）。
- Card：信息层级升级（模型、工具组、目录摘要、Heartbeat/Evolution 状态），动作分层（对话/记忆/设置/删除），默认卡片高亮。

对应文件：
- `frontend/src/components/workspace/agents/agent-gallery.tsx`
- `frontend/src/components/workspace/agents/agent-card.tsx`

### 5) 设置深链能力补齐

- 支持 URL 参数 `?settings=memory` 自动打开设置弹窗并定位到记忆分区，承接默认智能体记忆说明中的“打开全局记忆页”。

对应文件：
- `frontend/src/components/workspace/workspace-nav-menu.tsx`

### 6) i18n 与类型同步

- 新增并收口 agents/settings/memory 相关文案与键。
- 同步更新 locale types，避免类型漂移。

对应文件：
- `frontend/src/core/i18n/locales/zh-CN.ts`
- `frontend/src/core/i18n/locales/en-US.ts`
- `frontend/src/core/i18n/locales/types.ts`

## 验证结果

- `pnpm --dir frontend typecheck`：通过
- 定向 ESLint（本次改动文件）：通过

备注：仓库当前 `pnpm --dir frontend lint` 全量存在与本次改动无关的既有报错，不作为本次 UI 收口阻塞项。

## 不在本轮范围

- 不处理 422 相关问题。
- 不改后端记忆治理裁决模式（继续系统全权治理，前端只读）。
- 不改 Memory Core 存储结构与运行时契约。
