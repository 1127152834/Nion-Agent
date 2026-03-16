# Phase 3A：OpenViking Context FS（tool-first）执行记录

**日期**：2026-03-16  
**Workstream**：WS4 Core Domains（Memory/OpenViking）  
**范围**：backend  
**风险等级**：A/B  
**目标**：稳定性 / 可维护性 / 体量控制 / 质量提升  
**关联计划**：
- `docs/memoh/plan/2026-03-16-phase-3a-openviking-context-fs.md`
- `docs/plans/2026-03-16-openviking-context-fs-implementation-plan.md`
**关联提交**：
- `a11b6c49..fc8e7e7e`（Phase 3A Tasks 1-6）
- `1a5eb286`（合并到 main）

## 背景

本阶段要把 OpenViking 从“偶尔 find 一下”的外部能力，升级为可被智能体稳定使用的 Context Filesystem（tool-first），并与 Nion Curated Memory（manifest/ledger + tier/TTL + 注入治理）明确分工，解决：

- 混用模型不稳定：Anthropic-compatible 模型会跳过注入式 middleware，必须提供 tool-first 主路径。
- OpenViking client 并发不安全：`OPENVIKING_CONFIG_FILE` 是进程级 env，scope 切换会串扰。
- session 原文沉淀缺少可控入口：需要 trace 化（tier=trace + TTL）并默认不注入。
- `<memory>` 注入缺少强约束：必须按 tier/TTL 注入，并永远排除 trace。
- SOUL/IDENTITY/USER 等核心资产未进入 OpenViking resources：无法统一检索与追溯。

## 本阶段策略与约束

- 渐进式治理：按 Task 粒度提交，每个 Task 独立可回滚。
- tool-first 优先：`ovfs_*` 作为混用模型的稳定入口，不依赖额外 system message 注入增强。
- 写入受控：不向 LLM 暴露 OpenViking 写工具；写入仅由后端内部逻辑触发。
- 托管前缀固定：只允许写入 `viking://resources/nion/managed/...`，防止覆盖用户自建资源。

## 变更清单（按 Task）

### Task 1：修复 OpenViking client 并发安全（全局锁 + env 还原）

- 提交：`a11b6c49`
- 核心变更：
  - 在 runtime 内引入统一的 OpenViking client contextmanager，使用全局锁保护 `OPENVIKING_CONFIG_FILE` 的切换，并在 finally 中还原 env，避免跨 scope 串扰。
  - 将关键 SDK 调用统一收敛到该 contextmanager。
- 验证：新增并通过并发/切 scope 的 env 还原单测（见同提交）。

### Task 2：Runtime/Provider 增加 OpenViking FS 只读能力

- 提交：`9b4771f5`
- 核心变更：
  - 增加 `fs_find/fs_search/fs_overview/fs_read/fs_ls/fs_tree/fs_grep/fs_glob/fs_stat`（只读），并统一输出形状。
  - provider 增加对应转发方法。
- 验证：新增并通过只读 API 单测（见同提交）。

### Task 3：新增 ovfs_* 内置工具（tool-first 主入口）

- 提交：`f086e6ba`（工具实现与导出）+ `fd2258fb`（Ruff import 排序）
- 核心变更：
  - 新增 `ovfs_find/ovfs_search/ovfs_overview/ovfs_read/ovfs_ls/ovfs_tree/ovfs_grep/ovfs_glob/ovfs_stat` 工具，统一 JSON 输出，统一 scope 解析（`_default -> global`）。
  - 工具注册与 contract tests。
- 验证：新增并通过工具契约测试（见同提交）。

### Task 4：接线 openviking_session_commit_enabled（trace 化 session commit）

- 提交：`1813851f`
- 核心变更：
  - 在 `MemoryMiddleware.after_agent` 中接线 session commit queue：当允许写入且开关开启时，把过滤后的消息作为“证据层”异步入队。
  - 写入 ledger 时标记 `tier=trace`，并设置短期 TTL（默认 7 天），保证默认注入/检索不会被 trace 污染。
- 兼容性修复（verify 回归发现）：`d8f7876c`
  - 对缺少 `openviking_session_commit_enabled` 字段的测试/旧配置对象使用 `getattr(..., False)` 防御，避免 AttributeError。

### Task 5：升级 `<memory>` 注入为 tier-aware（强约束）

- 提交：`57413168`
- 核心变更：
  - facts 输出补齐 tier/TTL 元信息。
  - 注入格式化按 tier 组织（Profile/Preference/Episodes），强制排除 trace/过期/非 active；Episodes 限制 top-N；超预算优先丢 Episodes。
- 验证：新增并通过 tier-aware 注入单测（见同提交）。

### Task 6：setup_agent 完成后同步 Soul/Identity/User(marker) 到 OpenViking resources

- 提交：`fc8e7e7e`
- 核心变更：
  - 在 provider/runtime 增加 `sync_managed_resource`：仅允许写入托管前缀，mkdir/rm/add_resource(best-effort, wait=false)，失败只 warning，不阻断 bootstrap。
  - setup_agent 在创建/更新资产后，最佳努力同步：
    - `viking://resources/nion/managed/user/USER.md`
    - `viking://resources/nion/managed/agents/<agent_name>/{SOUL.md,IDENTITY.md,agent.json}`
- 验证：bootstrap 单测覆盖同步调用与失败降级（见同提交）。

## 验证证据（必须）

在当前 main（包含 Phase 3A + WS0 guardrails）上执行：

- Run：`make verify`
- Result：PASS
  - backend：`uvx ruff check .` PASS；`pytest` 605 passed, 1 skipped（存在 1 条 upstream Deprecation warning）
  - frontend：`pnpm run check` PASS；`pnpm run test:unit` 53 passed
  - desktop：`pnpm run test` PASS（node --test 1 passed）

## 风险点与回滚

- 主要风险点：
  - `OPENVIKING_CONFIG_FILE` 为进程级 env，任何绕开 runtime client contextmanager 的 SDK 调用都可能重新引入并发串扰。
  - trace 证据层写入必须永远不进入默认注入与默认检索，否则会污染长期事实。
- 回滚策略：
  - 所有变更按 Task 拆分提交，可逐个 `git revert <sha>` 回退。
  - `openviking_session_commit_enabled=false` 可立即停止 session 原文写入（不影响主对话链路）。

## 遗留问题与下一步

- Phase 3A 后续建议：
  - 在生产环境打开 `openviking_session_commit_enabled` 前，补齐监控与容量预估（session 写入量与 TTL 清理效果）。
  - 基于 `ovfs_*` 工具结果，逐步增强“只在需要时拉取上下文”的提示模板与策略（仍保持 tool-first）。

