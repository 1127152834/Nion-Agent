## Context

当前仓库已经在前端线程上下文中定义并透传 `session_mode`、`memory_read`、`memory_write`，但后端线程状态和运行时中间件最初没有统一消费这些字段。长期记忆读链路仍在 `backend/src/agents/lead_agent/prompt.py` 中通过系统提示词注入，写链路仍在 `backend/src/agents/middlewares/memory_middleware.py` 中触发 `MemoryMiddleware -> Queue -> Updater -> memory.json`。在 Phase 1 主修复之后，又发现 `backend/src/client.py` 这条 embedded 入口仍未透传同一套会话字段，导致 scheduler / embedded 调用可能绕过统一策略。

Phase 1 的目标不是重构整个记忆系统，而是在不引入 `MemoryProvider / MemoryRegistry / MemoryRuntime` 的前提下，把“何时能读长期记忆、何时能写长期记忆”的运行时语义做对，并用测试锁住它。

## Goals / Non-Goals

**Goals:**
- 补齐后端线程运行时契约，正式支持 `session_mode`、`memory_read`、`memory_write`
- 引入轻量策略模块，统一解析默认值与显式覆盖关系
- 让长期记忆提示词注入链路受 `memory_read` 控制
- 让长期记忆写回链路受 `memory_write` 控制
- 为普通会话、临时会话、显式禁读/禁写补齐自动化测试
- 让 `NionClient` / scheduler 的 embedded 调用入口遵守同一套会话记忆契约

**Non-Goals:**
- 不做 `Memory Provider / Registry / Runtime` 正式重构
- 不迁移 `memory.json` 到结构化存储
- 不增加 `usage / compact / rebuild` 新 API
- 不实现 `Soul Core`、`Heartbeat Core`、`Evolution Core`
- 不引入向量检索、BM25、新数据库或外部向量服务

## Decisions

1. **新增轻量策略模块**
   - 在 `backend/src/agents/memory/policy.py` 中新增最小策略对象与解析函数。
   - 理由：Phase 1 只需要一个统一裁决点，不需要提前把 Phase 2 的 provider/runtime 抽象搬进来。
   - 备选方案：直接在 prompt 和 middleware 各自写默认值判断；被拒绝，因为会继续制造策略漂移。

2. **运行时字段优先级固定为 `state > runtime.context > defaults`**
   - 线程状态代表已持久化的当前线程语义；运行时上下文负责首次引导；默认值负责兼容旧线程。
   - 备选方案：让 `runtime.context` 覆盖线程状态；被拒绝，因为会让旧线程在后续 turn 中被新请求临时改写。

3. **读链路继续复用系统提示词注入**
   - `backend/src/agents/lead_agent/prompt.py` 在生成 `<memory>` 块之前先调用统一策略。
   - 备选方案：引入新的 `before_model` memory middleware；被拒绝，因为这已经接近 Phase 2 的 runtime 重组。

4. **前端与 embedded client 都必须把会话字段镜像到 `config.configurable`**
   - Web 入口继续保留 `context` 透传，并把关键字段显式放到 `config.configurable`；embedded `NionClient` 也必须把同一组字段同步放入 `config.configurable` 与运行时上下文。
   - 备选方案：只继续依赖 `runtime.context`；被拒绝，因为 agent prompt 当前从 `config.configurable` 读取运行时能力。

5. **写链路只在 `MemoryMiddleware` 入口拦截**
   - 现有代码搜索确认 `MemoryMiddleware` 是唯一生产写入口，因此 Phase 1 只在这里做统一禁写判断。
   - 备选方案：在 queue 或 updater 再做二次拦截；被拒绝，因为当前没有第二写入口，会增加重复逻辑。

6. **embedded `NionClient` 的 agent cache key 必须纳入会话记忆字段**
   - `NionClient` 会缓存内部 agent 与 system prompt；因此 `session_mode`、`memory_read`、`memory_write` 也必须进入 cache key，避免同一进程内切换会话策略时复用错误 prompt。
   - 备选方案：仅透传到运行时上下文，不调整 cache key；被拒绝，因为 prompt 构建会继续使用旧 agent。

## Risks / Trade-offs

- **[临时桥接不是最终架构]** → 通过在 design 和 docs 中明确说明：Phase 1 只是把语义做对，Phase 2 再做 `MemoryRuntime` 正式结构化。
- **[agent factory 依赖 `configurable`]** → 前端显式镜像 `memory_read`、`memory_write`、`session_mode` 到 `config.configurable`，避免只有中间件生效而 prompt 不生效。
- **[旧线程兼容]** → 策略层缺省按普通会话读写全开处理，保证字段缺失不致崩溃或意外只读。
- **[测试覆盖不足会放大回归风险]** → 新增独立 policy 测试，并补 runtime middleware、prompt、memory middleware、embedded client / scheduler 相邻测试。

## Migration Plan

1. 先创建 OpenSpec change 并补 proposal/spec/design/tasks。
2. 先写失败测试，锁定策略默认值、prompt 禁读、middleware 禁写和字段透传。
3. 实现 `policy.py`、线程状态扩展、runtime middleware 归并。
4. 接入 prompt 读链路与 memory middleware 写链路。
5. 补齐 `NionClient` / scheduler 透传与 agent cache key。
6. 运行最小相关测试、前端 typecheck、OpenSpec validate。
7. 更新 README、backend/CLAUDE 和阶段文档进展说明。

## Open Questions

- 暂无阻塞性 open question；若实施中发现必须引入 `MemoryRuntime` 或改存储格式，视为跨阶段阻塞并停止实现。
