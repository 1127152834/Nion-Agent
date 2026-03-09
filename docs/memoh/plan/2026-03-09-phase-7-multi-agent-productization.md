# Phase 7：多智能体增强与委派产品化

> **给执行 Agent：** 这是一份可直接执行的阶段计划文档，但你**不能跳过上下文**直接开发。请先验证 `Phase 3 ~ Phase 6` 是否已经真实落地，再检查当前主智能体、子智能体、任务委派与限流中间件的真实状态，然后再进入实现。
>
> **阶段目标一句话版：** 保留 Nion 已经具备的 LangGraph 主智能体与子智能体协作能力，但把它从“能用的技术能力”升级为“有边界、可解释、可配置、可评估”的产品能力，形成“主助手 + 有边界的任务型委派 agent + 可选工作流编排”的轻量多智能体体系，而不是走复杂 swarm 或代理社会路线。

- 阶段编号：`Phase 7`
- 优先级：`P1`
- 前置阶段：`Phase 3：结构化记忆存储与维护能力`、`Phase 4：Soul Core 身份与长期陪伴层`、`Phase 5：Heartbeat Core 周期任务与助手节律`、`Phase 6：Evolution Core 低频反思与建议层`
- 后续阶段：`后续增量优化，不再强制拆新核心阶段`
- 是否允许独立实施：`不允许`（若前序核心阶段未落地，本阶段必须先停止）
- 风险等级：`中`
- 预估改动范围：`中到大`

---

## 1. 阶段定位

Nion 当前其实已经具备了不错的多智能体基础：

- `lead agent` 是统一主入口
- 已有 `subagent executor`
- 已有 `subagent registry`
- 已有 `SubagentLimitMiddleware`
- 已有内置 `general-purpose` 与 `bash` 子智能体

问题不在“没有多智能体”，而在：

- 哪些任务适合委派还不够产品化
- 子智能体的 `tool scope / skill scope / memory scope` 没有成为明确产品边界
- 默认内置子智能体还偏技术原型，不够面向普通个人助手场景
- 委派结果与长期反馈（Memory / Soul / Heartbeat / Evolution）之间还没有形成完整闭环

因此本阶段解决的不是“再造一个代理社会”，而是：

> 把已有委派能力收紧边界、补足角色、做成普通用户可感知、可受益的个人助手能力。

本阶段的最终目标不是“系统里有很多 agent”，而是：

- 主助手更会分工
- 子助手更有边界
- 用户更容易得到高质量结果
- 长期演进更有反馈闭环

---

## 2. Context Pack

### 2.1 必读文档

执行前必须阅读以下文档，并在开始编码前输出 8-12 句话总结你理解到的关键事实：

1. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/plans/2026-03-09-nion-memoh-research-architecture.md`
   - 作用：确认 Agent Core 的定位、保留能力与需要新增的边界
   - 读完后你应该知道：我们要的是“主助手 + 有边界委派”，不是复杂 swarm

2. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-3-structured-memory.md`
   - 作用：确认多智能体与长期记忆的边界
   - 读完后你应该知道：多数子智能体不应拥有默认长期记忆写权限

3. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-4-soul-core.md`
   - 作用：确认多智能体与 Soul 的边界
   - 读完后你应该知道：子智能体不应默认继承完整 Soul 资产全文

4. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-6-evolution-core.md`
   - 作用：确认后续如何基于长期反馈改进委派体系
   - 读完后你应该知道：Evolution 可以为 agent 模板优化提供建议，但不是本阶段的替代物

5. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-7-multi-agent-productization.md`
   - 作用：这是当前阶段计划本身，必须逐节核对边界与不做项

### 2.2 必读代码

执行前必须先阅读以下代码，并确认当前多智能体的真实边界：

1. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/lead_agent/agent.py`
   - 你需要确认主智能体的 middleware、prompt 与 subagent 能力入口

2. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/lead_agent/prompt.py`
   - 你需要确认主智能体当前是如何理解并使用委派能力的

3. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/subagents/config.py`
   - 你需要确认当前子智能体有哪些可配置边界：tools、disallowed_tools、model、timeout 等

4. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/subagents/registry.py`
   - 你需要确认当前内置子智能体注册方式与 config override 机制

5. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/subagents/executor.py`
   - 你需要确认当前子智能体如何继承父上下文、工具、sandbox、thread data

6. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/middlewares/subagent_limit_middleware.py`
   - 你需要确认当前并发限制已经具备哪些保护

7. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/tools/builtins/setup_agent_tool.py`
   - 你需要确认当前自定义 agent 初始化能力与 Soul 资产创建边界

8. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/config/agents_config.py`
   - 你需要确认自定义 agent 与 `SOUL.md` 的当前接线方式

### 2.3 已知事实（禁止再猜）

以下事实已经由当前仓库与研究文档确认：

- 当前 `lead agent` 已是唯一主入口
- 当前已存在子智能体执行器、注册表和并发限流中间件
- 当前内置子智能体数量很少，主要是 `general-purpose` 与 `bash`
- 当前子智能体可以继承父工具集或使用 allowlist/denylist 约束
- 当前子智能体与长期记忆边界还没有形成正式产品语义
- 当前多智能体能力更偏技术能力，不是面向普通用户的清晰产品能力
- 本阶段必须坚持“主助手 + 委派式子智能体 + 可选工作流编排”的边界
- 本阶段不能走 swarm、代理社会、多 bot 管理平台路线

---

## 3. 当前系统状态（As-Is Context）

### 3.1 当前主智能体与子智能体技术链路已经存在

从 `lead_agent/agent.py`、`subagents/executor.py`、`subagents/registry.py` 看，当前系统已经具备：

- 主智能体 orchestrate 能力
- 子智能体运行时
- 子智能体配置模型
- 工具过滤
- 并发限制

这意味着本阶段不是从零开始，而是建立在已有技术能力之上。

### 3.2 当前内置子智能体还偏“工程辅助”，不够“个人助手产品化”

当前内置子智能体以：

- `general-purpose`
- `bash`

为主。

它们对工程或复杂执行任务很有帮助，但对普通个人助手常见场景来说，还缺少更清晰的产品角色，例如：

- 研究整理型
- 写作成稿型
- 计划拆解/组织型
- 工作复盘与输出整理型

### 3.3 当前子智能体边界还不够显式

虽然 `SubagentConfig` 已有：

- `tools`
- `disallowed_tools`
- `model`
- `timeout_seconds`

但仍然缺少更明确的产品边界表达，例如：

- `memory_scope`
- `soul_scope`
- `artifact_scope`
- `delegation_contract`

这会导致多智能体能力虽然可用，但很难长期稳定扩展。

### 3.4 当前长期反馈闭环还未真正作用到委派层

在理想状态下：

- Memory Core 决定哪些上下文适合共享
- Soul Core 决定哪些风格/边界需要传递给子智能体
- Heartbeat Core 能记录长期使用效果
- Evolution Core 能建议哪些委派模板该保留/优化

而当前这些链路还没有在 agent productization 层真正落地。

---

## 4. 本阶段要解决的核心问题

本阶段要解决以下六类问题：

1. **现有多智能体能力缺少面向个人助手的产品角色划分**
2. **子智能体的 scope 还不够正式化**
3. **委派结果缺少稳定契约和可评估性**
4. **与 Memory / Soul / Heartbeat / Evolution 的关系缺少产品规则**
5. **默认内置子智能体数量少且角色不清**
6. **用户无法明确理解“什么时候系统会委派、委派给谁、带着什么边界去做”**

---

## 5. 本阶段目标

### 5.1 目标一：正式固化 Agent Core 的边界

`Agent Core` 在 Nion 中必须固定为：

- `lead agent` 是唯一用户主入口
- `subagents` 是有边界的委派 worker
- `workflow` 是可选的编排放大器

### 5.2 目标二：为子智能体补正式 scope 模型

至少明确以下 scope：

- `tool scope`
- `skill scope`
- `memory scope`
- `soul scope`
- `artifact scope`

### 5.3 目标三：产品化一组适合个人助手场景的默认子智能体模板

优先考虑以下方向：

- `researcher`：资料收集、比对、整理
- `writer`：成稿、改写、结构化输出
- `organizer`：计划拆解、信息归档、结果汇总
- `bash` / `executor`：受控执行与验证

不要求一次做很多，重点是**角色清晰、边界清晰、默认收益明确**。

### 5.4 目标四：定义主助手与子智能体之间的委派契约

至少要明确：

- 什么任务适合委派
- 委派时共享哪些上下文
- 子智能体默认能不能写长期记忆
- 子智能体默认能不能继承完整 Soul
- 结果如何回传给主助手

### 5.5 目标五：让委派体系能被长期反馈优化

本阶段不要求完整自动优化，但至少要把委派结果与以下信号衔接：

- Heartbeat 日志
- Evolution 建议
- 任务结果质量
- 子智能体失败/超时/重试统计

---

## 6. 本阶段明确不做

以下内容本阶段明确不做：

1. **不做 swarm / 代理社会**
   - 不做复杂多 agent 互相聊天、自组织、自治博弈平台

2. **不做多 bot 管理平台**
   - 不把个人助手产品做成 Memoh 式多 bot 管理系统

3. **不让每个子智能体都拥有完整长期记忆与 Soul 资产**
   - 默认多数子智能体只拿任务相关上下文与必要摘要

4. **不做无限制委派**
   - 不移除或弱化现有并发限制保护

5. **不做复杂 agent 市场或模板商店**
   - 先把少量高价值模板做好

6. **不做完全自动的委派自优化**
   - Evolution 的建议可以辅助，但本阶段不做黑箱自动策略更新

---

## 7. 默认规则与决策闭环

### 7.1 主入口决策

从本阶段开始，必须坚持：

- `lead agent` 是唯一主入口
- 用户默认不直接面对一个 agent 列表社会
- 子智能体是主助手内部能力，不是平级产品人格

### 7.2 默认子智能体角色决策

本阶段默认优先产品化少量高价值模板，而不是扩数量。推荐顺序：

1. `researcher`
2. `writer`
3. `organizer`
4. `bash / executor`

### 7.3 memory scope 决策

默认规则：

- 子智能体默认**不拥有长期记忆写权限**
- 子智能体默认只读取工作流上下文、任务上下文和必要摘要
- 如需长期记忆沉淀，应由主助手统一决策写回

### 7.4 soul scope 决策

默认规则：

- 子智能体默认不继承完整 `SOUL / IDENTITY / USER` 原始资产
- 只继承与当前任务相关的最小风格/边界摘要
- 研究型、写作型可获得更明确的风格摘要，但仍不应拿到完整长期画像全文

### 7.5 tool / skill scope 决策

默认规则：

- 子智能体必须有明确的 allowlist / denylist
- 高风险工具应优先留在主助手或专用执行 agent 中
- 不同子智能体应按任务类型提供最小可用工具集

### 7.6 delegation contract 决策

建议正式定义“委派契约”，至少包含：

- `task_kind`
- `goal`
- `input_context_refs`
- `allowed_tools`
- `memory_scope`
- `expected_output_schema`
- `return_summary`

这可以是轻量数据结构，不需要一开始就做复杂 DSL。

### 7.7 结果回传决策

子智能体结果必须能被主助手稳定消费，至少包括：

- 摘要
- 关键发现
- 产出物路径
- 失败原因
- 是否建议写回长期记忆

---

## 8. 实现方案

### 8.1 工作包 A：定义 Agent Scope 与 Delegation Contract

**目标**
- 把子智能体的边界从“代码约定”提升为“正式模型”

**建议修改点**
- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/subagents/config.py`
- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/subagents/executor.py`
- 必要时新增 contract / schema 模型

**完成标准**
- 工具、技能、记忆、Soul、产出范围都能被正式表达
- 主助手与子智能体之间的交接更稳定可测

### 8.2 工作包 B：产品化默认子智能体模板

**目标**
- 新增少量高价值、面向普通用户的默认子智能体角色

**建议新增位置**
- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/subagents/builtins/` 下新增 `researcher.py`、`writer.py`、`organizer.py` 等（命名可微调）
- 更新 registry

**完成标准**
- 至少有 2-3 个角色清晰的新默认模板
- 每个模板都说明适用场景、禁止场景、默认工具范围

### 8.3 工作包 C：强化 lead agent 的委派策略与提示

**目标**
- 让主助手更清楚何时该委派、委派给谁、如何描述目标

**建议修改点**
- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/lead_agent/prompt.py`
- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/lead_agent/agent.py`
- 相关 middleware 或工具说明

**完成标准**
- 主助手对不同子智能体的角色边界描述更清晰
- 委派不只是“开个 task 试试”，而是更有选择性和契约感

### 8.4 工作包 D：接入 Memory / Soul / Heartbeat / Evolution 边界

**目标**
- 把多智能体能力正式接到前面几个核心阶段的边界上

**建议重点**
- 子智能体默认 memory scope = no-write / summary-read
- 子智能体默认 soul scope = minimal-summary
- Heartbeat / Evolution 可消费子智能体执行表现，辅助后续优化模板

**完成标准**
- 多智能体不再越过 Memory / Soul 规则直接乱写状态
- 长期反馈可以作用于模板优化

### 8.5 工作包 E：补最小前端表达

**目标**
- 让用户至少能知道系统有哪些委派角色或模板，而不是黑箱发生

**建议修改点**
- 与 agent 管理、设置页或任务结果展示相关的前端入口
- 不要求做大型 agent studio

**完成标准**
- 至少能看到默认委派角色、基本说明或部分执行结果归属

### 8.6 工作包 F：补测试与验证

**目标**
- 用测试锁住委派边界与角色模板行为

**建议新增测试**
- `backend/tests/test_subagent_scopes.py`
- `backend/tests/test_subagent_registry_templates.py`
- `backend/tests/test_lead_agent_delegation_contract.py`

**最少覆盖场景**
- 新模板能被正确注册与解析
- 子智能体默认无长期记忆写权限
- 子智能体默认只拿到最小 soul summary
- lead agent 会按角色选择性委派
- 并发限制仍然有效

---

## 9. Agent 实施顺序

建议执行顺序如下：

1. 先验证 `Phase 3 ~ Phase 6` 是否已真实落地
2. 梳理当前 lead agent、subagent registry、executor、limit middleware 的真实状态
3. 定义 scope 模型与 delegation contract
4. 新增少量高价值默认模板
5. 优化主助手委派策略
6. 接入 Memory / Soul / Heartbeat / Evolution 边界
7. 补最小前端表达
8. 跑测试并演练研究型、多步写作型、受控执行型三类任务
9. 回写执行总结，明确多智能体产品化到底落地到了什么程度

---

## 10. 验收标准

只有同时满足以下条件，才能认为 `Phase 7` 完成：

1. 主助手 + 子智能体 + 工作流 的边界被正式固化
2. 子智能体至少具备明确的 tool/memory/soul scope
3. 默认内置模板完成一轮面向个人助手场景的产品化提升
4. 主助手委派策略更清晰且可解释
5. 子智能体默认不会绕过主助手直接写长期记忆
6. 子智能体默认不会继承完整 Soul 全文
7. 并发限制与安全边界仍然生效
8. Heartbeat / Evolution 可以消费委派表现或结果摘要
9. 没有把系统做成 swarm 或多 bot 管理平台
10. 自动化测试覆盖模板注册、scope 边界、委派契约和限流保护

---

## 11. 回滚方案

### 11.1 运行时回滚

- 关闭新增的默认委派模板
- 回退到当前基础 `general-purpose` / `bash` 子智能体集合
- 保留主助手主入口不变

### 11.2 数据回滚

- 不删除已有自定义 agent 资产
- 新增模板可保留但不作为默认启用项

### 11.3 接口回滚

- 新增的模板/说明接口可临时关闭或降级为只读
- 核心 lead agent 与 scheduler / memory / soul 接口保持兼容

### 11.4 验证回滚

至少验证：

- 主助手仍可在没有新增模板的情况下正常工作
- 原有 `general-purpose` 与 `bash` 子智能体仍可执行
- Memory / Soul / Heartbeat / Evolution 主链路不被破坏

---

## 12. 本阶段完成后的产品成效

如果 `Phase 7` 完成，Nion 会获得以下关键升级：

1. **多智能体能力从“技术存在”升级为“产品可感知”**
2. **主助手的委派行为更稳定、更有边界、更符合普通用户任务**
3. **研究、写作、整理、执行等任务获得更清晰的角色分工**
4. **长期反馈开始真正作用到 agent 模板优化，而不是停留在抽象想法**
5. **系统仍然保持轻量、单用户、桌面端友好，而没有滑向复杂代理社会**

---

## 13. 后续衔接

完成 `Phase 7` 后，核心升级主线已经闭环：

- `Memory Core`
- `Soul Core`
- `Heartbeat Core`
- `Evolution Core`
- `Agent Core` 产品化

后续迭代应优先走：

- 模板细化与角色质量优化
- 结果质量评估与提示词精修
- 更好的最小 UI 表达
- 个别高价值模板的增强，而不是继续横向扩张 agent 数量

---

## 14. 给 Claude 的启动 Prompt

你现在要执行 Nion × Memoh 升级线的 `Phase 7：多智能体增强与委派产品化`，但你**不能直接开始写代码**。

请先按下面顺序工作：

1. 阅读以下文档：
   - `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/plans/2026-03-09-nion-memoh-research-architecture.md`
   - `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-3-structured-memory.md`
   - `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-4-soul-core.md`
   - `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-6-evolution-core.md`
   - `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-7-multi-agent-productization.md`

2. 阅读以下代码：
   - `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/lead_agent/agent.py`
   - `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/lead_agent/prompt.py`
   - `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/subagents/config.py`
   - `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/subagents/registry.py`
   - `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/subagents/executor.py`
   - `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/middlewares/subagent_limit_middleware.py`
   - `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/tools/builtins/setup_agent_tool.py`

3. 先输出“多智能体前置检查摘要”，至少回答：
   - Phase 3~6 是否都已真实落地？
   - 当前 lead agent 和 subagent 的真实边界是什么？
   - 当前子智能体默认拥有哪些工具和上下文？
   - 当前最缺哪几类产品化子智能体角色？
   - 哪些能力绝对不能在本阶段走向 swarm 化？

4. 如果前置不满足，请停止本阶段实施并汇报缺口；不要把 Memory / Soul / Heartbeat / Evolution / Agent Productization 混成一个超大改动。

5. 如果前置满足，再给出你准备如何实现 `scope model / delegation contract / built-in templates / lead agent delegation improvements` 的执行计划，然后再进入编码。

你的约束如下：

- 你必须坚持“主助手 + 有边界委派 agent + 可选工作流编排”的结构
- 你必须让子智能体默认没有长期记忆写权限
- 你必须让子智能体默认只拿最小 soul summary
- 你不能把系统做成 swarm、多 bot 管理平台或 agent 社会
- 你不能移除现有并发限制与安全保护

---

## 15. 给 Claude 的实施 Prompt

请在 `Nion-Agent` 仓库中实现 `Phase 7：多智能体增强与委派产品化`，实现目标如下：

### 任务目标

基于现有 LangGraph 主智能体 + 子智能体体系，补齐：

- 子智能体 scope 模型
- delegation contract
- 2-3 个高价值默认模板（研究/写作/整理 等）
- 更清晰的主助手委派策略
- 与 Memory / Soul / Heartbeat / Evolution 的正式边界

### 你必须先做的事情

1. 检查 Phase 3~6 是否已落地
2. 检查当前 lead agent、subagent registry/executor/limit middleware 的真实状态
3. 如果前置不满足，停止并汇报
4. 如果前置满足，再先设计 scope 和 contract，再写实现

### 推荐切入文件

- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/lead_agent/agent.py`
- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/lead_agent/prompt.py`
- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/subagents/config.py`
- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/subagents/registry.py`
- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/subagents/executor.py`
- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/middlewares/subagent_limit_middleware.py`
- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/subagents/builtins/` 目录

### 推荐新增测试

- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/tests/test_subagent_scopes.py`
- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/tests/test_subagent_registry_templates.py`
- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/tests/test_lead_agent_delegation_contract.py`

### 你应该做的事情

- 正式化 tool/memory/soul/artifact scope
- 定义 delegation contract
- 产品化少量高价值默认模板
- 优化主助手委派提示和选择逻辑
- 接入长期反馈边界
- 补自动化测试

### 你不应该做的事情

- 不做 swarm / 代理社会
- 不做多 bot 管理平台
- 不给所有子智能体默认长期记忆写权限
- 不给所有子智能体默认完整 Soul 资产
- 不移除并发限制

### 验收要求

你完成后必须明确汇报：

1. lead agent 与 subagent 的边界现在是什么
2. 各默认模板的角色、工具范围、memory/soul scope 是什么
3. 子智能体默认为什么不能直接写长期记忆
4. 长期反馈如何作用到模板优化
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
- 后续增量优化最值得优先做什么
