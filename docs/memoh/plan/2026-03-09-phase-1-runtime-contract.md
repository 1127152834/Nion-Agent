# Phase 1：运行时契约对齐与临时会话记忆保护

> **给执行 Agent：** 这是一份可直接执行的阶段计划文档，但你**不能跳过上下文**直接开发。请先完整阅读本文的 `Context Pack`、输出一段你对现状与目标的理解摘要，再开始实现。
>
> **阶段目标一句话版：** 在不重构 Memory Core 的前提下，先把 `session_mode / memory_read / memory_write` 做成真正生效的后端运行时契约，并确保 `temporary_chat` 不污染长期记忆。

- 阶段编号：`Phase 1`
- 优先级：`P0`
- 适用对象：负责当前仓库实现的 Claude / Codex / 其他工程型 Agent
- 前置阶段：无
- 后续阶段：`Phase 2：Memory Core 骨架化`
- 是否允许独立实施：允许
- 预估改动范围：小到中
- 风险等级：低到中

---

## 1. 阶段定位

本阶段不是要把记忆系统一次性重做，而是要先修掉当前最危险的“产品语义已经存在、后端运行时却没有真正执行”的错位问题。

当前系统已经有这些事实：

- 前端线程上下文已经定义 `session_mode`、`memory_read`、`memory_write`
- 临时会话已经透传 `memory_write=false` 与 `session_mode=temporary_chat`
- 但后端线程状态和运行时中间件没有统一消费这些字段
- 结果是：UI 和产品语义承诺“临时会话不写长期记忆”，但后端主链路未必真正遵守

这会直接破坏用户对长期记忆的信任，也会让后续的 `Memory Core`、`Soul Core`、`Heartbeat Core` 都建立在一个错误的策略底座上。

因此，`Phase 1` 的职责非常明确：

1. 统一线程运行时契约
2. 建立轻量记忆会话策略层
3. 让注入链路和写回链路都遵守同一套策略
4. 用测试锁住这些行为

---

## 2. Context Pack

### 2.1 必读文档

执行前必须先阅读以下文档，并在开始编码前用 6-10 句话总结你读到的关键信息：

1. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/plans/2026-03-09-nion-memoh-research-architecture.md`
   - 作用：提供 Nion × Memoh 的总体路线、阶段顺序、借鉴边界
   - 读完后你应该知道：为什么 Phase 1 不是做 Provider 大重构，而是先做契约修正

2. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/plan/memory/nion-memory-as-is-source-study.md`
   - 作用：解释当前 Nion 记忆系统的真实链路、已知风险与证据
   - 读完后你应该知道：当前 `MemoryMiddleware -> Queue -> Updater` 的调用关系，以及 `temporary_chat` 风险为何是 P0

3. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/plan/memory/memoh-memory-source-study.md`
   - 作用：提供 Memoh 记忆能力的抽象方法与对照样本
   - 读完后你应该知道：后续为什么要走 `Policy + Provider + Runtime`，以及现在为什么暂时不直接做这一步

4. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/plan/memory/nion-memory-v3-one-shot-refactor-blueprint.md`
   - 作用：给出目标态蓝图和未来阶段参考
   - 读完后你应该知道：本阶段只接一小步，哪些内容被明确留给后续阶段

### 2.2 必读代码

开发前必须先阅读以下代码，并明确它们分别处于哪条链路：

1. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/frontend/src/core/threads/types.ts`
   - 你需要确认前端已经定义了哪些线程上下文字段

2. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/frontend/src/app/workspace/chats/[thread_id]/page.tsx`
   - 你需要确认临时会话在哪里透传 `memory_read / memory_write / session_mode`

3. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/thread_state.py`
   - 你需要确认后端线程状态目前有哪些字段、缺哪些字段

4. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/middlewares/runtime_profile_middleware.py`
   - 你需要确认后端运行时中间件当前只处理了哪些状态

5. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/middlewares/memory_middleware.py`
   - 你需要确认长期记忆写回是从哪里入队的

6. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/memory/queue.py`
   - 你需要确认写回异步队列当前的职责边界

7. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/memory/updater.py`
   - 你需要确认最终长期记忆落盘发生在哪里

8. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/lead_agent/prompt.py`
   - 你需要确认长期记忆注入发生在哪里

9. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/tests/test_memory_upload_filtering.py`
   - 你需要确认当前记忆相关测试风格和已有覆盖面

### 2.3 已知事实（禁止再猜）

以下事实已经由当前仓库代码与研究文档确认，执行 Agent 不要重复猜测：

- 前端已经透传 `memory_read`、`memory_write`、`session_mode`
- 后端当前没有统一消费这三个字段
- 当前长期记忆真实链路是 `MemoryMiddleware -> MemoryUpdateQueue -> MemoryUpdater -> memory.json`
- 当前长期记忆注入真实入口在 `lead_agent/prompt.py`
- 当前系统尚未引入正式的 `MemoryProvider / Registry / Runtime` 实现
- 当前系统中 `Soul`、`Evolution`、`Heartbeat` 还不是完整运行时核心，不要假设它们已经接线

### 2.4 禁止假设

执行 Agent 在本阶段中**禁止**做以下假设：

- 禁止假设 `temporary_chat` 现在已经真正只读
- 禁止假设配置页里与记忆相关的所有字段都已生效
- 禁止假设当前可以顺手把记忆系统升级成 V3
- 禁止假设当前已有统一的会话策略层
- 禁止假设 scheduler 已经等同于 heartbeat

---

## 3. 当前系统状态（As-Is Context）

### 3.1 现在已经有的能力

- 聊天线程已经能传运行时上下文
- 普通长期记忆机制已经工作
- 自定义 agent、上传过滤、基础记忆 API 已存在
- 前端临时会话 UI 已存在

### 3.2 现在的核心问题

- 前端传了字段，后端没统一消费
- UI 语义和后端行为之间存在漂移
- 注入链路和写回链路没有共享同一套策略判断
- 这意味着“临时会话不污染长期记忆”只是产品意图，不是强约束

### 3.3 为什么这一阶段必须先做

如果跳过这一阶段，直接进入 `Memory Core`、`Soul Core`、`Heartbeat Core`，会导致后续所有能力都要建立在一个不可靠的线程运行时语义之上。那样不仅会返工，而且会继续放大“前端约定已经有、后端执行缺位”的问题。

---

## 4. 本阶段要解决的核心问题

本阶段只解决下面三个问题：

1. 后端线程运行时状态缺少 `session_mode / memory_read / memory_write`
2. 长期记忆读取与写入没有统一策略判断点
3. `temporary_chat` 未被后端强制解释为“可读长期记忆、不可写长期记忆”

如果某项工作不能直接解决以上三点，就不属于本阶段范围。

---

## 5. 本阶段目标

### 目标 1：统一后端线程运行时契约
后端线程状态中正式支持：

- `session_mode`
- `memory_read`
- `memory_write`

### 目标 2：建立统一的会话记忆策略层
新增一个轻量策略模块，用统一接口回答：

- 当前会话是否允许读取长期记忆
- 当前会话是否允许写入长期记忆
- 当前会话是否属于 `temporary_chat`

### 目标 3：让长期记忆注入链路遵守 `memory_read`
如果当前策略不允许读取长期记忆，则不注入长期记忆上下文。

### 目标 4：让长期记忆写回链路遵守 `memory_write`
如果当前策略不允许写入长期记忆，则不得触发长期记忆落盘。

### 目标 5：为新行为补测试
至少要有自动化测试覆盖：

- 普通会话：可读可写
- 临时会话：可读不可写
- 显式禁读：不可注入
- 显式禁写：不落盘

---

## 6. 本阶段明确不做

为了避免执行 Agent 把任务越做越大，本阶段**明确不做**：

- 不做 `Memory Provider / Registry / Runtime` 正式重构
- 不做 `memory.json` 到结构化文件布局的迁移
- 不做 `usage / compact / rebuild` 新 API
- 不做 Soul Core
- 不做 Heartbeat Core
- 不做 Evolution Core
- 不做向量检索或 BM25 改造
- 不改现有长期记忆文件格式
- 不新增外部数据库或外部向量服务依赖

如果你发现这些方向很值得做，可以在最终交付里记录为“后续建议”，但不能在本阶段实现。

---

## 7. 默认规则与决策闭环

本阶段执行时，必须遵守以下默认规则，不要自行发明新的行为语义：

### 7.1 默认规则

- 默认普通会话：`memory_read=true`，`memory_write=true`
- `session_mode=temporary_chat`：默认 `memory_read=true`，`memory_write=false`
- 如果显式传入 `memory_read` / `memory_write`，则显式字段优先
- 如果字段缺失，应回退到兼容当前正常行为，而不是报错

### 7.2 策略层职责边界

策略层只负责“是否允许读写长期记忆”，不负责：

- 记忆内容如何检索
- 记忆内容如何压缩
- 记忆内容如何迁移
- 记忆内容如何格式化展示

### 7.3 推荐实现位置

推荐新增文件：

- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/memory/policy.py`

推荐职责：

- 从线程状态解析 `session_mode / memory_read / memory_write`
- 输出统一的 policy 对象或统一的判断函数
- 被注入链路和写回链路共同调用

---

## 8. 实现方案

### 8.1 工作包 A：补齐线程状态契约

**目标**
- 让后端线程状态与前端上下文字段对齐

**建议修改点**
- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/thread_state.py`
- 必要时检查运行时 context 的透传位置

**完成标准**
- 后端状态 schema 中能稳定读取 `session_mode / memory_read / memory_write`
- 缺失字段不报错

### 8.2 工作包 B：新增轻量记忆策略模块

**目标**
- 实现统一记忆读写策略判断点

**建议输出**
- 一个小而清晰的 `policy.py`
- 明确的函数名或结构，例如：
  - 解析当前会话策略
  - 判断是否允许读
  - 判断是否允许写

**要求**
- 不要把复杂 Provider 抽象提前带进来
- 不要在这个阶段设计过重的数据模型

### 8.3 工作包 C：接入长期记忆注入链路

**目标**
- 在长期记忆注入前统一检查 `memory_read`

**建议检查文件**
- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/lead_agent/prompt.py`
- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/memory/prompt.py`

**完成标准**
- 当策略禁止读取时，不注入长期记忆
- 其他普通会话行为保持兼容

### 8.4 工作包 D：接入长期记忆写回链路

**目标**
- 在长期记忆写回前统一检查 `memory_write`

**建议检查文件**
- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/middlewares/memory_middleware.py`
- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/memory/queue.py`
- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/memory/updater.py`

**完成标准**
- 当策略禁止写入时，不触发长期记忆写回
- `temporary_chat` 不得污染长期记忆

### 8.5 工作包 E：补充测试与最小可观测性

**目标**
- 用测试锁住 Phase 1 的行为
- 用最小日志帮助排查策略命中情况

**建议测试文件**
- 优先新增：`/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/tests/test_memory_session_policy.py`
- 或在已有记忆测试文件中补充相邻测试

**最少覆盖场景**
- 普通会话：允许写入
- 临时会话：禁止写入
- `memory_write=false`：禁止写入
- `memory_read=false`：不注入长期记忆

---

## 9. Agent 实施顺序

执行 Agent 必须按下面顺序工作，不要跳步：

1. 阅读 `Context Pack` 中的文档与代码
2. 输出一段“现状理解摘要”，确认你已经理解当前链路
3. 确认当前后端状态缺少哪些字段
4. 补齐线程状态契约
5. 新增统一记忆策略模块
6. 接入记忆注入链路
7. 接入记忆写回链路
8. 补测试
9. 运行最小相关测试
10. 输出本阶段改动总结，并明确写出“本阶段刻意没做什么”

### 9.1 2026-03-09 OpenSpec 实施进展

- 已建立 OpenSpec change：`openspec/changes/enforce-memory-session-runtime-contract/`
- 已补齐后端线程运行时契约：`session_mode`、`memory_read`、`memory_write`
- 已新增轻量策略模块：`backend/src/agents/memory/policy.py`
- 已让记忆注入链路遵守 `memory_read`
- 已让记忆写回链路遵守 `memory_write`
- 已补测试覆盖普通会话、`temporary_chat`、显式禁读、显式禁写，并通过最小相关回归验证

---

## 10. 验收标准

### 10.1 功能验收

- 普通会话仍然保有长期记忆注入与写回能力
- `temporary_chat` 不写长期记忆
- `memory_read=false` 时不注入长期记忆
- `memory_write=false` 时不写长期记忆

### 10.2 回归验收

- 不破坏自定义 agent 的现有行为
- 不破坏上传过滤逻辑
- 不破坏现有记忆 API 的兼容行为

### 10.3 边界场景验收

- 缺失字段时系统继续正常工作
- 旧线程如果没有这些字段，不应崩溃
- 普通线程不应因为策略改造而变成默认只读或默认禁写

---

## 11. 回滚方案

本阶段必须保持易回滚，因为它只涉及策略与接线，不涉及数据迁移。

### 回滚原则

- 删除或绕过新增的策略模块即可恢复旧行为
- 不修改现有长期记忆文件格式
- 不引入新存储，因此不需要数据恢复脚本

### 回滚成功判定

- 聊天主链路恢复到现有行为
- 旧的长期记忆读写继续可用
- 不存在数据结构不兼容问题

---

## 12. 本阶段完成后的产品成效

做完这一阶段后，用户能直接感知到两件事：

1. 临时聊天终于真的“临时”了，不会污染长期记忆
2. 产品页面上的会话模式语义，终于和后端真实行为一致了

这虽然不是最炫的功能升级，但它会明显提升用户对长期记忆系统的信任，也为后续真正的 `Memory Core` 建设打下稳定基础。

---

## 13. 下一阶段衔接

本阶段完成后，下一阶段应进入：

- `Phase 2：Memory Core 骨架化`

只有在 Phase 1 行为被测试锁住后，Phase 2 才适合开始引入：

- `MemoryPolicy` 的正式结构化版本
- `MemoryProvider`
- `MemoryRuntime`
- `MemoryRegistry`

也就是说：

> **Phase 1 先把语义做对，Phase 2 再把结构做强。**

---

## 14. 给 Claude 的启动提示词

```text
你现在是 Nion-Agent 仓库中的高级 Python / LangGraph 工程师。你的任务不是立刻改代码，而是先进入“实现前理解模式”。

项目根目录：
/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent

请先阅读以下文档与代码：

文档：
1. /Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-1-runtime-contract.md
2. /Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/plans/2026-03-09-nion-memoh-research-architecture.md
3. /Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/plan/memory/nion-memory-as-is-source-study.md
4. /Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/plan/memory/memoh-memory-source-study.md
5. /Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/plan/memory/nion-memory-v3-one-shot-refactor-blueprint.md

代码：
1. /Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/frontend/src/core/threads/types.ts
2. /Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/frontend/src/app/workspace/chats/[thread_id]/page.tsx
3. /Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/thread_state.py
4. /Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/middlewares/runtime_profile_middleware.py
5. /Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/middlewares/memory_middleware.py
6. /Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/memory/queue.py
7. /Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/memory/updater.py
8. /Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/lead_agent/prompt.py
9. /Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/tests/test_memory_upload_filtering.py

阅读完成后，不要立刻编码。请先输出：
1. 你理解的当前记忆读写链路
2. 你理解的当前契约漂移点
3. 你准备在哪个文件引入统一策略层
4. 你认为本阶段明确不应该做的内容

输出必须简洁、准确、以实现为导向。
```

---

## 15. 实施提示词

```text
你现在开始实施 Nion-Agent 的 Phase 1：运行时契约对齐与临时会话记忆保护。

项目根目录：
/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent

你的任务目标：
1. 让后端线程状态正式支持 `session_mode`、`memory_read`、`memory_write`
2. 引入统一的轻量记忆策略模块
3. 让长期记忆注入链路遵守 `memory_read`
4. 让长期记忆写回链路遵守 `memory_write`
5. 确保 `temporary_chat` 默认“可读长期记忆、不可写长期记忆”
6. 为这些行为补充自动化测试

严格范围：
- 不做 Memory Provider / Registry / Runtime 重构
- 不改现有长期记忆文件格式
- 不做 Soul / Heartbeat / Evolution
- 不做结构化记忆迁移
- 不新增外部基础设施依赖

实现要求：
- 把策略判断集中到统一模块，不要散落在多个文件里复制逻辑
- 字段缺失时必须安全回退，保持兼容当前正常行为
- 注入链路和写回链路必须共享同一套策略判断
- 普通会话行为不能被破坏
- 临时会话不允许污染长期记忆

建议重点文件：
- /Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/thread_state.py
- /Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/middlewares/runtime_profile_middleware.py
- /Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/middlewares/memory_middleware.py
- /Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/lead_agent/prompt.py
- /Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/memory/queue.py
- /Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/memory/updater.py
- /Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/tests/

推荐新增文件：
- /Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/memory/policy.py

默认规则：
- 普通会话：`memory_read=true`，`memory_write=true`
- `temporary_chat`：默认 `memory_read=true`，`memory_write=false`
- 显式字段优先于默认规则
- 缺失字段时回退到兼容现有行为

测试最低要求：
1. 普通会话：允许写入
2. temporary_chat：禁止写入
3. memory_write=false：禁止写入
4. memory_read=false：不注入长期记忆

工作方式要求：
1. 先简述实现方案
2. 再做修改
3. 先跑最小相关测试，不要一上来跑全量慢测试
4. 最后输出：
   - 修改了哪些文件
   - 新增了什么策略规则
   - 运行了哪些测试
   - 哪些内容被刻意留到后续阶段

如果你发现额外优化点，但超出本阶段范围，只记录在最终总结里，不要顺手实现。
```
