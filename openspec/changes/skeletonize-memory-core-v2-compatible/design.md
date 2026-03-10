## Context

当前 Nion 的长期记忆链路已经能工作：对话后由 `MemoryMiddleware` 过滤消息并入队，`MemoryUpdateQueue` 做 debounce，`MemoryUpdater` 更新 `memory.json` / `agents/{name}/memory.json`，对话前再由 `lead_agent/prompt.py` 从同一数据源生成 `<memory>` 注入内容。Phase 1 已经把 `session_mode`、`memory_read`、`memory_write` 的运行时语义修正到位，且 embedded `NionClient` / scheduler 入口也已补齐同一套契约。

Phase 2 不再修“语义是否生效”，而是修“结构边界是否存在”。当前的核心问题是：上层链路仍在直接依赖 V2 细节文件，导致 provider、runtime、后续结构化存储和维护能力没有稳定挂点。

## Goals / Non-Goals

**Goals:**
- 建立最小 `MemoryProvider` / `MemoryRuntime` / `MemoryRegistry` 骨架
- 让当前 V2 `memory.json` 路线挂到默认 `v2-compatible` provider 下运行
- 让 prompt 注入、memory write、memory 只读接口开始依赖 `Memory Core`
- 保持 Phase 1 的会话读写策略语义不变
- 用最小自动化测试锁住默认 provider、默认 runtime 和兼容行为

**Non-Goals:**
- 不迁移 `memory.json` 到新文件结构
- 不实现 `overview / manifest / day-files`
- 不实现完整 `usage / compact / rebuild` 业务能力
- 不引入新的外部数据库或向量服务
- 不替换现有 memory API 为新的 API 面
- 不删除 V2 `queue.py` / `updater.py` 逻辑
- 不做前端记忆页面大改
- 不做 Soul / Heartbeat / Evolution 正式接线

## Decisions

1. **继续复用 Phase 1 的 `policy.py`**
   - `MemoryPolicy` 语义继续由现有 `resolve_memory_policy(...)` 提供。
   - 理由：Phase 2 只建立骨架，不重定义会话语义。

2. **新增最小 Memory Core 文件集**
   - 新增 `backend/src/agents/memory/core.py`、`runtime.py`、`provider.py`、`registry.py`。
   - 理由：把 Provider / Runtime / Registry 的结构边界固定下来，同时避免一上来引入过重框架。

3. **默认 provider 固定为 `v2-compatible`**
   - registry 首次访问时自动注册默认 provider。
   - 理由：本阶段不做配置化 provider 管理，但必须有稳定默认入口。

4. **默认 runtime 只包装 V2 逻辑，不重写 V2 算法**
   - `V2CompatibleMemoryRuntime` 只包装现有 `get_memory_data`、`reload_memory_data`、`get_memory_queue().add(...)`。
   - 理由：本阶段目标是“旧逻辑挂到新骨架”，不是重写队列和写回算法。

5. **上层链路开始依赖 provider，而不是继续直接依赖 V2 文件**
   - `lead_agent/prompt.py` 通过 provider 获取注入内容。
   - `memory_middleware.py` 通过 provider 发起兼容写回。
   - `gateway/routers/memory.py` 与 `client.py` 通过 provider 读取 memory data。
   - 理由：只有改变依赖方向，Phase 2 的骨架才真正生效。

6. **兼容性优先于纯粹重构**
   - 所有外部响应格式、路径规则、会话语义和 custom-agent 记忆路径保持兼容。
   - 理由：Phase 2 是骨架引入期，必须保持可回滚和低回归风险。

## Risks / Trade-offs

- **[骨架过轻，像“套壳”]** → 这是 Phase 2 的刻意选择；先把依赖方向扭正，再在 Phase 3 扩展维护能力。
- **[上层仍可能残留 V2 直连点]** → 通过明确将 prompt、middleware、memory API、embedded client 都接到 provider，减少直接依赖残留。
- **[兼容包装会增加一层间接性]** → 可接受；当前优先级是演进性与回滚能力，而不是最少抽象层数。
- **[后续 provider lifecycle 尚未完整]** → 留给 Phase 3+；本阶段 registry 只需要稳定提供默认 provider。

## Migration Plan

1. 创建 Phase 2 OpenSpec change 并完成 proposal/spec/design/tasks。
2. 先补默认 provider / runtime / registry 的失败测试。
3. 实现最小 Memory Core 骨架。
4. 将 prompt 注入、memory write、memory 只读接口重定向到 provider。
5. 跑最小相关测试与 OpenSpec validate。
6. 更新文档与阶段计划进展说明。

## Open Questions

- 本阶段无阻塞性 open question；若实施中发现必须迁移数据格式、替换 API 面或引入多 provider 配置管理，则判定为跨阶段阻塞并停止实现。
