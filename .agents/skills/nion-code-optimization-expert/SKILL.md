---
name: nion-code-optimization-expert
description: Use when在 Nion-Agent 仓库做代码治理/重构/删除无效代码/优化业务逻辑/提升稳定性与可维护性，且需要严格的小步提交、可回滚、可并发 workstream 与全栈验证门禁。
---

# Nion 代码优化专家（渐进式治理）

## 目标与底线

本 Skill 用于在 **Nion-Agent** 做渐进式代码优化治理，核心目标排序固定为：

1. **稳定性**：关键链路不被意外破坏，回归风险可控。
2. **可维护性**：模块边界清晰、职责单一、复杂度可管理。
3. **体量控制**：持续删除无效代码与重复逻辑，避免只增不减。
4. **质量提升**：把“能跑”变成“可持续演进”（lint/typecheck/test/build 有证据）。

底线规则（必须遵守，违反就会失控）：

- **先安全网，再动刀**：没有可重复验证的门禁，不做高风险清理/重构。
- **每次改动必须提交**：工作区不允许长期滞留未提交改动；每个 commit 都必须可独立回滚。
- **证据链删除**：删代码必须证明“不会误删动态引用”，否则先冻结/隔离再观察。
- **不大爆炸重构**：优先拆小、逐步替换、保留回退路径。

## 适用场景

必须使用本 Skill 的典型触发：

- 用户说“代码优化/治理/重构/清理无效代码/去重复/降复杂度/体量控制/架构梳理/提升可维护性/稳定性”。
- 要在 Nion 关键链路附近动刀：Gateway/LangGraph Proxy、Memory(OpenViking)、Sandbox、Channels、Scheduler、Workbench、Electron 主进程。
- 需要并发推进多条优化任务，但仍要求每条都可回退、可验证、可独立合并。

不适用：

- 单纯写新功能且不涉及治理（用对应实现类 Skill + TDD/调试类 Skill）。
- 纯 UI 视觉打磨（用 UI 优化类 Skill）。

## Nion 模块地图（用于风险分级与切 Workstream）

三端：

- `backend/`：FastAPI Gateway + LangGraph + Memory/OpenViking + Sandbox + Scheduler + Channels + Tools/Subagents/MCP。
- `frontend/`：Next.js 工作台（Workspace/Chats/Settings/Workbench/Artifacts 等）。
- `desktop/`：Electron 桌面端（进程管理、路径、IPC、安全边界、运行时资产）。

支撑：

- `docker/`、`scripts/`、`skills/`（Nion 内置技能树）、`.github/`（CI）、`docs/`、`openspec/`、`reports/`。

## 风险分级（决定先做什么后做什么）

按“爆炸半径 + 数据/安全敏感度 + 动态引用程度 + 跨端耦合 + 验证缺口”评估：

- **A 极高风险（最后动）**：对外契约/数据一致性/安全边界/桌面端主流程。
  - `backend/src/config/*`
  - `backend/src/gateway/routers/langgraph_proxy.py`
  - `backend/src/gateway/routers/{memory,openviking,channels,scheduler,workbench}.py`
  - `backend/src/agents/memory/*`
  - `backend/src/sandbox/*`
  - `desktop/electron/src/{main,preload,process-manager,runtime-manager,paths}.ts`
- **B 高风险（要门禁 + 小步切）**：编排/中间件/工具生态/前端 core 域。
  - `backend/src/agents/*`、`backend/src/tools/*`、`backend/src/subagents/*`、`backend/src/mcp/*`
  - `backend/src/{embedding_models,retrieval_models}/*`
  - `frontend/src/core/*`、`frontend/src/core/platform/*`
- **C 中风险（优先做热点降复杂度）**：页面/组件组合层、周边能力。
  - `frontend/src/app/workspace/*`、`frontend/src/components/workspace/*`
  - `backend/src/{processlog,evolution,heartbeat,system}/*`（不碰核心闭环时）
- **D 低风险（优先降噪入口）**：文档/原型/报告/脚本/静态产物。
  - `docs/`、`openspec/`、`reports/`、大部分 `scripts/`

## 标准工作流（强制执行）

### 0) 基线检查（Preflight）

目标：确保“你看到的失败就是你造成的失败”，否则治理没有控制面。

1. `git status -sb` 必须干净（或只包含本任务相关变更）。
2. 跑全栈门禁（推荐）：`make verify`
3. 记录基线：在 commit message 里写“执行了哪些验证命令、结果是什么”。不要口头宣称。

### 0.5) 优化记录（强制沉淀到 docs）

目标：把“阶段与成果”落到仓库文档中，形成可审计的执行轨迹，避免只靠 commit message 追溯。

规则：

- 每条优化 workstream 必须在 `docs/优化记录/` 维护独立记录文件，避免并发冲突。
- 每次合并到 `main` 前，必须更新对应记录文件，至少包含：本阶段范围、关键变更、验证证据、风险与回滚点、下一步。
- `docs/plans/` 写“计划”，`docs/优化记录/` 写“实际执行与成果”；两者要互相引用。

推荐命名：

- `docs/优化记录/YYYY-MM-DD-WS0-guardrails.md`
- `docs/优化记录/YYYY-MM-DD-WS1-hygiene.md`
- `docs/优化记录/YYYY-MM-DD-WS2-frontend.md`
- `docs/优化记录/YYYY-MM-DD-WS3-backend.md`
- `docs/优化记录/YYYY-MM-DD-WS4-core-domains.md`

模板：

- 使用 `docs/优化记录/TEMPLATE.md`，不要自由发挥省略验证/回滚字段。

### 1) 切 Workstream（支持并发且减少冲突）

并发原则：目录边界隔离，最多同时 2-3 条（WIP limit）。

推荐 Workstream：

- WS0 Guardrails：CI/验证入口/门禁统一（优先合并）。
- WS1 Repo Hygiene：无效代码候选清单、低风险清理（D/C 级）。
- WS2 Frontend：重复逻辑收敛、热点组件拆分（B/C 级）。
- WS3 Backend：热点 router/service 拆分（B 级）。
- WS4 Core Domains：Memory/Sandbox/Channels/Scheduler（A 级，必须专项测试护城河）。

隔离手段（优先 worktree）：

- 为每个 workstream 建独立分支 + worktree（避免互相污染、方便回滚/搁置/并行）。
- 合并顺序固定：WS0 → WS1 → WS2/WS3 → WS4。

### 2) 明确“本次只做一类事”（Scope Freeze）

每个 commit 只允许做一类事：

- 仅门禁/工具链
- 仅清理删除（且必须证据链）
- 仅重构拆分（行为不变）
- 仅修 bug（行为变更）
- 仅补测试（护城河）

禁止在同一 commit 混合：格式化 + 逻辑改动 + 删除 + 重构。

### 3) 先补护城河，再动实现（测试优先）

- A/B 级：优先补“关键行为回归测试”，再动实现。
- C/D 级：允许先清理，但仍要保持门禁全绿。
- 任何“看起来是无效代码”的东西：先证明，再删除。

### 4) 证据链删除（删除无效代码的最低要求）

删文件/模块前，必须同时完成：

1. **静态引用扫描**：`rg` 全仓检索（符号名/路由 path/config key/plugin id/env key）。
2. **动态引用排查**：注册表/反射/字符串拼接加载点必须人工确认。
3. **影响面评估**：涉及 A/B 级目录必须降级为“先冻结再删”。
4. **门禁验证**：至少跑本模块相关测试；合并前建议 `make verify`。

动态加载高危特征（命中任意一个，默认先冻结而不是删除）：

- 通过字符串组装模块路径/类名/工具名加载
- 配置文件驱动（YAML/JSON/SQLite config）启用/禁用
- 插件目录扫描（skills/plugins/marketplace）

冻结策略（推荐）：

- 先把入口从注册表移除或加明确告警日志，再观察一个窗口期。
- 或把实现移到 `*_deprecated.py` 并保留最小 stub（明确抛错并指引替代路径）。

### 5) 验证门禁（Definition of Done）

本仓库推荐的统一证据命令（全栈）：

```bash
make verify
```

等价拆分：

```bash
cd backend && make lint && make test
cd frontend && pnpm run check && pnpm run test:unit
cd desktop/electron && pnpm run test
```

规则：

- **不跑验证，不允许声称“已完成/已通过/没问题”。**
- 如果因环境/时间无法跑全量门禁，必须在 commit message 里明确写“没跑什么、为什么、风险是什么、后续怎么补”。

### 6) 提交规范（必须非常详细）

每次提交必须包含：

- 背景/动机（为什么做）
- 修改内容（做了什么，点名文件/模块）
- 行为变化（如果没有要明确写“无行为变更”）
- 风险点与缓解（影响面、兼容性、回滚点）
- 验证证据（运行了哪些命令、结果摘要）
- 回滚方式（通常 `git revert <sha>`）

建议格式（示例骨架）：

```text
type(scope): 一句话总结

背景
- ...

本次修改（是否行为变更：是/否）
- 文件 A：...
- 文件 B：...

风险与缓解
- ...

验证
- make verify
  - backend：... passed
  - frontend：... passed（warnings: N）
  - desktop：... passed

回滚
- git revert <SHA>
```

提交命令行注意事项（防止把验证输出“注入”到 commit message）：

- **不要在 shell 的双引号里使用反引号**（例如 `git commit -m "这里有 \`make verify\`"`），反引号会被 zsh/bash 当作命令替换执行，污染提交信息甚至产生副作用。
- 推荐做法：
  - commit message 里避免使用反引号；需要标注命令时用普通文本或使用单引号包裹 `-m` 参数。
  - 复杂提交信息用 `git commit -F <file>`（把正文写到文件里）更稳，不会触发 shell 展开。

### 7) 合并与回退（保持可控）

- 合并优先使用 `--ff-only`（避免把 unrelated merge 泥球带进主干）。
- 每个 workstream 合并前：再次跑 `make verify` 给出新鲜证据。
- 发现回归：优先 `git revert` 回滚单个 commit，不要“顺手再修一点”扩大变更面。

## 常见坑（必须主动规避）

- “删了看起来没用的东西”但它是动态加载入口（技能/插件/路由/配置 key）。
- 同一提交里把格式化/重命名/逻辑修改混在一起，导致 review 与回滚都困难。
- 只跑了 backend 测试就合并，但前端/桌面端已经红了（跨端耦合经常被低估）。
- 不写验证证据，只写“应该通过/已验证”（没有证据等于没验证）。
- 为了整洁引入重型抽象/框架，结果让维护成本更高（治理目标是稳定与可维护，不是炫技）。

## 推荐配合使用的其他 Skill

- `superpowers:brainstorming`：在动大方向前先把目标/约束/验收标准说清。
- `superpowers:writing-plans`：把治理拆成可回滚的小任务清单（每步 2-5 分钟）。
- `superpowers:using-git-worktrees`：并发 workstream 隔离，避免相互污染。
- `superpowers:verification-before-completion`：任何“完成”宣称前先跑验证命令。
- `superpowers:dispatching-parallel-agents`：当存在多个互不相关的治理子任务时并行推进。
- `code-simplifier`：对“刚改过的代码”做行为不变的简化收敛，防止重构越改越复杂。

## Backend 专用工具链（Python 治理）

说明：Skill 本身不会“凭空拥有新工具能力”，但可以把工具接入仓库的 dev 依赖与 Makefile，形成可重复执行的标准动作。

已推荐接入的工具：

- `ruff`：静态检查与格式化（仓库已集成，见 `backend/Makefile` 的 `lint/format`）。
- `pytest-cov` / `coverage`：生成覆盖率报告，用于“护城河测试”与重构安全评估（建议先做 report，不要一上来就用阈值卡死治理）。
- `vulture`：死代码候选扫描（**启发式**，容易对动态加载/反射/注册表误报，只能当“候选线索”，不能据此直接删代码）。

对应命令（后端目录执行）：

```bash
make lint
make test
make coverage        # 生成覆盖率终端报告 + coverage.xml
make coverage-html   # 生成 htmlcov/
make deadcode        # 输出死代码候选（min-confidence=80）
```
