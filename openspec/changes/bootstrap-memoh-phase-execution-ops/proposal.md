## Why

`Nion × Memoh` 的后续重构并不是单一功能开发，而是一条跨 `Phase 3 ~ Phase 7` 的长升级线。当前仓库虽然已经具备各阶段文档与部分前置 change，但仍缺少一套真正可复用的执行脚手架：任务启动 Prompt、blocker report 模板、review-fix 模板、任务级验证脚本、阶段收尾脚本，以及统一的迁移执行日志。

如果直接开始 `Phase 3`，执行过程很容易出现以下问题：

- 当前工作树未收口就叠加新阶段改动
- 每个 Task 的验证命令靠临时拼接，遗漏 `openspec validate`、`git diff --check` 或桌面/前端校验
- review finding 修复没有统一模板，容易顺手扩大范围
- 长时间开发缺少统一账本，导致 commit、风险、blocker 和实际验证无法回看

因此，本 change 先为后续阶段建立低风险流程脚手架，让 `Phase 3 ~ Phase 7` 能按“任务级提交 + 严格门禁 + 可追溯日志”推进。

## What Changes

- 新增一份 `Phase 3 ~ Phase 7` 共用的治理文档，固定阶段入口、Task 门禁、阶段收尾和提交规范
- 新增流程模板：阶段任务启动 Prompt、blocker report、review-fix Prompt、commit message 模板
- 新增迁移执行日志模板，作为后续阶段共用总账本
- 新增 Task 门禁脚本与 Stage 收尾脚本，统一运行 `openspec validate`、最小测试、前端 typecheck、Electron 校验和 `git diff --check`
- 产出 `Milestone 0` baseline report，记录当前基线验证、已知 blocker 和后续入口条件

## Capabilities

### New Capabilities
- `memoh-phase-execution-ops`: 为 `Nion × Memoh` 后续阶段提供统一的执行协议、验证脚本、模板与迁移日志，保证阶段推进可回溯、可中断恢复、可独立验收

## Impact

- 执行治理文档：`docs/memoh/plan/2026-03-10-phase-3-7-program-governance.md`
- 流程模板与执行日志：`docs/memoh/ops/*`、`docs/memoh/logs/*`
- 验证脚本：`scripts/memoh/task-gate.sh`、`scripts/memoh/stage-closeout.sh`
- 索引回写：`docs/memoh/plan/README.md`
