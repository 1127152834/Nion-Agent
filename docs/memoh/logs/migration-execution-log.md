# Nion × Memoh 迁移执行日志

> 用途：记录从 `Milestone 0` 到 `Phase 7` 收官期间的每一个 Task、review fix、blocker 与阶段收尾动作。

| Date | Phase/Task | Type | Change | Commit | Validation | Result | Risks / Follow-up |
|---|---|---|---|---|---|---|---|
| 2026-03-10 | Milestone 0 | baseline-start | bootstrap-memoh-phase-execution-ops | pending | pending | in-progress | 先建立治理文档、模板、脚本与总账本 |
| 2026-03-10 | Milestone 0 | baseline-verify | bootstrap-memoh-phase-execution-ops | pending | `openspec validate` × 5、`backend pytest`、`frontend pnpm typecheck`、`./scripts/verify-electron.sh`、`git diff --check` | passed-with-blockers | 基线验证为绿，但工作树仍有 117 条在途改动，需先收口再进入 Phase 3 |
| 2026-03-10 | Milestone 1 | tooling-bootstrap | bootstrap-memoh-phase-execution-ops | pending | templates present、scripts runnable、plan index updated | completed | 流程资产已落地，已进入自检与最终校验 |
| 2026-03-10 | Milestone 1 | tooling-self-check | bootstrap-memoh-phase-execution-ops | pending | `bash -n scripts/memoh/*.sh`、`./scripts/memoh/task-gate.sh --change bootstrap-memoh-phase-execution-ops --frontend-typecheck`、`./scripts/memoh/stage-closeout.sh --stage milestone-1 --change bootstrap-memoh-phase-execution-ops --frontend-typecheck` | passed | `stage-closeout` 会主动暴露当前工作树脏状态，符合治理预期 |
| 2026-03-10 | Phase 2 / Phase 2.5 | task-closeout | skeletonize-memory-core-v2-compatible + stabilize-v2-compatible-memory-update | 87485c8d | `uv run pytest tests/test_client.py tests/test_scheduler_workflow.py tests/test_memory_core_provider.py tests/test_memory_core_registry.py tests/test_memory_updater.py tests/test_memory_session_policy.py tests/test_memory_upload_filtering.py tests/test_lead_agent_rss_context.py -q`、`openspec validate skeletonize-memory-core-v2-compatible --type change --strict`、`openspec validate stabilize-v2-compatible-memory-update --type change --strict`、`git diff --cached --check` | passed | 默认 Memory Core 骨架、compat hotfix 与 embedded runtime contract 已收口；下一步继续拆分桌面运行时对齐改动 |
| 2026-03-10 | Milestone 0 | desktop-memory-link-fix | n/a | 8e371805 | `git stash push --keep-index -u -m milestone0-memory-link-fix`、`cd frontend && pnpm typecheck`、`git diff --cached --check`、`git stash pop --index` | passed | 仅收口来源跳转与关闭设置弹窗；更大的 desktop runtime alignment 仍待独立提交 |
