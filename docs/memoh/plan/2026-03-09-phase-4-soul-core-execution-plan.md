# Phase 4 Soul Core 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.
>
> **引用阶段计划：** `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-4-soul-core.md`
>
> **适用前提：** 只有当 `Phase 3` 已经真实落地到代码与测试时，才能执行本计划。若 `Phase 3` 未落地，必须停止并输出阻塞报告，而不是把 `Phase 3` 和 `Phase 4` 混做。

**Goal:** 为 Nion 建立一个轻量、可编辑、可注入、可审计的 `Soul Core`，统一管理 `SOUL.md / IDENTITY.md / USER.md` 三类身份资产，并把当前“文件可读写但运行时未闭环”的状态升级为“有 resolver、有 summary、有注入策略、有调试入口”的正式能力。

**Architecture:** 保持文件系统优先，不把 Soul 做成数据库中心或自治 agent。整体采用“先验证 Phase 3 前置 → 再补资产路径与模型 → 再做 resolver/runtime → 再补默认主助手资产接口 → 再接入 prompt 与 runtime 策略 → 最后做调试预览、回滚验证与文档回写”的保守路线。

**Tech Stack:** Python、FastAPI、Pydantic、本地文件系统、现有 `agents_config` / `paths` / `lead_agent.prompt` / `agents router` / `pytest`

> As-Built 注释（2026-03-11）：
> 默认智能体主接口当前为 `/api/default-agent/*`，并补了文档兼容别名 `/api/soul/default` 与 `/api/soul/identity`。
> 为避免命名漂移导致的前后端割裂，前端已统一接入 default-agent 专用配置与资产接口。

---

## 0. 执行前总原则

### 0.1 必读材料

开始前必须完整阅读：

1. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-3-structured-memory.md`
2. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-4-soul-core.md`
3. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/plans/2026-03-09-nion-memoh-research-architecture.md`
4. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-2-memory-core.md`
5. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/plan/memory/memoh-memory-source-study.md`

### 0.2 硬性边界

执行期间必须始终遵守：

- 不做 `Heartbeat Core`
- 不做 `Evolution Core`
- 不做独立 `Soul Agent`
- 不做高频自动人格改写
- 不做多用户画像体系
- 不做重型 UI 平台
- 不做外部重型依赖

### 0.3 当前仓库的现实风险

截至本计划编写时，可以确认：

- 自定义 agent 的 `SOUL.md` CRUD 已存在
- `/api/user-profile` 对 `USER.md` 的 CRUD 已存在
- `prompt.py` 已会注入 `SOUL.md`
- 但 `USER.md` 尚未看到真实运行时注入证据
- `IDENTITY.md` 当前基本缺席
- 前端 `soul.enabled / seed_from_global / incognito_supported` 更像 UI 占位，而非已落地语义

所以 **Task 0** 仍然是必须执行的前置检查，而不是假定 `Phase 4` 可以直接进入开发。

---

## Task 0：前置检查与阻塞报告

**目标**
- 验证 `Phase 3` 是否真实落地
- 验证当前 Soul 相关资产与运行时接线的真实状态
- 如果前置不满足，停止并给出 blocker report

**Files:**
- Read: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-3-structured-memory.md`
- Read: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/memory/`
- Read: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/config/agents_config.py`
- Read: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/gateway/routers/agents.py`
- Read: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/lead_agent/prompt.py`
- Optional Create: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-4-blocker-report.md`

**Step 1: 验证 Phase 3 是否已真实落地**

至少检查：
- 是否已有 `structured-fs` provider/runtime
- 是否已有 `usage / compact / rebuild`
- prompt/middleware 是否已经能走 provider 边界
- `memory_read / memory_write` 是否已被 Phase 3 测试锁住

**Step 2: 验证 Soul 现状**

必须明确回答：
- `SOUL.md` 当前如何加载与注入
- `USER.md` 是否真实参与运行时
- `IDENTITY.md` 是否已有正式路径/接口
- 前端 Soul 设置是否有真实后端语义

**Step 3: 输出前置结论**

如果前置不满足，必须明确列出：
- 缺失的 Phase 3 资产
- 缺失的 Soul 资产路径/接口/测试
- 不允许继续执行的原因

**Stop Rule**
- `Phase 3` 未落地则停止，不进入 `Task 1+`

**给 Claude 的任务 Prompt**

```text
你现在执行的是 Nion-Agent 的 Phase 4 Task 0：前置检查与阻塞报告。

请先不要改代码。你必须先检查：
1. Phase 3 是否真实落地
2. 当前 SOUL.md / USER.md / IDENTITY.md 的真实状态
3. 当前 prompt 注入与前端 Soul 设置是否已经形成闭环

如果 Phase 3 不满足，或 Soul 资产事实与计划严重不一致，停止后续实现，并输出 blocker report。
```

---

## Task 1：补齐 Soul 资产路径与最小模型

**目标**
- 正式定义默认主助手和自定义 agent 的 `SOUL.md / IDENTITY.md / USER.md` 路径语义
- 建立 Soul 相关最小模型

**Files:**
- Modify: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/config/paths.py`
- Modify: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/config/agents_config.py`
- Create: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/soul/models.py`
- Test: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/tests/test_soul_paths_and_models.py`

**Step 1: 先写失败测试**

建议先覆盖：
- 默认主助手 `SOUL.md` 路径
- 默认主助手 `IDENTITY.md` 路径
- 全局 `USER.md` 路径
- agent 级 `SOUL.md` 路径
- 可选 agent 级 `IDENTITY.md` 路径
- 缺文件时的安全返回值

**Step 2: 路径层最小改造**

建议新增 helper，例如：
- `default_soul_file`
- `default_identity_file`
- `agent_soul_file(name)`
- `agent_identity_file(name)`
- 保留现有 `user_md_file` 语义不变

**Step 3: 建立最小模型**

至少包含：
- `SoulAssetBundle`
- `ResolvedSoulSummary`
- `SoulSummarySource`
- `SoulSettingsSnapshot`（如果确实需要）

**Step 4: 跑最小测试**

Run:
```bash
pytest backend/tests/test_soul_paths_and_models.py -q
```

Expected:
- 路径和最小模型可用
- 现有 `SOUL.md` 与 `USER.md` 路径语义未被破坏

**给 Claude 的任务 Prompt**

```text
你现在执行 Phase 4 Task 1：补齐 Soul 资产路径与最小模型。

你的目标只是在路径层和模型层把 SOUL / IDENTITY / USER 资产立住。
不要提前写 router、prompt summary、自动更新逻辑。
必须先写测试，再做实现。
```

---

## Task 2：实现 Soul Resolver / Summary Runtime

**目标**
- 建立统一 Soul 读取、解析、摘要和来源追踪入口

**Files:**
- Create: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/soul/resolver.py`
- Create: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/soul/runtime.py`
- Create: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/soul/__init__.py`
- Modify: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/config/agents_config.py`
- Test: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/tests/test_soul_resolver.py`

**Step 1: 先写失败测试**

至少覆盖：
- 默认助手 `SOUL + IDENTITY + USER` 的组合
- 自定义 agent `SOUL` 与默认 Soul 的叠加/覆盖
- 缺 `IDENTITY.md` 时安全退化
- summary 带来源信息
- summary 具有 token/长度边界（可简单按字符/段落先做）

**Step 2: 实现 resolver**

第一版建议能力：
- 读取三类文件
- 生成分层摘要
- 记录来源（default_soul / default_identity / user_profile / agent_soul）

先不要在这一步做：
- 自动修改资产
- scheduler / heartbeat / evolution 接线

**Step 3: 跑最小测试**

Run:
```bash
pytest backend/tests/test_soul_resolver.py -q
```

Expected:
- resolver 可稳定输出可注入 summary
- 对缺失文件有清晰回退行为

**给 Claude 的任务 Prompt**

```text
你现在执行 Phase 4 Task 2：实现 Soul Resolver / Summary Runtime。

你的目标是建立统一的读取、解析、摘要和来源追踪入口。
这一步只做 resolver/runtime，不做 router、前端或自动更新。
必须先写测试，再做实现。
```

---

## Task 3：补默认主助手的 Soul / Identity 资产接口

**目标**
- 不再只有自定义 agent 有 `SOUL.md`
- 默认主助手也要有正式资产管理入口

**Files:**
- Modify: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/gateway/routers/agents.py`
- Optional Create: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/gateway/routers/soul.py`
- Test: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/tests/test_soul_router.py`
- Reuse/Extend: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/tests/test_custom_agent.py`

**Step 1: 先写失败测试**

至少覆盖：
- 获取默认 `SOUL.md`
- 更新默认 `SOUL.md`
- 获取默认 `IDENTITY.md`
- 更新默认 `IDENTITY.md`
- 获取 resolved soul summary 预览
- 继续兼容 `/api/user-profile`

**Step 2: 最小接口落地**

建议最少提供：
- `GET /api/soul/default`
- `PUT /api/soul/default`
- `GET /api/soul/identity`
- `PUT /api/soul/identity`
- `GET /api/soul/preview`

也可以复用 `agents router`，但不建议把 Soul 语义无限堆进去。

**Step 3: 跑最小测试**

Run:
```bash
pytest backend/tests/test_soul_router.py -q
pytest backend/tests/test_custom_agent.py -q
```

Expected:
- 默认主助手资产接口可用
- 现有 custom agent 和 user-profile 测试不回退

**给 Claude 的任务 Prompt**

```text
你现在执行 Phase 4 Task 3：补默认主助手的 Soul / Identity 资产接口。

不要重构整套 agents router，只补最小且清晰的接口层。
必须保持现有 custom agent 与 /api/user-profile 兼容。
```

---

## Task 4：把 `USER.md` 接进真实运行时，并受契约控制

**目标**
- 修复 `USER.md` 目前“有 CRUD、无 runtime”的断层
- 明确 `memory_read` 与 `USER.md` 的关系

**Files:**
- Modify: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/lead_agent/prompt.py`
- Modify: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/soul/resolver.py`
- Modify: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/thread_state.py`
- Test: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/tests/test_prompt_soul_injection.py`

**Step 1: 先写失败测试**

至少覆盖：
- 普通会话会带入 `USER.md` 摘要
- `memory_read=false` 时不带入 `USER.md`
- `SOUL.md / IDENTITY.md` 仍可按策略注入
- 自定义 agent 仍能带入自己的 Soul summary

**Step 2: prompt 集成最小修改**

目标不是把所有逻辑都塞回 `prompt.py`，而是：
- prompt 调用 Soul resolver
- resolver 根据运行时契约决定是否读取 `USER.md`
- 最终注入 resolved summary

**Step 3: 跑最小测试**

Run:
```bash
pytest backend/tests/test_prompt_soul_injection.py -q
```

Expected:
- summary 注入工作正常
- `memory_read` 边界未被破坏

**给 Claude 的任务 Prompt**

```text
你现在执行 Phase 4 Task 4：把 USER.md 接进真实运行时，并受契约控制。

你的目标是修复 USER.md 的运行时断层。
必须坚持：
- USER.md 默认受 memory_read 控制
- Soul/Identity 不是等同于用户画像
- 不要把逻辑重新散落回 prompt.py
```

---

## Task 5：用 Soul Summary 替代默认全文注入，并补最小前后端语义闭环

**目标**
- 用 summary 注入替代长期默认的 `SOUL.md` 原始全文直拼
- 让前端已有的 Soul 相关概念至少部分具备后端语义落点

**Files:**
- Modify: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/lead_agent/prompt.py`
- Modify: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/gateway/routers/config.py` 或相关配置入口
- Modify: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/frontend/src/components/workspace/settings/configuration/sections/memory-section.tsx`
- Modify: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/frontend/src/core/config-center/types.ts`
- Test: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/tests/test_prompt_soul_injection.py`

**Step 1: 先写/补失败测试**

至少覆盖：
- 默认使用 summary 注入
- raw file fallback 仅在明确条件下生效（如果保留）
- `soul.enabled=false` 时 summary 不注入
- `incognito_supported` 不会被误解释成“自动读取长期画像”

**Step 2: 后端最小语义接线**

建议只补最小可解释语义：
- `soul.enabled`
- `soul.seed_from_global`（只在 resolver 组合逻辑中表达）
- `soul.incognito_supported`（只用于是否允许在临时会话保留最小 Soul 一致性，不等于允许读用户画像）

**Step 3: 前端最小语义对齐**

目标是减少漂移，不是做完整配置中心大改。

**Step 4: 跑最小测试**

Run:
```bash
pytest backend/tests/test_prompt_soul_injection.py -q
pytest backend/tests/test_custom_agent.py -q
```

Expected:
- 默认 summary 注入生效
- 现有 agent CRUD 不回退
- 前后端核心文案/字段语义开始对齐

**给 Claude 的任务 Prompt**

```text
你现在执行 Phase 4 Task 5：用 Soul Summary 替代默认全文注入，并补最小前后端语义闭环。

你不是在做完整 Soul 设置中心，只是让已有前端概念与后端真实行为不再完全漂移。
默认应使用 summary 注入，而不是长期全文直拼。
```

---

## Task 6：调试预览、回滚验证与文档回写

**目标**
- 锁定 Soul summary 的调试入口、回滚方式和最终执行总结

**Files:**
- Modify: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/gateway/routers/soul.py` 或 `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/gateway/routers/agents.py`
- Optional Update: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-4-soul-core.md`
- Optional Create: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-4-execution-report.md`

**Step 1: 提供 preview/debug 视图**

至少能回答：
- 当前 resolved soul summary 是什么
- 来源文件有哪些
- 哪些来源缺失/禁用

**Step 2: 明确回滚方式**

至少包括：
- 如何关闭 Soul summary 注入
- 如何退回兼容的 raw `SOUL.md` 注入（如保留）
- 如何暂时禁用 `USER.md` runtime 注入

**Step 3: 跑阶段相关测试**

Run:
```bash
pytest backend/tests/test_soul_paths_and_models.py -q
pytest backend/tests/test_soul_resolver.py -q
pytest backend/tests/test_soul_router.py -q
pytest backend/tests/test_prompt_soul_injection.py -q
pytest backend/tests/test_custom_agent.py -q
pytest backend/tests/test_lead_agent_rss_context.py -q
```

Expected:
- Phase 4 相关测试全部通过
- preview/debug 与回滚方式有证据

**Step 4: 文档回写**

最终必须明确输出：
- `SOUL.md / IDENTITY.md / USER.md` 现在如何存、如何读、如何注入
- `USER.md` 在哪些条件下会进入运行时
- 默认是否已改成 summary 注入
- 哪些能力刻意留给 `Phase 5`

**给 Claude 的任务 Prompt**

```text
你现在执行 Phase 4 Task 6：调试预览、回滚验证与文档回写。

如果你没有实际验证 preview/debug 或回滚路径，就不能宣称 Soul Core 已完成。
最终必须把哪些内容已落地、哪些内容仍刻意未做讲清楚。
```

---

## 推荐执行顺序

严格按以下顺序推进：

1. `Task 0` 前置检查
2. `Task 1` 路径与模型
3. `Task 2` Soul Resolver / Summary Runtime
4. `Task 3` 默认主助手资产接口
5. `Task 4` USER runtime 接线
6. `Task 5` summary 注入与最小前后端语义闭环
7. `Task 6` 调试、回滚、文档回写

不要跳步，不要把 4/5/6 提前混做。

---

## 完成判定（DoD）

只有以下条件都满足，才能宣称 `Phase 4` 完成：

- `Phase 3` 已真实落地
- 默认主助手与自定义 agent 的 Soul 资产路径已正式化
- `IDENTITY.md` 已拥有正式路径与最小接口
- Soul resolver 能输出可注入 summary 与来源信息
- `USER.md` 已真实参与 runtime，且受 `memory_read` 语义约束
- 默认注入已从长期全文直拼升级到 summary 注入
- preview/debug 入口可用
- 回滚路径可说明并验证
- 测试通过，且有执行总结

---

## 给下一位 Agent 的总启动 Prompt

```text
你现在要执行 Nion-Agent 的 `Phase 4 Soul Core 实施计划`。

实施计划文件：
/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-4-soul-core-execution-plan.md

阶段计划文件：
/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-4-soul-core.md

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
5. 不要跨阶段实现 Heartbeat / Evolution / 多智能体产品化
6. 最后必须补一份执行总结
```
