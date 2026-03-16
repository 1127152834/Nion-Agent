# Phase 3A：OpenViking Context FS（tool-first，混用模型稳定）

> **阶段目标一句话版：** 把 OpenViking 从“偶尔 find 一下”升级为可被智能体稳定使用的 **Context Filesystem**（只读检索 + 资源同步 + session 原文沉淀），并与 Nion 的 **Curated Memory（manifest/ledger + tier/governance + 注入）** 明确分工，保证 Anthropic-compatible 与 OpenAI-compatible 混用时不依赖额外 system message 注入也能工作。

- 阶段编号：`Phase 3A`
- 优先级：`P0`
- 前置阶段：`Phase 3 Structured Memory（已在当前仓库以 hard-cut 写入链路落地）`
- 后续阶段：`Phase 4 Soul Core`（不阻塞，但本阶段会为 Soul/Identity 资源化做铺垫）
- 是否允许独立实施：`允许`
- 风险等级：`中`

---

## 1. 阶段定位

Nion 当前的 OpenViking 接入更像“memory provider 的一个兼容壳”，主要能力仍停留在：

1. 通过 `SyncOpenViking.find()` 做轻量检索（且注入式 middleware 在 Anthropic-compatible 下会直接跳过）
2. structured write graph 把长期记忆落到本地 SQLite（manifest/ledger），并把 OpenViking 作为“可用则用，不可用则降级”的外部能力

这导致两类真实问题：

- **混用模型不稳定**：任何“额外 system message 注入”的增强逻辑，在 Anthropic-compatible 下会被跳过或直接导致请求失败。
- **OpenViking 未被充分利用**：OpenViking 的 L0/L1/L2、search/grep/tree 等 FS 能力没有被模型以 tool-first 稳定调用；SOUL/IDENTITY/USER 等资产也没进入可检索的资源域。

因此，本阶段的定位是：**先把 OpenViking 能力“可调用、可验证、可治理地接入”，再考虑更激进的深度融合。**

---

## 2. Context Pack

### 2.1 必读文档

- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-10-phase-3-7-program-governance.md`
  - 统一提交粒度、门禁与回写原则（本阶段严格按 Task 级提交）
- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-11-session-policy-as-built.md`
  - 运行时契约：`session_mode=temporary_chat` 时禁止记忆写入
- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-11-agent-memory-ui-closure-as-built.md`
  - UI 侧“默认智能体 = 全局记忆”的既定约束，避免后端引入 `agent:_default` 语义漂移

### 2.2 必读代码

- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/lead_agent/prompt.py`
  - Soul Core（`<soul>/<identity>/<user-profile>`）与 `<memory>` 注入入口
- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/middlewares/openviking_context_middleware.py`
  - 现有注入式增强；Anthropic-compatible 下会跳过（本阶段以 tool-first 替代）
- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/middlewares/memory_middleware.py`
  - 对话结束后的写入 hook（本阶段会接线 session commit queue）
- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/memory/openviking_runtime.py`
  - OpenViking client 构建、find/rm、commit_session、structured write graph、ledger/index 等核心
- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/tools/builtins/setup_agent_tool.py`
  - bootstrap 落盘资产与初始化记忆入口（本阶段会在这里触发资源同步）

### 2.3 已知事实（禁止再猜）

- OpenViking SDK 会通过环境变量 `OPENVIKING_CONFIG_FILE` 解析配置文件路径，该 env **是进程级全局**。
- 当前 `OpenVikingRuntime._build_openviking_client()` 会直接写 `os.environ["OPENVIKING_CONFIG_FILE"] = ...`，存在并发串扰风险。
- Anthropic-compatible 模型不接受非连续 system message，因此：
  - `OpenVikingContextMiddleware` 会跳过注入
  - `InternalToolRecallMiddleware` 也会跳过注入
- 当前 Nion 的长期记忆主链路是 **structured write graph -> SQLite manifest/ledger -> 注入/检索**，OpenViking 不可用时会降级到 ledger。

### 2.4 禁止假设

- 禁止假设“只要加一个 middleware 注入就能解决混用模型问题”。
- 禁止假设“只要把所有内容写进 OpenViking session 就等于完成了长期记忆”。
- 禁止假设可以在本阶段引入重型依赖或大范围重构（比如把 Curated Memory 全面替换为 OpenViking memory）。

---

## 3. 当前系统状态（As-Is Context）

### 3.1 当前已经有什么

- Curated Memory（SQLite）：
  - `MemoryWriteGraph` 按 `profile/preference/episode/trace` 生成动作与证据，落 manifest/ledger，并支持 explain/治理。
- OpenViking（SDK）：
  - runtime 层已有 `find/abstract/rm/add_message/commit_session` 的使用与降级逻辑。
- 工具层：
  - 目前对 LLM 暴露的 `ov_find/ov_search` 实际是 `memory_query` 的 alias，并不提供 OpenViking FS 能力。

### 3.2 当前缺什么

- tool-first 的 OpenViking FS 工具集合（overview/read/tree/grep/search 等）
- 并发安全的 OpenViking client 构建封装（env 还原 + 临界区）
- `openviking_session_commit_enabled` 实际接线（现有 queue 存在但未使用）
- `<memory>` 注入的 tier-aware 格式化与强约束（确保 trace 永不注入）
- `setup_agent` 创建/更新后资产同步到 OpenViking resources（让 Soul/Identity/User 可检索、可追溯）

---

## 4. 本阶段要解决的核心问题

1. OpenViking 的 FS 能力缺少稳定工具入口，导致混用模型下无法依赖 prompt 注入增强。
2. OpenViking client 构建不并发安全，存在 scope 配置串扰风险。
3. session commit 没有接线，无法把“对话原文证据层”沉淀到 OpenViking session。
4. `<memory>` 注入缺少强约束，存在把不该注入的信息（尤其 trace）混入 prompt 的风险。
5. Soul/Identity/User 等核心资产没进入 OpenViking resources，无法统一检索与追溯。

---

## 5. 本阶段目标（可验收）

- 目标 1：新增一组只读 `ovfs_*` 内置工具，覆盖 `find/search/overview/read/ls/tree/grep/glob/stat`，输出统一 JSON。
- 目标 2：OpenViking client 构建实现进程级并发安全（全局锁 + env 还原），所有 SDK 调用走统一封装。
- 目标 3：`openviking_session_commit_enabled` 真正生效：每轮对话后将过滤后的消息以 debounce 方式写入 session，并在 ledger 侧标记为 `trace` 且 TTL 受控。
- 目标 4：升级 `<memory>` 注入为 tier-aware：只注入 `profile/preference/高质量 episode`，永不注入 trace，并在超预算时优先裁剪 episode。
- 目标 5：`setup_agent` 成功后把 `SOUL/IDENTITY/USER(marker block)` 同步到 `viking://resources/nion/managed/...`，支持 `ovfs_search` 命中与 overview/read。

---

## 6. 本阶段明确不做（Out of Scope）

- 不把 Curated Memory 全量迁移/替换为 OpenViking memory（保持双栈分工）。
- 不新增 UI 侧 “OpenViking Explorer” 页（除非后续明确需求）。
- 不改变 Soul Core 的注入字段结构（仍为 `<soul>/<identity>/<user-profile>`）。
- 不在本阶段引入 OpenViking 的写工具给 LLM（写入只通过后端内部同步逻辑执行）。

---

## 7. 默认规则与决策闭环

- 以 **tool-first** 为主：混用模型下不依赖额外 system message 注入增强。
- `_default` 智能体在记忆层语义上恒等于 `global`：
  - OpenViking scope / Curated Memory scope 都不得产生 `agent:_default` 的独立视图。
- session 原文写入只作为“证据层”：
  - ledger 中必须标记为 `tier=trace` 且有 TTL（默认 7 天）
  - 任何默认注入与默认检索必须排除 trace
- OpenViking resources 托管前缀固定：`viking://resources/nion/managed/`：
  - Nion 只允许写入该前缀，避免覆盖用户自建资源。

---

## 8. 实现方案（工作包）

### 工作包 A：OpenViking client 并发安全与 FS 只读封装
- 在 runtime 内实现全局锁 + env 还原的 client contextmanager
- 新增 FS 只读方法：find/search/overview/read/ls/tree/grep/glob/stat

### 工作包 B：tool-first `ovfs_*` 工具集
- 新增 `openviking_fs_tools.py` 并导出到 builtin tool registry
- 保证 scope 解析、输出格式统一、只读安全

### 工作包 C：session commit 接线（trace 化） + `<memory>` tier-aware 注入
- `MemoryMiddleware.after_agent` 接线 `MemoryUpdateQueue.add(...)`
- runtime 写入 ledger 的 session_commit 条目打 `tier=trace` + TTL
- 注入函数强约束排除 trace、过期、非 active

### 工作包 D：setup_agent 后资源同步到 OpenViking resources
- runtime/provider 增加 `sync_managed_resource`
- setup_agent 成功后同步 `SOUL/IDENTITY/USER` 到托管前缀

---

## 9. 验收标准

### 9.1 功能验收

- `ovfs_search` 能命中 `viking://resources/nion/managed/...` 下的 SOUL/IDENTITY/USER 资源。
- 开启 `openviking_session_commit_enabled` 后，后台会写入 session（OpenViking 不可用时降级到 ledger，但不影响主对话）。
- `<memory>` 注入按 tier 分区且稳定，不混入 trace。

### 9.2 回归验收

- `backend` 定向 pytest 通过：
  - runtime retrieval 相关用例
  - 新增 FS tools contract 用例
  - setup_agent bootstrap 用例（含资源同步）

### 9.3 边界场景验收

- Anthropic-compatible 模型下不依赖注入式 middleware 仍可通过 `ovfs_*` 获取 OpenViking 资源上下文。
- scope=agent&agent_name=_default 始终等价 global（防旧 UI/旧调用方式）。

---

## 10. 回滚方案

- 新增能力全部通过开关/只读工具实现，可随时回滚：
  - `openviking_session_commit_enabled=false` 立刻停止 session 原文写入
  - 资源同步失败不影响主流程（仅 warning），必要时可加入总开关再回滚
- 不做任何 destructive 数据删除；回滚仅停止写入与工具暴露。

---

## 11. 给 Codex 的实施 Prompt（执行必须遵守）

```text
你将实现 Phase 3A：OpenViking Context FS。要求：
1) 每个 Task 改完必须跑对应定向 pytest，并单独提交。
2) 每个 commit message 必须包含 Plan/Why/What/Validation/Follow-up，写清楚修改了哪些文件、原因、验证命令与结果。
3) 不允许引入重型抽象或大范围重构；优先在现有 openviking_runtime/provider/tools/setup_agent 上增量改造。
4) 混用模型稳定优先：任何依赖额外 system message 注入的增强都不能作为主路径。
```

