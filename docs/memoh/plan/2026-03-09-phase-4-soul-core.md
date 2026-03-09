# Phase 4：Soul Core 身份与长期陪伴层

> **给执行 Agent：** 这是一份可直接执行的阶段计划文档，但你**不能跳过上下文**直接开发。请先验证 `Phase 3` 是否已经真实落地，再检查当前仓库里 `SOUL.md / USER.md / prompt 注入 / agent 资产管理` 的真实状态，然后再进入实现。
>
> **阶段目标一句话版：** 在结构化长期记忆底座已经具备的前提下，为 Nion 建立一个轻量、可编辑、可注入、可审计的 `Soul Core`，统一管理 `SOUL.md / IDENTITY.md / USER.md` 三类身份资产，让个人助手具备稳定的人设、角色边界和用户画像连续性，但不把“灵魂系统”做成独立自治代理。

- 阶段编号：`Phase 4`
- 优先级：`P0`
- 前置阶段：`Phase 1：运行时契约对齐与临时会话记忆保护`、`Phase 2：Memory Core 骨架化`、`Phase 3：结构化记忆存储与维护能力`
- 后续阶段：`Phase 5：Heartbeat Core 周期任务与助手节律`
- 是否允许独立实施：`不允许`（若 Phase 3 未真实落地，本阶段必须先停止）
- 风险等级：`中`
- 预估改动范围：`中`

---

## 1. 阶段定位

`Phase 3` 解决的是“长期记忆有没有稳定、结构化、可维护的底座”；`Phase 4` 解决的是“助手是否拥有持续稳定的身份表达、用户画像和关系边界”。

这两个阶段不能混淆：

- `Memory Core` 负责长期事实、背景、工作上下文、可回顾资产
- `Soul Core` 负责身份、气质、角色边界、长期陪伴风格、用户偏好解析

当前 Nion 已经有一些和 Soul 相关的零散能力：

- 自定义 agent 目录下支持 `config.yaml + SOUL.md`
- `prompt.py` 已会把 `SOUL.md` 直接拼进系统提示词
- `/api/user-profile` 支持读写 `USER.md`
- 前端设置里已经有 `soul.enabled / seed_from_global / incognito_supported` 等文案和开关

但这些能力还远远不等于 `Soul Core`：

- `SOUL.md` 只有文件与原始注入，没有统一解析层
- `USER.md` 虽然可读写，但当前并没有真实接到主提示词注入链路
- `IDENTITY.md` 目前基本缺席，没有正式文件、路径或解析入口
- 前端的 Soul 相关开关没有后端真实语义支撑
- 还没有“解析 → 摘要 → 注入 → 调试/回看”的完整闭环

因此本阶段要做的不是“给模型加点人格提示词”，而是：

> 把身份资产从零散文件和文案开关，升级为统一、轻量、可控的运行时层。

---

## 2. Context Pack

### 2.1 必读文档

执行前必须阅读以下文档，并在开始编码前输出 8-12 句话总结你理解到的关键事实：

1. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-3-structured-memory.md`
   - 作用：确认 Soul Core 建立在怎样的结构化长期记忆底座之上
   - 读完后你应该知道：Soul 不是 Memory 的替代物，而是建立在其上的身份解释层

2. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/plans/2026-03-09-nion-memoh-research-architecture.md`
   - 作用：确认 `Soul Core` 的目标定义、资产形态与与 Heartbeat/Evolution 的边界
   - 读完后你应该知道：`SOUL.md / IDENTITY.md / USER.md` 的各自职责，以及为什么不应做成独立自治 agent

3. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-2-memory-core.md`
   - 作用：提醒你上层统一接线应该优先依赖核心边界，而不是散落逻辑
   - 读完后你应该知道：Soul Core 应该有清晰的 resolver/runtime 入口，而不是把逻辑继续塞进 prompt.py

4. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/plan/memory/memoh-memory-source-study.md`
   - 作用：复核 Memoh 对 `SOUL / IDENTITY / HEARTBEAT` 的文件化资产启发
   - 读完后你应该知道：可以借鉴文件资产思想，但不能复制其整套生态与隐含复杂度

5. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-4-soul-core.md`
   - 作用：这是当前阶段计划本身，执行前必须逐节核对边界与不做项

### 2.2 必读代码

执行前必须先阅读以下代码，并确认当前 Soul 相关能力的真实状态：

1. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/config/agents_config.py`
   - 你需要确认 `SOUL.md` 当前如何加载，以及默认 agent 是否已经隐式支持 base_dir 级 Soul 文件

2. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/gateway/routers/agents.py`
   - 你需要确认自定义 agent 的 `SOUL.md` CRUD 与 `USER.md` CRUD 当前已经具备哪些能力

3. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/lead_agent/prompt.py`
   - 你需要确认 `SOUL.md` 当前是如何被注入的，以及 `USER.md` 是否真的参与主 prompt

4. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/config/paths.py`
   - 你需要确认当前是否已经存在 `USER.md` 路径，以及 `SOUL.md / IDENTITY.md` 是否缺少正式 path helper

5. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/tools/builtins/setup_agent_tool.py`
   - 你需要确认自定义 agent 初始化流程当前只创建了什么资产

6. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/frontend/src/core/agents/types.ts`
   - 你需要确认前端目前只显式暴露了哪些 Soul 相关字段

7. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/frontend/src/components/workspace/settings/configuration/sections/memory-section.tsx`
   - 你需要确认前端 `soul.enabled / seed_from_global / incognito_supported` 等开关当前是否只是 UI 占位

8. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/memory/core.py`
9. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/memory/runtime.py`
10. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/memory/registry.py`
   - 你需要确认 `Phase 3` 的底座是否已经存在，Soul 是否可以依赖结构化记忆而不是回退到 V2 黑箱

### 2.3 已知事实（禁止再猜）

以下事实已经由当前仓库与研究文档确认：

- 当前自定义 agent 已支持 `SOUL.md` 文件的创建、读取、更新
- 当前 `prompt.py` 已会注入 `SOUL.md`，但方式是**原始文本直拼**，不是统一摘要解析
- 当前 `/api/user-profile` 已支持 `USER.md` 的读写
- 当前仓库中没有证据表明 `USER.md` 已经真实进入主 prompt 注入链路
- 当前仓库中没有正式 `IDENTITY.md` 文件路径、CRUD、注入与解析闭环
- 当前前端已有 Soul 相关文案与开关，但后端并未看到对应稳定语义
- 当前 Soul 相关能力仍然是零散资产，不是正式域模块
- 本阶段必须保持 `单用户`、`桌面端`、`文件系统优先`、`低依赖` 原则
- 本阶段不能偷跑 Heartbeat / Evolution
- 本阶段不能让 Soul Core 变成会自我自治、频繁改写人格的独立代理

---

## 3. 当前系统状态（As-Is Context）

### 3.1 `SOUL.md` 只在自定义 agent 维度上半落地

当前 `backend/src/config/agents_config.py` 与 `backend/src/gateway/routers/agents.py` 已经支持：

- 创建 agent 时写入 `SOUL.md`
- 更新 agent 时覆盖 `SOUL.md`
- 获取 agent 时读取 `SOUL.md`

并且 `prompt.py` 已经会在 prompt 中插入 `<soul>...</soul>` 块。

但这仍然只是“文件 + 直拼注入”，还不是 Soul Core，因为缺少：

- 统一的身份解析规则
- 全局默认助手的 Soul 资产管理
- `IDENTITY.md` 层
- `USER.md` 与 Soul 的组合逻辑
- 注入摘要与可观测性

### 3.2 `USER.md` 当前处于“有 CRUD、无运行时接线”的状态

从 `/api/user-profile` 与 `paths.user_md_file` 看，`USER.md` 已经是一个真实存在的文件资产。

但是从 prompt 注入链路搜索结果看，当前没有明确证据表明：

- `USER.md` 已被读取
- `USER.md` 已被摘要
- `USER.md` 已进入主提示词

这意味着当前产品在“文档/API 层”与“运行时真实行为”之间存在断层。

### 3.3 `IDENTITY.md` 目前基本缺席

研究文档已经明确建议引入 `IDENTITY.md`，用于表达：

- 助手当前是谁
- 当前主要职责是什么
- 工作方式和角色边界是什么

但当前仓库里还没有正式的：

- `IDENTITY.md` 路径
- `IDENTITY.md` 读写接口
- `IDENTITY.md` 注入摘要逻辑
- 与 `SOUL.md / USER.md` 的层次关系

### 3.4 前端已有 Soul 文案，但后端还没有真正 Soul Core

前端设置页已经出现：

- `soulEnabled`
- `soulSeedFromGlobal`
- `soulIncognito`
- `soulHint`

这说明产品意图已经出现了，但当前后端还没有完整支撑：

- `enabled` 是否真的影响注入
- `seed_from_global` 是否真的改变资产分层
- `incognito_supported` 是否真的影响临时会话或隐私策略

换句话说，前端目前更像“未来概念界面”，后端还没形成实际域语义。

### 3.5 当前 prompt 注入方式过于原始

当前 `prompt.py` 的 `get_agent_soul(agent_name)` 会直接把 `SOUL.md` 全文包进 `<soul>` 标签。

这种方式的优点是简单，但问题也很明显：

- 没有分层
- 没有摘要
- 没有 token 控制
- 没有 user/profile 组合逻辑
- 没有调试视图
- 很难和未来 Heartbeat / Evolution 的低频微调衔接

因此 Phase 4 的目标不是“让 soul 继续全文注入”，而是把它升级成“统一的身份解析与注入层”。

---

## 4. 本阶段要解决的核心问题

本阶段要解决以下六类问题：

1. **Soul 资产没有统一边界**
   - `SOUL.md / USER.md / IDENTITY.md` 没有被放到同一运行时模型里

2. **User Profile 与真实注入链路脱节**
   - `USER.md` 现在只是 API 资产，不是实际对话能力

3. **Identity 层缺失**
   - 助手缺少“当前角色与职责”的显式资产层

4. **Prompt 注入过于原始**
   - 当前是文件全文直拼，不适合长期演进与调试

5. **前后端语义漂移**
   - 前端已经有 Soul 设置，但后端缺少稳定实现

6. **后续 Heartbeat / Evolution 缺少身份资产落点**
   - 如果没有 Soul Core，未来“身份校正”“风格稳定性”“长期偏好微调”都无处承载

---

## 5. 本阶段目标

### 5.1 目标一：正式定义 Soul Core 的职责边界

`Soul Core` 在 Nion 中的定义必须固定为：

- **身份/人设/偏好解析层**
- 不是独立自治 agent
- 不直接决策调度、进化或多智能体社会行为

### 5.2 目标二：统一 `SOUL.md / IDENTITY.md / USER.md` 三类资产

至少要把这三类资产纳入统一的读取、解析、摘要和注入流程：

- `SOUL.md`：气质、价值观、表达风格、关系边界
- `IDENTITY.md`：当前角色认知、职责边界、长期工作方式
- `USER.md`：用户偏好、禁忌、长期目标、生活/工作节律

### 5.3 目标三：建立 Soul Resolver / Summary 注入机制

本阶段必须把“文件全文直拼”升级为：

- 资产读取
- 分层解析
- 摘要生成
- 受控注入
- 调试预览

### 5.4 目标四：补齐最小资产管理接口

至少要让以下资产有稳定入口：

- 默认助手的 `SOUL.md`
- 默认助手的 `IDENTITY.md`
- 全局 `USER.md`
- 自定义 agent 的 `SOUL.md` 与默认 Soul 的继承/组合关系

### 5.5 目标五：为 Heartbeat / Evolution 预留低频更新落点，但不在本阶段启用自动改写

换句话说：

- 本阶段可以定义哪些资产未来允许 Heartbeat/Evolution 提建议
- 但本阶段不允许自动大规模改写这些资产

---

## 6. 本阶段明确不做

以下内容本阶段明确不做：

1. **不做 Heartbeat Core**
   - 不引入周期身份检查、每日复盘、自动提醒

2. **不做 Evolution Core**
   - 不做自动人格修订、风格自演化、无人工确认的资产重写

3. **不做独立 Soul Agent**
   - Soul Core 不是一个可以自己对外执行任务的代理

4. **不做高频自动改写**
   - 不允许每轮对话后自动重写 `SOUL.md / IDENTITY.md / USER.md`

5. **不做复杂前端工作台**
   - 本阶段可以补基础接口和必要 UI 接线，但不做庞大的可视化人格管理平台

6. **不做多租户/多用户画像**
   - 默认只有一个用户画像 `USER.md`

7. **不做每个子智能体都拥有完整 Soul 资产体系**
   - 多数子智能体仍然应以任务边界和工作流上下文为主

8. **不新增重型数据库依赖**
   - Soul 资产优先文件系统；必要 metadata 只做轻量缓存，不引入外部依赖

---

## 7. 默认规则与决策闭环

### 7.1 Soul Core 的正式定义

从本阶段开始，必须把 `Soul Core` 定义为：

- 助手身份资产管理与运行时解析层
- 负责读取、解析、摘要、注入 `SOUL / IDENTITY / USER`
- 对上提供统一的“resolved soul summary”
- 对下依赖文件系统与必要的轻量缓存

### 7.2 资产分层决策

推荐的默认分层如下：

1. `base_dir/SOUL.md`
   - 默认主助手的人格基线

2. `base_dir/IDENTITY.md`
   - 默认主助手当前角色、职责、工作方式

3. `base_dir/USER.md`
   - 用户偏好与长期目标

4. `agents/{agent_name}/SOUL.md`
   - 自定义 agent 的专属风格与边界

5. `agents/{agent_name}/IDENTITY.md`（可选）
   - 如果需要，为自定义 agent 提供当前角色说明；但不是第一优先级

### 7.3 解析顺序决策

本阶段建议的默认解析顺序：

- 先解析默认主助手的 `SOUL.md`
- 再解析默认 `IDENTITY.md`
- 再按需要引入 `USER.md` 摘要
- 若当前为自定义 agent，会在上述基础上叠加该 agent 的 `SOUL.md`

重要约束：

- 自定义 agent 的 `SOUL.md` 默认是**补充/覆盖部分风格**，不是完全抹掉全局用户画像
- `USER.md` 不是人格提示词，而是用户偏好与长期关系上下文

### 7.4 注入策略决策

本阶段默认不再推荐“每轮都把原始文件全文灌进 prompt”。应改为：

- 文件读取
- 结构解析 / 段落过滤
- 生成简洁摘要
- 在 prompt 中注入 resolved soul summary

如果为了兼容需要暂时保留 raw soul fallback，也必须满足：

- 有 token 限制
- 有明确 fallback 条件
- 不是长期默认方案

### 7.5 与运行时契约的关系

本阶段默认规则：

- `SOUL.md / IDENTITY.md` 属于助手自身身份层，默认可在普通会话中注入
- `USER.md` 属于用户长期画像层，默认应受 `memory_read` 语义约束
- 当 `memory_read=false` 时，`USER.md` 摘要默认不注入
- 临时/无痕会话可以保留助手身份一致性，但不应默认读取完整用户长期画像

### 7.6 写入策略决策

本阶段允许修改 Soul 资产的方式只包括：

- 人工编辑文件
- 显式 API 更新
- 显式 setup / 初始化流程

本阶段不允许：

- 对话后自动重写
- 高频自发更新
- 未经确认的大规模替换

### 7.7 Debug / Preview 决策

必须为 Soul Core 提供最小可观测性。至少要能回答：

- 当前对话最终解析出的 soul summary 是什么
- 它来自哪些文件
- 哪些文件未命中或被禁用

否则后续排查“为什么这个助手像变了个人”会非常困难。

---

## 8. 实现方案

### 8.1 工作包 A：补齐 Soul 资产路径与文件模型

**目标**
- 正式引入 `SOUL.md / IDENTITY.md / USER.md` 的路径辅助与文件语义

**建议修改点**
- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/config/paths.py`
- 必要时新增 Soul 相关类型文件

**完成标准**
- 默认助手与自定义 agent 的 Soul 资产路径清晰
- `IDENTITY.md` 不再是“概念存在、代码缺席”
- 文件读写不需要业务层自行拼路径

### 8.2 工作包 B：实现 Soul Resolver / Summary Runtime

**目标**
- 新增统一的 Soul 解析与摘要入口，而不是继续把逻辑堆在 `prompt.py`

**建议新增位置**
- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/soul/` 下的 `resolver.py`、`runtime.py`、`models.py`（命名可微调）
- 或者与现有结构兼容的轻量实现，但职责必须清晰

**完成标准**
- 存在统一入口，能够读取 `SOUL / IDENTITY / USER`
- 能输出受控的 resolved soul summary
- 能告诉上层 summary 来源

### 8.3 工作包 C：补齐默认助手资产管理接口

**目标**
- 不再只有自定义 agent 能拥有 `SOUL.md`
- 默认主助手也要有统一资产入口

**建议修改点**
- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/gateway/routers/agents.py`
- 或新增 `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/gateway/routers/soul.py`

**最低能力建议**
- 读取默认 `SOUL.md`
- 更新默认 `SOUL.md`
- 读取默认 `IDENTITY.md`
- 更新默认 `IDENTITY.md`
- 读取 resolved soul summary（用于调试/预览）
- 继续保留 `/api/user-profile`

**完成标准**
- 默认助手不再是“只有 prompt fallback、没有正式资产接口”的状态
- `USER.md` 保持兼容

### 8.4 工作包 D：把 `USER.md` 接入真实运行时

**目标**
- 修复“用户画像有 CRUD 但不参与对话”的断层

**建议修改点**
- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/lead_agent/prompt.py`
- 新增 Soul Resolver 的集成点

**完成标准**
- `USER.md` 在满足策略条件时能进入 resolved soul summary
- `memory_read=false` 时默认不注入用户长期画像
- 临时会话不会把用户画像当作默认无限读取资产

### 8.5 工作包 E：替换原始 `SOUL.md` 全文注入为 Soul Summary 注入

**目标**
- 把当前 `<soul>原文件全文</soul>` 的做法升级为“摘要化、可控、可调试”的注入方式

**建议检查文件**
- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/lead_agent/prompt.py`
- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/config/agents_config.py`

**完成标准**
- prompt 注入不再强依赖原始文件全文
- soul summary 有 token 边界与来源说明
- 自定义 agent 的 Soul 仍然生效

### 8.6 工作包 F：补测试与最小验证

**目标**
- 用测试锁住 Soul Core 的资产解析、注入和边界语义

**建议新增测试**
- `backend/tests/test_soul_resolver.py`
- `backend/tests/test_soul_router.py`
- `backend/tests/test_prompt_soul_injection.py`

**最少覆盖场景**
- 默认 `SOUL.md` 可读取与更新
- 默认 `IDENTITY.md` 可读取与更新
- `USER.md` 在允许时参与 summary
- `memory_read=false` 时 `USER.md` 不注入
- 自定义 agent 的 `SOUL.md` 会覆盖/补充默认 Soul
- Soul summary 会被 prompt 正常注入
- 缺文件时行为清晰、不会静默崩溃

---

## 9. Agent 实施顺序

建议执行顺序如下：

1. 先验证 `Phase 3` 是否已经真实落地
2. 梳理当前 `SOUL.md / USER.md / prompt 注入 / 前端占位开关` 的真实状态
3. 在路径层补齐 `SOUL / IDENTITY / USER` 文件语义
4. 落地 `Soul Resolver / Summary Runtime`
5. 为默认助手补资产管理接口
6. 把 `USER.md` 接进真实运行时链路
7. 把原始 Soul 全文注入升级成 summary 注入
8. 补测试，并验证普通会话/临时会话/自定义 agent 三类场景
9. 回写执行总结，明确哪些 Soul 能力已落地、哪些仍刻意未做

---

## 10. 验收标准

只有同时满足以下条件，才能认为 `Phase 4` 完成：

1. 存在正式的 `Soul Core` 解析入口，而不是只有 `prompt.py` 零散逻辑
2. 默认助手拥有正式的 `SOUL.md` 与 `IDENTITY.md` 资产管理路径
3. `USER.md` 不再只是 CRUD 资产，而是能真实影响运行时 summary
4. 自定义 agent 的 `SOUL.md` 仍然兼容且生效
5. Soul 注入从“原始全文直拼”升级为“解析后的 summary 注入”
6. `memory_read=false` 时，`USER.md` 默认不会被注入
7. 资产缺失、关闭、禁用时有清晰回退行为
8. 没有引入自动人格改写或独立 Soul agent
9. 自动化测试覆盖资产解析、接口、prompt 注入和边界策略
10. 前端现有 Soul 文案与后端真实语义至少不再完全漂移

---

## 11. 回滚方案

### 11.1 运行时回滚

- 关闭 Soul summary 注入
- 回退到当前兼容路径：仅保留已有 `SOUL.md` 原始注入逻辑（如确有需要）
- 暂时禁用 `IDENTITY.md` 与 `USER.md` 的运行时参与

### 11.2 数据回滚

- 所有资产文件都保留，不删除 `SOUL.md / IDENTITY.md / USER.md`
- 若新接口写坏内容，可恢复到文件级备份或 Git 历史

### 11.3 接口回滚

- 新增的 Soul 资产接口可以降级为只读或暂时关闭
- `/api/user-profile` 继续保留，避免破坏已有前端/外部调用

### 11.4 验证回滚

至少验证：

- 普通会话仍能正常工作
- 自定义 agent 仍可沿用旧 `SOUL.md`
- 临时会话不会错误读取用户画像

---

## 12. 本阶段完成后的产品成效

如果 `Phase 4` 完成，Nion 会获得以下几项关键升级：

1. **助手首次拥有稳定、可解释的身份层**
   - 不再只是零散 prompt 片段

2. **用户画像真正进入运行时，而不是停留在文件/API 层**
   - `USER.md` 终于从“可编辑文档”变成“可用能力”

3. **自定义 agent 与默认主助手的身份模型得到统一**
   - 不再是一个有 Soul、一个没有正式入口

4. **后续 Heartbeat / Evolution 有了身份资产落点**
   - 未来的身份校正和低频建议终于有地方写、有地方审计

5. **临时/无痕场景的边界更清晰**
   - 助手身份可保持一致，用户长期画像可受控关闭

---

## 13. 下一阶段衔接

本阶段完成后，下一阶段进入：`Phase 5：Heartbeat Core 周期任务与助手节律`。

`Phase 5` 将建立在两个前提之上：

- `Phase 3` 提供了结构化长期记忆底座
- `Phase 4` 提供了 Soul / Identity / User 资产层

这样 Heartbeat 才能做真正有意义的低频动作：

- 日报/周报式回顾
- 记忆维护
- 身份校正建议
- 长期目标检查

如果没有 Soul Core，Heartbeat 只能做机械 scheduler；如果没有结构化记忆，Heartbeat 也很难留下稳定痕迹。

---

## 14. 给 Claude 的启动 Prompt

你现在要执行 Nion × Memoh 升级线的 `Phase 4：Soul Core 身份与长期陪伴层`，但你**不能直接开始写代码**。

请先按下面顺序工作：

1. 阅读以下文档：
   - `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-3-structured-memory.md`
   - `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-4-soul-core.md`
   - `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/plans/2026-03-09-nion-memoh-research-architecture.md`
   - `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-2-memory-core.md`
   - `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/plan/memory/memoh-memory-source-study.md`

2. 阅读以下代码：
   - `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/config/agents_config.py`
   - `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/gateway/routers/agents.py`
   - `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/lead_agent/prompt.py`
   - `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/config/paths.py`
   - `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/tools/builtins/setup_agent_tool.py`
   - `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/frontend/src/components/workspace/settings/configuration/sections/memory-section.tsx`

3. 先输出“Soul Core 前置检查摘要”，至少回答：
   - Phase 3 是否已真实落地？
   - 当前 `SOUL.md` 如何被注入？
   - `USER.md` 是否真的参与运行时？
   - `IDENTITY.md` 现在是否存在正式路径和接口？
   - 前端 Soul 设置与后端语义有哪些漂移？

4. 如果 Phase 3 未落地，请停止本阶段实施，明确缺口；不要把结构化记忆和 Soul Core 混在一起做。

5. 如果前置满足，再给出你准备如何实现 `Soul Resolver / default soul assets / identity assets / user profile runtime injection / summary preview` 的执行计划，然后再开始编码。

你的约束如下：

- 你必须把 Soul Core 定义为“身份资产解析层”，不是自治 agent
- 你必须优先使用文件系统，保持桌面端可读可编辑
- 你必须让 `USER.md` 的运行时语义与 `memory_read` 协调一致
- 你不能在本阶段加入自动人格进化或周期任务
- 你不能让 prompt 注入继续长期依赖原始全文拼接

如果你的环境支持技能或工作流编排，请遵守“先上下文、后实现、最后验证”的流程；如果不支持，也必须手动遵守同样约束。

---

## 15. 给 Claude 的实施 Prompt

请在 `Nion-Agent` 仓库中实现 `Phase 4：Soul Core 身份与长期陪伴层`，实现目标如下：

### 任务目标

建立一个轻量的 `Soul Core`，统一管理和注入：

- 默认助手的 `SOUL.md`
- 默认助手的 `IDENTITY.md`
- 全局 `USER.md`
- 自定义 agent 的 `SOUL.md`

并提供：

- Soul Resolver / summary 注入
- 默认助手资产管理接口
- `USER.md` 的真实运行时接线
- 最小调试/预览能力

### 你必须先做的事情

1. 检查 `Phase 3` 是否已经落地
2. 检查当前 `SOUL.md / USER.md / prompt 注入 / 前端 Soul 设置` 的真实状态
3. 如果前置不满足，停止并汇报，不要擅自跨阶段混做
4. 如果前置满足，再先设计资产层和测试，再写实现

### 推荐切入文件

- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/config/paths.py`
- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/config/agents_config.py`
- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/lead_agent/prompt.py`
- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/gateway/routers/agents.py`
- 新增 `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/soul/` 相关文件（命名可微调）

### 推荐新增测试

- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/tests/test_soul_resolver.py`
- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/tests/test_soul_router.py`
- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/tests/test_prompt_soul_injection.py`

### 你应该做的事情

- 补齐 `SOUL / IDENTITY / USER` 的路径与资产模型
- 实现 Soul Resolver / summary runtime
- 给默认助手补 `SOUL.md / IDENTITY.md` 资产接口
- 让 `USER.md` 真正参与运行时，但受策略控制
- 用 summary 注入替代长期默认的全文拼接
- 补齐测试与错误处理

### 你不应该做的事情

- 不做 Heartbeat / Evolution
- 不做自动人格改写
- 不做独立 Soul Agent
- 不做复杂 UI 平台
- 不做多用户画像体系
- 不引入重型外部依赖

### 验收要求

你完成后必须明确汇报：

1. `SOUL.md / IDENTITY.md / USER.md` 各自现在怎么存、怎么读、怎么注入
2. `USER.md` 在什么条件下会进入运行时，什么条件下不会
3. 自定义 agent 的 `SOUL.md` 和默认助手 Soul 是如何组合的
4. 现在 prompt 里注入的是 summary 还是 raw file，为什么
5. 哪些内容刻意没有做
6. 你跑了哪些测试，结果如何

### 输出格式要求

先输出：
- 前置检查结果
- 你的实施计划

再执行实现。

实现完成后输出：
- 修改了哪些文件
- 哪些验收点已满足
- 哪些风险仍然存在
- 下一阶段 Heartbeat Core 可以直接复用哪些资产与接口
