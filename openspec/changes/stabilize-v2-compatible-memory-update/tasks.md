## 1. OpenSpec 与热修文档

- [x] 1.1 新增 `docs/memoh/plan/2026-03-10-phase-2-memory-stability-hotfix.md`
- [x] 1.2 完成 `proposal.md`、`specs/memory-core-stability/spec.md`、`design.md`、`tasks.md`
- [x] 1.3 运行 `openspec validate stabilize-v2-compatible-memory-update --type change --strict`

## 2. 写回解析与日志加固

- [x] 2.1 在 `backend/src/agents/memory/updater.py` 新增集中解析函数与固定解析回退链
- [x] 2.2 为兼容解析成功结果补齐最小结构归一化
- [x] 2.3 在彻底解析失败时输出带 `thread_id`、模型名和响应片段的诊断日志，并确保不改写已有 memory 文件
- [x] 2.4 轻量收紧 `backend/src/agents/memory/prompt.py` 中 `MEMORY_UPDATE_PROMPT` 的输出约束

## 3. 最小 facts 注入

- [x] 3.1 在 `backend/src/agents/memory/prompt.py` 保留现有 summary 注入逻辑
- [x] 3.2 追加高置信 `Key Facts` 区块，按 `confidence` 降序、`createdAt` 新到旧排序
- [x] 3.3 控制最多注入 10 条，并继续受 `max_injection_tokens` 总预算约束
- [x] 3.4 确保 `memory_read=false` 时 summary 与 facts 都不注入

## 4. 测试、手测、验证、回写

- [x] 4.1 扩展 `backend/tests/test_memory_updater.py` 覆盖 fenced JSON、前后缀文本、YAML/近似 JSON、彻底失败保留旧文件
- [x] 4.2 扩展 `backend/tests/test_memory_core_provider.py` 覆盖高置信 facts 注入与 `memory_read=false` gating
- [x] 4.3 回归 `backend/tests/test_memory_session_policy.py` 与 `backend/tests/test_memory_upload_filtering.py`
- [x] 4.4 运行最小测试、`openspec validate stabilize-v2-compatible-memory-update --type change --strict` 与 `git diff --check`
- [x] 4.5 回写阶段文档进展说明，并明确仍留给 `Phase 3+` 的内容
