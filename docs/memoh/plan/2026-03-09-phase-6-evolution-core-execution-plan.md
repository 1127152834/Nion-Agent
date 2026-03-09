# Phase 6 Evolution Core 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.
>
> **引用阶段计划：** `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-6-evolution-core.md`
>
> **适用前提：** 只有当 `Phase 5` 已真实落地到代码与测试时，才能执行本计划。若前置不满足，必须停止并输出阻塞报告。

**Goal:** 为 Nion 建立低频、受控、可审计、默认不自动应用的 `Evolution Core`，让系统能够基于 Heartbeat / Memory / Soul 长期信号生成结构化建议，而不是继续停留在“只有 evolution 开关和文案”的状态。

**Architecture:** 不复用 `reflection` 模块做演化引擎，而是新增独立 `evolution` 域：模型、store、service、router。整体路线采用“先前置检查 → 再报告/建议模型 → 再 service 聚合输入 → 再 API 与状态流转 → 再 heartbeat 低频联动 → 最后最小前端与验证”的方式。

**Tech Stack:** Python、FastAPI、Pydantic、本地文件系统、现有 Heartbeat / Memory / Soul 资产、`pytest`

---

## 0. 执行前总原则

### 0.1 必读材料

开始前必须完整阅读：

1. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-5-heartbeat-core.md`
2. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-6-evolution-core.md`
3. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-4-soul-core.md`
4. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-3-structured-memory.md`
5. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/plans/2026-03-09-nion-memoh-research-architecture.md`

### 0.2 硬性边界

执行期间必须始终遵守：

- 不做自治进化引擎
- 不自动重写 Memory / Soul 主资产
- 不做复杂 RL/评分系统
- 不做重型 UI 平台
- 不把所有语义继续塞进 `memory_config.py`
- 不把 `reflection` 模块误用为 Evolution 引擎

### 0.3 当前仓库的现实风险

截至本计划编写时，可以确认：

- `memory_config.py` 已有 `evolution_enabled / evolution_interval_hours`
- 前端 memory settings 已有 `evolution` 文案开关
- `backend/src/reflection` 只是类/变量解析工具
- 当前未看到成熟 `backend/src/evolution/` 域模块

所以 **Task 0** 必须先验证 `Phase 5` 前置与输入来源，而不是直接开始“建议生成”。

---

## Task 0：前置检查与阻塞报告

**目标**
- 验证 `Phase 5` 是否真实落地
- 验证当前 evolution 配置、前端开关、reflection 模块的真实含义

**Files:**
- Read: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/config/memory_config.py`
- Read: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/reflection/__init__.py`
- Read: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/reflection/resolvers.py`
- Read: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/heartbeat/`
- Optional Create: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-6-blocker-report.md`

**Step 1: 验证 Phase 5 是否已真实落地**

至少检查：
- Heartbeat 模板是否已存在
- Heartbeat 日志/结果是否可读
- `memory_maintenance` / `identity_check` 是否已有稳定输出

**Step 2: 验证 evolution 现状**

必须明确回答：
- `evolution_enabled` 当前是否有执行链路
- `reflection` 为什么不能当 Evolution 引擎
- 当前可消费的输入信号有哪些

**Stop Rule**
- `Phase 5` 未落地则停止，不进入 `Task 1+`

---

## Task 1：定义 Evolution 报告、建议与状态模型

**目标**
- 建立 Evolution 的正式模型与本地存储布局

**Files:**
- Create: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/evolution/models.py`
- Create: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/evolution/store.py`
- Create: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/evolution/__init__.py`
- Test: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/tests/test_evolution_models.py`

**Step 1: 先写失败测试**

至少覆盖：
- report 模型
- suggestion 模型
- `pending / accepted / dismissed` 状态
- 三类建议：`memory_suggestion / soul_suggestion / agent_suggestion`

**Step 2: 实现最小模型和 store**

推荐最小文件布局：
- `evolution/reports/`
- `evolution/suggestions/pending`
- `evolution/suggestions/accepted`
- `evolution/suggestions/dismissed`

**Step 3: 跑最小测试**

Run:
```bash
pytest backend/tests/test_evolution_models.py -q
```

Expected:
- report / suggestion / status 模型可用
- 不依赖外部数据库

---

## Task 2：实现 Evolution Service，聚合 Heartbeat / Memory / Soul 输入

**目标**
- 基于长期信号生成结构化报告和建议

**Files:**
- Create: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/evolution/service.py`
- Modify: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/evolution/store.py`
- Test: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/tests/test_evolution_service.py`

**Step 1: 先写失败测试**

至少覆盖：
- 读取 heartbeat 日志/结果
- 读取 memory 维护结果
- 读取 soul summary / identity check 结果
- 生成 report
- 从 report 中提取三类建议

**Step 2: 第一版 service 只做建议生成**

不要在这一步做：
- 自动应用建议
- 复杂评分系统
- 自动重写资产

**Step 3: 跑最小测试**

Run:
```bash
pytest backend/tests/test_evolution_service.py -q
```

Expected:
- 能稳定生成 report 与 suggestions
- 默认不自动应用任何建议

---

## Task 3：补 Evolution Router 与建议状态流转

**目标**
- 提供手动触发、读取报告、查看建议、标记状态的接口

**Files:**
- Create: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/gateway/routers/evolution.py`
- Modify: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/gateway/routers/__init__.py`
- Test: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/tests/test_evolution_router.py`

**Step 1: 先写失败测试**

至少覆盖：
- `POST /api/evolution/run`
- `GET /api/evolution/reports`
- `GET /api/evolution/reports/{id}`
- `GET /api/evolution/suggestions`
- `POST /api/evolution/suggestions/{id}/dismiss`
- 如实现：`POST /api/evolution/suggestions/{id}/accept`

**Step 2: 实现最小状态流转**

默认要求：
- 可查看待处理建议
- 可标记 dismissed
- accepted 如实现，也不能默认自动应用主资产改动

**Step 3: 跑最小测试**

Run:
```bash
pytest backend/tests/test_evolution_router.py -q
```

Expected:
- 手动运行与状态流转可用
- 默认不自动改写主资产

---

## Task 4：与 Heartbeat 低频联动

**目标**
- 让 Evolution 可以由 Heartbeat 低频触发，但仍保持可关闭

**Files:**
- Modify: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/heartbeat/service.py`
- Modify: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/evolution/service.py`
- Test: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/tests/test_evolution_heartbeat_integration.py`

**Step 1: 先写失败测试**

至少覆盖：
- Heartbeat 可触发一次 evolution run
- Evolution 运行后有 report/suggestion
- 全局关闭时不触发

**Step 2: 做低频联动**

默认要求：
- 只触发 run
- 不做自动应用

**Step 3: 跑最小测试**

Run:
```bash
pytest backend/tests/test_evolution_heartbeat_integration.py -q
```

Expected:
- Heartbeat 与 Evolution 联动可用
- 边界仍受控

---

## Task 5：补最小前端表达

**目标**
- 让用户或开发者至少能看到最近报告或待处理建议

**Files:**
- Modify: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/frontend/src/components/workspace/settings/configuration/sections/memory-section.tsx`
- Optional Create: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/frontend/src/core/evolution/*`
- Optional Create: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/frontend/src/components/workspace/evolution/*`

**Step 1: 最小目标**

至少能看到：
- 最近一次 Evolution 运行结果
- 待处理建议数量或列表入口

**Step 2: 不做大型平台**

优先做最小入口，不做复杂控制台。

---

## Task 6：回滚验证、最小演练与文档回写

**目标**
- 锁定 Evolution 的关闭方式、回滚方式与执行总结

**Files:**
- Optional Update: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-6-evolution-core.md`
- Optional Create: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-6-execution-report.md`

**Step 1: 最小演练场景**

至少验证：
- 手动触发一次 Evolution
- 生成 report 与 suggestions
- dismiss 一条建议
- 全局关闭后不再运行

**Step 2: 跑阶段测试**

Run:
```bash
pytest backend/tests/test_evolution_models.py -q
pytest backend/tests/test_evolution_service.py -q
pytest backend/tests/test_evolution_router.py -q
pytest backend/tests/test_evolution_heartbeat_integration.py -q
```

**Step 3: 文档回写**

最终必须明确：
- Evolution 的输入源
- 三类建议的存储与查看方式
- 为什么默认不自动应用
- 哪些内容刻意留给 `Phase 7`

---

## 推荐执行顺序

1. `Task 0` 前置检查
2. `Task 1` 模型与 store
3. `Task 2` service
4. `Task 3` router
5. `Task 4` heartbeat 联动
6. `Task 5` 最小前端表达
7. `Task 6` 演练、回滚、文档回写

---

## 完成判定（DoD）

- `Phase 5` 已真实落地
- Evolution report/suggestion 模型可用
- service 能基于 Heartbeat/Memory/Soul 生成建议
- API 可手动触发和管理建议状态
- 默认不自动应用建议
- Heartbeat 可低频触发 Evolution
- 相关测试通过，且有执行总结

---

## 给下一位 Agent 的总启动 Prompt

```text
你现在要执行 Nion-Agent 的 `Phase 6 Evolution Core 实施计划`。

实施计划文件：
/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-6-evolution-core-execution-plan.md

阶段计划文件：
/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-6-evolution-core.md

项目根目录：
/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent

执行规则：
1. 先完整阅读实施计划与阶段计划
2. 从 Task 0 开始，顺序执行
3. 如果前置不满足，停止并输出 blocker report
4. 每完成一个 Task，都要输出修改文件、测试结果、当前阻塞
5. 不要跨阶段实现多智能体产品化
6. 最后必须补一份执行总结
```
