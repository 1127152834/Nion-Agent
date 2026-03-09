# Memoh 执行辅助资产

本目录存放 `Nion × Memoh` 升级线的流程辅助资产，只服务于工程推进，不直接改变业务行为。

## 目录说明

- `templates/phase-task-start.prompt.md`
  - 每个阶段 Task 开始前复用的启动 Prompt 模板
- `templates/blocker-report.template.md`
  - Task 0 或实现中发现前置不满足时使用
- `templates/review-fix.prompt.md`
  - 收到 review finding 后的修复执行模板
- `templates/commit-message.template.md`
  - 高频任务级提交的 message 模板
- `../logs/migration-execution-log.md`
  - 总账本：记录每个 Task、review fix、blocker 与验证结果

## 脚本说明

- `scripts/memoh/task-gate.sh`
  - 跑 Task 级最小门禁
- `scripts/memoh/stage-closeout.sh`
  - 跑阶段收尾门禁

## 使用原则

1. 先执行当前阶段文档里的 `Task 0`
2. 再使用 Prompt 模板与门禁脚本
3. 每次提交后回写执行日志
4. 任何 blocker 先记录，再决定是否继续
