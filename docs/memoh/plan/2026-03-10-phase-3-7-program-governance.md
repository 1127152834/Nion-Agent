# Phase 3–7：长期推进治理与门禁协议

> **定位：** 这不是新的业务阶段，而是 `Phase 3 ~ Phase 7` 共用的执行治理文档。
> **一句话目标：** 在不牺牲可回滚性与阶段边界的前提下，把 `Nion × Memoh` 后续重构变成“可分阶段推进、可持续验证、可高频提交、可随时中断恢复”的工程流程。

- 生效日期：`2026-03-10`
- 适用范围：`Phase 3 Structured Memory` ~ `Phase 7 Multi-Agent Productization`
- 前置状态：`Phase 1` 与 `Phase 2.5` 已完成实现；`Milestone 0` 仍需收口当前基线
- 默认工作分支：`main`
- 默认提交粒度：`任务级提交`

---

## 1. 当前系统状态 / As-Is Context

截至本治理文档落地时，仓库已具备以下事实：

- `Phase 1` 运行时契约 change 已存在：`enforce-memory-session-runtime-contract`
- `Phase 2` Memory Core 骨架 change 已存在：`skeletonize-memory-core-v2-compatible`
- `Phase 2.5` 兼容写回稳定性热修 change 已存在：`stabilize-v2-compatible-memory-update`
- 桌面端记忆页运行时对齐热修 change 已存在：`stabilize-desktop-memory-ui-runtime`
- 后续正式业务阶段文档已写好：`Phase 3 ~ Phase 7`

当前最大的工程风险不是“没有计划”，而是：

1. 工作树仍可能处于多阶段在途状态
2. 已完成 change 未必已完成收口、归档、日志回写
3. 如果直接跳到 `Phase 3`，容易把前序遗留问题和后续结构化改造混做
4. 后续阶段跨度大，如果没有统一门禁、日志和 commit 规范，几小时级长任务很容易失控

因此，本治理文档先定义：**Milestone 0 收口当前基线**，以及 **Milestone 1 流程脚手架**。

---

## 2. 本文目标

### 2.1 Goals

- 为 `Phase 3 ~ Phase 7` 建立统一执行协议
- 固定任务级 commit 规范与 blocker 处理流程
- 提供可复用的验证脚本、Prompt 模板和执行日志模板
- 确保每个阶段都遵守：`先前置检查 -> 再实现 -> 再验证 -> 再评审 -> 再归档`

### 2.2 Non-Goals

- 不直接实现 `Phase 3 ~ Phase 7` 的业务代码
- 不修改 `Memory / Soul / Heartbeat / Evolution` 的核心语义
- 不替代各阶段已有执行计划文档
- 不引入定时型无人值守自动改代码机制

---

## 3. 固定执行协议

### 3.1 阶段入口协议

任何新阶段开始前，必须满足：

1. 当前工作树状态可解释
2. 上一阶段 change 已完成验证与文档回写
3. 先执行对应执行计划中的 `Task 0`
4. 若前置不满足，只允许输出 blocker report，不允许继续实现

### 3.2 Task 级协议

每个 Task 固定遵守：

1. 重读阶段文档与 `Context Pack`
2. 明确本 Task 的 `Out of Scope`
3. 先跑最小失败测试或最小验证
4. 完成实现
5. 跑最小相关测试
6. 跑 `openspec validate <change> --type change --strict`
7. 跑 `git diff --check`
8. 做一次自查评审
9. 单独 commit
10. 更新迁移执行日志

### 3.3 阶段结束协议

阶段完成前必须满足：

1. 该阶段所有 Task 已完成并有 commit 记录
2. 阶段最小测试集通过
3. 相邻阶段相关回归通过
4. 已完成正式 code review
5. review finding 已修复并单独提交
6. change 文档、阶段文档、执行日志一致
7. 满足 DoD 后才允许 archive 当前 change

---

## 4. 里程碑安排

### Milestone 0：收口当前基线

目标：把 `Phase 1 / Phase 2 / Phase 2.5 / 桌面热修` 的当前状态验证清楚，并形成一份可信基线。

固定动作：

- 检查当前工作树是否干净、是否存在跨阶段混改
- 检查已存在 OpenSpec change 是否都能通过严格校验
- 运行关键回归：后端记忆链路、前端 typecheck、桌面验证
- 产出 `Milestone 0` baseline report
- 在执行日志中登记所有 blocker、延期待办和当前风险

### Milestone 1：流程脚手架

目标：为后续 5 个阶段提供可复用的低风险辅助资产。

固定交付物：

- 阶段任务启动 Prompt 模板
- blocker report 模板
- review-fix Prompt 模板
- commit message 模板
- 迁移执行日志模板
- Task 门禁脚本
- Stage 收尾脚本

---

## 5. Phase 3–7 启动顺序

### Phase 3：Structured Memory
- 先执行 `Task 0`，确认 `Phase 1/2` 真正落地
- 只有 baseline 与流程脚手架完成后，才允许进入实现

### Phase 4：Soul Core
- 只有 `Phase 3` 完成并通过阶段回归后，才允许开始

### Phase 5：Heartbeat Core
- 只有 `Phase 4` 完成后，才允许开始

### Phase 6：Evolution Core
- 只有 `Phase 5` 完成后，才允许开始

### Phase 7：Multi-Agent Productization
- 只有 `Phase 3 ~ Phase 6` 全部完成后，才允许开始

---

## 6. 提交与记录规范

### 6.1 提交粒度

- `1 个 Task 完成 = 1 个功能 commit`
- `1 个 blocker report = 1 个 docs/process commit`
- `1 组 review finding 修复 = 1 个 fix commit`
- `1 个阶段结束 = 1 个阶段总结 commit`

### 6.2 提交正文固定字段

每个 commit message 正文必须包含：

- `Plan`
- `Why`
- `What`
- `Validation`
- `Follow-up` 或 `Blocker`

### 6.3 日志要求

每次 commit 后必须更新迁移执行日志，至少记录：

- 阶段 / Task / 类型
- 对应 commit hash
- 运行过的验证
- 当前 blocker 或残余风险
- 下一步预期动作

---

## 7. 给执行 Agent 的强制提醒

- 不要在工作树脏且未解释时启动新阶段
- 不要在 `Task 0` 未通过时直接进入 Task 1+
- 不要把 review fix 混进新的业务提交
- 不要在 change 未归档时假定该阶段已经完全收口
- 不要把 `Soul / Heartbeat / Evolution` 混在同一个提交里推进

---

## 8. 最终验收

本治理线完成的判定不是“写了流程文档”，而是：

1. `Milestone 0` baseline report 已产出
2. `Milestone 1` 流程脚手架已落地
3. 后续阶段都能复用这些资产推进
4. 最终 `Phase 7` 完成后，可基于执行日志回看整个升级过程
