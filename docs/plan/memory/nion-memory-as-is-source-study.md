# Nion 记忆系统 As-Is 源码级研究

## 1. 研究基线
- 代码基线：`Nion-Agent@a6f07d5a`（工作区含未提交改动，按用户要求不回滚）。
- 索引基线：`npx gitnexus status` 显示 `Indexed commit = Current commit = a6f07d5`，状态 `up-to-date`（2026-03-09）。
- 结论范围：仅基于当前工作区源码，不引用推测性设计文档。
- 证据规范：每条核心结论均落到 `文件 + 符号 + 行号 + 风险级别`。

## 2. 统一术语（与后续两文一致）
- `Memory V2`：当前 Nion 的 `memory.json + middleware + queue + updater + prompt 注入` 机制。
- `写回链路`：`MemoryMiddleware -> MemoryUpdateQueue -> MemoryUpdater -> memory.json`。
- `注入链路`：`get_memory_data -> format_memory_for_injection -> apply_prompt_template`。
- `Provider`：可插拔记忆后端抽象（当前 Nion 尚未引入统一 Provider 层）。
- `temporary_chat`：前端临时会话模式，期望“可读记忆但不写记忆”。
- `业务沾粘性`：记忆系统与线程上下文、上传、配置中心、前端设置、检索模型等耦合点。

## 3. 当前架构与调用链解剖

### 3.1 入口：MemoryMiddleware
- 中间件在 `after_agent` 中读取 `runtime.context.thread_id`，过滤消息后入队。
- 过滤逻辑会移除工具中间消息与 `uploaded_files` 临时块，并仅保留用户消息和最终 AI 回复。

关键源码：
- `backend/src/agents/middlewares/memory_middleware.py:20-87` `_filter_messages_for_memory`
- `backend/src/agents/middlewares/memory_middleware.py:112-153` `after_agent`
- `backend/src/agents/lead_agent/agent.py:242-244` middleware 挂载

### 3.2 队列：MemoryUpdateQueue
- 全局单例队列，按 `thread_id` 去重（新覆盖旧），定时 debounce 后批处理。
- 批处理内串行调用 `MemoryUpdater.update_memory`。

关键源码：
- `backend/src/agents/memory/queue.py:22-63` `add`
- `backend/src/agents/memory/queue.py:84-130` `_process_queue`
- `backend/src/agents/memory/queue.py:168-195` 单例管理

### 3.3 写回：MemoryUpdater -> memory.json
- `_get_memory_file_path` 决定全局 / per-agent 文件路径。
- `update_memory` 使用 LLM prompt 生成更新 JSON，再 `_apply_updates` 写入 `facts/user/history`。
- `_save_memory_to_file` 使用 `.tmp` 原子替换写入。

关键源码：
- `backend/src/agents/memory/updater.py:19-38` `_get_memory_file_path`
- `backend/src/agents/memory/updater.py:239-303` `update_memory`
- `backend/src/agents/memory/updater.py:305-373` `_apply_updates`
- `backend/src/agents/memory/updater.py:180-219` `_save_memory_to_file`
- `backend/src/config/paths.py:57-77` 全局 / agent memory 路径定义

### 3.4 注入：memory.json -> prompt
- `apply_prompt_template` 调用 `_get_memory_context`，按 `config.injection_enabled` 决定是否注入 `<memory>` 块。
- 注入来源直接读取 `get_memory_data(agent_name)`。

关键源码：
- `backend/src/agents/lead_agent/prompt.py:287-316` `_get_memory_context`
- `backend/src/agents/lead_agent/prompt.py:433-482` `apply_prompt_template`
- `backend/src/agents/memory/prompt.py:169-234` `format_memory_for_injection`

## 4. 业务沾粘性分析

### 4.1 与线程上下文强耦合
- 写回依赖 `runtime.context.thread_id`；缺失 thread_id 直接跳过。
- 前端将 `thread_id` 与 runtime context 一起提交。

证据：
- `backend/src/agents/middlewares/memory_middleware.py:126-130`
- `frontend/src/core/threads/hooks.ts:352-360,393-397`

### 4.2 与上传处理强耦合
- 中间件与 updater 都显式做了上传语义清洗，避免写入临时路径。
- 已有单测覆盖上传过滤场景。

证据：
- `backend/src/agents/middlewares/memory_middleware.py:43-66`
- `backend/src/agents/memory/prompt.py:256-264`
- `backend/src/agents/memory/updater.py:153-177`
- `backend/tests/test_memory_upload_filtering.py:45-232`

### 4.3 与配置中心耦合
- `AppConfig` 启动时将 `memory` 字段水合到 `MemoryConfig` 单例。
- 记忆配置同时承载大量“检索/压缩/演化”字段，边界模糊。

证据：
- `backend/src/config/app_config.py:71-79`
- `backend/src/config/memory_config.py:6-170`

### 4.4 与前后端契约耦合且存在漂移
- 前端 `MemorySettingsPage` 只读展示 `/api/memory`，不提供 Provider/compact/usage 管控。
- 前端 `temporary_chat` 传入 `memory_read/memory_write/session_mode`，后端未消费这些字段。

证据：
- `frontend/src/components/workspace/settings/memory-settings-page.tsx:158-185`
- `frontend/src/core/memory/api.ts:5-8`
- `frontend/src/app/workspace/chats/[thread_id]/page.tsx:368-373,452-457`
- `frontend/src/core/threads/types.ts:47-55`
- `backend/src/agents/thread_state.py:84-97`（无 `memory_read/memory_write/session_mode`）
- `backend/src/agents/middlewares/runtime_profile_middleware.py:11-15,55-57,90-94`

### 4.5 与 retrieval_models 强耦合
- 检索模型切换会反向写入 memory 配置（`vector_weight/embedding_provider` 等）。
- 记忆系统行为受 retrieval 模型操作副作用影响。

证据：
- `backend/src/retrieval_models/service.py:889-1001`

## 5. 质量评估

### 5.1 并发一致性：`中`
- 优点：文件落盘用 temp+replace，降低部分写入损坏风险。
- 风险：队列按 `thread_id` 覆盖，忽略 `agent_name` 维度；进程内内存队列无持久化，进程异常会丢未写回任务。

证据：
- `backend/src/agents/memory/queue.py:58-60`
- `backend/src/agents/memory/queue.py:84-130`
- `backend/src/agents/memory/updater.py:199-206`

### 5.2 可观测性：`偏弱`
- 主要靠 `print`，缺少结构化日志、指标、trace id 与失败告警分级。

证据：
- `backend/src/agents/memory/queue.py:64,82,103,110-121`
- `backend/src/agents/middlewares/memory_middleware.py:129,135`
- `backend/src/agents/memory/updater.py:135,215,299,302`

### 5.3 可测试性：`偏弱`
- 现有测试集中在上传过滤和客户端 API；缺少“真实 chat 回合 -> 注入 -> 写回”闭环集成测试。

证据：
- `backend/tests/test_memory_upload_filtering.py:1-232`
- `backend/tests/test_client.py:559-602,1163-1197`
- `backend/tests` 中无 `MemoryMiddleware/MemoryUpdateQueue` 集成回归

### 5.4 可演进性：`一般`
- 当前为函数式/单体式 memory 模块，未抽象 Provider/Registry/Runtime，扩展多存储或多策略成本高。

证据：
- `backend/src/agents/memory/__init__.py:1-44`
- `backend/src/gateway/routers/memory.py:75-201`（全局 memory 视角）

### 5.5 配置一致性：`偏弱`
- 前端配置 MemorySection 字段与后端 `MemoryConfig` 字段集明显不一致，存在“可配置但不生效”风险。

证据：
- `frontend/src/components/workspace/settings/configuration/sections/memory-section.tsx:58-121,141-278`
- `backend/src/config/memory_config.py:44-170`
- `frontend/src/components/workspace/settings/settings-dialog.tsx:90-101,175-176`
- `rg` 显示 `MemorySection` 仅定义：`frontend/src/components/workspace/settings/configuration/sections/memory-section.tsx:40`

## 6. 已知高风险（必须项）

| 风险ID | 风险描述 | 影响 | 风险级别 |
|---|---|---|---|
| R-01 | `memory_read/memory_write` 前端透传但后端未消费 | 临时会话写保护失效，可能误写长期记忆 | P0 |
| R-02 | `MemorySection` 未接线到设置入口 | 配置入口与实际生效配置割裂 | P1 |
| R-03 | Memory 配置字段漂移（前端字段集 vs 后端字段集） | 运营/用户误判“已配置生效” | P1 |
| R-04 | 回归测试缺口（无端到端闭环与迁移回滚测试） | 重构后易出现静默回归 | P1 |

## 7. 源码证据索引

| 结论ID | 结论 | 源码证据（文件/符号/行号） | 风险级别 |
|---|---|---|---|
| N-01 | 记忆写回入口在 `after_agent`，依赖 thread_id | `backend/src/agents/middlewares/memory_middleware.py` `after_agent` `112-153` | P1 |
| N-02 | 调用链符合 `Middleware -> Queue -> Updater` | `memory_middleware.py:149-151` -> `queue.py:37-63,84-130` -> `updater.py:239-303` | P1 |
| N-03 | 落盘目标是 `memory.json` / `agents/{agent}/memory.json` | `updater.py:19-38`; `paths.py:57-77` | P1 |
| N-04 | prompt 注入读取 memory 并拼入 `<memory>` | `lead_agent/prompt.py:287-316,433-482`; `memory/prompt.py:169-234` | P1 |
| N-05 | 上传事件被双层过滤（中间件+写回） | `memory_middleware.py:43-66`; `memory/prompt.py:256-264`; `updater.py:153-177` | P2 |
| N-06 | 队列按 thread_id 覆盖，忽略 agent 维度 | `queue.py:56-60` | P1 |
| N-07 | 队列仅进程内，异常退出会丢任务 | `queue.py:32-36,84-130` | P1 |
| N-08 | 观测主要依赖 `print`，缺结构化指标 | `queue.py:64,82,103,110-121`; `updater.py:135,215,299,302` | P2 |
| N-09 | 前端临时会话发送 `memory_write=false` | `frontend/.../[thread_id]/page.tsx:368-373,452-457` | P0 |
| N-10 | 后端状态 schema 未定义 memory_read/write/session_mode | `backend/src/agents/thread_state.py:84-97` | P0 |
| N-11 | 运行时中间件仅处理 execution_mode/host_workdir | `runtime_profile_middleware.py:11-15,55-57,90-94` | P0 |
| N-12 | Memory 页面仅只读 `/api/memory` | `memory-settings-page.tsx:158-185`; `core/memory/api.ts:5-8` | P2 |
| N-13 | MemorySection 未接线（定义存在、引用缺失） | `configuration/sections/memory-section.tsx:40`; `settings-dialog.tsx:175-176` | P1 |
| N-14 | retrieval_models 会改写 memory 配置 | `retrieval_models/service.py:889-1001` | P1 |
| N-15 | 当前测试未覆盖记忆闭环与迁移回滚 | `test_memory_upload_filtering.py`; `test_client.py:559-602,1163-1197` | P1 |

## 8. 结论摘要
- 当前 Nion 记忆系统是可运行的单体 V2 链路，但“会话开关语义、配置入口一致性、可观测性、测试闭环”存在明显短板。
- 结构上已出现“业务契约先行、后端执行缺位”的风险（最典型是 `temporary_chat + memory_write=false`）。
- 若执行一次性重构，必须先引入 Provider 层与统一 runtime 决策点，否则新增能力会继续堆叠在既有耦合点上。
