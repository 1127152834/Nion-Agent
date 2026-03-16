# WS2 Frontend：Evolution 报告列表支持按状态筛选（降低历史失败误判）

**日期**：2026-03-16  
**Workstream**：WS2 Frontend  
**范围**：frontend  
**风险等级**：C（仅 UI 展示与交互；不改后端契约与持久化格式）  
**目标**：稳定性 / 可维护性 / 质量提升  
**关联计划**：`docs/plans/2026-03-16-repo-optimization-design.md`  
**关联提交**：`756c8f33`  

## 背景

Evolution 报告会持久化保存（当前实现默认保留最近 50 条）。当历史上出现过失败记录（例如旧版本 bug 造成的失败），即使当前版本已经修复且最新一次分析已成功，报告列表仍会展示旧的 `failed` 记录，容易导致：

- 用户误判“当前版本仍然失败”
- 排查方向跑偏（反复盯着历史错误信息）
- 治理成本上升（无法快速确认“最新一次是否正常”）

## 本阶段策略与约束

- 仅做前端 UI 层的可用性增强：增加筛选能力，不改后端 API、数据结构与存储格式。
- 默认行为保持不变：不筛选时仍展示全部报告，避免意外隐藏真实失败。
- 通过全栈门禁 `make verify` 提供可审计证据，并保持可回滚。

## 变更清单（按类别）

- 报告列表新增按状态筛选（All / pending / completed / failed）：
  - `frontend/src/components/workspace/agents/settings/evolution-reports.tsx`
    - Reports 卡片新增下拉筛选控件，报告列表按筛选条件过滤展示。
    - 将 suggestions 的 `statusFilter` 重命名为 `suggestionStatusFilter`，并新增 `reportStatusFilter`，避免命名混淆，提升可维护性。

## 删除/迁移/冻结证据链（若适用）

本阶段无删除/迁移/冻结动作。

## 验证证据（必须）

- Run: `make verify`
  - Backend: `ruff` PASS；`pytest` PASS（605 passed, 1 skipped；1 warning）
  - Frontend: `eslint` PASS；`tsc` PASS；`vitest` PASS（22 files / 53 tests）
  - Desktop: `tsc` PASS；`node --test` PASS（1 passed）

## 产出与指标

- 产出：在不改后端的前提下，用户可在 UI 上快速聚焦“最新成功/最新失败”，降低历史失败对刷屏与误判的概率。
- 指标（后续可选补充）：报告页的“误判反馈”减少；排障平均时间降低。

## 风险点与回滚点

- 风险：低（UI 层过滤与状态管理；不影响后端运行）。
- 回滚点：`git revert 756c8f33`

## 遗留问题与下一步

- 若用户仍希望“彻底清理历史失败记录”，可以在后端补一个可回滚的清理/归档能力（例如：清理前自动备份 `~/.nion/.../evolution.json`），并在 UI 提供显式按钮与确认流程。

