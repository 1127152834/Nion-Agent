# Phase 6：Evolution Core 低频反思与建议层

> **给执行 Agent：** 这是一份可直接执行的阶段计划文档，但你**不能跳过上下文**直接开发。请先验证 `Phase 5` 是否已经真实落地，再检查当前仓库里的 `evolution_enabled`、前端演化开关与 `reflection` 模块到底是什么，然后再进入实现。
>
> **阶段目标一句话版：** 在 Heartbeat 已经形成稳定节律和日志之后，为 Nion 建立一个低频、受控、可审计、可回滚的 `Evolution Core`，它只负责生成对 `Memory Core`、`Soul Core` 和任务型 agent 组织方式的建议，不直接演变成一个高频自动改写的自治引擎。

- 阶段编号：`Phase 6`
- 优先级：`P1`
- 前置阶段：`Phase 5：Heartbeat Core 周期任务与助手节律`
- 后续阶段：`Phase 7：多智能体增强与委派产品化`
- 是否允许独立实施：`不允许`（若 Phase 5 未真实落地，本阶段必须先停止）
- 风险等级：`中`
- 预估改动范围：`中`

---

## 1. 阶段定位

如果说：

- `Phase 3` 解决了长期记忆底座
- `Phase 4` 解决了身份与用户画像
- `Phase 5` 解决了周期行为与日志节律

那么 `Phase 6` 解决的是：

> 系统如何在低频、受控、可审计的条件下，对自身长期状态提出改进建议。

这里最重要的前提是：

- `Evolution Core` **不是**自治进化引擎
- `Evolution Core` **不是**每轮对话后的即时自我改写器
- `Evolution Core` **不是**黑箱人格重写器

在 Nion 里，它应被定义为：

- 一个建立在 `Heartbeat + Memory + Soul` 之上的**监督式反思器**
- 一个低频运行、默认只产出建议的层
- 一个把“长期使用后应该怎么修正系统”变成结构化结论的模块

因此本阶段要做的不是“让系统自己变聪明”，而是：

- 让系统具备**稳定、可回看、可人工采纳**的长期建议能力
- 避免把产品做成不可控的自治黑箱

---

## 2. Context Pack

### 2.1 必读文档

执行前必须阅读以下文档，并在开始编码前输出 8-12 句话总结你理解到的关键事实：

1. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-5-heartbeat-core.md`
   - 作用：确认 Evolution 的稳定输入源来自哪里
   - 读完后你应该知道：Evolution 应该建立在 Heartbeat 日志与结果之上，而不是凭空运行

2. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-4-soul-core.md`
   - 作用：确认 Evolution 对 Soul 的作用边界
   - 读完后你应该知道：对 `SOUL / IDENTITY / USER` 只能提建议，不应高频自动重写

3. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-3-structured-memory.md`
   - 作用：确认 Evolution 对 Memory 的作用边界
   - 读完后你应该知道：Evolution 可以建议压缩、归档、补全，但不重写 Memory Core 的底层结构

4. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/plans/2026-03-09-nion-memoh-research-architecture.md`
   - 作用：确认 Evolution Core 的正确定义与安全边界
   - 读完后你应该知道：Evolution 是低频建议层，不是自治进化引擎

5. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-6-evolution-core.md`
   - 作用：这是当前阶段计划本身，必须逐节核对边界与不做项

### 2.2 必读代码

执行前必须先阅读以下代码，并明确哪些是真的、哪些只是占位：

1. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/config/memory_config.py`
   - 你需要确认 `evolution_enabled / evolution_interval_hours` 当前只是配置字段，还是已有真实执行链路

2. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/reflection/__init__.py`
3. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/reflection/resolvers.py`
   - 你需要确认当前 `reflection` 模块只是类/变量解析工具，不是 Evolution 引擎

4. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/scheduler/*`
5. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/heartbeat/*`
   - 你需要确认 Heartbeat 的任务、日志、结果是否已经真实存在，Evolution 将依赖这些输入

6. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/soul/*`
7. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/memory/*`
   - 你需要确认 Soul Core 和 Memory Core 已经有稳定边界，而不是仍在规划阶段

8. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/frontend/src/components/workspace/settings/configuration/sections/memory-section.tsx`
   - 你需要确认前端演化开关当前是否只是 UI 占位

### 2.3 已知事实（禁止再猜）

以下事实已经由当前仓库与研究文档确认：

- 当前 `memory_config.py` 已出现 `evolution_enabled`、`evolution_interval_hours` 等字段
- 当前前端设置文案也已经出现了 `evolution` 开关
- 当前代码里没有一个真正的 Evolution Core 运行时模块
- `backend/src/reflection` 只是类/变量解析工具，不是反思引擎
- 本阶段必须建立在 Heartbeat 的日志与结果基础之上
- 本阶段默认只产出建议，不直接大规模改写 Memory / Soul / Agent 资产
- 本阶段必须保持可审计、可回滚、可关闭
- 本阶段不能把 Evolution 做成“随时都在后台自我改变”的黑箱机制

---

## 3. 当前系统状态（As-Is Context）

### 3.1 当前存在“演化”配置，但没有演化运行时

从 `backend/src/config/memory_config.py` 与前端 memory settings 看：

- 后端存在 `evolution_enabled / evolution_interval_hours`
- 前端存在 `evolution` 开关文案

但从当前代码入口看，并没有：

- Evolution service
- Evolution scheduler job
- Evolution report store
- Evolution suggestion API
- Evolution 审计与回滚机制

这意味着目前的“演化”更多是配置和概念，而不是实际能力。

### 3.2 当前 `reflection` 模块与 Evolution 无关

`backend/src/reflection` 目前提供的是：

- `resolve_class`
- `resolve_variable`

它用于模块/类解析，不是：

- 任务复盘器
- 身份反思器
- 记忆优化建议器

因此执行 Agent 不能把 `reflection` 误判为已有 Evolution 基座。

### 3.3 当前系统还缺少“建议资产”的正式落点

在没有 Evolution Core 的情况下，系统即使偶尔产生一些“应该改进哪里”的结论，也缺少稳定落点：

- 没有统一建议报告目录
- 没有建议对象分类（memory / soul / agent）
- 没有 pending / accepted / dismissed 这种受控状态
- 没有让用户或后续 agent 消费这些建议的正式入口

### 3.4 当前 Heartbeat 还无法自然过渡到 Evolution

如果 `Phase 5` 只做了定时任务与日志，而没有把结果标准化，Evolution 就会缺少稳定输入。

因此本阶段必须要求：

- Heartbeat 已能产出稳定日志/摘要
- Memory Core 已能提供维护状态
- Soul Core 已能提供稳定 summary 和资产边界

否则 Evolution 无从谈起。

---

## 4. 本阶段要解决的核心问题

本阶段要解决以下六类问题：

1. **当前只有演化开关，没有演化引擎或建议层**
2. **缺少统一的 Evolution 输入、输出和审计结构**
3. **缺少“建议而非自动改写”的产品边界**
4. **缺少针对 Memory / Soul / Agent 的建议分类模型**
5. **缺少建议的回看、采纳、忽略流程**
6. **后续多智能体增强缺少长期策略反馈来源**

---

## 5. 本阶段目标

### 5.1 目标一：正式定义 Evolution Core 的角色

`Evolution Core` 必须被定义为：

- 低频监督式建议层
- 消费 Heartbeat / Memory / Soul / 用户纠错等长期信号
- 输出结构化建议和报告
- 默认不自动改写主系统资产

### 5.2 目标二：建立 Evolution 输入模型

至少纳入以下输入：

- Heartbeat 日志与结果摘要
- Memory usage / compact / rebuild 结果
- Soul summary 与身份检查结果
- 用户纠错、显式反馈、长期偏好变化（若已有）
- 最近任务完成质量与失败样本（若已可得）

### 5.3 目标三：建立 Evolution 输出模型

至少支持以下建议类型：

- `memory_suggestion`
- `soul_suggestion`
- `agent_suggestion`

每条建议至少包含：

- 目标域
- 建议内容
- 证据摘要
- 影响范围
- 置信度/优先级
- 默认动作（仅建议，不自动应用）

### 5.4 目标四：建立审计、回看与采纳状态

至少支持：

- 报告列表
- 建议详情
- 标记忽略/已阅/待处理
- 导出给用户或其他 agent 的执行提示词

### 5.5 目标五：与 Heartbeat 正式联动，但保持可关闭

Evolution 可以由：

- 手动触发
- Heartbeat 低频触发

但必须允许：

- 全局关闭
- 单次手动运行
- 不自动应用建议

---

## 6. 本阶段明确不做

以下内容本阶段明确不做：

1. **不做自治进化引擎**
   - 不允许系统在后台持续、自主、高频改写自己

2. **不做自动写回主资产**
   - 不自动重写 `SOUL.md / IDENTITY.md / USER.md`
   - 不自动大规模改写长期记忆

3. **不做复杂评分与强化学习系统**
   - 不做模型训练、奖励系统、黑箱打分器

4. **不做复杂协作市场或 worker 池**
   - Evolution 不是任务市场或多 agent 社会

5. **不做重型 UI 平台**
   - 可提供报告列表/详情，但不做庞大控制台

6. **不继续把配置堆回 `memory_config.py`**
   - 不把所有 Evolution 语义继续塞进 memory config 顶层字段

---

## 7. 默认规则与决策闭环

### 7.1 Evolution 的正式定义

从本阶段开始，Evolution 必须被定义为：

- 基于长期日志与结果的建议生成层
- 输出建议而非直接执行
- 可以作为后续人工决策、辅助 agent 或下一阶段产品化的输入

### 7.2 运行频率决策

Evolution 默认是：

- 低频
- 可手动触发
- 可由 Heartbeat 低频触发
- 不在每次会话后自动运行

### 7.3 输出目录与状态决策

推荐但不强制的文件布局示例：

```text
{base_dir}/evolution/
├── reports/
│   └── 2026-03-09T21-00-00Z.json
├── suggestions/
│   ├── pending/
│   ├── accepted/
│   └── dismissed/
└── settings.json
```

如果你不想用完全独立文件夹，也至少要保证：

- 报告与建议可独立读取
- 建议状态清晰
- 审计与回滚证据完整

### 7.4 建议类型决策

本阶段默认只支持三类建议：

1. `memory_suggestion`
2. `soul_suggestion`
3. `agent_suggestion`

不要在本阶段继续扩展更多类型，除非你能证明它们已经是刚需。

### 7.5 应用策略决策

本阶段默认策略是：

- 生成建议
- 人工或后续明确动作再决定是否应用
- 不自动改写主资产

如果你想实现“应用建议”，也必须满足：

- 有单条建议粒度
- 有审计日志
- 有回滚点
- 默认关闭

### 7.6 配置决策

当前 `memory_config.py` 中已有演化字段，但本阶段不建议继续把 Evolution 所有语义放在 Memory 配置里。

优先方案：

- 新增独立 Evolution 设置模型/文件
- 对已有 `evolution_enabled / evolution_interval_hours` 保持兼容映射
- 逐步把“演化是独立域”的事实从配置层表达出来

### 7.7 与 Heartbeat / Memory / Soul 的关系决策

- Evolution 消费 Heartbeat，不替代 Heartbeat
- Evolution 消费 Memory/Soul 结果，不重写它们的内部实现
- Memory / Soul 的真实修改仍应通过各自领域的正式接口或后续人工确认完成

---

## 8. 实现方案

### 8.1 工作包 A：定义 Evolution 模型、报告与建议存储

**目标**
- 正式建立 Evolution 的输入输出模型与本地存储布局

**建议新增位置**
- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/evolution/models.py`
- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/evolution/store.py`
- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/evolution/service.py`

**完成标准**
- 存在 report 与 suggestion 的正式结构
- 存在 pending / accepted / dismissed 等状态语义
- 不依赖外部数据库

### 8.2 工作包 B：实现 Evolution Service，消费 Heartbeat / Memory / Soul 输入

**目标**
- 让系统能够基于长期信号生成结构化建议

**建议重点**
- 读取 Heartbeat 日志
- 读取 Memory 维护结果
- 读取 Soul summary / identity_check 结果
- 聚合为 report
- 从 report 中抽取可执行建议

**完成标准**
- 至少能稳定生成 `memory_suggestion / soul_suggestion / agent_suggestion`
- 报告中有证据摘要与影响范围

### 8.3 工作包 C：补 Evolution API

**目标**
- 提供手动触发、查看报告、查看建议、变更建议状态的接口

**建议新增接口**
- `POST /api/evolution/run`
- `GET /api/evolution/reports`
- `GET /api/evolution/reports/{report_id}`
- `GET /api/evolution/suggestions`
- `POST /api/evolution/suggestions/{id}/dismiss`
- `POST /api/evolution/suggestions/{id}/accept`（若实现，必须默认关闭自动应用）

**完成标准**
- 至少能手动触发一次 Evolution，并查看报告和建议
- 即使不支持自动应用，也要能完成“建议流转”闭环

### 8.4 工作包 D：与 Heartbeat 低频联动

**目标**
- 让 Evolution 可以在 Heartbeat 节律中被低频触发，而不是自成黑箱

**建议实现**
- Heartbeat 侧提供可选模板或开关，低频触发 Evolution run
- 默认关闭自动应用，只生成报告与建议

**完成标准**
- Heartbeat 能触发 Evolution 运行
- Evolution 运行结果可被日志与报告看到

### 8.5 工作包 E：补最小前端表达与操作

**目标**
- 让用户或开发者至少能看到建议，不要让 Evolution 结果继续沉没在文件里

**建议修改点**
- 在现有设置或工作台中补最小报告/建议入口
- 不做大型 UI 平台

**完成标准**
- 至少可以查看最近一次 Evolution 报告或待处理建议列表

### 8.6 工作包 F：补测试与最低验证

**目标**
- 用测试锁住 Evolution 的低频、受控、非自动改写边界

**建议新增测试**
- `backend/tests/test_evolution_service.py`
- `backend/tests/test_evolution_router.py`
- `backend/tests/test_evolution_heartbeat_integration.py`

**最少覆盖场景**
- 可手动触发 Evolution run
- 可生成 report 与 suggestions
- 建议可标记 dismissed / accepted（如实现）
- 默认不会自动改写 Memory / Soul 资产
- Heartbeat 可低频触发 Evolution
- 全局关闭后不运行

---

## 9. Agent 实施顺序

建议执行顺序如下：

1. 先验证 `Phase 5` 是否已真实落地
2. 梳理当前 `evolution_enabled`、前端演化开关与 `reflection` 模块的真实含义
3. 定义 Evolution report / suggestion 模型与存储布局
4. 实现 Evolution Service，接入 Heartbeat / Memory / Soul 输入
5. 补 Evolution API
6. 接入 Heartbeat 低频触发
7. 补最小前端表达
8. 跑测试并做一次手动演化演练
9. 回写执行总结，明确哪些建议类型已落地、哪些应用动作仍刻意不做

---

## 10. 验收标准

只有同时满足以下条件，才能认为 `Phase 6` 完成：

1. 存在正式 Evolution Core 运行时，而不是只有配置字段
2. Evolution 可基于 Heartbeat / Memory / Soul 输入生成报告
3. Evolution 至少支持三类建议：memory / soul / agent
4. 建议默认不会自动改写主资产
5. 报告与建议可回看、可审计、可区分状态
6. 支持手动触发，且可选由 Heartbeat 低频触发
7. 可以全局关闭
8. 没有把 `reflection` 误用成 Evolution 引擎
9. 没有引入重型自治或黑箱演化逻辑
10. 自动化测试覆盖建议生成、API、联动与“默认不自动应用”边界

---

## 11. 回滚方案

### 11.1 运行时回滚

- 关闭 Evolution 全局开关
- 停止 Heartbeat 触发 Evolution
- 保留 Heartbeat / Memory / Soul 主链路继续运行

### 11.2 数据回滚

- 保留 evolution reports / suggestions 作为历史证据
- 不把这些文件当作必须加载的主状态
- 不删除已有 Memory / Soul 资产

### 11.3 接口回滚

- `/api/evolution/*` 可临时关闭或降级为只读
- 其他阶段接口继续兼容

### 11.4 验证回滚

至少验证：

- 关闭 Evolution 后 Heartbeat 仍正常
- Memory / Soul 不受影响
- 已有报告仍可保留供人工参考

---

## 12. 本阶段完成后的产品成效

如果 `Phase 6` 完成，Nion 会获得以下关键升级：

1. **第一次拥有受控的长期反思能力**
2. **长期使用后的问题不再只能靠人类主观记忆，而是可被结构化建议捕捉**
3. **系统开始形成“建议—审阅—采纳/忽略”的闭环，而不是黑箱自改**
4. **后续多智能体增强有了长期策略反馈来源**
5. **整个系统仍然保持轻量、可关闭、可审计、可回滚**

---

## 13. 下一阶段衔接

本阶段完成后，下一阶段进入：`Phase 7：多智能体增强与委派产品化`。

`Phase 7` 将利用 Evolution 的一部分输出，例如：

- 哪些任务型 subagent 值得长期保留
- 哪些委派链路频繁失败，需要调整工具范围或模板
- 哪些研究/写作/整理型工作适合产品化成更稳定的委派流程

没有 Evolution，多智能体增强容易只停留在“功能很多”；有了 Evolution，才更容易走向“哪些委派真的有价值、如何逐步变稳”。

---

## 14. 给 Claude 的启动 Prompt

你现在要执行 Nion × Memoh 升级线的 `Phase 6：Evolution Core 低频反思与建议层`，但你**不能直接开始写代码**。

请先按下面顺序工作：

1. 阅读以下文档：
   - `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-5-heartbeat-core.md`
   - `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-4-soul-core.md`
   - `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-3-structured-memory.md`
   - `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-6-evolution-core.md`
   - `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/plans/2026-03-09-nion-memoh-research-architecture.md`

2. 阅读以下代码：
   - `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/config/memory_config.py`
   - `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/reflection/__init__.py`
   - `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/reflection/resolvers.py`
   - `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/heartbeat/*`
   - `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/soul/*`
   - `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/memory/*`
   - `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/frontend/src/components/workspace/settings/configuration/sections/memory-section.tsx`

3. 先输出“Evolution 前置检查摘要”，至少回答：
   - Phase 5 是否已真实落地？
   - 当前 `evolution_enabled` 是否有真实执行链路？
   - `reflection` 模块现在到底是什么？
   - 当前可用的 Evolution 输入源有哪些？
   - 哪些动作绝对不能在本阶段自动做？

4. 如果前置不满足，请停止本阶段开发并汇报缺口；不要把 Heartbeat 和 Evolution 混在一起一次硬做。

5. 如果前置满足，再给出你准备如何实现 `evolution reports / suggestions / status transitions / heartbeat integration` 的执行计划，然后再进入编码。

你的约束如下：

- 你必须把 Evolution 定义为低频建议层，而不是自治进化引擎
- 你必须默认不自动改写 Memory / Soul 主资产
- 你必须保持 Evolution 可关闭、可审计、可回滚
- 你不能把所有配置继续塞回 `memory_config.py`
- 你不能误用 `reflection` 模块当作 Evolution 引擎

---

## 15. 给 Claude 的实施 Prompt

请在 `Nion-Agent` 仓库中实现 `Phase 6：Evolution Core 低频反思与建议层`，实现目标如下：

### 任务目标

建立一个轻量、受控的 `Evolution Core`，提供：

- Evolution report 生成
- `memory_suggestion / soul_suggestion / agent_suggestion`
- 建议状态流转（至少 pending / dismissed，可选 accepted）
- 手动触发与 Heartbeat 低频触发
- 最小前端可见性

### 你必须先做的事情

1. 检查 Phase 5 是否已落地
2. 检查当前 `evolution_enabled`、前端演化开关、`reflection` 模块的真实状态
3. 如果前置不满足，停止并汇报
4. 如果前置满足，再先设计 report / suggestion 模型与测试，再写实现

### 推荐切入文件

- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/config/memory_config.py`
- 新增 `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/evolution/` 相关模块
- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/heartbeat/` 相关模块
- 适量修改前端设置与结果查看入口

### 推荐新增测试

- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/tests/test_evolution_service.py`
- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/tests/test_evolution_router.py`
- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/tests/test_evolution_heartbeat_integration.py`

### 你应该做的事情

- 定义 report / suggestion 模型与文件落点
- 消费 Heartbeat / Memory / Soul 输入生成建议
- 提供 Evolution API
- 提供建议状态管理
- 保持默认不自动应用
- 补充最小 UI 与自动化测试

### 你不应该做的事情

- 不做自治进化引擎
- 不自动重写主资产
- 不做复杂 RL/评分系统
- 不做重型 UI 平台
- 不继续把 Evolution 语义混回 Memory 域

### 验收要求

你完成后必须明确汇报：

1. 当前 Evolution 的输入来自哪里
2. 三类建议如何生成、如何存储、如何查看
3. 默认为什么不自动应用
4. Heartbeat 是如何触发 Evolution 的
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
- 下一阶段多智能体增强现在可以复用哪些信号与接口
