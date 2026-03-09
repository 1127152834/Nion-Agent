# Phase 5：Heartbeat Core 周期任务与助手节律

> **给执行 Agent：** 这是一份可直接执行的阶段计划文档，但你**不能跳过上下文**直接开发。请先验证 `Phase 3` 与 `Phase 4` 是否已经真实落地，再检查现有 `scheduler` 是否已经稳定运行，然后再开始 Heartbeat Core 的实现。
>
> **阶段目标一句话版：** 在不新建第二套调度系统的前提下，把现有 `scheduler` 升级成面向个人助手的 `Heartbeat Core` 语义层，提供默认心跳模板、心跳日志、心跳设置与低频维护动作，让 Nion 从“会被动响应”进化为“会按节律主动照顾用户与系统状态”的桌面助手。

- 阶段编号：`Phase 5`
- 优先级：`P0`
- 前置阶段：`Phase 3：结构化记忆存储与维护能力`、`Phase 4：Soul Core 身份与长期陪伴层`
- 后续阶段：`Phase 6：Evolution Core 低频反思与建议层`
- 是否允许独立实施：`不允许`（若 Phase 3 / Phase 4 未真实落地，本阶段必须先停止）
- 风险等级：`中`
- 预估改动范围：`中`

---

## 1. 阶段定位

当前 Nion 已经有一个真实可用的 `scheduler`：

- 支持 `cron / interval / once / event / webhook`
- 支持 `workflow / reminder` 两类任务模式
- 已有后端 router、runner、store、history
- 已有前端任务管理页与 reminder watcher

但这还不是 `Heartbeat Core`。

`Heartbeat Core` 不是新的定时引擎，而是：

> 建立在现有 scheduler 之上的“个人助手周期行为语义层”。

它关心的不是“任务什么时候跑”本身，而是：

- 哪些周期任务应该默认存在
- 哪些任务属于“个人助手节律”，而不是普通 workflow
- 哪些结果应该沉淀为心跳日志
- 哪些动作要连到 `Memory Core` 与 `Soul Core`
- 如何让这些能力对单用户桌面端保持轻量、可控、可关闭

因此本阶段解决的不是“调度器有没有 API”，而是：

- **把通用 scheduler 提升为助手级节律层**
- **定义默认心跳模板与日志语义**
- **让低频主动行为成为产品能力，而不是散落在临时任务里**

---

## 2. Context Pack

### 2.1 必读文档

执行前必须阅读以下文档，并在开始编码前输出 8-12 句话总结你理解到的关键事实：

1. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-3-structured-memory.md`
   - 作用：确认 Heartbeat 未来要调用哪些记忆维护能力
   - 读完后你应该知道：`memory_maintenance` 不应自己重造记忆治理逻辑，而应复用 `usage / compact / rebuild`

2. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-4-soul-core.md`
   - 作用：确认 Heartbeat 未来如何与 `SOUL / IDENTITY / USER` 交互
   - 读完后你应该知道：`identity_check` 只能产出建议或摘要，不能在本阶段自动重写身份资产

3. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/plans/2026-03-09-nion-memoh-research-architecture.md`
   - 作用：确认 Heartbeat 的定位、默认模板与与 Evolution 的边界
   - 读完后你应该知道：Heartbeat 是个人助手行为层，Evolution 才是低频反思建议层

4. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-5-heartbeat-core.md`
   - 作用：这是当前阶段计划本身，必须逐节核对边界与不做项

### 2.2 必读代码

执行前必须先阅读以下代码，并确认现有 scheduler 的真实能力：

1. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/scheduler/models.py`
   - 你需要确认任务模型、触发器类型、历史记录模型当前已经具备哪些字段

2. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/scheduler/service.py`
   - 你需要确认任务创建、更新、删除、立即执行的服务边界

3. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/scheduler/runner.py`
   - 你需要确认任务实际执行与历史记录是如何落下来的

4. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/scheduler/store.py`
   - 你需要确认 scheduler 当前已经是文件化存储（`tasks.json / history.json`）

5. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/gateway/routers/scheduler.py`
   - 你需要确认现有调度 API 已经提供了哪些通用能力

6. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/frontend/src/core/scheduler/types.ts`
   - 你需要确认前端当前已经理解哪些任务字段

7. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/frontend/src/app/workspace/scheduler/page.tsx`
8. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/frontend/src/components/workspace/scheduler/task-manager.tsx`
9. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/frontend/src/components/workspace/scheduler/scheduler-reminder-watcher.tsx`
   - 你需要确认现有 UI 适合复用哪些部分，不要重做完整调度界面

10. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/gateway/routers/workbench.py`
11. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/frontend/src/core/workbench/sdk.ts`
   - 你需要确认当前名为 `heartbeat` 的 SSE 事件只是连接/会话层事件，不等于 Heartbeat Core 域模型

### 2.3 已知事实（禁止再猜）

以下事实已经由当前仓库与研究文档确认：

- 当前已经存在通用 `scheduler`，并且任务与历史都以本地文件形式持久化
- 当前 scheduler 已支持 workflow 与 reminder 两种模式
- 当前前端已经有 scheduler 管理页与提醒监听能力
- 当前并没有正式的 `Heartbeat Core` 领域模型、默认模板或设置中心
- 当前 workbench / SSE 中的 `heartbeat` 事件更偏连接保活，不是“每日回顾/每周整理”这类产品语义
- 当前还没有 `daily_review / weekly_reset / memory_maintenance / identity_check` 这类默认心跳任务集
- 当前 Heartbeat 还没有和 `Memory Core`、`Soul Core` 建立正式接口关系
- 本阶段必须复用现有 scheduler，不允许另起一套定时框架
- 本阶段不能偷跑 Evolution 自动建议与自动改写
- 本阶段必须保持轻量、本地优先、可关闭、可审计

---

## 3. 当前系统状态（As-Is Context）

### 3.1 现有 scheduler 已经是很好的执行底座

当前 `backend/src/scheduler/*` 已经提供：

- 任务定义模型
- 触发器配置校验
- 运行状态与执行记录
- 本地文件持久化
- Router 暴露与前端管理能力

这意味着 Heartbeat 不需要自己再发明：

- cron 引擎
- 任务队列
- 任务持久化
- 基础提醒能力

### 3.2 当前缺的是“个人助手语义层”，不是“调度引擎”

现在的 scheduler 更像一个通用任务系统，用户可以：

- 配提醒
- 配 workflow
- 看历史

但系统还不知道：

- 哪些任务属于默认助手心跳
- 哪些日志属于长期节律记录
- 哪些动作应该默认启用、默认禁用、默认推荐
- 哪些周期任务需要调用 Memory Core 和 Soul Core

### 3.3 当前 scheduler 历史是有的，但心跳日志语义还没有

`scheduler/store.py` 已有 `tasks.json` 与 `history.json`。这很好，因为说明：

- Heartbeat Core 可以复用现有落盘能力
- 不必新增外部 DB
- 可以在本地追踪心跳任务执行情况

但还没有“心跳任务日志”的概念，例如：

- 每日回顾生成了什么摘要
- 本次记忆维护做了什么
- 这次身份检查输出了什么建议
- 哪些日志适合用户回看，哪些只是系统执行记录

### 3.4 当前前端有调度器，但没有助手节律设置层

当前前端 scheduler 页更偏通用任务管理，而不是 Heartbeat 设置层。

也就是说，当前用户能看到的是“任务”，但还看不到：

- 这是每天回顾还是每周整理
- 这是系统维护还是生活提醒
- 当前是否启用了默认心跳包
- 最近一次心跳为个人助手带来了什么结果

### 3.5 当前 Heartbeat 仍未和 Memory / Soul 对接

在理想状态下：

- `daily_review` 会读近期工作/生活上下文并产出回顾
- `memory_maintenance` 会调用 `Memory Core` 的维护能力
- `identity_check` 会读取 `Soul Core` 资产并输出低频建议

而当前这些关系都还没有正式落地。

---

## 4. 本阶段要解决的核心问题

本阶段要解决以下六类问题：

1. **通用 scheduler 没有个人助手语义层**
2. **没有默认 heartbeat 模板与任务集**
3. **没有心跳日志分类与可回看产物**
4. **Heartbeat 与 Memory / Soul 尚未建立稳定接口**
5. **前端缺少“助手节律”层面的配置与状态表达**
6. **后续 Evolution 缺少稳定输入来源**

---

## 5. 本阶段目标

### 5.1 目标一：定义 Heartbeat Core 的正式边界

`Heartbeat Core` 必须被定义为：

- 建立在 scheduler 之上的语义层
- 负责默认周期任务模板、任务分组、设置、日志和最小结果产物
- 不是新的调度框架

### 5.2 目标二：落地默认心跳模板

至少定义并支持以下默认心跳：

- `daily_review`
- `weekly_reset`
- `memory_maintenance`
- `identity_check`

### 5.3 目标三：建立 Heartbeat 设置与模板接线

系统至少要能表达：

- 是否启用 Heartbeat
- 启用哪些默认心跳
- 每种心跳的运行频率/时区
- 是否允许产生用户可见日志或提醒

### 5.4 目标四：建立 Heartbeat 日志与结果沉淀

Heartbeat 不能只留在 scheduler `history.json` 里。它至少要能产出：

- 可区分的 heartbeat 运行记录
- 面向用户/开发者可回看的摘要产物
- 与 Memory / Soul / 后续 Evolution 可衔接的结果结构

### 5.5 目标五：让 Heartbeat 正式调用 Memory Core 与 Soul Core

至少做到：

- `memory_maintenance` 调用 `usage / compact / rebuild`
- `identity_check` 调用 Soul summary/资产读取，但默认只产出建议或摘要
- `daily_review / weekly_reset` 能读取长期记忆和最近上下文，产出阶段性总结

---

## 6. 本阶段明确不做

以下内容本阶段明确不做：

1. **不重写 scheduler**
   - 不引入第二套调度器，不替换 APScheduler，不重做任务存储

2. **不做 Evolution Core**
   - `identity_check` 或 `memory_maintenance` 可以产出建议，但不自动做大规模修改

3. **不做重型通知基础设施**
   - 不接入复杂远程推送、外部消息中间件、云任务系统

4. **不做复杂自治计划器**
   - Heartbeat 不是“系统自己无限生成任务”的自治平台

5. **不做庞大新 UI 平台**
   - 可在现有 scheduler 基础上补最小设置与状态表达，但不新做大型控制台

6. **不做复杂跨设备同步**
   - 先以本地桌面端文件与本地状态为准

7. **不做无边界高频执行**
   - Heartbeat 默认是低频、受控、可关闭的

---

## 7. 默认规则与决策闭环

### 7.1 Heartbeat Core 的正式定义

从本阶段开始，Heartbeat 必须被定义为：

- 个人助手的低频主动行为层
- 调度逻辑由 scheduler 承担
- 语义、模板、日志、设置由 Heartbeat Core 承担

### 7.2 默认模板决策

本阶段默认只做四个模板：

1. `daily_review`
   - 总结今天、整理待办、更新 top-of-mind

2. `weekly_reset`
   - 回顾本周项目、整理长期目标、提示下周重点

3. `memory_maintenance`
   - 复用 `Memory Core` 的 `usage / compact / rebuild`

4. `identity_check`
   - 读取 `Soul Core`，产出身份/风格/边界建议摘要

如果你还想加更多模板，必须先证明：这是不是当前个人助手的刚需，而不是泛化冲动。

### 7.3 调度复用决策

本阶段不新建第二套调度系统。应优先复用：

- `backend/src/scheduler/models.py`
- `backend/src/scheduler/service.py`
- `backend/src/scheduler/runner.py`
- `backend/src/scheduler/store.py`
- `/api/scheduler/*`

如需扩展任务语义，优先通过**轻量 metadata / category / template_id** 方式增强，而不是复制一份 Heartbeat 专用任务系统。

### 7.4 日志决策

Heartbeat 至少要同时有两层结果：

- **系统执行记录**：继续复用 scheduler `history.json`
- **心跳语义产物**：面向用户/开发者回看的摘要日志

推荐但不强制的文件布局示例：

```text
{base_dir}/heartbeat/
├── logs/
│   ├── 2026-03-09-daily_review.md
│   ├── 2026-03-10-memory_maintenance.md
│   └── ...
└── settings.json
```

如果你不想落独立文件，也至少要让 scheduler `last_result` / history 能区分 heartbeat 类型并承载摘要结果。

### 7.5 结果边界决策

本阶段 Heartbeat 运行结果默认分成三类：

- `summary`：给用户看或给系统下游消费的摘要
- `maintenance_report`：面向 Memory Core 的维护结果
- `suggestion`：供下一阶段 Evolution 使用的低频建议

### 7.6 与 Memory / Soul 的关系决策

- Heartbeat 是 `Memory Core` 和 `Soul Core` 的消费者，不应重新实现它们的内部逻辑
- `memory_maintenance` 应优先调用 Phase 3 暴露的维护接口
- `identity_check` 应优先调用 Phase 4 的 resolver/summary，而不是自己拼 prompt

### 7.7 开关与频率决策

本阶段必须允许：

- 全局关闭 Heartbeat
- 单独关闭某个 heartbeat 模板
- 配置时区与执行频率
- 区分“只生成日志”和“生成提醒”两种结果表现

---

## 8. 实现方案

### 8.1 工作包 A：定义 Heartbeat 域模型与模板元数据

**目标**
- 正式定义 heartbeat 模板、类别、设置与结果类型

**建议修改点**
- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/scheduler/models.py`
- 新增 `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/heartbeat/` 相关轻量模块（命名可微调）

**完成标准**
- 存在 Heartbeat 模板与设置模型
- 能区分 generic scheduler task 与 heartbeat task
- 不需要新建第二套任务框架

### 8.2 工作包 B：实现 Heartbeat Service，复用 scheduler

**目标**
- 在 scheduler 之上建立 Heartbeat Service，用于模板注册、任务 bootstrap、开关同步与日志归档

**建议新增位置**
- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/heartbeat/service.py`
- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/heartbeat/templates.py`
- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/heartbeat/store.py`（如果需要）

**完成标准**
- 能一键初始化默认心跳任务集
- 能根据设置启停默认心跳
- 能复用 scheduler 创建与执行任务

### 8.3 工作包 C：补 Heartbeat API 与最小设置入口

**目标**
- 给前端和后续系统一个正式的 Heartbeat 接口层

**建议修改点**
- 新增 `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/gateway/routers/heartbeat.py`
- 或在现有 scheduler router 之外增加薄封装，不要把 Heartbeat 语义直接塞满 scheduler router

**最低接口建议**
- `GET /api/heartbeat/settings`
- `PUT /api/heartbeat/settings`
- `GET /api/heartbeat/templates`
- `POST /api/heartbeat/bootstrap`
- `GET /api/heartbeat/logs`

**完成标准**
- Heartbeat 具有独立的语义入口
- 仍然复用 scheduler 作为执行底座

### 8.4 工作包 D：接入 Memory Core 与 Soul Core

**目标**
- 让 heartbeat 模板不只是“空提醒”，而是能触发真正的个人助手维护行为

**建议重点**
- `memory_maintenance` -> 调用 `usage / compact / rebuild`
- `identity_check` -> 调用 Soul summary，产出建议摘要
- `daily_review / weekly_reset` -> 读取长期记忆、近期上下文、必要工作台信息，产出回顾产物

**完成标准**
- 默认模板至少有两类真实对接：系统维护类、用户陪伴类
- 不自己重写 Memory / Soul 内部逻辑

### 8.5 工作包 E：补最小前端表达

**目标**
- 在现有 scheduler UI 基础上，让用户知道“这不是普通任务，而是助手心跳”

**建议修改点**
- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/frontend/src/core/scheduler/*`
- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/frontend/src/app/workspace/scheduler/page.tsx`
- 或新增轻量 heartbeat 设置区域

**完成标准**
- 用户可以看到默认 heartbeat 模板与启用状态
- 至少可以查看最近心跳日志或结果摘要
- 不需要新做大型管理平台

### 8.6 工作包 F：补测试与最低回归验证

**目标**
- 用测试锁住 Heartbeat 与 scheduler / memory / soul 的接线

**建议新增测试**
- `backend/tests/test_heartbeat_service.py`
- `backend/tests/test_heartbeat_router.py`
- `backend/tests/test_heartbeat_scheduler_integration.py`

**最少覆盖场景**
- 默认 heartbeat 模板可 bootstrap
- 全局关闭时 heartbeat 不运行
- `memory_maintenance` 会调用 Memory Core 维护接口
- `identity_check` 默认只产出建议，不自动改写 Soul 资产
- Heartbeat 日志可被读取
- scheduler 历史仍然正常记录

---

## 9. Agent 实施顺序

建议执行顺序如下：

1. 先验证 `Phase 3` 与 `Phase 4` 是否已真实落地
2. 梳理 scheduler 现有模型、存储、前端页面与 reminder watcher
3. 定义 heartbeat 模板、设置与日志模型
4. 落地 Heartbeat Service，并复用 scheduler 做 bootstrap
5. 新增 Heartbeat API
6. 接入 Memory Core 与 Soul Core
7. 补最小前端表达
8. 跑集成测试与一次最小 heartbeat 演练
9. 回写执行总结，明确 Heartbeat 与 scheduler 的边界已经如何固化

---

## 10. 验收标准

只有同时满足以下条件，才能认为 `Phase 5` 完成：

1. Heartbeat 已成为建立在 scheduler 之上的独立语义层
2. 默认四个 heartbeat 模板至少已经定义并可管理
3. Heartbeat 具有独立设置入口，而不是完全混在 generic task 中
4. Heartbeat 运行结果可通过日志或摘要回看
5. `memory_maintenance` 已与 Memory Core 维护能力接通
6. `identity_check` 已与 Soul Core 接通，且默认只产出建议/摘要
7. 全局关闭与单模板关闭都可用
8. 没有新建第二套调度系统
9. 自动化测试覆盖模板、bootstrap、设置开关、日志与 Memory/Soul 接线
10. 前端至少能看见 Heartbeat 的存在与最近结果

---

## 11. 回滚方案

### 11.1 运行时回滚

- 关闭 Heartbeat 全局开关
- 保留 scheduler 作为通用任务系统继续运行
- 停止默认 heartbeat 模板的 bootstrap 或执行

### 11.2 数据回滚

- 保留 scheduler `tasks.json / history.json`
- Heartbeat 新增日志文件可保留但不作为当前主入口
- 不删除用户已有普通 scheduler 任务

### 11.3 接口回滚

- `/api/heartbeat/*` 可暂时关闭或降级为只读
- `/api/scheduler/*` 继续保持兼容

### 11.4 验证回滚

至少验证：

- 普通 scheduler 任务仍能正常运行
- reminder watcher 仍能正常工作
- 关闭 Heartbeat 后不会继续触发默认低频动作

---

## 12. 本阶段完成后的产品成效

如果 `Phase 5` 完成，Nion 会获得以下关键升级：

1. **从被动问答工具升级为有节律的个人助手**
2. **日/周回顾、记忆维护、身份检查第一次成为正式产品能力**
3. **现有 scheduler 获得个人助手语义层，而不是继续停留在通用任务工具**
4. **后续 Evolution 有了稳定输入来源：心跳日志、维护结果、身份建议**
5. **整个系统仍然保持轻量、本地优先、可关闭、可回滚**

---

## 13. 下一阶段衔接

本阶段完成后，下一阶段进入：`Phase 6：Evolution Core 低频反思与建议层`。

`Phase 6` 将建立在以下输入之上：

- Heartbeat 日志
- Memory Core 的维护结果
- Soul Core 的身份摘要与低频建议
- 最近任务结果与用户反馈

没有 Heartbeat，Evolution 就没有稳定节律与样本；只有 Heartbeat 但没有 Evolution，则系统只能定期执行动作，无法形成受控反思层。

---

## 14. 给 Claude 的启动 Prompt

你现在要执行 Nion × Memoh 升级线的 `Phase 5：Heartbeat Core 周期任务与助手节律`，但你**不能直接开始写代码**。

请先按下面顺序工作：

1. 阅读以下文档：
   - `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-3-structured-memory.md`
   - `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-4-soul-core.md`
   - `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-5-heartbeat-core.md`
   - `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/plans/2026-03-09-nion-memoh-research-architecture.md`

2. 阅读以下代码：
   - `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/scheduler/models.py`
   - `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/scheduler/service.py`
   - `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/scheduler/runner.py`
   - `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/scheduler/store.py`
   - `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/gateway/routers/scheduler.py`
   - `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/frontend/src/app/workspace/scheduler/page.tsx`
   - `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/frontend/src/components/workspace/scheduler/task-manager.tsx`
   - `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/frontend/src/components/workspace/scheduler/scheduler-reminder-watcher.tsx`

3. 先输出“Heartbeat 前置检查摘要”，至少回答：
   - Phase 3 和 Phase 4 是否都已真实落地？
   - 当前 scheduler 已经具备哪些能力？
   - 当前 workbench 的 `heartbeat` 事件是不是 Heartbeat Core？
   - 当前哪些默认 heartbeat 模板还完全缺失？
   - Heartbeat 最不应该重复造什么轮子？

4. 如果前置不满足，请停止本阶段开发并汇报缺口；不要把 Memory / Soul / Heartbeat 混在一个提交里硬做。

5. 如果前置满足，再给出你准备如何实现 `heartbeat templates / heartbeat service / logs / settings / scheduler integration` 的执行计划，然后再进入编码。

你的约束如下：

- 你必须复用现有 scheduler，不允许另起一套定时框架
- 你必须让 Heartbeat 保持低频、可关闭、可回滚
- 你必须让 `memory_maintenance` 和 `identity_check` 调用已有核心能力，而不是重写内部逻辑
- 你不能在本阶段加入 Evolution 自动改写
- 你不能把前端做成大型新平台

---

## 15. 给 Claude 的实施 Prompt

请在 `Nion-Agent` 仓库中实现 `Phase 5：Heartbeat Core 周期任务与助手节律`，实现目标如下：

### 任务目标

基于现有 scheduler，新增一层轻量 `Heartbeat Core`，提供：

- 默认 heartbeat 模板：`daily_review / weekly_reset / memory_maintenance / identity_check`
- Heartbeat 设置与 bootstrap
- Heartbeat 日志或结果摘要
- 与 `Memory Core`、`Soul Core` 的正式接线
- 最小前端可见性

### 你必须先做的事情

1. 检查 Phase 3 与 Phase 4 是否已经落地
2. 检查当前 scheduler 的模型、store、router、前端页面与 reminder watcher
3. 如果前置不满足，停止并汇报
4. 如果前置满足，再先设计模板与测试，再写实现

### 推荐切入文件

- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/scheduler/models.py`
- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/scheduler/service.py`
- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/scheduler/runner.py`
- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/gateway/routers/scheduler.py`
- 新增 `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/heartbeat/` 相关模块
- 适量修改 `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/frontend/src/core/scheduler/*`

### 推荐新增测试

- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/tests/test_heartbeat_service.py`
- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/tests/test_heartbeat_router.py`
- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/tests/test_heartbeat_scheduler_integration.py`

### 你应该做的事情

- 定义 Heartbeat 模板与设置模型
- 复用 scheduler 做 bootstrap 与执行
- 提供独立的 Heartbeat API
- 接入 Memory Core 与 Soul Core
- 增加日志/摘要回看
- 补充最小前端表达与自动化测试

### 你不应该做的事情

- 不重写 scheduler
- 不做 Evolution 自动建议执行
- 不做复杂远程通知基础设施
- 不做重型自治计划器
- 不做庞大新 UI 平台

### 验收要求

你完成后必须明确汇报：

1. Heartbeat 与 scheduler 的边界现在是什么
2. 四个默认 heartbeat 模板如何定义、如何启停
3. 心跳日志或结果摘要存在哪里、怎么看
4. `memory_maintenance` 和 `identity_check` 分别调用了什么
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
- 下一阶段 Evolution Core 可以直接利用哪些输入与接口
