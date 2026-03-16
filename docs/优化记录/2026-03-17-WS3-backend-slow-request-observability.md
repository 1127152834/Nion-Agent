# Gateway 慢请求观测：记录请求耗时与阈值告警（Phase 1）

**日期**：2026-03-17  
**Workstream**：WS3 Backend（Observability/Perf）  
**范围**：backend  
**风险等级**：B（新增中间件日志；不改路由契约）  
**目标**：稳定性 / 质量提升  
**关联计划**：无（用户反馈驱动的体验问题修复）  
**关联提交**：f9878c96  

## 背景

用户反馈“首次访问接口特别卡（例如记忆列表）”“页面切换慢”，需要先把端到端耗时拆开，明确到底是：

- 前端 dev 编译慢
- 网关请求慢（后端处理/IO）
- 下游服务慢（LangGraph/模型/存储）

在缺少证据的情况下直接优化很容易跑偏。本阶段先在 gateway 侧建立“慢请求日志”，让后续排查可以明确到具体 path 与耗时分布。

## 本阶段策略与约束

- 只做观测增强，不改业务逻辑与 API 契约。
- 日志默认只输出超过阈值的请求，避免噪音爆炸。
- 阈值可通过环境变量覆盖，便于在不同环境下调优观测粒度。

## 变更清单（按类别）

- 慢请求中间件
  - 在 gateway app 增加 HTTP middleware：记录每个请求耗时，并在超过阈值（默认 800ms）时输出 warning；若请求异常且耗时超过阈值则输出 exception 日志。
  - 提供环境变量 `NION_GATEWAY_SLOW_REQUEST_MS` 覆盖阈值。

## 验证证据（必须）

- `cd backend && make lint`
  - 结果：OK（ruff check 通过）
- `cd backend && make test`
  - 结果：OK（pytest：609 passed, 1 skipped）

## 产出与指标

- 产出：可检索的慢请求日志（method + path + status + duration），为定位“首次接口慢”提供证据链。
- 指标：能快速确定最慢的 TopN endpoints，以及是否集中在 OpenViking items 等路径。
- 回滚点：逐 commit `git revert <sha>`。

## 遗留问题与下一步

- 基于慢请求日志确认瓶颈后，再进入下一阶段：对热点 endpoint 做 warmup/缓存/并发与 IO 优化。
