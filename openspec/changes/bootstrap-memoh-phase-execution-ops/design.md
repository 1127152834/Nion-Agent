## Context

当前仓库里已经存在四个与前置阶段相关的 OpenSpec change：

- `enforce-memory-session-runtime-contract`
- `skeletonize-memory-core-v2-compatible`
- `stabilize-v2-compatible-memory-update`
- `stabilize-desktop-memory-ui-runtime`

同时，`docs/memoh/plan/` 已经写好了 `Phase 3 ~ Phase 7` 的业务阶段文档与执行计划。缺口不在“没有计划”，而在“没有统一执行骨架”：后续阶段若继续手工拼接验证、随意命名 commit、零散记录 blocker，会让长时间任务失去可控性。

本 change 只处理执行治理，不改动 Memory / Soul / Heartbeat / Evolution 的业务实现。

## Goals / Non-Goals

**Goals:**
- 建立 Phase 3–7 共用的执行治理文档
- 提供可复用的 Prompt 模板、blocker 模板、review-fix 模板和 commit 模板
- 提供 Task 级与 Stage 级验证脚本
- 提供一份迁移执行日志模板与当前 `Milestone 0` baseline report
- 让后续阶段能统一复用这些流程资产

**Non-Goals:**
- 不实现 `Phase 3 ~ Phase 7` 业务功能
- 不修改现有 `memory.json`、`Soul`、`Heartbeat`、`Evolution` 的运行时语义
- 不替代各阶段执行计划中的 Task 列表
- 不引入无人值守自动改代码机制

## Decisions

1. **治理文档单独落地，不混入业务阶段文档**
   - 新增 `docs/memoh/plan/2026-03-10-phase-3-7-program-governance.md`。
   - 理由：这是跨阶段共用协议，不属于 `Phase 3` 的业务设计。

2. **流程模板统一放在 `docs/memoh/ops/templates/`**
   - 提供 Task 启动、blocker report、review-fix、commit message 四类模板。
   - 理由：后续执行、复盘和手工补点都可以直接引用。

3. **验证脚本优先采用简单 Shell 方案**
   - `scripts/memoh/task-gate.sh` 负责 Task 级门禁。
   - `scripts/memoh/stage-closeout.sh` 负责阶段收尾门禁。
   - 理由：仓库现有验证命令主要是 shell 友好的 CLI，保持依赖轻量、便于桌面端和本地使用。

4. **迁移执行日志先用 Markdown 账本**
   - 新增 `docs/memoh/logs/migration-execution-log.md`。
   - 理由：先满足可追溯性与人工维护；等后续确有需要，再考虑结构化执行元数据。

5. **Milestone 0 只产出 baseline report，不强行在本 change 内收口所有前序业务改动**
   - 基线报告写明当前工作树、既有 change、验证结果和 blocker。
   - 理由：执行治理 change 的职责是建立流程，不越权替代前序业务改动的收口。

## Risks / Trade-offs

- Shell 脚本适合当前仓库，但参数协议会比专用 CLI 更轻量，后续若阶段增多可能需要再抽象。
- 执行日志采用 Markdown，适合人工审阅，但不提供自动汇总能力。
- Milestone 0 baseline report 会暴露当前未收口状态；这是本 change 的目的，而不是缺点。

## Migration Plan

1. 新增治理文档与流程模板。
2. 新增 Task / Stage 验证脚本。
3. 回写阶段索引，加入治理文档入口。
4. 产出 Milestone 0 baseline report。
5. 运行 OpenSpec 严格校验与最小验证，确认流程资产自身可用。
