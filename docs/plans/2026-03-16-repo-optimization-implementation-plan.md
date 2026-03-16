# Nion-Agent 渐进式代码治理 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在不牺牲稳定性的前提下，通过渐进式治理提升 Nion-Agent 的可维护性、控制代码体量，并把“可回滚 + 可验证 + 可并发推进”的工程纪律固化为流程与门禁。

**Architecture:** 以 Workstream（WS0..WS4）并发推进为组织方式；以 A/B/C/D 风险分级决定先后顺序；以 `make verify` 与 CI 作为证据门禁；以 `docs/优化记录/` 作为阶段成果沉淀，避免只靠 commit message 追溯。

**Tech Stack:**
- Backend: Python 3.12 + uv + ruff + pytest + pytest-cov/coverage + vulture（启发式）
- Frontend: Node.js 22 + pnpm + Next.js(App Router) + ESLint + TypeScript + Vitest
- Desktop: Electron + TypeScript + node --test
- CI: GitHub Actions（三端单测门禁）

---

## 0. 当前基线（开始治理前必须对齐的事实）

本仓库治理的最低安全网以“证据链”为准，禁止口头宣称。

已具备的基础能力（用于后续所有治理任务）：

- 统一全栈验证入口：`make verify`（backend + frontend + desktop）
- 后端治理工具链：ruff、pytest、coverage（pytest-cov）、vulture（启发式候选扫描）
- 三端 PR 级 CI 单测门禁（backend/frontend/desktop）
- 治理流程 Skill：`.agents/skills/nion-code-optimization-expert/SKILL.md`
- 阶段成果沉淀目录与模板：`docs/优化记录/`

## 1. 治理总策略（必须遵守）

1. 先护城河再优化：没有验证门禁与回归测试护城河的地方，不允许做高风险清理/重构。
1. 小步提交：每个 commit 只做一类事，并且可独立 `git revert <sha>` 回退。
1. 删除必须证据链：静态引用 + 动态加载排查 + 相关门禁通过，缺一不可。
1. 并发但不失控：同一时间最多 2-3 条 workstream 并行（WIP limit），合并顺序固定（WS0 → WS1 → WS2/WS3 → WS4）。
1. 记录必须落 docs：每个阶段/里程碑必须更新 `docs/优化记录/`，形成可审计轨迹。

## 2. Workstream 划分（并发执行的基本单元）

WS0 Guardrails（优先合并）：
- 统一验证入口、CI 门禁、工具链接入、诊断与可观测性补齐。

WS1 Repo Hygiene（低风险降噪）：
- 无效代码候选清单、证据链、冻结/迁移/删除；清理原型与过期资产（优先 D/C 级）。

WS2 Frontend Maintainability：
- 前端 core 逻辑收敛、重复逻辑减少、热点组件拆分；补单测护城河。

WS3 Backend Maintainability：
- 超大 router 拆分、service 化、错误语义统一、补测试；治理工具链深化（coverage、deadcode 候选）。

WS4 Core Domains（A 级专项，最后合并）：
- Memory/OpenViking、Sandbox、安全边界、Channels、Scheduler 等核心域专项治理；必须先建专项回归测试护城河。

## 3. 阶段里程碑（Phase）与验收口径

Phase 0 安全网完备（门禁与可验证）：
- 验收：`make verify` 可在本机跑通；CI 三端门禁可复现；治理 Skill 与 docs 记录机制齐备。

Phase 1 低风险降噪与候选清理（D/C 优先）：
- 验收：产生“无效代码候选清单 + 证据链”；完成若干低风险删除/冻结；`make verify` 全绿；`docs/优化记录/` 有清晰成果。

Phase 2 热点重构（B/C）：
- 验收：热点文件显著变薄；关键行为有回归测试；复杂度下降可量化；仍保持可回滚小步。

Phase 3 核心域专项（A）：
- 验收：对外契约稳定；专项测试覆盖关键不变量；具备开关/回退路径；出现回归可快速定位与回滚。

## 4. 产出物（必须沉淀的“固定资产”）

1. `docs/plans/`：计划与设计（Why/What/How）。
1. `docs/优化记录/`：执行记录与成果（证据链、验证证据、回滚点、下一步）。
1. 自动化门禁：Makefile/脚本/CI（让流程“可执行”而不是“口头约定”）。
1. 回归测试护城河：围绕关键行为的不变量测试。

---

## 5. Master Checklist（后续所有治理任务都按此执行）

### 5.1 每条 Workstream 开工前（Preflight）

- [ ] 明确本 workstream 的范围边界（目录/模块），写在 `docs/优化记录/YYYY-MM-DD-WSx-*.md` 的“范围”字段里。
- [ ] 设定本 workstream 的风险等级（A/B/C/D）与“明确不做”的非目标，防止范围漂移。
- [ ] 创建隔离分支与 worktree（建议路径 `.worktrees/<branch>`），避免污染主工作区。
- [ ] 在 worktree 中跑一次 `make verify`，确认基线是绿的；如基线非绿，先记录并修复或取得继续执行的明确决策。
- [ ] 设定 WIP：同一时间并行 workstream 不超过 2-3 条。

### 5.2 每个 Commit 前（Scope Freeze + 证据）

- [ ] 确认本 commit 只做“一类事”（门禁/清理/重构/修 bug/补测试之一）。
- [ ] 如果是重构或删除，先补齐/确认对应回归测试或证据链（见 5.4/5.5）。
- [ ] 运行与本次变更相关的最小验证命令，合并前建议跑全量 `make verify`。
- [ ] 更新对应 `docs/优化记录/` 文件，至少补充“变更清单 + 验证证据 + 回滚点”。
- [ ] 提交信息必须包含：背景、修改范围（点名文件/模块）、行为变更说明、风险与缓解、验证证据、回滚方式。
- [ ] 避免在 shell 双引号里使用反引号（命令替换会污染 commit message）。

### 5.3 每个 Commit 后（回滚可用性检查）

- [ ] `git status -sb` 必须干净（或只包含下一步要做的变更）。
- [ ] 能清晰说明“如果回滚这个 commit，会回到什么状态”，并确保回滚不会留下半迁移状态。

### 5.4 删除无效代码 Checklist（证据链删除）

- [ ] 静态引用扫描：`rg` 检索符号名、路由路径、配置 key、plugin/skill id、env key、文件路径字面量。
- [ ] 动态加载排查：检查是否存在注册表、反射、字符串拼接加载、目录扫描（skills/plugins/marketplace）。
- [ ] 影响面评估：触达 A/B 级模块时，默认先冻结或保留 stub（明确告警），不要直接删。
- [ ] 执行删除后至少跑相关验证；合并前建议 `make verify`。
- [ ] 在 `docs/优化记录/` 写清楚：删除原因、证据链、替代路径（如有）、回滚方式。

### 5.5 重构 Checklist（行为不变前提下的可维护性提升）

- [ ] 明确“不变量”：输入输出契约、错误语义、数据写入点、跨端协议字段。
- [ ] 先把纯逻辑从 IO 中剥离成可单测函数，再收敛到 service 层，最后让 router/component 变薄。
- [ ] 为关键行为补回归测试（护城河），避免只靠人工走查。
- [ ] 每次改动尽量局部化，避免跨目录大范围重排导致 review 与回滚困难。
- [ ] 合并前跑 `make verify`，并在记录文档写清楚风险与回滚点。

### 5.6 A 级核心域 Checklist（必须专项护城河）

- [ ] 在动实现前先补齐专项测试：至少覆盖数据一致性、幂等、重试、错误分级、权限/路径边界。
- [ ] 必要时增加开关或 Strangler 路径，保证可以切回旧路径。
- [ ] 任何对外契约变更必须先写 design/spec，并写清兼容策略与迁移步骤。
- [ ] 必须跑全量 `make verify`，并补充最小人工验收步骤（例如通过 UI/CLI 跑通关键链路）。

### 5.7 合并到 main 前（集成门禁）

- [ ] 再跑一次全量 `make verify`（给出新鲜证据）。
- [ ] 检查 `docs/优化记录/` 已更新且包含本阶段成果、验证证据、回滚点、下一步。
- [ ] 采用 `--ff-only` 合并（保持历史线性，避免 merge 泥球）。
- [ ] 合并后如发现回归，优先 `git revert` 回退单个 commit，禁止“顺手再修一点”扩大爆炸半径。

