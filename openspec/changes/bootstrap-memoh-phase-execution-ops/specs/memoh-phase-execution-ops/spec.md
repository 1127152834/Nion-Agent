## ADDED Requirements

### Requirement: 后续阶段必须有统一的执行治理资产
系统 MUST 为 `Phase 3 ~ Phase 7` 提供统一的执行治理文档，明确阶段入口、Task 门禁、阶段收尾和提交记录规范。

#### Scenario: 新阶段开始前执行 Task 0
- **WHEN** 执行 Agent 准备启动一个新的正式阶段
- **THEN** 系统 MUST 先要求执行对应执行计划中的 `Task 0`
- **AND** MUST 在前置不满足时输出 blocker report，而不是继续实现

### Requirement: 系统必须提供可复用的模板资产
系统 MUST 提供后续阶段共用的 Prompt / 记录模板，以降低长任务中遗漏上下文、遗漏 blocker 记录或遗漏提交说明的风险。

#### Scenario: 执行一个阶段 Task
- **WHEN** 执行 Agent 启动一个新的 Task
- **THEN** 系统 MUST 可提供阶段任务启动 Prompt 模板
- **AND** MUST 可提供 blocker report、review-fix 与 commit message 模板

### Requirement: 系统必须提供可复用的验证脚本
系统 MUST 提供脚本化的 Task 级与 Stage 级门禁，用于统一执行 OpenSpec 校验、最小测试和 diff 检查。

#### Scenario: Task 完成前进行最小门禁
- **WHEN** 某个 Task 实现完成，准备提交
- **THEN** 系统 MUST 能运行 Task 级验证脚本
- **AND** 该脚本 MUST 支持 `openspec validate`、后端最小测试、前端 typecheck、Electron 校验和 `git diff --check` 的组合执行

#### Scenario: 阶段准备收尾
- **WHEN** 某个阶段的全部 Task 完成
- **THEN** 系统 MUST 能运行 Stage 级收尾脚本
- **AND** MUST 输出当前 git 状态摘要，提醒执行 code review、更新执行日志与归档 change

### Requirement: 流程资产不得改变业务阶段语义
本 change MUST 只新增执行治理资产，不得顺手改变 Memory / Soul / Heartbeat / Evolution 的业务行为。

#### Scenario: 引入流程模板和门禁脚本
- **WHEN** 本 change 被应用
- **THEN** 系统 MUST 只新增或更新流程治理相关文档、模板、脚本和日志资产
- **AND** MUST NOT 以此 change 的名义修改业务运行时语义
