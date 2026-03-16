# Nion-Agent 代码优化治理（渐进式）Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在不牺牲稳定性的前提下，用可回滚的小步并发治理，持续降低无效代码与复杂度，建立统一质量门禁，提升可维护性并控制体量。

**Architecture:** 以“门禁先行 + 证据链清理 + 热点小步重构”为主线，按风险分层和 workstream 并发推进；每个 workstream 用独立 worktree/分支隔离，所有变更必须携带验证证据与回滚点，并沉淀到 `docs/优化记录/`。

**Tech Stack:** Root `make verify`、Backend `ruff/pytest/pytest-cov/vulture`（uv）、Frontend `eslint/tsc/vitest`（pnpm）、Desktop `tsc/node --test`（pnpm）、辅助 `rg/find/cloc/git`。

**日期**：2026-03-16  
**仓库**：Nion-Agent  
**目标优先级**：稳定性与可维护性（同时兼顾体量控制与无效代码清理）  

---

## 1. 背景与问题陈述

当前仓库经历了较长时间的 vibe coding，功能闭环具备，但代码体量快速膨胀，出现了典型治理问题：

- 存在重复实现、过期原型/实验性代码、未被引用的模块与分支，导致理解成本与维护成本持续上升。
- 关键链路（Gateway/LangGraph Proxy、Memory/OpenViking、Sandbox、Channels、Scheduler、Workbench）代码复杂度高，边界不清，变更风险大。
- 质量门禁不均衡：后端有 `ruff + pytest` 的 CI，但前端与桌面端质量门禁缺失，导致“看起来能跑”但不可持续。

本方案采用“渐进式治理”作为主策略：不追求一次性大改，而是以可验证、可回滚的小步迭代持续降低复杂度与体量，并允许多任务并发推进以提高总体效率。

---

## 2. 优化目标（明确要达成的结果）

四个目标全部是硬目标，且长期有效：

1. **稳定性**：关键链路回归风险可控，线上/本地运行更少出现非预期崩溃与边界漏洞。
2. **可维护性**：模块边界清晰、职责单一、复杂度可管理，新人可在短时间内定位问题与安全修改。
3. **体量控制**：持续识别并清理无效代码与重复逻辑，避免“代码只增不减”，控制长期成本。
4. **质量提升**：建立统一质量门禁（lint/typecheck/test/build），把“能跑”升级为“可持续演进”。

---

## 3. 非目标（本次不做或谨慎做）

- 不做“大爆炸重构”（一次性重排所有目录/接口/调用链）。
- 不在没有门禁与回归测试的情况下大规模删除核心域代码（A/B 级模块）。
- 不为了“整洁”强行引入重型框架/新抽象层（保持简单、可读、可 debug）。

---

## 4. 当前模块版图（作为治理边界）

系统是三端架构：

- `backend/`：FastAPI Gateway + LangGraph + 沙箱执行 + 记忆系统 + 调度 + 通道集成等运行时能力
- `frontend/`：Next.js 工作台（Workspace/Chats/Settings/Workbench/Artifacts 等）
- `desktop/`：Electron 桌面壳（运行时管理、进程管理、端口/路径、更新、preload 等）

支撑目录：

- `docker/`、`scripts/`、`openspec/`、`docs/plans/`、`skills/`、`.github/`

---

## 5. 风险分层（决定“先做什么后做什么”）

风险 = 爆炸半径 + 数据/安全敏感度 + 动态引用程度 + 跨端耦合 + 自动化验证缺口。

### A 级（极高风险，优先最后动）

- 配置/路径基座：`backend/src/config`
- 对外 API 契约与入口：`backend/src/gateway`（尤其 `langgraph_proxy.py`、`config.py`、`openviking.py`、`memory.py`、`channels.py`、`scheduler.py`、`workbench.py`）
- 数据一致性核心：`backend/src/agents/memory`（OpenViking、索引、写回）
- 安全边界/执行：`backend/src/sandbox`、`backend/src/sandbox/local`
- 外部集成：`backend/src/channels`、`backend/src/channels/plugins`
- 后台执行：`backend/src/scheduler`
- 桌面端主流程与安全边界：`desktop/electron/src/main.ts`、`preload.ts`、`runtime-manager.ts`、`process-manager.ts`、`paths.ts`

### B 级（高风险，需要门禁 + 小步切）

- Agents 编排与中间件：`backend/src/agents/*`、`backend/src/subagents/*`
- 工具与技能加载：`backend/src/tools`、`backend/src/skills`、`backend/src/mcp`
- CLI/交互：`backend/src/cli` + Gateway CLI routers
- 模型与检索：`backend/src/models`、`embedding_models`、`retrieval_models`
- 前端 core 层：`frontend/src/core/*`（尤其 `config`、`api`、`navigation`、`threads/messages/models/memory/mcp/channels/scheduler/workbench`）
- 前端 workspace 主路径：`frontend/src/app/workspace/*`、`frontend/src/components/workspace/*`

### C/D 级（中低风险，适合作为第一阶段降噪入口）

- 诊断/周边能力：`backend/src/processlog`、`reflection`、`system`、`heartbeat`、`community/*`
- 文档/脚本/原型与素材：`docs/plans`、`reports`、`openspec`、`scripts`、`docker`

---

## 6. 总体策略（渐进式治理 + 可并发执行）

### 6.1 渐进式治理的核心规则

- **先安全网，再动刀**：没有统一验证命令与 CI 门禁，任何“清理/重构”都不可控。
- **小步提交**：每个 commit 只做一类事，保证可审查、可回滚。
- **证据链删除**：删除必须能自证“不会误删动态引用”，否则先隔离/冻结再观察。
- **边界先于实现**：优先明确模块边界与契约（输入输出、错误语义、数据写入点），再优化内部实现。

### 6.2 并发推进的组织方式（你要求的“多任务执行”）

采用“多工作流并行”的方式提升吞吐，但必须控制冲突与风险：

- **工作流（Workstream）划分原则**：以目录边界为主，减少同文件冲突。
- **并发数量控制**：同一时间最多 2-3 个 workstream 并行（WIP limit），避免集成地狱。
- **集成顺序**：优先合并“门禁/工具链”类变更，其次合并低风险清理，最后合并核心域重构。
- **隔离手段**：每个 workstream 使用独立 git worktree + 分支（前缀 `codex/`），每个 workstream 自己跑完验证再合并。

推荐 workstream 模板：

- WS0（Guardrails）：CI/验证命令/质量门禁统一化（跨端，但尽量只动 build/配置文件）
- WS1（Repo Hygiene）：无效文件/过期原型清理（优先 C/D 级）
- WS2（Frontend）：大组件拆分与重复逻辑收敛（优先 Settings/InputBox）
- WS3（Backend）：热点大文件拆分与 service 化（优先 `gateway/routers/workbench.py` 这类超大文件）
- WS4（核心域专项）：Memory/Sandbox/Channels/Scheduler（A 级，必须有专项测试护城河）

---

## 7. 方法与工具（怎么判定、怎么下刀、怎么验证）

### 7.1 “无效代码”判定的证据链（必须同时满足）

- 静态调用：GitNexus `impact(direction=upstream)` 没有直接调用者（或仅测试调用者）。
- 动态引用排查：`rg` 全仓检索关键字符串（路由路径、skill/plugin id、配置 key、env key、反射/注册表字符串）。
- 验证命令通过：后端/前端/桌面端的 lint/typecheck/test/build 全绿。

> 对“动态加载/注册表驱动”的模块：即使静态 impact 为 0，也不能直接删；应先做“冻结与告警”，观察一段时间后再删。

### 7.2 重构策略（不牺牲可读性）

- 先把“纯逻辑”从 IO 中剥离：让核心逻辑可单测、可复用、可替换。
- IO 与副作用集中化：网络/文件/子进程/数据库写入必须有明确入口，避免散落。
- 错误语义统一：关键链路错误分级（可重试/不可重试/用户可见）与日志字段统一。

### 7.3 验证门禁（Definition of Done 的硬约束）

每次合并前至少满足：

- 后端：`cd backend && make lint && make test`
- 前端：`cd frontend && pnpm run check && pnpm run test:unit`
- 桌面端：`cd desktop/electron && pnpm run test`

并且在 PR/commit 说明中记录“本次实际执行的验证命令与结果摘要”。

---

## 8. 分阶段实施计划（完整方案，但以阶段产出为准）

### Phase 0：建立安全网（优先级最高）

产出：

- CI 覆盖三端的最小门禁（backend/frontend/desktop）
- 根目录统一验证入口（例如 `make verify` 或 `scripts/verify.sh`）
- 变更回滚与提交规范（写入文档并执行）

验收：

- 任意机器按文档能一键跑完验证；CI 在 PR 上可复现。

### Phase 1：低风险降噪与体量控制（从 C/D 级开始）

重点：

- 清理过期原型、重复报告/静态产物（先确认哪些是产品交付物/运行时必需）
- 清理未引用代码（严格证据链），减少重复工具函数
- 规范化目录边界（但不做大爆炸目录重排）

验收：

- 体量下降（文件数/代码行数/重复逻辑降低），且三端门禁全绿。

### Phase 2：热点重构（降低复杂度，提升可维护性）

重点：

- 优先处理超大文件与高 churn 文件（例如 Workbench、Settings/InputBox）
- 抽离 service 与 domain 层，缩薄 router/component
- 针对关键行为补回归测试（护城河测试）

验收：

- 热点文件显著变薄，新增测试能覆盖关键行为，回归风险可控。

### Phase 3：核心域专项（A 级模块，严格控风险）

重点：

- Memory/OpenViking：契约不变前提下做一致性/可测性优化
- Sandbox：边界、安全与资源回收
- Channels/Scheduler：幂等、重试、错误分级、可观测性

验收：

- 对外契约稳定；专项回归测试齐备；出现问题可快速定位与回滚。

---

## 9. 回滚策略（保证“每次优化都能回退”）

- 所有变更以小 commit 提交，必要时使用 `git revert <sha>` 回滚单次变更。
- 核心域变更遵循“先加测试再改实现”，避免回滚后仍残留数据不一致。
- 引入开关/适配（Strangler）时，必须提供“强制回退到旧路径”的配置开关与文档。

---

## 10. 近期实施计划（Phase 0-1 的可执行清单）

> 说明：Phase 2+ 需要基于 Phase 1 的清理结果与热点统计再拆分为专项计划文档；本节只把最紧迫、最通用的 Phase 0-1 细化到可直接开干的层级。

### Task 0：建立并发工作流约定（一次性）

步骤：

1. 约定 workstream 名称、目录边界与 WIP limit（建议同时最多 2-3 个）
2. 约定合并顺序：WS0 → WS1 → WS2/WS3 → WS4
3. 约定回滚与验证要求（每次提交必须记录验证证据）

### Task 1（WS0）：补齐三端 CI 门禁

目标：PR 上自动执行 backend/frontend/desktop 的最小验证链路。

建议拆分提交：

- 提交 1：新增/调整 GitHub Actions，使其运行 `backend` 的 `make lint && make test`（保持现有行为可复用）
- 提交 2：新增 `frontend` workflow，运行 `pnpm install` + `pnpm run check` + `pnpm run test:unit`
- 提交 3：新增 `desktop/electron` workflow，运行 `pnpm install` + `pnpm run test`

### Task 2（WS0）：统一本地验证入口

目标：根目录提供一致的“全栈验证”命令，避免靠记忆跑命令。

候选方案（二选一即可）：

- `make verify`：依次进入 `backend/frontend/desktop/electron` 执行验证脚本
- `scripts/verify.sh`：同样串行执行，Makefile 调用它

### Task 3（WS1）：列出可清理候选清单并逐项验证

目标：先不删，先出“候选列表 + 证据链”，然后按风险分批删除。

输出格式（建议）：

- 文件/目录
- 候选原因（重复/过期/无引用/仅原型）
- 证据链（impact/rg/验证命令）
- 删除策略（直接删/先冻结/先迁移）
- 回滚方式

---

## 11. 交付与协作约定（非常重要）

- 每次变更必须 commit，commit message 必须包含：
  - 任务背景与动机
  - 修改范围（具体文件）
  - 行为变化说明（若无则明确写“无行为变化”）
  - 风险点与缓解措施
  - 验证命令与结果摘要
  - 回滚方式
- 并发 workstream 合并前必须跑完各自的验证链路，避免把风险推给集成阶段。

---

## 12. 下一步（确认后即可进入执行）

1. 先落地 Phase 0（WS0）：CI + 本地 verify 入口
2. 同时并发启动 WS1：候选清理清单（先证据链，后删除）

若你确认该方案没有要补充/修改的地方，我将把它作为治理总纲，后续每个 Phase/Workstream 再拆出独立计划文档与实施 PR。

---

## 13. 总体 Checklist（详细且可直接复用）

> 目标：避免工作重复、避免范围漂移、确保每次优化“可验证 + 可回滚 + 可追溯”。建议把本节作为 PR 模板或每个 workstream 的执行 SOP。

### 13.1 启动前 Checklist（每个 workstream 必做一次）

- 明确本 workstream 的边界：只动哪些目录/模块，不动哪些目录/模块（写进记录文件）。
- 评估风险等级：A/B/C/D（A/B 必须先有针对性回归测试，且必须拆更小步）。
- 明确交付物：对应 `docs/优化记录/YYYY-MM-DD-WS?-*.md` 文件必须存在并持续更新。
- 明确“并发位”：当前是否已有 2-3 个并行 workstream 在跑；超过 WIP limit 则先收尾再开新流。
- 创建独立工作区：使用独立 `git worktree` + 独立分支（分支名建议 `codex/wsX-<short-topic>`）。
- 拉齐基线：从 `main` 拉最新代码，避免在旧基线做清理导致误判引用。
- 基线验证：运行一次 `make verify`，记录结果摘要作为“变更前基线证据”。
- 记录回滚策略：明确本 workstream 的回滚方式（通常是 `git revert <sha>`，必要时提供开关回退）。

### 13.2 任务执行 Checklist（每个改动点都要走）

- 写清楚“要解决的问题”与“非目标”，避免为了整洁引入不必要改动。
- 先找证据再改：用 `rg`、路由/配置 key、注册表/扫描点定位真实引用链。
- 对动态引用保持敬畏：出现“字符串拼接路径、目录扫描、插件注册表、配置驱动”的场景，默认不删，先冻结/隔离。
- 变更粒度控制：一次 commit 只做一类事（例如只做“删除 1-3 个确定无引用文件”或只做“提取纯函数 + 加单测”）。
- 每次改动必须能解释“行为是否变化”：不确定就先补测试把行为钉住。
- 任何重构都应优先把“纯逻辑”从 IO 副作用中剥离，保证可单测。
- 删除类变更必须补齐证据链（见 13.3），并在 `docs/优化记录/` 里逐条记录决策。

### 13.3 删除/冻结/迁移 Checklist（证据链必须齐）

- 静态引用扫描：`rg -n "<文件名/符号/路由/配置 key>" .`，记录搜索关键词与关键结果。
- 入口扫描：确认未被 `__init__`、注册表、plugins、routes、settings 之类汇聚入口导入或暴露。
- 动态加载排查：确认未被目录扫描、字符串拼接、反射、配置驱动加载。
- 测试与验证：至少跑 `make verify`；涉及特定模块时额外跑该模块更聚焦的测试命令。
- 决策结论：必须是 `DELETE` / `FREEZE` / `MIGRATE` / `KEEP` 之一，并写清理由与风险点。
- 回滚点：写清楚回滚命令（通常 `git revert <sha>`），以及是否需要额外数据回滚步骤。

### 13.4 提交（Commit）Checklist（强制）

- `git status` 确认本次提交只包含当前任务相关文件，避免混入“顺手格式化/大范围改名”。
- Commit message 必须包含下列信息（建议直接复制模板）：

```text
<type>(wsX): <一句话总结>

背景/动机:
- 为什么做这件事，它解决什么维护/稳定/体量问题

修改内容:
- 改动点 1（指明文件路径）
- 改动点 2（指明文件路径）

行为变化:
- 是否有行为变化；若无，明确写“无行为变化”
- 若有，写清楚旧行为 vs 新行为，以及兼容策略

风险与缓解:
- 主要风险点
- 如何降低风险（测试/开关/分批/冻结）

验证证据:
- Run: <命令>
  Result: <通过/失败摘要>

记录与回滚:
- 更新: docs/优化记录/YYYY-MM-DD-WS?-*.md
- Rollback: git revert <sha>
```

### 13.5 合并（Merge）Checklist（每个 workstream 收尾）

- 合并前再跑一次 `make verify`，保证证据新鲜。
- 确认 `docs/优化记录/` 对应文件包含：变更清单、证据链、验证证据、回滚点、下一步。
- 合并策略：优先“门禁/工具链”类变更先合并；清理类变更分批合并；核心域变更最后合并。
- 冲突处理：若同目录并发导致冲突，优先保主干行为不变，冲突解决后再次全量验证。

### 13.6 阶段复盘 Checklist（可选但强烈建议）

- 记录体量变化：文件数/LOC（可用 `cloc` 或 `git diff --stat` 作为近似指标）。
- 记录质量变化：lint 违规数、测试数量/覆盖率（如适用）。
- 记录风险暴露：本阶段出现的“动态引用不确定点/历史包袱”，沉淀成下一阶段的专项 work item。

### 13.7 并发执行模板（Worktree + Branch，推荐命令）

> 目标：你要求的“并发优化、多任务执行”必须以隔离为前提，避免互相踩文件导致集成地狱。

建议每个 workstream 使用独立 worktree（示例以 WS1 为例）：

```bash
# 1) 拉齐 main 基线
git checkout main
git pull --ff-only

# 2) 创建 worktree + 分支（分支必须使用 codex/ 前缀）
git worktree add ../nion-ws1-hygiene -b codex/ws1-hygiene

# 3) 在 worktree 内执行
cd ../nion-ws1-hygiene
make verify   # 建议先跑一次基线
```

合并前同步主干（可选，但并发时间较长时建议做）：

```bash
git fetch origin
git rebase origin/main
make verify
```

### 13.8 模块梳理与风险排序 Checklist（一次性，但要持续更新）

> 目标：把“当前系统有哪些模块”变成可执行的治理边界与风险地图，避免凭感觉重构。

- 输出文件：`docs/plans/2026-03-16-module-map.md`（建议后续补齐）
- 最小内容要求-模块清单：按 `backend/`、`frontend/`、`desktop/` 与支撑目录拆分到二级目录（例如 `backend/src/gateway`、`frontend/src/core`）。
- 最小内容要求-关键入口：每个端至少列 3-5 个入口文件/主路由/主进程启动点。
- 最小内容要求-风险分层：A/B/C/D，并注明“为何是这个等级”（爆炸半径、动态引用、数据/安全敏感度、跨端耦合、验证缺口）。
- 推荐采集命令（辅助，不作为最终结论）：

```bash
find backend/src -maxdepth 2 -type d | sort
find frontend/src -maxdepth 2 -type d | sort
find desktop/electron/src -maxdepth 2 -type d | sort
```
