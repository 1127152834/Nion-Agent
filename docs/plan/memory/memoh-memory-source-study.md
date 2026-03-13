> [!WARNING]
> 历史基线说明（2026-03-12）  
> 本文基线为 `memohai/Memoh@09cdb8c`（memoh v1），仅用于历史回溯。  
> 当前对标与实施请优先阅读：
> - `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/plan/memory/memoh-v2-learning-checklist.md`
> - `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/plan/memory/memoh-v2-code-evidence-index.md`

# Memoh 记忆系统源码级研究（基线 `memohai/Memoh@09cdb8c`）

## 1. 研究基线
- 仓库来源：`https://github.com/memohai/Memoh.git`
- 固定提交：`09cdb8c`
- 本地分析目录：`/private/tmp/memoh-src-1773028990`
- 研究目标：抽取可迁移到 Nion 的 Provider 化架构要点，并识别“宣称能力 vs 运行时真实能力”差距。

## 2. 统一术语（与另外两文一致）
- `MemoryProvider`：统一记忆抽象，覆盖会话 Hook、MCP 工具、CRUD、Compact、Usage。
- `Provider Registry`：按 provider id 管理实例与工厂。
- `Provider Bootstrap`：进程启动时确保默认 provider 存在并实例化。
- `Memory Runtime`：provider 背后实际执行增删改查/检索/压缩/重建的运行时实现。
- `storefs`：Memoh 的文件存储实现（day-file + manifest + overview）。

## 3. Provider 抽象设计

### 3.1 统一接口边界完整
`Provider` 把能力分成 5 组：
1. 会话 Hook：`OnBeforeChat`、`OnAfterChat`
2. MCP 工具：`ListTools`、`CallTool`
3. CRUD：`Add/Search/GetAll/Update/Delete/DeleteBatch/DeleteAll`
4. 生命周期：`Compact`、`Usage`
5. 类型标识：`Type()`

证据：
- `internal/memory/provider/provider.go:9-48`
- `internal/memory/provider/types.go:8-257`

### 3.2 BuiltinProvider 的执行模式
- `OnBeforeChat`：按 `bot` 命名空间检索并拼接“可注入上下文文本”。
- `OnAfterChat`：将聊天消息打包为 `AddRequest` 写入 runtime。
- MCP 暴露 `search_memory` 工具，并带会话权限校验。

证据：
- `internal/memory/provider/builtin.go:72-145`（before hook）
- `internal/memory/provider/builtin.go:147-171`（after hook）
- `internal/memory/provider/builtin.go:175-295`（MCP tool）
- `internal/memory/provider/builtin.go:297-311`（访问控制）

## 4. 运行时接线（settings -> registry -> resolver/handler）

### 4.1 核心接线点
- Bot 设置中持有 `MemoryProviderID`。
- Resolver 在聊天前后通过 `MemoryProviderID` 解析 provider，并做注入与写回。
- MemoryHandler 和 MCP Memory Executor 也通过同一配置解析 provider。

证据：
- `internal/settings/types.go:11-16,28-33`
- `internal/settings/service.go:120-127,143-160,220-291`
- `internal/conversation/flow/resolver.go:1332-1375,1693-1711`
- `internal/mcp/providers/memory/provider.go:37-75`
- `internal/handlers/memory.go:95-118,142-147`

### 4.2 Registry + Bootstrap 机制
- 启动时注册 `builtin` 工厂和 `__builtin_default__` 实例。
- 生命周期 `OnStart` 会 `EnsureDefault` 并 `Instantiate(default provider)`。

证据：
- `cmd/memoh/serve.go:226-233`
- `cmd/memoh/serve.go:236-250`
- `internal/memory/provider/registry.go:11-103`
- `internal/memory/provider/service.go:135-152`

### 4.3 关键断点：Provider 管理与 Registry 生命周期分离
- `memory-providers` CRUD 只写数据库，不触发 `registry.Instantiate/Remove`。
- `Registry.Get` 仅查实例缓存，不做按 ID 懒加载实例化。
- 代码中 `Instantiate` 除启动 bootstrap 外无常规调用路径。
- 新建 provider 即使写入 DB，也可能无法被 runtime 立即解析。

证据：
- `internal/handlers/memory_providers.go:25-158`
- `internal/memory/provider/service.go:51-133`
- `rg` 调用面：`cmd/memoh/serve.go:244`（bootstrap）为主要实例化点

## 5. storefs 存储实现（day-file + manifest + overview）

### 5.1 存储布局
- `manifest`: `.../index/manifest.json`
- `overview`: `.../MEMORY.md`
- `day-file`: `.../memory/YYYY-MM-DD.md`
- 日文件内使用 `<!-- MEMOH:ENTRY {...} --> ... <!-- /MEMOH:ENTRY -->` 标记块。

证据：
- `internal/memory/storefs/service.go:31-44,446-455`
- `internal/memory/storefs/service.go:459-543`

### 5.2 写入/更新/删除/重建流程
- `PersistMemories`：按日期分桶写日文件、更新 manifest、同步 overview。
- `RemoveMemories`：按 manifest 反查文件删条目并回写。
- `RebuildFiles`：重建目录结构并重写 manifest/overview。
- `ReadAllMemoryFiles` 同时兼容 legacy frontmatter。

证据：
- `internal/memory/storefs/service.go:107-167`
- `internal/memory/storefs/service.go:169-210`
- `internal/memory/storefs/service.go:212-252`
- `internal/memory/storefs/service.go:271-331`
- `internal/memory/storefs/service.go:545-575`

### 5.3 API 对外暴露
- `/bots/:bot_id/memory` 提供 `add/search/getall/delete/compact/usage/rebuild`。

证据：
- `internal/handlers/memory.go:129-140,165-539`

## 6. README 宣称能力 vs Runtime 实现差距

### 6.1 差距总览
| README 宣称 | Runtime 现状（09cdb8c） | 差距等级 |
|---|---|---|
| Hybrid retrieval（dense + BM25）+ LLM fact extraction | 默认内建 runtime 为 `fileMemoryRuntime`，`Search` 主要是字符串包含/分词命中比率；`Add` 直接拼接消息文本写文件 | 高 |
| Per-bot memory model assignment | `lazyLLMClient.resolve` 最终返回 `memory llm runtime is not available`，未接入可用 LLM runtime | 高 |
| Memory compaction（语义压缩） | 当前 `Compact` 以时间排序后按比例截断保留，非语义合并 | 中 |
| Rebuild capability | 已有 `ChatRebuild` + `storefs.RebuildFiles/SyncOverview` | 低（已落地） |

关键证据：
- `README.md:80-83,92`
- `internal/handlers/memory.go:641-711,809-844,905-924`
- `cmd/memoh/serve.go:688-745`
- `internal/memory/provider/service.go:33-45`（配置 schema 提到 memory/embedding model）
- `cmd/memoh/serve.go:229-231`（factory 未使用 provider config）

### 6.2 额外一致性风险
- Resolver 的 `resolveMemoryProvider` 无默认 fallback：`MemoryProviderID` 为空时直接不注入/不写回。
- MemoryHandler 有 `__builtin_default__` fallback，导致“会话链路 vs REST 链路”行为不一致。

证据：
- `internal/conversation/flow/resolver.go:1332-1353`
- `internal/handlers/memory.go:95-118`

## 7. 对 Nion 重构可迁移资产
- 可直接借鉴：`Provider` 接口切分粒度（Hook/MCP/CRUD/Lifecycle）。
- 可直接借鉴：`Registry + Factory + Bootstrap` 组合模式。
- 可直接借鉴：`storefs` 的 `manifest + day-file + overview + rebuild` 存储策略。
- 需避免复制：Provider CRUD 与运行时实例生命周期脱节；“宣称能力未落地”导致预期偏差。

## 8. 源码证据索引

| 结论ID | 结论 | 源码证据（文件/符号/行号） | 风险级别 |
|---|---|---|---|
| M-01 | Provider 接口覆盖 Hook/MCP/CRUD/Compact/Usage | `internal/memory/provider/provider.go:9-48` | P1 |
| M-02 | 类型模型定义完整（请求/响应/管理） | `internal/memory/provider/types.go:8-257` | P1 |
| M-03 | BuiltinProvider 在 before/after chat 注入与写回 | `builtin.go:72-171` | P1 |
| M-04 | BuiltinProvider 暴露 `search_memory` MCP 工具 | `builtin.go:175-295` | P1 |
| M-05 | Bot 设置通过 `MemoryProviderID` 驱动 provider 选择 | `settings/types.go:14`; `settings/service.go:120-127,158`; `resolver.go:1343-1348` | P1 |
| M-06 | Resolver 在聊天前注入 memory context | `resolver.go:325-333,1355-1375` | P1 |
| M-07 | Resolver 聊天后异步写回 memory | `resolver.go:1437-1439,1693-1711` | P1 |
| M-08 | 启动时确保默认 provider 并实例化 | `cmd/memoh/serve.go:236-250` | P1 |
| M-09 | MemoryProvider CRUD API 存在 | `handlers/memory_providers.go:25-158` | P2 |
| M-10 | Provider CRUD 未联动 registry 实例生命周期 | `handlers/memory_providers.go:56-157`; `provider/service.go:51-133`; `provider/registry.go:50-63`; `serve.go:244` | P0 |
| M-11 | storefs 使用 day-file + manifest + overview | `storefs/service.go:31-44,446-455,459-543,577-621` | P1 |
| M-12 | 重建能力落地到 API | `handlers/memory.go:505-539`; `storefs/service.go:169-210` | P2 |
| M-13 | LLM runtime 未落地点 | `cmd/memoh/serve.go:727-745` | P0 |
| M-14 | README 的 hybrid/LLM 宣称与当前 runtime 不一致 | `README.md:80,92`; `handlers/memory.go:681-711,809-844,905-924` | P0 |
| M-15 | Resolver 与 Handler 的 provider fallback 行为不一致 | `resolver.go:1332-1353`; `handlers/memory.go:113-118` | P1 |

## 9. 结论摘要
- Memoh 的 Provider 架构抽象非常适合 Nion V3 借鉴，尤其是 Hook/MCP/CRUD/Lifecycle 的分层。
- 但 Memoh 当前实现也暴露两个关键教训：
  1. Provider 管理平面（CRUD）必须和运行时实例平面（registry）一致联动。
  2. README/产品宣称必须与 runtime 可用能力同步，否则会引入“功能表述债务”。
