# Phase 7 多智能体增强与委派产品化实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.
>
> **引用阶段计划：** `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-7-multi-agent-productization.md`
>
> **适用前提：** 只有当 `Phase 3 ~ Phase 6` 已真实落地到代码与测试时，才能执行本计划。若前置不满足，必须停止并输出阻塞报告。

**Goal:** 把现有 `lead agent + subagents + workflow` 能力升级为“有边界、可解释、可配置、可评估”的个人助手委派体系，明确 tool/memory/soul/artifact scope 和 delegation contract，并产品化少量高价值默认角色模板。

**Architecture:** 保留 `lead agent` 作为唯一主入口，在现有 `subagents/config.py`、`registry.py`、`executor.py` 基础上增加 scope 与 contract，而不是推翻现有执行器。整体路线采用“先前置检查 → 再 scope/contract 模型 → 再模板产品化 → 再主助手委派策略 → 再与 Memory/Soul/Heartbeat/Evolution 边界对齐 → 最后最小前端与验证”的方式。

**Tech Stack:** Python、LangGraph、现有 `subagent executor`、现有 middleware、现有测试框架 `pytest`

---

## 0. 执行前总原则

### 0.1 必读材料

开始前必须完整阅读：

1. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/plans/2026-03-09-nion-memoh-research-architecture.md`
2. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-3-structured-memory.md`
3. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-4-soul-core.md`
4. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-6-evolution-core.md`
5. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-7-multi-agent-productization.md`

### 0.2 硬性边界

执行期间必须始终遵守：

- 不做 swarm / 代理社会
- 不做多 bot 管理平台
- 不给所有子智能体默认长期记忆写权限
- 不给所有子智能体默认完整 Soul 资产
- 不移除现有并发限制
- 不做复杂 agent 商店或模板市场

### 0.3 当前仓库的现实风险

截至本计划编写时，可以确认：

- `lead agent`、`subagent executor`、`registry`、`SubagentLimitMiddleware` 已存在
- 现有内置模板主要是 `general-purpose` 与 `bash`
- 已有子智能体执行器测试：`backend/tests/test_subagent_executor.py`
- 已有配置覆盖测试：`backend/tests/test_subagent_timeout_config.py`
- 但当前还没有正式的 `memory_scope / soul_scope / artifact_scope / delegation_contract` 模型

所以 **Task 0** 必须先验证前序阶段是否真实落地，并确认当前委派边界事实，而不是直接加新模板。

---

## Task 0：前置检查与阻塞报告

**目标**
- 验证 `Phase 3~6` 是否真实落地
- 验证当前主智能体与子智能体的真实边界

**Files:**
- Read: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/lead_agent/agent.py`
- Read: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/lead_agent/prompt.py`
- Read: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/subagents/config.py`
- Read: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/subagents/registry.py`
- Read: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/subagents/executor.py`
- Read: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/middlewares/subagent_limit_middleware.py`
- Optional Create: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-7-blocker-report.md`

**Step 1: 验证前序核心阶段是否已真实落地**

至少检查：
- Memory Core 是否已 provider 化
- Soul Core 是否已 summary 化
- Heartbeat / Evolution 是否已有正式输入输出

**Step 2: 验证当前委派事实**

必须明确回答：
- lead agent 当前如何触发委派
- 子智能体默认继承哪些工具与上下文
- 子智能体当前是否默认能写长期记忆
- 现有并发限制如何生效

**Stop Rule**
- 前序阶段未落地则停止，不进入 `Task 1+`

---

## Task 1：定义 scope 模型与 delegation contract

**目标**
- 把子智能体边界从代码习惯提升为正式模型

**Files:**
- Modify: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/subagents/config.py`
- Optional Create: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/subagents/contracts.py`
- Test: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/tests/test_subagent_scopes.py`

**Step 1: 先写失败测试**

至少覆盖：
- `tool_scope`
- `memory_scope`
- `soul_scope`
- `artifact_scope`
- `delegation_contract`
- 默认无长期记忆写权限

**Step 2: 实现最小模型**

建议新增：
- `SubagentScopes`
- `DelegationContract`
- `DelegationResultEnvelope`

**Step 3: 跑最小测试**

Run:
```bash
pytest backend/tests/test_subagent_scopes.py -q
```

Expected:
- scope 与 contract 模型可用
- 不破坏现有 SubagentConfig 行为

---

## Task 2：产品化默认内置模板

**目标**
- 新增少量高价值、面向普通用户的默认子智能体模板

**Files:**
- Create: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/subagents/builtins/researcher.py`
- Create: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/subagents/builtins/writer.py`
- Create: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/subagents/builtins/organizer.py`
- Modify: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/subagents/builtins/__init__.py`
- Modify: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/subagents/registry.py`
- Test: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/tests/test_subagent_registry_templates.py`

**Step 1: 先写失败测试**

至少覆盖：
- 新模板可注册
- 新模板具备清晰描述
- 默认工具范围、memory/soul scope 明确

**Step 2: 先做 2~3 个高价值模板**

优先顺序：
1. `researcher`
2. `writer`
3. `organizer`

不要一次做很多模板。

**Step 3: 跑最小测试**

Run:
```bash
pytest backend/tests/test_subagent_registry_templates.py -q
pytest backend/tests/test_subagent_timeout_config.py -q
```

Expected:
- 新模板可注册与读取
- 现有 timeout config override 不回退

---

## Task 3：强化 lead agent 的委派策略与提示契约

**目标**
- 让主助手更明确何时委派、委派给谁、带什么 contract

**Files:**
- Modify: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/lead_agent/prompt.py`
- Modify: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/lead_agent/agent.py`
- Test: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/tests/test_lead_agent_delegation_contract.py`

**Step 1: 先写失败测试**

至少覆盖：
- lead agent 能根据角色选择委派对象
- 委派提示中包含 contract 关键信息
- 默认不把所有复杂任务都扔给 `general-purpose`

**Step 2: 最小改造**

目标不是重写主 agent，而是让 prompt 和委派入口更清晰地表达：
- 任务类型
- 角色匹配
- scope 边界
- 返回格式

**Step 3: 跑最小测试**

Run:
```bash
pytest backend/tests/test_lead_agent_delegation_contract.py -q
pytest backend/tests/test_subagent_executor.py -q
```

Expected:
- 委派契约更清晰
- 现有 subagent executor 行为不回退

---

## Task 4：接入 Memory / Soul / Heartbeat / Evolution 边界

**目标**
- 正式限制子智能体默认 memory/soul 权限，并接入长期反馈边界

**Files:**
- Modify: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/subagents/executor.py`
- Modify: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/lead_agent/agent.py`
- Optional Modify: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/heartbeat/service.py`
- Optional Modify: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/evolution/service.py`
- Test: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/tests/test_subagent_scope_integration.py`

**Step 1: 先写失败测试**

至少覆盖：
- 子智能体默认无长期记忆写权限
- 子智能体默认只拿最小 soul summary
- 子智能体执行结果可形成可回传摘要
- 长期反馈层可读取子智能体结果或统计

**Step 2: 做边界接线**

重点是：
- 默认 no-write memory scope
- 默认 minimal-summary soul scope
- 结果可被 Heartbeat/Evolution 消费

**Step 3: 跑最小测试**

Run:
```bash
pytest backend/tests/test_subagent_scope_integration.py -q
pytest backend/tests/test_subagent_executor.py -q
```

Expected:
- 子智能体边界可工作
- 不破坏现有 executor 主链路

---

## Task 5：补最小前端表达

**目标**
- 让用户至少能感知默认委派角色或结果归属

**Files:**
- Optional Create/Modify: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/frontend/src/core/agents/*`
- Optional Modify: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/frontend/src/components/workspace/*`

**Step 1: 最小目标**

至少能表达：
- 默认可用委派角色
- 某次结果来自哪个角色模板（如果已有事件/结果载荷支持）

**Step 2: 不做大型 agent studio**

优先做最小显示和说明，不做重型界面。

---

## Task 6：回滚验证、最小演练与文档回写

**目标**
- 锁定新增模板与委派边界的关闭方式、验证方式和执行总结

**Files:**
- Optional Update: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-7-multi-agent-productization.md`
- Optional Create: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-7-execution-report.md`

**Step 1: 最小演练场景**

至少验证：
- 研究型委派
- 写作型委派
- 受控执行型委派
- 并发限制仍生效

**Step 2: 跑阶段测试**

Run:
```bash
pytest backend/tests/test_subagent_timeout_config.py -q
pytest backend/tests/test_subagent_executor.py -q
pytest backend/tests/test_subagent_scopes.py -q
pytest backend/tests/test_subagent_registry_templates.py -q
pytest backend/tests/test_lead_agent_delegation_contract.py -q
pytest backend/tests/test_subagent_scope_integration.py -q
```

**Step 3: 文档回写**

最终必须明确：
- lead agent 与 subagent 的边界
- 各模板的角色、工具范围、memory/soul scope
- 默认为什么不能直接写长期记忆
- 哪些内容刻意未做

---

## 推荐执行顺序

1. `Task 0` 前置检查
2. `Task 1` scope/contract 模型
3. `Task 2` 默认模板产品化
4. `Task 3` lead agent 委派策略
5. `Task 4` 边界接线
6. `Task 5` 最小前端表达
7. `Task 6` 演练、回滚、文档回写

---

## 完成判定（DoD）

- `Phase 3~6` 已真实落地
- scope 与 delegation contract 正式可用
- 至少 2~3 个高价值模板已产品化
- lead agent 委派策略更清晰
- 子智能体默认无长期记忆写权限
- 子智能体默认只拿最小 soul summary
- 并发限制仍有效
- 相关测试通过，且有执行总结

---

## 给下一位 Agent 的总启动 Prompt

```text
你现在要执行 Nion-Agent 的 `Phase 7 多智能体增强与委派产品化实施计划`。

实施计划文件：
/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-7-multi-agent-productization-execution-plan.md

阶段计划文件：
/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-7-multi-agent-productization.md

项目根目录：
/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent

执行规则：
1. 先完整阅读实施计划与阶段计划
2. 从 Task 0 开始，顺序执行
3. 如果前置不满足，停止并输出 blocker report
4. 每完成一个 Task，都要输出修改文件、测试结果、当前阻塞
5. 不要做 swarm、多 bot 管理平台或无限制委派
6. 最后必须补一份执行总结
```
