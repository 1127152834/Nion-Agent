# WS0 Guardrails Kickoff：治理总纲与执行SOP落地

**日期**：2026-03-16  
**Workstream**：WS0 Guardrails  
**范围**：repo / docs  
**风险等级**：D  
**目标**：稳定性 / 可维护性 / 体量控制 / 质量提升  
**关联计划**：
- `docs/plans/2026-03-16-repo-optimization-design.md`
- `docs/plans/2026-03-16-ws1-repo-hygiene-implementation-plan.md`
**关联提交**：`edfb41b0..d8f7876c`（make verify + 三端 CI 门禁落地与稳定性修复）  

## 背景

仓库在较长时间的 vibe coding 后形成了“功能可用但体量膨胀、边界不清、质量门禁不均衡”的典型治理问题。为了保证后续任何删除/重构都能 **可验证、可回滚、可追溯**，需要先把“治理方法论 + 执行SOP + Checklist”落到仓库文档层面，作为后续并发 workstream 的统一作业规程。

## 本阶段策略与约束

- 渐进式治理：不追求一次性大改，优先把流程规范化、把风险分层，把小步可回滚作为硬约束。
- 并发但不失控：允许多 workstream 并行，但要求 WIP limit（建议最多 2-3 个同时进行），并规定合并顺序（WS0→WS1→WS2/WS3→WS4）。
- 本阶段以“文档 + 门禁(guardrails)”为主：不引入新抽象、不触碰业务逻辑，不做目录大搬家；仅允许对 CI/Makefile 等验证入口做增量改造以形成可执行证据链。

## 变更清单（按类别）

- 治理总纲与执行 Checklist：
  - 更新 `docs/plans/2026-03-16-repo-optimization-design.md`，补齐 writing-plans 风格的 Header 与“总体 Checklist（详细且可复用）”。
- Workstream 计划沉淀：
  - 纳入 `docs/plans/2026-03-16-ws1-repo-hygiene-implementation-plan.md`（WS1 Repo Hygiene 的可执行计划，强调证据链删除与小步可回滚）。
- 模块地图（风险边界）沉淀：
  - 新增 `docs/plans/2026-03-16-module-map.md`，输出全仓模块清单与 A/B/C/D 风险排序，作为后续 workstream 的共同边界参考。
- 优化记录初始化：
  - 新增本文件 `docs/优化记录/2026-03-16-WS0-guardrails.md`，作为 WS0 的执行记录与后续补齐证据的落点。
- 统一验证入口与 CI 门禁（guardrails）：
  - Makefile：新增根目录 `make verify`（backend + frontend + desktop 的 lint/typecheck/unit tests 统一入口）。
  - GitHub Actions：补齐 frontend/desktop 的 PR 单测门禁，与 backend 并行执行。
  - 稳定性修复：让 `make verify` 在 main 上稳定通过（memory config 缺字段兼容 + Ruff import 排序）。

## 删除/迁移/冻结证据链（若适用）

本阶段无删除/迁移/冻结动作（仅文档与流程建设）。

## 验证证据（必须）

说明：本阶段为文档变更，但仍跑全量门禁作为基线证据（避免“在红灯基线下做治理”）。

- Run: `make verify`
- Result: PASS
- Backend: `uvx ruff check .` PASS；`pytest` 605 passed, 1 skipped
- Frontend: `pnpm run check` PASS；`pnpm run test:unit` 53 passed
- Desktop: `pnpm run test` PASS（node --test 1 passed）

## 产出与指标

- 产出：
  - 形成可复用的“治理总纲 + 全量 Checklist + Commit 模板”，作为后续所有 workstream 的执行标准。
  - 输出“模块地图与风险排序”快照，避免后续治理凭感觉选点与范围漂移。
  - 明确 `docs/plans/`（计划）与 `docs/优化记录/`（执行记录）的分工，避免并发阶段的信息散落。
- 指标（本阶段为流程产出，不做硬指标承诺）：
  - 后续阶段将以“文件数/LOC 变化、重复逻辑减少、门禁通过率、回归测试补齐情况”作为阶段性指标。

## 遗留问题与下一步

- 下一步（按合并顺序）：
  - WS0：把“门禁先行”落到 CI 与本地统一入口（若已有则做对齐与补齐）。
  - WS1：先产出候选清单与证据链，再执行第一批 D/C 级低风险清理。
- 待补齐项：
  - 后续可把 coverage/deadcode（report-only）接入到统一入口，但默认不作为硬门禁，避免阻塞渐进式治理吞吐。
