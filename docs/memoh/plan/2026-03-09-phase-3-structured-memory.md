# Phase 3：结构化记忆存储与维护能力

> **给执行 Agent：** 这是一份可直接执行的阶段计划文档，但你**不能跳过上下文**直接开发。请先完整阅读本文的 `Context Pack`，明确 `Phase 1` 与 `Phase 2` 是否已经真正落地到代码，再决定是否继续执行本阶段。
>
> **阶段目标一句话版：** 在 `MemoryPolicy + MemoryProvider + MemoryRuntime + MemoryRegistry` 最小骨架已经具备的前提下，引入适合桌面单用户系统的 `Structured FS Memory` 形态，把长期记忆从单体 `memory.json` 逐步升级为 `overview + manifest + day-files` 的结构化文件布局，并补上 `usage / compact / rebuild` 这类维护能力，但仍然保留安全回滚路径，不把系统一次做成重型自治平台。

- 阶段编号：`Phase 3`
- 优先级：`P0`
- 前置阶段：`Phase 1：运行时契约对齐与临时会话记忆保护`、`Phase 2：Memory Core 骨架化`
- 后续阶段：`Phase 4：Soul Core 身份与长期陪伴层`
- 是否允许独立实施：`不允许`（如果 Phase 1 / Phase 2 未真实落地，本阶段必须先停止）
- 风险等级：`中高`
- 预估改动范围：`中到大`

---

## 1. 阶段定位

`Phase 1` 解决的是“线程运行时契约与记忆读写语义漂移”的问题；`Phase 2` 解决的是“记忆系统没有稳定抽象边界”的问题；`Phase 3` 解决的是“即使已经有了骨架，底层存储仍然停留在单体 `memory.json`，无法支撑维护、回滚、演进和桌面可见性”的问题。

这意味着本阶段不是在讨论“记忆该不该存在”，也不是在讨论“灵魂、心跳、进化先做哪个”，而是在完成一个更基础的动作：

> 让长期记忆从“单文件黑箱”升级为“可读、可审计、可重建、可维护”的本地结构化资产。

当前 Nion 已经具备：

- LangGraph 主智能体与子智能体协作能力
- V2 记忆写回链路：`MemoryMiddleware -> MemoryUpdateQueue -> MemoryUpdater -> memory.json`
- V2 注入链路：`prompt.py` 从长期记忆构造上下文注入主智能体
- 计划中的 `Memory Core` 骨架方向

但当前 Nion 还不具备：

- 结构化长期记忆目录
- 记忆清单/索引（manifest）
- 面向维护的 `usage / compact / rebuild` 操作
- 从“当前活跃记忆”到“可编辑可审计本地文件”的映射
- 为后续 `Soul / Heartbeat / Evolution` 提供稳定的底层记忆资产形态

因此本阶段的关键词不是“更聪明”，而是：

- **可见**：用户和开发者能知道长期记忆到底存了什么
- **可管**：系统能统计、压缩、重建，而不是只能继续往 `memory.json` 堆
- **可回滚**：升级失败时可以退回 legacy provider
- **可扩展**：后续的 Soul / Heartbeat / Evolution 都建立在结构化记忆上，而不是继续绑死在 V2 单体链路上

---

## 2. Context Pack

### 2.1 必读文档

执行前必须阅读以下文档，并在开始编码前输出 8-12 句话总结你理解到的关键事实：

1. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-1-runtime-contract.md`
   - 作用：确认 `session_mode / memory_read / memory_write` 的语义已经被锁定
   - 读完后你应该知道：本阶段不能重新解释临时会话与长期记忆的边界

2. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-2-memory-core.md`
   - 作用：确认 Memory Core 的职责切分与上层依赖方向
   - 读完后你应该知道：本阶段必须建立在 `Policy / Provider / Runtime / Registry` 骨架之上，而不是重新绕回直接调用 V2 细节

3. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/plans/2026-03-09-nion-memoh-research-architecture.md`
   - 作用：确认整体升级路径、借鉴边界与“单用户桌面端、轻依赖、本地优先”的总原则
   - 读完后你应该知道：为什么我们只借鉴 Memoh 的结构与机制，不借它偏多 Bot / 管理平面那一套形态

4. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/plan/memory/nion-memory-as-is-source-study.md`
   - 作用：确认当前 Nion 真实记忆链路、已知缺口与源码证据
   - 读完后你应该知道：当前 `memory.json` 仍然是事实源之一，队列覆盖、API 能力不足等问题都是真实存在的

5. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/plan/memory/memoh-memory-source-study.md`
   - 作用：确认 Memoh 的 `Provider / Registry / storefs / handler / rebuild` 真实落点
   - 读完后你应该知道：本阶段重点借鉴的是 `manifest + overview + day-file + rebuild` 这套结构，而不是照搬其多 provider 管理平面

6. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/plan/memory/nion-memory-v3-one-shot-refactor-blueprint.md`
   - 作用：确认长期目标形态与后续切换/回滚证据
   - 读完后你应该知道：本阶段是朝 V3 迈进的一大步，但不是一次性把所有高级能力全部做完

### 2.2 必读代码

执行前必须先阅读以下代码，并确认哪些文件已经存在、哪些只是阶段计划里的目标文件：

1. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/middlewares/memory_middleware.py`
   - 你需要确认聊天后写回入口仍然在哪里

2. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/memory/queue.py`
   - 你需要确认当前 debounce 队列和写回调度仍然有哪些遗留限制

3. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/memory/updater.py`
   - 你需要确认 V2 的持久化逻辑集中在哪里，以及哪些逻辑应该迁移到 runtime/provider 之下

4. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/lead_agent/prompt.py`
   - 你需要确认长期记忆注入仍然在哪里发生

5. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/gateway/routers/memory.py`
   - 你需要确认当前 memory API 仍然偏只读/状态型，缺少维护接口

6. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/config/paths.py`
   - 你需要确认现有路径系统如何组织 `memory.json` 与 agent 目录

7. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/config/memory_config.py`
   - 你需要确认当前 memory config 已经混入了哪些检索/演化字段，不要继续无节制堆字段

8. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/tests/test_memory_upload_filtering.py`
   - 你需要确认现有记忆测试风格与上传过滤边界

9. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/memory/core.py`
10. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/memory/runtime.py`
11. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/memory/registry.py`
12. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/memory/policy.py`
   - 这四个文件是 `Phase 2` 预期落地后的核心入口
   - **如果这些文件不存在，或者其职责与 `Phase 2` 文档严重不一致，你必须先停止本阶段实施，转而先完成/修复 Phase 2**

### 2.3 已知事实（禁止再猜）

以下事实已经由仓库与研究文档确认，执行 Agent 不要重复猜测：

- 当前真实写回链路仍然是 `MemoryMiddleware -> MemoryUpdateQueue -> MemoryUpdater -> memory.json`
- 当前真实注入链路仍然从长期记忆构造上下文并进入主 prompt
- 当前 `memory.json` / `agents/{agent}/memory.json` 仍是可工作的 legacy 数据形态
- 当前 memory router 缺少 `usage / compact / rebuild` 这类正式维护能力
- 当前 `Paths` 只正式暴露了 `memory.json` 与 agent memory 文件路径，没有结构化长期记忆目录辅助方法
- 当前 `MemoryConfig` 已经较重，本阶段不应继续把 provider、layout、evolution、retrieval 混成一团
- Memoh 的 `storefs` 结构（`manifest + overview + day-file + rebuild`）适合桌面端本地文件系统
- Memoh 的 provider CRUD / registry 生命周期存在断裂，这一点不应直接照搬
- 本升级线的产品原则已经固定：`单用户`、`桌面端`、`本地优先`、`SQLite + 内嵌向量`、`文件系统优先`、`低依赖`
- 本阶段不是 Soul、Heartbeat、Evolution 阶段，不得偷跑这些高级能力

---

## 3. 当前系统状态（As-Is Context）

### 3.1 当前长期记忆仍以单体文件为中心

从当前源码与研究文档看，Nion 的长期记忆仍以：

- 全局 `memory.json`
- 自定义 agent 级 `agents/{agent_name}/memory.json`

作为主要持久化落点。

这意味着系统虽然已经有“长期记忆”的概念，但它仍然缺少：

- 面向目录结构的长期管理能力
- 基于 `day-file` 的时间分桶
- 可重建的索引文件
- 可读的概览文件

### 3.2 当前 Memory API 仍然不具备维护平面

`backend/src/gateway/routers/memory.py` 当前主要承担的是“查看当前记忆状态或基础信息”的职责，缺少：

- `usage`：统计当前存量、规模、分布、活跃度
- `compact`：整理/压缩/清理结构化存储
- `rebuild`：从 day-files 重建 manifest 与 overview
- provider/runtime 状态暴露

这会导致后续一旦切入结构化存储，没有官方维护入口，很快又会退化成“文件堆在那里，但系统不会治理”。

### 3.3 当前配置层还没有正式表达结构化存储语义

当前 `MemoryConfig` 中已经存在很多字段：

- 存储路径
- embedding/provider
- vector/BM25 权重
- injection 配置
- evolution/compression 相关字段

但它并没有以“provider + runtime + storage layout”的方式组织。继续在这个对象上随手加字段，只会让 Phase 3 变成另一个更大的配置黑箱。

### 3.4 当前仓库并不能假设 Phase 1 / Phase 2 已真实落地

截至当前研究基线，`docs/memoh/plan/` 下已经有 `Phase 1` 与 `Phase 2` 文档，但代码仓库未必已经完全落地这两个阶段。

因此执行本阶段前，必须先做一个现实检查：

- `Phase 1` 的契约修复是否已经真实存在于代码与测试中
- `Phase 2` 的 `Policy / Provider / Runtime / Registry` 是否已经成为上层依赖入口

如果没有，这不是“边做边补”的问题，而是**本阶段前置条件未满足**。

### 3.5 后续阶段已经在等结构化记忆底座

后续 `Soul Core`、`Heartbeat Core`、`Evolution Core` 都需要一个更稳定的长期记忆底座：

- `Soul` 需要长期偏好与身份资产的可读可编辑基础
- `Heartbeat` 需要周期任务可回顾、可沉淀、可压缩的记忆结构
- `Evolution` 需要低频 review 与建议写入的受控落点

如果本阶段不把结构化长期记忆做好，后面所有能力都会继续建立在 V2 单文件之上，成本越来越高。

---

## 4. 本阶段要解决的核心问题

本阶段要解决的是以下五类问题：

1. **长期记忆缺少结构化文件布局**
   - 当前只有 `memory.json`，没有 `overview / manifest / day-files`

2. **长期记忆缺少维护平面**
   - 系统没有 `usage / compact / rebuild` 这类必要维护能力

3. **路径与配置缺少结构化表达**
   - `Paths` 与 `MemoryConfig` 还没有正式承载结构化存储的概念

4. **切换风险不可控**
   - 如果直接让上层完全切离 legacy `memory.json`，一旦实现出错会影响现有长期对话体验

5. **后续高级能力没有可依赖底座**
   - Soul / Heartbeat / Evolution 需要的不是“更多功能点”，而是“稳定的长期资产组织方式”

---

## 5. 本阶段目标

### 5.1 目标一：建立结构化长期记忆目录

引入适合本地文件系统的结构化长期记忆布局，至少包括：

- `overview`：当前长期记忆概览文件
- `manifest`：索引与元数据清单
- `day-files`：按日期分桶的记忆条目文件
- `snapshots`：必要时的 legacy 快照或重建快照目录

### 5.2 目标二：让 Memory Core 能挂接 Structured FS Runtime

在 `Phase 2` 的 `Provider / Runtime / Registry` 骨架基础上，新增可运行的 `StructuredFsRuntime`（命名可微调），并通过 provider 暴露统一能力，而不是把结构化逻辑散落在 router、middleware、prompt 各处。

### 5.3 目标三：补齐最小维护 API

至少提供以下维护能力：

- `usage`
- `compact`
- `rebuild`

必要时可以额外补一个轻量 `status` 暴露，但不要在本阶段扩成完整 provider 管理平面。

### 5.4 目标四：保留可验证的回滚路径

本阶段必须保留 legacy `memory.json` 回退能力，至少要做到：

- 能保留 legacy 快照
- 能切回 legacy provider/runtime
- 出问题时能恢复到 Phase 2 的兼容路径

### 5.5 目标五：为后续 Soul / Heartbeat / Evolution 提供底座，而不是提前实现它们

本阶段做的是“结构化记忆底座”，不是：

- 灵魂系统
- 周期性心跳任务
- 低频反思引擎
- 多智能体协同产品化

这些都在后续阶段再做。

---

## 6. 本阶段明确不做

以下内容本阶段明确不做，执行 Agent 不得越界：

1. **不做 Soul Core**
   - 不在本阶段引入统一 `SOUL.md / IDENTITY.md / USER.md` 运行时解析层

2. **不做 Heartbeat Core**
   - 不在本阶段把 scheduler 升级成周期心跳系统

3. **不做 Evolution Core**
   - 不在本阶段落地低频反思、自动修订或自治演化任务

4. **不做复杂多智能体记忆隔离**
   - 不在本阶段设计“每个子智能体都有独立长期记忆社会”的形态

5. **不做重型外部依赖**
   - 不引入外部数据库、远程对象存储、复杂消息系统

6. **不做完整 Provider 管理 UI / CRUD 平台**
   - 不照搬 Memoh 的 provider 管理平面

7. **不做重型语义压缩**
   - `compact` 的第一版优先做结构整理、索引重写、去孤儿、轻量去重、概览刷新
   - 不要求一上来做 LLM 驱动的智能总结或复杂语义合并

8. **不做长期双写体系**
   - 可以保留 legacy 回滚与快照，但不要把系统长期维持在“结构化存储 + memory.json 永久双写”的高复杂度状态

9. **不要求前端管理页在本阶段完整上线**
   - 可先补 API 与测试，UI 放在后续阶段或作为附加小任务处理

---

## 7. 默认规则与决策闭环

### 7.1 默认存储布局决策

本阶段默认推荐的结构化长期记忆布局如下（可微调，但语义不能漂移）：

```text
{memory_root}/
├── MEMORY.md
├── index/
│   └── manifest.json
├── memory/
│   ├── 2026-03-09.md
│   ├── 2026-03-10.md
│   └── ...
└── snapshots/
    └── memory-v2-<timestamp>/
        └── memory.json
```

说明：

- `MEMORY.md`：当前长期记忆概览，只承载“当前应被人类与系统快速理解的长期上下文”，不是 Soul 文件
- `manifest.json`：结构化索引，记录 memory item 与 day-file 的映射、时间戳、使用情况、状态等元数据
- `memory/YYYY-MM-DD.md`：按日期归档的原子记忆条目文件
- `snapshots/`：用于迁移、重建与回滚

### 7.2 路径决策

推荐在 `backend/src/config/paths.py` 中显式增加结构化记忆路径辅助方法，而不是让业务层到处手拼路径。至少要考虑：

- 全局结构化长期记忆根目录
- agent 级结构化长期记忆根目录
- `manifest` 文件路径
- `overview` 文件路径
- `day-file` 目录路径
- `snapshots` 目录路径

**重要约束：**

- 不要偷偷改变现有 `memory_file` 的语义
- 不要让 `storage_path` 在 legacy 与 structured 两种模式下产生歧义

### 7.3 配置决策

本阶段默认规则如下：

- `storage_path` 继续保留为 legacy `memory.json` 兼容语义，不要强行重载成结构化目录根路径
- 结构化 provider/runtime 的路径配置应单独表达，或挂到 provider 配置之下
- 尽量少新增字段，优先让配置表达清晰而不是“什么都往 `MemoryConfig` 塞”
- 如果 `Phase 2` 已经引入 provider 配置入口，应优先沿用其配置组织方式

### 7.4 Provider 决策

本阶段建议至少存在两个可明确区分的能力形态：

- `legacy-v2`：兼容 `memory.json` 的 runtime/provider，用于回滚与迁移窗口
- `structured-fs`：新引入的结构化文件 runtime/provider

但本阶段**不要求**实现完整 provider 管理面板或 provider CRUD。

### 7.5 读写主路径决策

本阶段的默认原则是：

- 让 `Memory Core` 能支持通过 provider 切到 `structured-fs`
- 允许在受控条件下切换默认主路径
- 保留回滚到 `legacy-v2` 的能力
- 不允许形成“永久双写”依赖

如果你当前环境无法安全切主，至少要做到：

- `structured-fs` 能独立导入/写入/读取/重建
- provider 切换有测试保护
- 回滚路径可演练

### 7.6 manifest 最小字段决策

本阶段的 `manifest` 只保留后续真正需要的最小字段，不做知识图谱或复杂 ontology。建议至少包含：

- `memory_id`
- `scope`（例如 `global` 或 `agent:<name>`）
- `source_thread_id`
- `summary`
- `tags`
- `created_at`
- `updated_at`
- `last_used_at`
- `use_count`
- `day_file`
- `status`（如 `active / archived / deleted`）

如果你想继续加字段，必须先回答：这个字段是 `Phase 3` 必需的吗？如果不是，就先不要加。

### 7.7 compact 决策

本阶段的 `compact` 默认只做轻量、可预测、可回滚的整理动作，例如：

- 重写 `manifest`
- 刷新 `MEMORY.md`
- 清理孤儿记录
- 轻量去重
- 可选地把已删除/归档项从 day-file 中规范化整理

本阶段**不要求**做 LLM 总结式压缩，不要求做自动价值判断。

### 7.8 rebuild 决策

`rebuild` 必须是本阶段的一等能力：

- 可以从 day-files 重建 `manifest`
- 可以从 day-files + manifest 重建 `MEMORY.md`
- 可以在索引损坏时用于恢复结构化存储

如果没有 `rebuild`，那就不算真正完成了结构化文件存储。

---

## 8. 实现方案

### 8.1 工作包 A：定义 Structured FS 存储模型与路径辅助

**目标**
- 正式定义结构化记忆目录、`manifest` 最小 schema、`MEMORY.md` 的职责与 day-file 规则

**建议修改点**
- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/config/paths.py`
- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/config/memory_config.py`
- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/memory/runtime.py` 或结构化 runtime 相关文件

**完成标准**
- 存在明确的 structured memory root 语义
- 不再靠业务层手写路径拼接
- `manifest` 与 `day-file` 的最小模型清晰可测

### 8.2 工作包 B：实现 StructuredFsRuntime / Provider

**目标**
- 在 `Phase 2` 的 Memory Core 骨架之下，新增可运行的结构化文件 runtime/provider

**建议修改点**
- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/memory/core.py` 或 `provider.py`
- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/memory/runtime.py`
- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/memory/registry.py`

**完成标准**
- 结构化 provider 可读写 `overview + manifest + day-files`
- 上层不需要知道结构化文件细节
- `legacy-v2` 兼容路径仍然存在

### 8.3 工作包 C：实现 legacy 导入、快照与回滚保护

**目标**
- 让结构化存储能从现有 `memory.json` 迁移/导入，并保留回滚证据

**建议修改点**
- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/memory/runtime.py`
- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/config/paths.py`
- 必要时新增迁移辅助模块

**完成标准**
- 可从 legacy `memory.json` 导入到结构化目录
- 导入前或切换前能创建快照
- 回滚时能明确切回 legacy provider/runtime

### 8.4 工作包 D：补齐 `usage / compact / rebuild` API

**目标**
- 让结构化记忆不是“只会写文件”，而是“有基本维护平面”

**建议修改点**
- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/gateway/routers/memory.py`
- 相关 schema / types 文件
- provider/runtime 维护能力接口

**最低接口建议**
- `GET /api/memory/usage`
- `POST /api/memory/compact`
- `POST /api/memory/rebuild`

**完成标准**
- 能查询结构化记忆规模、活跃天数、条目数、最近更新时间等基本信息
- 能主动触发 compact 与 rebuild
- 错误信息足够明确，不做静默失败

### 8.5 工作包 E：让注入与写回链路可以走 Structured Provider

**目标**
- 让聊天前注入、聊天后写回开始依赖新的 structured runtime/provider，而不是继续只认 `memory.json`

**建议检查文件**
- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/lead_agent/prompt.py`
- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/middlewares/memory_middleware.py`
- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/memory/queue.py`

**完成标准**
- 在 provider 切换到 `structured-fs` 时，读取与写回能走新路径
- `memory_read / memory_write` 语义仍然由 `Phase 1` 契约控制
- 不因为切到新 provider 就破坏临时会话只读逻辑

### 8.6 工作包 F：补齐测试矩阵与最小回滚演练

**目标**
- 用测试锁住结构化存储、维护 API 与回滚路径

**建议新增测试**
- `backend/tests/test_memory_structured_provider.py`
- `backend/tests/test_memory_structured_router.py`
- `backend/tests/test_memory_structured_rebuild.py`
- 或按项目现有风格命名，但职责要清晰

**最少覆盖场景**
- 结构化 provider 可初始化目录与索引
- 结构化 provider 可写入 day-file 与 manifest
- `MEMORY.md` 能被正确刷新
- `usage` 返回可解释结果
- `compact` 可完成轻量整理
- `rebuild` 可从 day-files 重建 manifest/overview
- `memory_write=false` 时不写入结构化长期记忆
- `memory_read=false` 时不注入结构化长期记忆
- provider 可从 `structured-fs` 回滚到 `legacy-v2`

---

## 9. Agent 实施顺序

建议执行顺序如下，任何一步发现前置不满足都应先停下：

1. 先验证 `Phase 1` 与 `Phase 2` 是否已经真实落地到代码与测试
2. 梳理当前 legacy `memory.json` 与目标 structured layout 的映射关系
3. 在 `Paths` 与配置层定义结构化长期记忆路径/根目录语义
4. 落地 `StructuredFsRuntime` 与对应 provider
5. 实现 legacy 导入、快照与回滚保护
6. 补 `usage / compact / rebuild` API
7. 让注入与写回链路在 provider 层可切到 `structured-fs`
8. 补自动化测试并做一次最小回滚演练
9. 更新阶段文档或执行总结，明确哪些行为已切主、哪些仍保留兼容路径

---

## 10. 验收标准

只有同时满足以下条件，才能认为 `Phase 3` 完成：

1. 代码中已经存在正式的结构化长期记忆目录语义，而不是零散文件拼接
2. 存在可运行的 `structured-fs` runtime/provider
3. 结构化存储至少包含 `MEMORY.md + manifest + day-files`
4. 系统能够通过 API 返回 `usage` 信息
5. 系统能够通过 API 执行 `compact`
6. 系统能够通过 API 执行 `rebuild`
7. 聊天前注入与聊天后写回能在 provider 层切到 `structured-fs`
8. `Phase 1` 的 `memory_read / memory_write` 语义在新 provider 上仍成立
9. 出现问题时能切回 `legacy-v2`
10. 不引入重型外部数据库或与桌面端目标冲突的依赖
11. 没有在本阶段偷跑 Soul / Heartbeat / Evolution
12. 自动化测试至少覆盖结构化读写、维护 API、契约保护、回滚路径四大类

---

## 11. 回滚方案

本阶段的回滚必须是清晰可执行的，而不是一句“切回旧逻辑”：

### 11.1 运行时回滚

- 将默认 provider/runtime 切回 `legacy-v2`
- 暂停 `structured-fs` 作为主路径的使用
- 确保聊天注入与写回恢复到 `Phase 2` 的兼容实现

### 11.2 数据回滚

- 使用 `snapshots/memory-v2-<timestamp>/memory.json` 作为 legacy 恢复基线
- 保留结构化目录，但不作为当前主事实源
- 如有必要，记录本次切换/回滚的时间与原因

### 11.3 API 回滚

- `usage / compact / rebuild` 可以暂时保留，但必须在 provider 不可用时返回清晰错误
- 不允许 router 静默吞掉“structured provider 不可用”的问题

### 11.4 验证回滚

至少完成一次最小验证：

- 切回 `legacy-v2` 后，普通工作会话仍可读取长期记忆
- 临时会话仍不会写入长期记忆
- 现有用户数据不会因本阶段升级而丢失

---

## 12. 本阶段完成后的产品成效

如果 `Phase 3` 完成，Nion 会出现几个非常关键的提升：

1. **长期记忆首次变得可见**
   - 用户与开发者不再只能面对一个 `memory.json` 黑箱

2. **长期记忆首次变得可治理**
   - 系统能统计、整理、重建，而不是一味追加写入

3. **桌面端体验更符合本地优先原则**
   - 记忆文件可见、可备份、可调试、可恢复

4. **后续 Soul / Heartbeat / Evolution 有了可靠底座**
   - 这些高级能力不必再直接绑死在 V2 单文件之上

5. **系统升级风险显著降低**
   - 有 provider 边界、有结构化目录、有回滚路径，后续演进更稳

---

## 13. 下一阶段衔接

本阶段完成后，下一阶段进入：`Phase 4：Soul Core 身份与长期陪伴层`。

`Phase 4` 将建立在本阶段的结构化长期记忆底座之上，重点解决：

- 助手身份、人设、边界、目标的统一表达
- `SOUL.md / IDENTITY.md / USER.md` 等资产如何被运行时解析与注入
- Soul 如何与长期记忆协同，而不是互相覆盖

换句话说：

- `Phase 3` 让长期记忆“有结构”
- `Phase 4` 才让助手“有稳定身份”

这两个阶段不能倒过来做。

---

## 14. 给 Claude 的启动 Prompt

你现在要执行 Nion × Memoh 升级线的 `Phase 3：结构化记忆存储与维护能力`，但你**不能直接开始写代码**。

请先按下面顺序工作：

1. 阅读以下文档：
   - `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-1-runtime-contract.md`
   - `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-2-memory-core.md`
   - `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-3-structured-memory.md`
   - `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/plans/2026-03-09-nion-memoh-research-architecture.md`
   - `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/plan/memory/nion-memory-as-is-source-study.md`
   - `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/plan/memory/memoh-memory-source-study.md`
   - `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/plan/memory/nion-memory-v3-one-shot-refactor-blueprint.md`

2. 阅读以下代码：
   - `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/middlewares/memory_middleware.py`
   - `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/memory/queue.py`
   - `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/memory/updater.py`
   - `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/lead_agent/prompt.py`
   - `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/gateway/routers/memory.py`
   - `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/config/paths.py`
   - `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/config/memory_config.py`
   - `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/memory/core.py`
   - `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/memory/runtime.py`
   - `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/memory/registry.py`
   - `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/memory/policy.py`

3. 首先输出一份“现状与前置条件检查摘要”，至少回答：
   - Phase 1 是否真实落地？
   - Phase 2 是否真实落地？
   - 当前 memory 主路径是什么？
   - 当前 Memory Core 是否已经成为上层依赖入口？
   - 结构化记忆阶段最大的实现风险是什么？

4. 如果你发现 `Phase 1` 或 `Phase 2` 没有真实落地，请停止 Phase 3 开发，并明确指出缺失点；不要擅自把前两个阶段一起混做。

5. 如果前置满足，再给出你准备怎么实现 `StructuredFsRuntime / usage / compact / rebuild / rollback` 的简洁执行计划，然后再进入编码。

你的约束如下：

- 你必须坚持“单用户、桌面端、本地优先、低依赖、文件系统优先”
- 你必须保留 `legacy-v2` 回滚路径
- 你不能在本阶段偷做 Soul / Heartbeat / Evolution
- 你不能把系统改造成重型多 provider 管理平台
- 你应优先做可测试、可回滚、可维护的最小实现

如果你的环境支持技能/工作流编排，请优先采用“先上下文、后实现、最后验证与评审”的流程；如果不支持，也必须手动遵守同样约束。

---

## 15. 给 Claude 的实施 Prompt

请在 `Nion-Agent` 仓库中实现 `Phase 3：结构化记忆存储与维护能力`，实现目标如下：

### 任务目标

在已经存在的 `MemoryPolicy + MemoryProvider + MemoryRuntime + MemoryRegistry` 骨架之上，引入适合桌面单用户场景的 `structured-fs` 长期记忆形态，提供：

- `MEMORY.md + manifest + day-files` 结构化目录
- legacy `memory.json` 导入与回滚快照
- `usage / compact / rebuild` API
- 通过 provider 让注入和写回链路可切到 `structured-fs`
- 保持 `memory_read / memory_write` 契约不被破坏

### 你必须先做的事情

1. 检查 `Phase 1` 与 `Phase 2` 是否已经在代码中真实存在
2. 如果前置不满足，先停止并报告，不要混做多个阶段
3. 如果前置满足，再从测试与结构设计开始，而不是直接写业务逻辑

### 推荐切入文件

- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/memory/core.py`
- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/memory/runtime.py`
- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/memory/registry.py`
- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/middlewares/memory_middleware.py`
- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/lead_agent/prompt.py`
- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/gateway/routers/memory.py`
- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/config/paths.py`
- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/config/memory_config.py`

### 推荐新增测试

- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/tests/test_memory_structured_provider.py`
- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/tests/test_memory_structured_router.py`
- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/tests/test_memory_structured_rebuild.py`

### 实现边界

你应该做：

- 结构化存储目录与最小 schema
- provider/runtime 接线
- legacy 导入、快照、回滚
- `usage / compact / rebuild`
- 契约与回滚测试

你不应该做：

- Soul / Heartbeat / Evolution
- 重型 embedding / hybrid retrieval 重构
- 复杂多智能体独立记忆体系
- 外部数据库或远程依赖
- 永久双写系统
- 完整 provider 管理后台

### 验收要求

你完成后必须明确汇报：

1. 结构化目录实际长什么样
2. 默认 provider 是否已切到 `structured-fs`，如果没有，当前切换方式是什么
3. `usage / compact / rebuild` 分别如何工作
4. legacy 回滚怎么做
5. 哪些内容刻意没有做
6. 你跑了哪些测试，结果如何

### 输出格式要求

先输出：
- 前置检查结果
- 你的实施计划

再执行实现。

实现完成后输出：
- 修改了哪些文件
- 哪些验收点已经满足
- 哪些风险仍然存在
- 下一阶段（Soul Core）现在可以建立在哪些资产之上
