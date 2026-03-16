# OpenViking items 首次访问优化：后台 warmup + to_thread（Phase 1）

**日期**：2026-03-17  
**Workstream**：WS4 Core Domains（Memory/OpenViking）  
**范围**：backend  
**风险等级**：A（触达记忆系统初始化与核心路由；但策略为“后台预热 + 不阻塞事件循环”）  
**目标**：稳定性 / 质量提升  
**关联计划**：无（用户反馈驱动的体验问题修复）  
**关联提交**：待补  

## 背景

用户反馈“第一次访问记忆列表接口特别卡”。从实现上看：

- OpenViking provider/runtime 的构建是 lazy 的，首次命中相关 endpoint 时可能触发初始化（SQLite schema/服务依赖等），导致首个请求出现明显冷启动延迟。
- `/api/openviking/items` 作为 async 路由，内部调用同步的 provider.get_memory_items，存在阻塞事件循环风险；在启动后前端可能会并发请求多个接口，这种阻塞会放大整体卡顿体感。

## 本阶段策略与约束

- 不改变 API 契约与返回结构。
- 将“初始化成本”从用户点击时刻尽量前移到后台，并避免阻塞 event loop。
- 变更可独立回滚；失败不影响主流程（warmup 失败必须 non-blocking）。

## 变更清单（按类别）

- Gateway 后台预热 memory provider
  - 在 gateway lifespan 中调度后台任务 warm up 默认 memory provider（仅在 memory enabled 时），降低首次访问 OpenViking endpoint 的冷启动成本。
  - warmup 失败仅记录 warning，不影响网关启动与请求处理。
- OpenViking items 路由避免阻塞 event loop
  - `/api/openviking/items` 改为 `await asyncio.to_thread(...)` 执行同步的 get_memory_items，避免在事件循环线程做潜在 IO/CPU 工作。

## 验证证据（必须）

- `cd backend && make lint`
  - 结果：OK（ruff check 通过）
- `cd backend && make test`
  - 结果：OK（pytest：609 passed, 1 skipped）

## 产出与指标

- 产出：记忆列表首访更平滑；并发请求时减少因为 event loop 阻塞引起的“全局卡顿”。
- 指标：结合慢请求日志（见 WS3）观察 /api/openviking/items 的首访耗时下降，或至少不再阻塞其它请求。
- 回滚点：逐 commit `git revert <sha>`。

## 遗留问题与下一步

- 若首访仍慢：需要继续拆解 warmup 实际耗时（provider 初始化 vs SQLite 读 vs 其他依赖），并进一步做缓存/索引/批量化策略。
