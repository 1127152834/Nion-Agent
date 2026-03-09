## 1. OpenSpec 产物与前置测试

- [x] 1.1 完成 `proposal.md`、`specs/memory-session-policy/spec.md`、`design.md`、`tasks.md`
- [x] 1.2 运行 `openspec validate enforce-memory-session-runtime-contract --type change --strict`
- [x] 1.3 新增 `backend/tests/test_memory_session_policy.py`，先写失败测试锁定默认规则与写链路禁写行为
- [x] 1.4 扩展 `backend/tests/test_runtime_profile_middleware.py` 与 `backend/tests/test_lead_agent_rss_context.py`，先让会话字段透传相关用例失败

## 2. 后端线程契约与 `policy.py`

- [x] 2.1 在 `backend/src/agents/thread_state.py` 增加 `session_mode`、`memory_read`、`memory_write`
- [x] 2.2 新建 `backend/src/agents/memory/policy.py`，实现统一解析与默认规则
- [x] 2.3 在 `backend/src/agents/middlewares/runtime_profile_middleware.py` 中接入会话字段归并与状态优先级

## 3. 读链路接线

- [x] 3.1 在 `frontend/src/core/threads/hooks.ts` 把会话记忆字段镜像到 `config.configurable`
- [x] 3.2 在 `backend/src/agents/lead_agent/agent.py` 把会话字段传给 `apply_prompt_template`
- [x] 3.3 在 `backend/src/agents/lead_agent/prompt.py` 中按统一策略决定是否注入长期记忆
- [x] 3.4 在 `backend/src/client.py` 把会话字段同步写入 `config.configurable` 与运行时上下文，并纳入 agent cache key
- [x] 3.5 在 `backend/src/scheduler/workflow.py` 透传 `agent_config` 中的会话记忆字段到 `NionClient`

## 4. 写链路接线

- [x] 4.1 在 `backend/src/agents/middlewares/memory_middleware.py` 最早接入统一禁写判断
- [x] 4.2 保持 `backend/src/agents/memory/queue.py` 与 `backend/src/agents/memory/updater.py` 不变，并用测试确认入口拦截足够

## 5. 测试、文档、验证、评审

- [x] 5.1 跑最小相关后端测试与 custom-agent memory 回归
- [x] 5.2 跑前端 `pnpm typecheck`
- [x] 5.3 更新 `README.md`、`backend/CLAUDE.md`、`docs/memoh/plan/2026-03-09-phase-1-runtime-contract.md`
- [x] 5.4 再次运行 `openspec validate enforce-memory-session-runtime-contract --type change --strict`
- [x] 5.5 基于最终 diff 做一次代码自审，确认未越界到 Phase 2
- [x] 5.6 补 `backend/tests/test_client.py` 与 `backend/tests/test_scheduler_workflow.py`，锁定 embedded / scheduler 入口的会话契约透传
