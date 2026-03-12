## 1. OpenSpec 产物与前置测试

- [x] 1.1 完成 `proposal.md`、`specs/memory-core/spec.md`、`design.md`、`tasks.md`
- [x] 1.2 运行 `openspec validate skeletonize-memory-core-v2-compatible --type change --strict`
- [x] 1.3 新增 provider / registry 的失败测试，先锁住默认 provider、兼容 runtime 与 Phase 1 gating 行为

## 2. Memory Core 抽象边界

- [x] 2.1 新增 `backend/src/agents/memory/core.py`，定义最小共享类型与协议
- [x] 2.2 新增 `backend/src/agents/memory/runtime.py`，实现 `V2CompatibleMemoryRuntime`
- [x] 2.3 新增 `backend/src/agents/memory/provider.py`，实现 `V2CompatibleMemoryProvider`
- [x] 2.4 新增 `backend/src/agents/memory/registry.py`，实现默认 registry 与默认 provider 注册入口

## 3. V2-Compatible Runtime 与默认 Provider

- [x] 3.1 复用 `policy.py` 作为会话策略来源，不复制 Phase 1 语义逻辑
- [x] 3.2 让默认 runtime 兼容读取现有 `memory.json` / `agents/{name}/memory.json`
- [x] 3.3 让默认 provider 在兼容模式下发起 queue update，并保留现有存储格式与写回路径

## 4. 上层依赖重定向

- [x] 4.1 在 `backend/src/agents/lead_agent/prompt.py` 通过默认 provider 获取长期记忆注入内容
- [x] 4.2 在 `backend/src/agents/middlewares/memory_middleware.py` 通过默认 provider 发起兼容写回
- [x] 4.3 在 `backend/src/gateway/routers/memory.py` 与 `backend/src/client.py` 通过默认 provider 读取 memory data
- [x] 4.4 在 `backend/src/agents/memory/__init__.py` 补导出新的 core/provider/runtime/registry 入口，并保留现有 V2 导出

## 5. 测试、文档、验证、评审

- [x] 5.1 新增 `backend/tests/test_memory_core_registry.py` 与 `backend/tests/test_memory_core_provider.py`
- [x] 5.2 扩展 `backend/tests/test_memory_upload_filtering.py`、`backend/tests/test_client.py`
- [x] 5.3 运行最小相关后端测试与 Phase 1 回归测试
- [x] 5.4 更新 `backend/CLAUDE.md`、`README.md`、`docs/memoh/plan/2026-03-09-phase-2-memory-core.md`
- [x] 5.5 再次运行 `openspec validate skeletonize-memory-core-v2-compatible --type change --strict`
- [x] 5.6 基于最终 diff 做一次代码自审，确认未越界到 Phase 3
