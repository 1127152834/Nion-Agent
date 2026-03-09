## 1. 治理文档与索引

- [x] 1.1 新增 `docs/memoh/plan/2026-03-10-phase-3-7-program-governance.md`
- [x] 1.2 在 `docs/memoh/plan/README.md` 中加入治理文档入口
- [x] 1.3 明确 `Milestone 0` 与 `Milestone 1` 的职责边界

## 2. 流程模板与执行日志

- [x] 2.1 新增阶段任务启动 Prompt 模板
- [x] 2.2 新增 blocker report 模板
- [x] 2.3 新增 review-fix Prompt 模板
- [x] 2.4 新增 commit message 模板
- [x] 2.5 新增迁移执行日志模板

## 3. 门禁脚本

- [x] 3.1 新增 `scripts/memoh/task-gate.sh`
- [x] 3.2 新增 `scripts/memoh/stage-closeout.sh`
- [x] 3.3 确认脚本支持 OpenSpec 校验、最小测试、前端 / Electron 校验和 diff 检查组合执行

## 4. Milestone 0 基线与验证

- [x] 4.1 产出 `Milestone 0` baseline report
- [x] 4.2 运行新 change 的 `openspec validate bootstrap-memoh-phase-execution-ops --type change --strict`
- [x] 4.3 运行最小流程资产自检（脚本帮助、索引、模板存在性、必要验证命令）
- [x] 4.4 在执行日志中登记当前基线状态与后续入口条件
