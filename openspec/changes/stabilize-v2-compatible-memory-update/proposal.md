## Why

当前 `v2-compatible` 长期记忆兼容链路在运行时已经能正常触发：对话后会入队、debounce 后会处理、`MemoryUpdater` 会实际调用模型尝试生成更新结果。但桌面端真实日志显示，这条链路经常因为模型返回 fenced JSON、带说明前后缀的对象文本，或近似 YAML/非严格 JSON，而在 `json.loads(...)` 阶段失败。

结果是：长期记忆更新被整体丢弃，`memory.json` 不会得到新偏好或新事实，页面 Memory 仍是旧内容；与此同时，即使部分事实未来成功写入，当前默认注入内容也主要依赖 summary，缺少最小 facts 可见性，导致“我记住了”与“下一轮真的能利用这条记忆”之间仍然存在体验断裂。

这不是 `Phase 3` 的结构化存储问题，而是当前 `Phase 2` 兼容层的基线可用性问题。如果不先修，后续结构化迁移、回滚验证和页面手测都缺少可信 legacy 基线。

## What Changes

- 为 `MemoryUpdater` 增加集中解析函数与固定解析回退链：`json.loads -> fence/object extraction -> yaml.safe_load`
- 解析成功后做最小结构归一化，解析失败时保留现有 `memory.json` 并输出可诊断日志
- 轻量收紧 `MEMORY_UPDATE_PROMPT` 的输出约束，降低非严格 JSON 输出概率
- 在现有 summary 注入基础上，为高置信持久化 facts 追加最小 `Key Facts` 注入区块
- 补齐相关自动化测试，并新增一份热修阶段文档记录本次兼容层修复边界

## Capabilities

### New Capabilities
- `memory-core-stability`: 稳定 `v2-compatible` 记忆兼容路径的写回与最小可感知读取行为，确保 legacy 基线可写、可读、可验证

### Modified Capabilities
- `memory-core`: 默认 `v2-compatible` provider 在保持现有存储格式不变的前提下，具备更稳健的更新结果解析能力与更可感知的 facts 注入能力
- `memory-session-policy`: 继续作为读写 gating 语义来源，热修后仍严格遵守 `memory_read` / `memory_write` / `session_mode`

## Impact

- 兼容写回链路：`backend/src/agents/memory/updater.py`
- 注入与提示词：`backend/src/agents/memory/prompt.py`
- 自动化测试：`backend/tests/test_memory_updater.py`、`backend/tests/test_memory_core_provider.py`、`backend/tests/test_memory_session_policy.py`、`backend/tests/test_memory_upload_filtering.py`
- 文档与阶段计划：`docs/memoh/plan/2026-03-10-phase-2-memory-stability-hotfix.md`
