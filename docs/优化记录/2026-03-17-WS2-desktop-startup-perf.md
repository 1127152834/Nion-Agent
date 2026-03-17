# Desktop 启动性能定位与黑屏闪烁优化（Phase 1）

**日期**：2026-03-17  
**Workstream**：WS2 Desktop（Startup UX/Perf）  
**范围**：desktop  
**风险等级**：A（触达 Electron 主进程启动链路，但变更为低侵入观测与 UI 背景色对齐）  
**目标**：稳定性 / 质量提升  
**关联计划**：无（用户反馈驱动的体验问题修复）  
**关联提交**：fb0e185a..10aeb035  

## 背景

用户反馈以下问题明显影响体验：

- 启动加载很慢，且无法判断到底卡在“哪一个环节”。
- 启动页结束后会出现一小段黑屏闪烁。
- 页面首跳（尤其 Agents/Scheduler）与首次接口访问（例如记忆列表）非常卡。

本阶段先对“桌面端启动链路”建立可量化的耗时证据链，并修复可明确归因的黑屏闪烁问题，避免在没有数据的情况下盲目优化。

## 本阶段策略与约束

- 先建立观测：为各启动 stage 记录耗时并输出到主进程日志，形成可对比的基线。
- 先做确定性修复：修复“黑屏闪一下”这类 UI 背景色不一致导致的视觉问题。
- 不在本阶段引入重型依赖、复杂抽象或大范围重构；每个 commit 可独立回滚。

## 变更清单（按类别）

- 启动阶段耗时打点
  - 在 Electron 主进程记录每个启动 stage 的开始/结束时间，并输出 stage 耗时 TopN 及总耗时。
  - 目的：精准回答“慢在哪一步”，为后续优化提供证据。
- dev 模式前端缓存策略（Next/Turbopack）
  - 默认不再在每次桌面端启动时清理 `.next/dev` 与 `.next/cache`，避免反复触发“全量冷编译”导致启动与首跳显著变慢。
  - 如需排查疑难编译问题，可通过环境变量 `NION_DESKTOP_CLEAR_FRONTEND_DEV_ARTIFACTS=1` 显式开启清理以回到旧行为。
- 黑屏闪烁修复
  - BrowserWindow 设置与 bootstrap data-url 页面一致的 `backgroundColor`，降低从启动页跳转到前端 URL 时的黑屏空白帧感知。

## 验证证据（必须）

- `pnpm -C desktop/electron install`
  - 结果：OK（lockfile up to date；依赖安装完成）
- `pnpm -C desktop/electron test`
  - 结果：OK（`tsc -p tsconfig.json` 通过；Node test `1 passed`）

## 产出与指标

- 产出：启动 stage 耗时 TopN 日志（用于后续定位 `runtime.start.frontend` / `runtime.start.gateway` / `runtime.start.langgraph` 等慢点）。
- 指标：黑屏闪烁的主观可见度降低（背景色一致后不再出现明显纯黑空白帧）。
- 回滚点：逐 commit `git revert <sha>`。

## 遗留问题与下一步

- 根据 stage timing 日志确认最慢环节后，分支推进：
  - dev 模式下 Next/Turbopack 编译与缓存策略（避免每次冷启动都“从零编译”）。
  - 首次接口慢（如 OpenViking items）是否由后端 lazy init 或前端 dev 编译导致，需要端到端分解耗时证据链。
