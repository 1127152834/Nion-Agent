# Phase 3 结构化记忆实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.
>
> **引用阶段计划：** `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-3-structured-memory.md`
>
> **适用前提：** 只有当 `Phase 1` 与 `Phase 2` 已经真实落地到代码与测试时，才能执行本计划。若前置不满足，必须停止并输出阻塞报告，而不是把多个阶段混在一起做。

**Goal:** 把 Nion 的长期记忆从单体 `memory.json` 路线升级为 `MEMORY.md + manifest + day-files` 的结构化文件布局，并补上 `usage / compact / rebuild / rollback` 能力，同时保证 `memory_read / memory_write` 契约和回滚路径不被破坏。

**Architecture:** 复用 `Phase 2` 的 `MemoryPolicy + MemoryProvider + MemoryRuntime + MemoryRegistry` 骨架，把 `structured-fs` 做成新的 runtime/provider，而不是把结构化逻辑散落到 router、prompt、middleware、queue 中。整体路线采用“先前置检查 → 再路径与模型 → 再 runtime/provider → 再 API → 再主链路接线 → 最后切换与回滚验证”的保守推进方式。

**Tech Stack:** Python、FastAPI、Pydantic、本地文件系统、现有 `Paths` / `MemoryConfig` / `scheduler` / `LangGraph` 中间件体系、`pytest`

---

## 0. 执行前总原则

### 0.1 必读材料

开始前必须完整阅读：

1. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-1-runtime-contract.md`
2. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-2-memory-core.md`
3. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-3-structured-memory.md`
4. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/plans/2026-03-09-nion-memoh-research-architecture.md`
5. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/plan/memory/nion-memory-as-is-source-study.md`
6. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/plan/memory/memoh-memory-source-study.md`
7. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/plan/memory/nion-memory-v3-one-shot-refactor-blueprint.md`

### 0.2 硬性边界

执行期间必须始终遵守：

- 不做 `Soul Core`
- 不做 `Heartbeat Core`
- 不做 `Evolution Core`
- 不做重型外部数据库
- 不做长期双写体系
- 不做复杂 provider 管理后台
- 不做高频自动语义压缩

### 0.3 当前仓库的现实风险

截至本计划编写时，当前仓库里尚未看到 `Phase 2` 预期的这些核心文件真实存在：

- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/memory/core.py`
- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/memory/runtime.py`
- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/memory/registry.py`
- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/memory/policy.py`

所以**任务 0 是阻塞检查，不是走过场**。

---

## Task 0：前置检查与阻塞报告

**目标**
- 验证 `Phase 1` 和 `Phase 2` 是否已经真实落地
- 如果没有落地，明确阻塞点并停止

**Files:**
- Read: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-1-runtime-contract.md`
- Read: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-2-memory-core.md`
- Read: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/memory/`
- Optional Create: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-3-blocker-report.md`

**Step 1: 检查核心文件是否存在**

Run:
```bash
test -f backend/src/agents/memory/core.py
 test -f backend/src/agents/memory/runtime.py
 test -f backend/src/agents/memory/registry.py
 test -f backend/src/agents/memory/policy.py
```

Expected:
- 如果任一文件不存在，进入阻塞路径
- 如果都存在，再继续读代码确认职责是否与 `Phase 2` 一致

**Step 2: 检查 Phase 1 契约是否存在测试保护**

重点确认是否已有：
- `session_mode`
- `memory_read`
- `memory_write`
- 临时会话不写长期记忆
- 读取/写入语义由统一策略点裁决

**Step 3: 输出前置检查结论**

必须明确回答：
- `Phase 1` 是否真实落地
- `Phase 2` 是否真实落地
- 当前 memory 主读写入口是什么
- 当前上层是否已开始依赖 Memory Core
- 若阻塞，缺哪几个文件/测试/接线点

**Stop Rule**
- 如果 `Phase 2` 未真实落地，本计划到此结束，不允许继续实现 `Phase 3`

**给 Claude 的任务 Prompt**

```text
你现在执行的是 Nion-Agent 的 Phase 3 Task 0：前置检查与阻塞报告。

请先不要改代码。你必须先检查：
1. Phase 1 是否真实落地
2. Phase 2 的 Memory Core 文件与职责是否真实存在
3. 当前上层是否已经开始依赖 Memory Core

如果任一前置不满足，停止后续实现，并输出一份明确的 blocker report。不要把 Phase 2 和 Phase 3 混做。
```

---

## Task 1：结构化路径与最小数据模型

**目标**
- 为 structured memory layout 建立统一路径辅助和最小模型

**Files:**
- Modify: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/config/paths.py`
- Modify: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/config/memory_config.py`
- Create: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/memory/structured_models.py` 或 `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/memory/models.py`
- Test: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/tests/test_memory_structured_paths.py`

**Step 1: 先写失败测试**

建议先覆盖：
- 全局 structured memory root 解析
- agent 级 structured memory root 解析
- `MEMORY.md` / `manifest.json` / `memory/YYYY-MM-DD.md` / `snapshots` 路径生成
- 非法 scope / path 情况下的错误处理

**Step 2: 路径层最小改造**

优先新增 helper，而不是修改现有 `memory_file` 语义，例如：
- `memory_structured_dir()`
- `agent_memory_structured_dir(name)`
- `memory_overview_file(...)`
- `memory_manifest_file(...)`
- `memory_day_file(...)`
- `memory_snapshots_dir(...)`

**Step 3: 建立最小模型**

至少包含：
- `MemoryManifestItem`
- `MemoryManifest`
- `StructuredMemoryUsage`
- `CompactResult`
- `RebuildResult`

**Step 4: 跑最小测试**

Run:
```bash
pytest backend/tests/test_memory_structured_paths.py -q
```

Expected:
- 新增路径 helper 测试通过
- 现有 `Paths` 行为未被破坏

**给 Claude 的任务 Prompt**

```text
你现在执行 Phase 3 Task 1：结构化路径与最小数据模型。

目标是只解决 structured memory 的路径与模型问题，不要提前写 provider/router/prompt 集成。

你必须：
- 保持现有 memory.json 路径语义不变
- 新增 structured memory 专用 path helper
- 用最小模型表达 manifest/usage/compact/rebuild
- 先写测试，再做实现
```

---

## Task 2：实现 StructuredFsRuntime 基础读写

**目标**
- 落地 `structured-fs` 的最小文件布局、读取、追加写入与概览刷新能力

**Files:**
- Modify: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/memory/runtime.py`
- Optional Create: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/memory/structured_runtime.py`
- Modify: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/memory/core.py`
- Modify: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/memory/registry.py`
- Test: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/tests/test_memory_structured_provider.py`

**Step 1: 先写失败测试**

至少覆盖：
- 初始化目录布局
- 首次写入会创建 `MEMORY.md + manifest + day-file`
- 新写入会追加/更新 `manifest`
- 重新读取能恢复结构化状态

**Step 2: 实现最小 runtime**

建议 first pass 只做：
- 初始化目录
- persist / load
- 刷新 overview
- 按日期分桶 day-file

不要在这一步混入：
- migration
- router
- prompt 注入
- compact / rebuild

**Step 3: registry/provider 接线**

确保 `structured-fs` 可以通过 registry 获取，但默认不一定立即切主。

**Step 4: 跑最小测试**

Run:
```bash
pytest backend/tests/test_memory_structured_provider.py -q
```

Expected:
- 能完整初始化和读写 structured layout
- legacy provider 仍存在

**给 Claude 的任务 Prompt**

```text
你现在执行 Phase 3 Task 2：实现 StructuredFsRuntime 基础读写。

只做 structured-fs runtime/provider 的最小可运行骨架：初始化、写入、读取、overview/manifest/day-file。
不要在这一步混入 migration、router、prompt、compact、rebuild。
先写测试，再做实现。
```

---

## Task 3：legacy 导入、快照与回滚辅助

**目标**
- 让 `memory.json` 能导入 structured layout，并保留回滚证据

**Files:**
- Modify: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/memory/runtime.py`
- Optional Create: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/memory/migration.py`
- Modify: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/config/paths.py`
- Test: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/tests/test_memory_structured_migration.py`

**Step 1: 先写失败测试**

至少覆盖：
- 从 legacy `memory.json` 生成 structured layout
- 导入前生成 snapshot
- 重复导入时的幂等策略
- provider 切回 legacy 时结构化目录不应损坏现有数据

**Step 2: 实现 snapshot 与 import**

最低要求：
- 导入前保存 `snapshots/memory-v2-<timestamp>/memory.json`
- 从 legacy 记忆数据生成 manifest/day-files/overview
- 导入失败时不破坏 legacy 数据

**Step 3: 跑最小测试**

Run:
```bash
pytest backend/tests/test_memory_structured_migration.py -q
```

Expected:
- 可安全导入 legacy 数据
- 可回滚到 legacy provider

**给 Claude 的任务 Prompt**

```text
你现在执行 Phase 3 Task 3：legacy 导入、快照与回滚辅助。

重点是安全迁移，而不是切主。你必须保证：
- 导入前有 snapshot
- 导入失败不破坏 legacy 数据
- 回滚路径清晰可测
```

---

## Task 4：补齐 `usage / compact / rebuild` API

**目标**
- 让 structured memory 具备正式维护接口

**Files:**
- Modify: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/gateway/routers/memory.py`
- Modify: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/gateway/schemas/__init__.py`
- Modify: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/memory/core.py`
- Modify: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/memory/runtime.py`
- Test: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/tests/test_memory_structured_router.py`
- Test: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/tests/test_memory_structured_rebuild.py`

**Step 1: 先写失败测试**

至少覆盖：
- `GET /api/memory/usage`
- `POST /api/memory/compact`
- `POST /api/memory/rebuild`
- structured provider 不可用时的明确错误

**Step 2: 实现 usage**

最低返回建议：
- 条目数
- 活跃天数
- 最近更新时间
- overview / manifest 状态
- scope / provider 标识

**Step 3: 实现 compact**

第一版只做轻量整理：
- 刷新 manifest
- 刷新 overview
- 清理孤儿索引
- 轻量去重

**Step 4: 实现 rebuild**

最低要求：
- 从 day-files 重建 manifest
- 重建 overview
- 损坏索引场景可恢复

**Step 5: 跑最小测试**

Run:
```bash
pytest backend/tests/test_memory_structured_router.py -q
pytest backend/tests/test_memory_structured_rebuild.py -q
```

Expected:
- 三个接口可用
- 错误时返回清晰状态

**给 Claude 的任务 Prompt**

```text
你现在执行 Phase 3 Task 4：补齐 usage / compact / rebuild API。

你要做的是结构化记忆的最小维护平面，不是完整后台。
第一版 compact 只做轻量整理，不做复杂 LLM 语义压缩。
rebuild 必须是一等能力。
```

---

## Task 5：把 prompt 注入与写回链路切到 provider 边界

**目标**
- 让注入与写回不再只认 `memory.json`

**Files:**
- Modify: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/lead_agent/prompt.py`
- Modify: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/middlewares/memory_middleware.py`
- Modify: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/memory/queue.py`
- Modify: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/memory/updater.py`
- Test: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/tests/test_memory_structured_integration.py`

**Step 1: 先写失败测试**

至少覆盖：
- provider 切到 `structured-fs` 时，prompt 仍能读到长期记忆
- 普通会话会写入 structured memory
- `memory_write=false` 时不会写 structured memory
- `memory_read=false` 时不会注入 structured memory

**Step 2: 让 prompt 走 provider 边界**

目标不是重写 prompt，而是让 `_get_memory_context` 一类入口转向新的 Memory Core。

**Step 3: 让 after_agent 写回走 provider 边界**

要求：
- 仍保留上传过滤
- 仍保留 debounce / queue 逻辑（若其仍在）
- 最终写入目标可由 provider 决定

**Step 4: 跑最小测试**

Run:
```bash
pytest backend/tests/test_memory_structured_integration.py -q
pytest backend/tests/test_memory_upload_filtering.py -q
```

Expected:
- 结构化主链路可用
- 上传过滤未回退
- 契约语义仍成立

**给 Claude 的任务 Prompt**

```text
你现在执行 Phase 3 Task 5：把 prompt 注入与写回链路切到 provider 边界。

你的目标不是推翻现有链路，而是让现有 prompt/middleware/queue/updater 最终通过 Memory Core 去读写。
必须保留：
- 上传过滤
- memory_read / memory_write 契约
- 临时会话保护
```

---

## Task 6：切换策略、回滚验证与文档回写

**目标**
- 锁定 structured provider 的切换方式与回滚方式，并完成最小演练

**Files:**
- Modify: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/config/memory_config.py`
- Modify: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/memory/registry.py`
- Optional Update: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-3-structured-memory.md`
- Optional Create: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-3-execution-report.md`

**Step 1: 确定切换策略**

必须明确：
- 默认 provider 什么时候切到 `structured-fs`
- 如何切回 `legacy-v2`
- 切换失败时如何回滚

**Step 2: 做最小演练**

建议场景：
- 普通工作会话
- 临时只读会话
- 从 structured 切回 legacy

**Step 3: 跑阶段相关测试**

Run:
```bash
pytest backend/tests/test_memory_structured_paths.py -q
pytest backend/tests/test_memory_structured_provider.py -q
pytest backend/tests/test_memory_structured_migration.py -q
pytest backend/tests/test_memory_structured_router.py -q
pytest backend/tests/test_memory_structured_rebuild.py -q
pytest backend/tests/test_memory_structured_integration.py -q
pytest backend/tests/test_memory_upload_filtering.py -q
```

Expected:
- Phase 3 相关测试全部通过
- 回滚路径有证据

**Step 4: 文档回写**

最终必须输出：
- 实际切换方式
- 实际 structured 布局
- 哪些验收点满足
- 哪些风险仍留待 `Phase 4`

**给 Claude 的任务 Prompt**

```text
你现在执行 Phase 3 Task 6：切换策略、回滚验证与文档回写。

你必须明确说明：
- 默认 provider 是否已切主
- 如何回滚到 legacy-v2
- 哪些测试跑过
- 哪些内容刻意未做

如果你没有实际做回滚演练，就不能宣称回滚已完成。
```

---

## 推荐执行顺序

严格按以下顺序推进：

1. `Task 0` 前置检查
2. `Task 1` 路径与模型
3. `Task 2` StructuredFsRuntime 基础读写
4. `Task 3` legacy 导入与回滚辅助
5. `Task 4` usage / compact / rebuild API
6. `Task 5` prompt + middleware + provider 接线
7. `Task 6` 切换、回滚演练、文档回写

不要跳步，不要把 4/5/6 先做完再回头补 1/2/3。

---

## 完成判定（DoD）

只有以下条件都满足，才能宣称 `Phase 3` 完成：

- 前置阶段真实落地
- structured layout 已可初始化、读写、恢复
- legacy 导入与 snapshot 可用
- `usage / compact / rebuild` 已可调用
- prompt 注入与 after_agent 写回已可走 provider 边界
- `memory_read / memory_write` 契约在新 provider 上仍成立
- 回滚路径可演练
- 测试通过，且有执行总结

---

## 给下一位 Agent 的总启动 Prompt

```text
你现在要执行 Nion-Agent 的 `Phase 3 结构化记忆实施计划`。

实施计划文件：
/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-3-structured-memory-execution-plan.md

阶段计划文件：
/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-3-structured-memory.md

项目根目录：
/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent

执行规则：
1. 先完整阅读实施计划与阶段计划
2. 从 Task 0 开始，顺序执行
3. 如果前置不满足，停止并输出 blocker report
4. 每完成一个 Task，都要输出：
   - 修改了哪些文件
   - 跑了哪些测试
   - 当前是否存在阻塞
5. 不要跨阶段实现 Soul / Heartbeat / Evolution
6. 最后必须补一份执行总结
```
