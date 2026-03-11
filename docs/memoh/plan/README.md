# Nion × Memoh 升级线阶段索引

本目录存放 `Nion-Agent` 基于 `Memoh` 对标后的分阶段升级计划。

## 推荐阅读顺序

1. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/plans/2026-03-09-nion-memoh-research-architecture.md`
2. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-1-runtime-contract.md`
3. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-2-memory-core.md`
4. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-10-phase-3-7-program-governance.md`
5. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-3-structured-memory.md`
6. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-3-structured-memory-execution-plan.md`
7. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-4-soul-core.md`
8. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-4-soul-core-execution-plan.md`
9. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-5-heartbeat-core.md`
10. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-5-heartbeat-core-execution-plan.md`
11. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-6-evolution-core.md`
12. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-6-evolution-core-execution-plan.md`
13. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-7-multi-agent-productization.md`
14. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-7-multi-agent-productization-execution-plan.md`
15. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-11-memory-hardcut-as-built.md`
16. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-11-agent-memory-ui-closure-as-built.md`

## 每个阶段的执行原则

- 先读完整 `Context Pack`，再开始实现
- 先验证前置阶段是否已经真实落地到代码与测试
- 若前置不满足，停止当前阶段，不要跨阶段混做
- 所有实现类任务都应补测试、验证和评审
- 所有阶段都必须遵守：`单用户`、`桌面端`、`本地优先`、`低依赖`、`文件系统优先`

## 阶段总览

### Phase 1：运行时契约对齐与临时会话记忆保护

- 目标：统一 `session_mode / memory_read / memory_write` 语义
- 作用：先把“什么时候能读、什么时候能写”做对

### Phase 2：Memory Core 骨架化

- 目标：建立 `MemoryPolicy + MemoryProvider + MemoryRuntime + MemoryRegistry`
- 作用：先把记忆系统的结构边界立起来

### Phase 3：结构化记忆存储与维护能力

- 目标：引入 `overview + manifest + day-files` 结构化长期记忆
- 作用：让长期记忆可见、可管、可重建、可回滚

### Phase 4：Soul Core 身份与长期陪伴层

- 目标：统一 `SOUL.md / IDENTITY.md / USER.md`
- 作用：让助手拥有稳定身份、边界和用户画像连续性

### Phase 5：Heartbeat Core 周期任务与助手节律

- 目标：把现有 scheduler 升级为个人助手周期行为层
- 作用：让系统具备日/周回顾、记忆维护、身份检查等低频能力

### Phase 6：Evolution Core 低频反思与建议层

- 目标：生成对 Memory / Soul / Agent 的结构化建议
- 作用：形成可审计、可回看、默认不自动应用的长期反思层

### Phase 7：多智能体增强与委派产品化

- 目标：把现有主智能体 + 子智能体能力产品化
- 作用：形成“主助手 + 有边界委派 agent + 可选工作流编排”的轻量体系

## 给后续 Agent 的硬性提醒

- 不要把本升级线做成 Memoh 式重型多 bot 管理平台
- 不要引入外部重型数据库替代本地文件系统与 SQLite
- 不要把 `Soul / Heartbeat / Evolution` 做成高频自治黑箱
- 不要在前置阶段未完成时直接跳到后续阶段开发
