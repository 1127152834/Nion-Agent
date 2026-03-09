# Phase 5 Heartbeat Core 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.
>
> **引用阶段计划：** `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-5-heartbeat-core.md`
>
> **适用前提：** 只有当 `Phase 3` 与 `Phase 4` 已真实落地到代码与测试时，才能执行本计划。若前置不满足，必须停止并输出阻塞报告。

**Goal:** 基于现有 scheduler，把 Nion 升级为拥有默认心跳模板、心跳设置、心跳日志和低频维护能力的个人助手，而不是继续停留在“通用定时任务系统”。

**Architecture:** 严格复用现有 `scheduler` 作为执行底座，在其上增加轻量 `Heartbeat Core` 语义层：模板、设置、日志、bootstrap、Memory/Soul 接线。路线采用“先前置检查 → 再模板与模型 → 再 heartbeat service/store → 再 router → 再 Memory/Soul 集成 → 再最小前端表达 → 最后验证与回滚”的保守方式。

**Tech Stack:** Python、FastAPI、Pydantic、现有 `scheduler` 文件存储、前端 scheduler 页面、`pytest`

---

## 0. 执行前总原则

### 0.1 必读材料

开始前必须完整阅读：

1. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-3-structured-memory.md`
2. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-4-soul-core.md`
3. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-5-heartbeat-core.md`
4. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/plans/2026-03-09-nion-memoh-research-architecture.md`

### 0.2 硬性边界

执行期间必须始终遵守：

- 不重写 `scheduler`
- 不引入第二套定时框架
- 不做 `Evolution Core`
- 不做重型通知基础设施
- 不做复杂自治计划器
- 不做大型全新 UI 平台
- 不做跨设备同步体系

### 0.3 当前仓库的现实风险

截至本计划编写时，可以确认：

- `scheduler` 模型、service、runner、router、store 已存在
- `scheduler` 测试已存在：`test_scheduler_router.py`、`test_scheduler_management_tools.py`
- 前端已有 scheduler 页面与 reminder watcher
- `workbench` 中名为 `heartbeat` 的 SSE 更偏连接保活，不是 Heartbeat Core 语义
- `backend/src/heartbeat/` 当前并未看到成熟领域模块

所以 **Task 0** 仍然必须先检查 `Phase 3/4` 前置，而不是直接做心跳模板。

---

## Task 0：前置检查与阻塞报告

**目标**
- 验证 `Phase 3` 与 `Phase 4` 是否真实落地
- 验证当前 scheduler 的真实能力与 `heartbeat` 现状
- 若前置不满足，停止并输出 blocker report

**Files:**
- Read: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/scheduler/models.py`
- Read: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/scheduler/service.py`
- Read: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/scheduler/runner.py`
- Read: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/gateway/routers/scheduler.py`
- Read: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/gateway/routers/workbench.py`
- Read: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/frontend/src/core/workbench/sdk.ts`
- Optional Create: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-5-blocker-report.md`

**Step 1: 验证 Phase 3/4 是否真实落地**

至少检查：
- structured memory provider/runtime 是否已可用
- Soul resolver / summary 是否已可用
- `memory_maintenance` 和 `identity_check` 未来可调用的接口是否真实存在

**Step 2: 验证 scheduler 现状**

必须明确回答：
- 当前 scheduler 能否创建/运行/记录 workflow 与 reminder
- 当前 tasks/history 存储在哪里
- 现有前端 scheduler 页是否能复用
- 当前所谓 `heartbeat` 事件是否只是 SSE 保活

**Stop Rule**
- `Phase 3/4` 任一未落地则停止，不进入 `Task 1+`

**给 Claude 的任务 Prompt**

```text
你现在执行的是 Nion-Agent 的 Phase 5 Task 0：前置检查与阻塞报告。

请先不要改代码。你必须先检查：
1. Phase 3 和 Phase 4 是否真实落地
2. 当前 scheduler 的真实能力
3. 当前 workbench heartbeat 事件是不是 Heartbeat Core

如果前置不满足，停止后续实现，并输出 blocker report。
```

---

## Task 1：定义 Heartbeat 模板、设置与日志模型

**目标**
- 建立 Heartbeat Core 的最小领域模型

**Files:**
- Create: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/heartbeat/models.py`
- Create: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/heartbeat/templates.py`
- Optional Create: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/heartbeat/__init__.py`
- Test: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/tests/test_heartbeat_models.py`

**Step 1: 先写失败测试**

至少覆盖：
- 默认四个模板：`daily_review / weekly_reset / memory_maintenance / identity_check`
- Heartbeat 设置模型
- Heartbeat 日志/结果模型
- 模板 ID、频率、开关、结果类型校验

**Step 2: 实现最小模型**

至少包含：
- `HeartbeatTemplate`
- `HeartbeatSettings`
- `HeartbeatRunSummary`
- `HeartbeatLogRecord`

**Step 3: 跑最小测试**

Run:
```bash
pytest backend/tests/test_heartbeat_models.py -q
```

Expected:
- Heartbeat 模板和设置模型可用
- 不影响现有 scheduler 模型

---

## Task 2：实现 Heartbeat Store / Service 与默认模板 bootstrap

**目标**
- 在 scheduler 之上建立 heartbeat service，用于管理默认模板与设置

**Files:**
- Create: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/heartbeat/store.py`
- Create: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/heartbeat/service.py`
- Modify: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/scheduler/service.py`
- Test: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/tests/test_heartbeat_service.py`

**Step 1: 先写失败测试**

至少覆盖：
- bootstrap 默认模板到 scheduler
- 全局开关关闭时不创建 heartbeat 任务
- 重复 bootstrap 幂等
- 模板启停与 scheduler 任务同步

**Step 2: 实现 Heartbeat Service**

职责建议：
- 读取/保存 heartbeat settings
- 根据 settings 生成/同步默认 scheduler tasks
- 区分 heartbeat task 与 generic scheduler task

**Step 3: 跑最小测试**

Run:
```bash
pytest backend/tests/test_heartbeat_service.py -q
```

Expected:
- 默认模板可初始化到 scheduler
- 设置和任务同步可工作

---

## Task 3：补 Heartbeat Router 与日志读取能力

**目标**
- 提供 Heartbeat 的正式 API 入口，而不是把语义硬塞进 scheduler router

**Files:**
- Create: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/gateway/routers/heartbeat.py`
- Modify: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/gateway/routers/__init__.py`
- Test: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/tests/test_heartbeat_router.py`

**Step 1: 先写失败测试**

至少覆盖：
- `GET /api/heartbeat/settings`
- `PUT /api/heartbeat/settings`
- `GET /api/heartbeat/templates`
- `POST /api/heartbeat/bootstrap`
- `GET /api/heartbeat/logs`

**Step 2: 落最小接口**

允许第一版只读/轻写，但必须有清晰语义。

**Step 3: 跑最小测试**

Run:
```bash
pytest backend/tests/test_heartbeat_router.py -q
pytest backend/tests/test_scheduler_router.py -q
```

Expected:
- Heartbeat API 可用
- scheduler router 不回退

---

## Task 4：接入 Memory / Soul，完成两个关键模板

**目标**
- 让 heartbeat 不只是“提醒”，而是能做真正的个人助手维护动作

**Files:**
- Modify: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/heartbeat/service.py`
- Modify: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/heartbeat/templates.py`
- Modify: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/scheduler/runner.py`
- Test: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/tests/test_heartbeat_memory_soul_integration.py`

**Step 1: 先写失败测试**

至少覆盖：
- `memory_maintenance` 会调用 `usage / compact / rebuild`
- `identity_check` 会调用 Soul summary / preview 入口
- 默认只产出摘要/建议，不自动改写资产

**Step 2: 先打通两个关键模板**

优先顺序：
1. `memory_maintenance`
2. `identity_check`

再考虑：
- `daily_review`
- `weekly_reset`

**Step 3: 跑最小测试**

Run:
```bash
pytest backend/tests/test_heartbeat_memory_soul_integration.py -q
```

Expected:
- 两个维护型模板可工作
- 不绕过 Memory / Soul 正式边界

---

## Task 5：补最小前端表达

**目标**
- 让用户能看到 Heartbeat 的存在、模板和最近结果

**Files:**
- Modify: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/frontend/src/core/scheduler/types.ts`
- Modify: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/frontend/src/app/workspace/scheduler/page.tsx`
- Modify: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/frontend/src/components/workspace/scheduler/task-manager.tsx`
- Optional Create: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/frontend/src/core/heartbeat/*`

**Step 1: 前端最小目标**

至少能看到：
- 默认 heartbeat 模板列表
- 启用状态
- 最近一次运行摘要或日志入口

**Step 2: 不要重做整页**

优先复用现有 scheduler 页和 task manager。

**Step 3: 如有前端测试则补最小测试，否则只做类型和交互自检**

---

## Task 6：回滚验证、最小演练与文档回写

**目标**
- 锁定 Heartbeat 的关闭方式、回滚方式和执行总结

**Files:**
- Optional Update: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-5-heartbeat-core.md`
- Optional Create: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-5-execution-report.md`

**Step 1: 最小演练场景**

建议至少验证：
- heartbeat bootstrap
- 全局关闭后停止默认模板
- `memory_maintenance` 成功产出结果
- `identity_check` 只产出建议/摘要

**Step 2: 跑阶段测试**

Run:
```bash
pytest backend/tests/test_scheduler_router.py -q
pytest backend/tests/test_scheduler_management_tools.py -q
pytest backend/tests/test_heartbeat_models.py -q
pytest backend/tests/test_heartbeat_service.py -q
pytest backend/tests/test_heartbeat_router.py -q
pytest backend/tests/test_heartbeat_memory_soul_integration.py -q
```

**Step 3: 文档回写**

最终必须明确：
- Heartbeat 与 scheduler 的边界
- 默认模板定义与启停方式
- 日志/摘要落点
- 哪些内容刻意留给 `Phase 6`

---

## 推荐执行顺序

1. `Task 0` 前置检查
2. `Task 1` 模板/设置/日志模型
3. `Task 2` service/store/bootstrap
4. `Task 3` router
5. `Task 4` Memory/Soul 集成
6. `Task 5` 最小前端表达
7. `Task 6` 演练、回滚、文档回写

---

## 完成判定（DoD）

- `Phase 3/4` 已真实落地
- Heartbeat 模板、设置、日志模型可用
- Heartbeat Service 可 bootstrap 默认模板
- Heartbeat API 可用
- `memory_maintenance` 与 `identity_check` 已接通
- 可全局关闭/单模板关闭
- 不存在第二套调度系统
- 相关测试通过，且有执行总结

---

## 给下一位 Agent 的总启动 Prompt

```text
你现在要执行 Nion-Agent 的 `Phase 5 Heartbeat Core 实施计划`。

实施计划文件：
/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-5-heartbeat-core-execution-plan.md

阶段计划文件：
/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-5-heartbeat-core.md

项目根目录：
/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent

执行规则：
1. 先完整阅读实施计划与阶段计划
2. 从 Task 0 开始，顺序执行
3. 如果前置不满足，停止并输出 blocker report
4. 每完成一个 Task，都要输出修改文件、测试结果、当前阻塞
5. 不要跨阶段实现 Evolution / 多智能体产品化
6. 最后必须补一份执行总结
```
