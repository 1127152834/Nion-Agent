# Nion × memoh-v2 升级线阶段索引

本目录存放 `Nion-Agent` 在 `memoh-v2` 基线下的阶段计划与实施文档。

## 当前对标基线
- 当前基线：`Kxiandaoyan/Memoh-v2`
- 基线快照：`/tmp/memoh-v2-src-1773290532`
- 历史基线（仅回溯）：`memohai/Memoh@09cdb8c`

## 推荐阅读顺序（已修复失效链接）
1. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/plan/memory/memoh-v2-execution/00-master-plan.md`
2. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/plan/memory/memoh-v2-execution/01-memory-core-hardcut.md`
3. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/plan/memory/memoh-v2-execution/02-manifest-sovereign-rebuild.md`
4. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/plan/memory/memoh-v2-execution/03-memory-observability-ui.md`
5. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/plan/memory/memoh-v2-execution/04-processlog-trace-export.md`
6. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/plan/memory/memoh-v2-execution/05-tool-governance-tier.md`
7. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/plan/memory/memoh-v2-execution/06-runtime-governance-loop.md`
8. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/plan/memory/memoh-v2-execution/07-gate-acceptance-report.md`
9. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/plan/memory/memoh-v2-learning-checklist.md`
10. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/plan/memory/memoh-v2-code-evidence-index.md`
11. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-10-phase-3-7-program-governance.md`
12. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-4-soul-core.md`
13. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-4-soul-core-execution-plan.md`
14. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-5-heartbeat-core.md`
15. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-5-heartbeat-core-execution-plan.md`
16. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-6-evolution-core.md`
17. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-6-evolution-core-execution-plan.md`
18. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-7-multi-agent-productization.md`
19. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-7-multi-agent-productization-execution-plan.md`
20. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-11-session-policy-as-built.md`
21. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-11-agent-memory-ui-closure-as-built.md`

## 历史文档说明
- 旧研究文档仍保留：`/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/plan/memory/memoh-memory-source-study.md`
- 该文档基于 `memohai/Memoh`，仅用于历史回溯，不再作为当前实施依据。
- 本目录内曾引用的 `phase-1/phase-2/phase-3` 旧链接与 `memory-hardcut-as-built` 文档当前不在仓库中，已从推荐链路移除。

## 每个阶段的执行原则
- 先读完整 `Context Pack`，再开始实现。
- 先验证前置阶段是否已真实落地到代码与测试。
- 若前置不满足，停止当前阶段，不跨阶段混做。
- 所有实现类任务都补测试、验证和评审。
- 所有阶段都遵守：`单用户`、`桌面端`、`本地优先`、`低依赖`。

## 给后续 Agent 的硬性提醒
- 不要把升级线做成重型多 Bot 管理平台。
- 不要引入与定位不匹配的重依赖栈。
- 不要把 `Soul / Heartbeat / Evolution` 做成高频自治黑箱。
- 不要在前置阶段未完成时直接跳后续阶段。
