# Nion-Agent 模块地图与重构风险排序（Snapshot）

**日期**：2026-03-16  
**基线提交**：6ba1f531（生成本快照时 `main` HEAD）  
**目标**：把“当前系统有哪些模块”沉淀成可执行的治理边界与风险地图，作为后续渐进式治理（WS0-WS4）的统一参考。  

> 说明：这是“目录与职责快照”，不是最终架构文档。后续任何新增/迁移/删除模块，都应同步更新本文件或在 `docs/优化记录/` 里说明偏差。

---

## 1. 顶层目录（Repo）

- `backend/`：FastAPI Gateway + LangGraph + Sandbox + Memory(OpenViking) + Scheduler + Channels + Tools/Subagents/MCP 等运行时能力（高风险域集中）。
- `frontend/`：Next.js 工作台（Workspace/Chats/Settings/Workbench/Artifacts 等）。
- `desktop/`：Electron 桌面壳（主进程/IPC/路径/运行时管理/更新等）。
- `docs/`：计划与实施文档、产品设计、优化记录（不影响运行时，但影响协作与认知成本）。
- `openspec/`：结构化变更包（spec/design/tasks/proposal），用于沉淀变更过程与可追溯性（可能被工具链依赖）。
- `skills/`：公开技能包（运行时可能动态加载，删除/改名需谨慎）。
- `scripts/`：项目脚本与一次性辅助工具。
- `docker/`：本地/容器化开发相关配置。
- `reports/`：历史静态产物（原型/截图/报告等，通常低风险，但需注意测试/文档引用）。

关键配置与入口文件（高风险）：

- `config.example.yaml` / `config.yaml`（本地）：运行时配置主入口（模型/工具/技能/沙箱/通道等）。
- `extensions_config.json`：扩展/技能启用状态（动态加载相关）。
- Root `Makefile`：统一验证入口 `make verify`（治理门禁的底座）。

---

## 2. Backend 模块（`backend/src/`）

### 2.1 模块清单（按目录边界）

- `backend/src/config/`：配置 schema、加载、校验、路径解析（A）
- `backend/src/gateway/`：FastAPI Gateway（应用入口/路由/契约）（A）
- `backend/src/gateway/routers/`：HTTP API routers（对外契约入口，高爆炸半径）（A）
- `backend/src/agents/`：Agent 编排与核心中间件（B；其中 memory/soul 较高）
- `backend/src/agents/memory/`：记忆系统核心（OpenViking 等）（A）
- `backend/src/sandbox/`：沙箱执行与安全边界（A）
- `backend/src/scheduler/`：调度系统（A）
- `backend/src/channels/`：外部通道集成（A）
- `backend/src/channels/plugins/`：通道插件（动态加载/外部依赖）（A/B）
- `backend/src/tools/`：工具系统（B）
- `backend/src/tools/builtins/`：内置工具（B）
- `backend/src/skills/`：技能加载与管理（动态加载）（B）
- `backend/src/subagents/`：子智能体系统（B）
- `backend/src/subagents/builtins/`：内置子智能体（B）
- `backend/src/mcp/`：MCP 客户端/适配（B）
- `backend/src/models/`：模型配置与解析（B）
- `backend/src/embedding_models/`：Embedding 模型实现/适配（B）
- `backend/src/retrieval_models/`：检索模型实现/适配（B）
- `backend/src/services/`：跨域 service（通常 B/C，取决于调用方）
- `backend/src/security/`：安全相关（通常 A/B）
- `backend/src/system/`：系统能力（C）
- `backend/src/heartbeat/`：心跳/定时任务模板（C；与 scheduler 耦合时风险上升）
- `backend/src/evolution/`：演化/反思层（C；与 memory/heartbeat 耦合时风险上升）
- `backend/src/processlog/`：运行日志与诊断（C）
- `backend/src/runtime_profile/`：运行时 profile（C）
- `backend/src/reflection/`：反射加载（动态导入，改动需谨慎）（B）
- `backend/src/community/`：社区集成（Tavily/WebSearch/Fetch 等）（C）
- `backend/src/cli/`：CLI 与交互（B/C）
- `backend/src/utils/`：通用工具（C）
- `backend/src/keychain/`：凭据/密钥相关（A/B）

### 2.2 关键入口（建议重构前先钉住行为）

- `backend/src/gateway/app.py`：FastAPI app 组装入口（A）
- `backend/src/gateway/config.py`：Gateway 配置与运行时对齐（A）
- `backend/src/gateway/routers/langgraph_proxy.py`：LangGraph 代理入口（A）
- `backend/src/gateway/routers/{memory,openviking,scheduler,channels,workbench}.py`：核心能力对外契约（A）

---

## 3. Frontend 模块（`frontend/src/`）

### 3.1 Next.js App Router（页面与路由）

- `frontend/src/app/`：App Router 根
- `frontend/src/app/workspace/`：工作台主路径（B/C）
- `frontend/src/app/api/`：BFF/Server Actions/API routes（B）
- `frontend/src/app/mock/`：mock（D）
- `frontend/src/app/prototypes/`：原型/试验页面（D）

### 3.2 Core 域（业务基础设施层，重构风险高）

> `frontend/src/core/*` 基本对应后端能力域，属于“调用方契约集中区”，改动需谨慎并补回归测试。

- `frontend/src/core/api/`：API 调用封装（B）
- `frontend/src/core/config/`、`config-center/`：配置读取/编辑（B）
- `frontend/src/core/threads/`、`messages/`：对话线程与消息模型（B）
- `frontend/src/core/models/`、`embedding-models/`、`retrieval-models/`：模型与检索（B）
- `frontend/src/core/memory/`：记忆相关（B）
- `frontend/src/core/scheduler/`：调度相关（B）
- `frontend/src/core/channels/`：通道相关（B）
- `frontend/src/core/workbench/`：工作台/插件（B）
- `frontend/src/core/artifacts/`：产物与工作台集成（B）
- `frontend/src/core/mcp/`：MCP 管理（B）
- `frontend/src/core/platform/`：平台/运行时适配（B）
- `frontend/src/core/runtime-*`：运行时诊断与拓扑（B/C）
- `frontend/src/core/settings/`：本地设置与持久化（B）
- `frontend/src/core/tools/`、`skills/`、`tasks/`、`uploads/`：工具/技能/任务/上传（B/C）
- `frontend/src/core/i18n/`：国际化（C）
- `frontend/src/core/utils/`：工具（C）

### 3.3 组件层

- `frontend/src/components/workspace/`：工作台 UI 组合层（C；热点组件仍需小步治理）
- `frontend/src/components/ai-elements/`：AI 元素组件库（C）
- `frontend/src/components/ui/`：基础 UI（C）
- `frontend/src/components/landing/`：Landing（D/C）

### 3.4 其他

- `frontend/src/plugins/`：前端插件（动态行为，B/C）
- `frontend/src/server/`：服务端逻辑（B）
- `frontend/src/hooks/`、`lib/`、`styles/`、`typings/`：基础设施（C/D）

---

## 4. Desktop 模块（`desktop/electron/src/`）

Electron 主进程与安全边界集中在少量关键文件中，属于高风险域：

- `main.ts`：主进程入口（A）
- `preload.ts`：preload 与渲染进程桥接（A）
- `process-manager.ts`：进程管理（A/B）
- `runtime-manager.ts`：运行时管理（A/B）
- `paths.ts`：路径与目录基座（A）
- `runtime-ports-config.ts`：端口/运行时配置（B）
- `update-manager.ts`：更新（B）
- `workspace-directory-watcher.ts`：工作区文件监听（B）
- `window-lifecycle.ts`、`startup-*`、`health.ts`、`i18n.ts`：辅助（C/B）

---

## 5. 支撑目录与工具链（风险通常更低，但要注意动态加载）

- `docs/`：D（流程与协作关键，但不影响运行时）
- `reports/`：D（静态产物；但需注意测试引用）
- `openspec/`：C/D（若被工具链依赖，风险上升）
- `docker/`：C（影响开发/部署路径）
- `scripts/`：C/D（脚本被 CI/运行时调用时风险上升）
- `skills/`：B/C（若运行时按路径动态加载，删除/改名需走证据链）

---

## 6. 重构风险排序（A/B/C/D）

### A 级（极高风险，最后动，先补护城河）

- Backend：`backend/src/config/`、`backend/src/gateway/`（尤其 `routers/langgraph_proxy.py` 与 `routers/{memory,openviking,channels,scheduler,workbench}.py`）、`backend/src/agents/memory/`、`backend/src/sandbox/`、`backend/src/scheduler/`、`backend/src/channels/`、`backend/src/keychain/`
- Desktop：`desktop/electron/src/{main,preload,paths,process-manager,runtime-manager}.ts`
- 配置与动态加载：`config.yaml`（本地）、`extensions_config.json`

### B 级（高风险，需要门禁 + 小步切）

- Backend：`backend/src/agents/`（除 memory 外）、`backend/src/tools/`、`backend/src/skills/`、`backend/src/subagents/`、`backend/src/mcp/`、`backend/src/models/`、`backend/src/{embedding_models,retrieval_models}/`、`backend/src/reflection/`
- Frontend：`frontend/src/core/*`（尤其 `api/config/threads/messages/models/memory/mcp/channels/scheduler/workbench/artifacts/platform`）、`frontend/src/app/api/`
- Desktop：`desktop/electron/src/{update-manager,runtime-ports-config,workspace-directory-watcher}.ts`
- `skills/`（若确认运行时加载）

### C 级（中风险，优先做热点降复杂度）

- Backend：`backend/src/{evolution,heartbeat,processlog,system,runtime_profile,community,utils,services}`（不触碰核心闭环前提下）
- Frontend：`frontend/src/components/workspace/`、`frontend/src/app/workspace/`（组合层重构，注意不破坏 core 契约）
- `docker/`、`scripts/`（被 CI/运行时引用时升级为 B）

### D 级（低风险，优先降噪入口）

- `docs/`、`reports/`、`frontend/src/app/mock/`、`frontend/src/app/prototypes/`（仅在确认无引用后删除/合并）

---

## 7. 下一步建议（用于并发 workstream 切分）

- WS1（Repo Hygiene）：继续扩展候选清单到 `scripts/`、`docs/`（非 plans/product-design/优化记录）与 `reports/` 余项，并逐条补齐证据链。
- WS2（Frontend）：优先对 `frontend/src/core` 与 `components/workspace` 的热点文件做“拆大文件 + 去重复 + 补单测”。
- WS3（Backend）：优先对 `backend/src/gateway/routers/*` 的热点大文件做“薄 router + service 下沉 + 可测核心逻辑”。
- WS4（Core Domains）：Memory/Sandbox/Channels/Scheduler 专项（必须先补回归测试护城河，再做实现优化）。

