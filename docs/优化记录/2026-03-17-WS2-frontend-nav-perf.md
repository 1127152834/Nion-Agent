# 前端路由首跳优化：预取 Agents/Scheduler（Phase 1）

**日期**：2026-03-17  
**Workstream**：WS2 Frontend（Navigation/Perf）  
**范围**：frontend  
**风险等级**：C（仅增加预取，不改业务逻辑；但会引入额外网络/编译开销）  
**目标**：质量提升 / 体验优化  
**关联计划**：无（用户反馈驱动的体验问题修复）  
**关联提交**：待补  

## 背景

用户反馈 workspace 内页面跳转很慢，尤其：

- 跳转到“智能体（Agents）”页面
- 跳转到“定时任务（Scheduler）”页面

在 dev 模式下会叠加 Next/Turbopack 的按需编译成本；在生产模式下也可能因为首次加载资源较大导致首跳明显卡顿。无论哪种模式，提前预取关键路由都能降低“点击后等待”的体感延迟。

## 本阶段策略与约束

- 不引入新依赖、不做大范围路由/组件重构。
- 预取放在布局组件的 effect 中异步触发，尽量不阻塞首屏渲染。
- 仅预取最常用且用户明确反馈慢的两个路由，避免过度预取造成带宽/CPU 抢占。

## 变更清单（按类别）

- Workspace 路由预取
  - 在 `frontend/src/app/workspace/layout.tsx` 中，布局挂载后使用 `router.prefetch` 预取：`/workspace/agents`、`/workspace/scheduler`。
  - 预期收益：减少用户首次点击进入 Agents/Scheduler 时的等待时间（尤其 dev 模式下避免“点击后才开始编译/拉资源”）。

## 验证证据（必须）

- `pnpm -C frontend install`
  - 结果：OK（依赖安装完成）
- `pnpm -C frontend typecheck`
  - 结果：OK（Next route types 生成成功；`tsc --noEmit` 通过）
- `pnpm -C frontend exec eslint src/app/workspace/layout.tsx`
  - 结果：OK（本次改动文件 lint 通过）
- 备注：`pnpm -C frontend check` 目前会因仓库中其他既有 lint 问题失败（与本次变更无直接关系），需要单独的 WS0/Repo Hygiene 处理后才能全绿。

## 产出与指标

- 产出：关键路由预取，降低首跳等待。
- 指标：用户首次进入 Agents/Scheduler 的体感延迟降低；Network/Console 侧能观察到对应路由资源提前请求。
- 回滚点：逐 commit `git revert <sha>`。

## 遗留问题与下一步

- 若生产环境仍存在 3-4 秒首跳：需要进一步拆解 bundle/数据请求串行链路（按页面做 profile 与 code-split）。
