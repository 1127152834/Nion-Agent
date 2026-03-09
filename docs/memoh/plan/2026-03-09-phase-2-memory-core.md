# Phase 2：Memory Core 骨架化

> **给执行 Agent：** 这是一份可直接执行的阶段计划文档，但你**不能跳过上下文**直接开发。请先完整阅读本文的 `Context Pack`，输出你对现状、边界和目标的理解摘要，再开始实现。
>
> **阶段目标一句话版：** 在不迁移数据格式、不替换现有记忆存储的前提下，为 Nion 建立 `MemoryPolicy + MemoryProvider + MemoryRuntime + MemoryRegistry` 的最小骨架，让后续记忆升级可以建立在稳定结构上，而不是继续堆在 V2 单体链路上。

- 阶段编号：`Phase 2`
- 优先级：`P0`
- 前置阶段：`Phase 1：运行时契约对齐与临时会话记忆保护`
- 后续阶段：`Phase 3：结构化记忆存储与维护能力`
- 是否允许独立实施：`不建议`（默认应在 Phase 1 落地并验证后再做）
- 风险等级：`中`
- 预估改动范围：`中`

---

## 1. 阶段定位

`Phase 1` 解决的是“产品语义与运行时策略错位”的问题；`Phase 2` 解决的是“记忆系统结构边界缺失”的问题。

当前 Nion 的记忆系统是一个可运行但耦合很深的 V2 单体方案：

- 对话后通过 `MemoryMiddleware` 入队
- 由 `MemoryUpdateQueue` 做 debounce
- 最终由 `MemoryUpdater` 生成并落盘 `memory.json`
- 对话前再由 `lead_agent/prompt.py` 从同一数据源注入上下文

这个方案现在能工作，但它的问题是：

1. 策略、存储、检索、写回、注入全挤在一起
2. 没有 Provider 层，无法优雅支持后续的多记忆后端、多作用域和维护能力
3. 任何新增能力都会继续堆在现有单体结构上
4. 前面即使修好了 `memory_read / memory_write`，后面也还是会遇到结构级耦合问题

因此本阶段的目标不是“让记忆变强”，而是先让记忆**变得可演进**。

换句话说：

> `Phase 1` 把语义做对，`Phase 2` 把结构立起来。

---

## 2. Context Pack

### 2.1 必读文档

执行前必须阅读以下文档，并在开始编码前输出 6-10 句话总结你理解到的关键事实：

1. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-1-runtime-contract.md`
   - 作用：确认前一个阶段修的是什么、哪些语义已经被锁住
   - 读完后你应该知道：Phase 2 不应重新定义 `memory_read / memory_write / session_mode` 的语义，只能建立在 Phase 1 的契约之上

2. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/plans/2026-03-09-nion-memoh-research-architecture.md`
   - 作用：给出整体路线、借鉴边界和阶段顺序
   - 读完后你应该知道：为什么 Memory Core 是 Soul、Heartbeat、Evolution 的共同底座

3. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/plan/memory/nion-memory-as-is-source-study.md`
   - 作用：解释当前 Nion 记忆 V2 的真实链路、已知风险和证据
   - 读完后你应该知道：现有单体链路的强耦合点在哪里

4. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/plan/memory/memoh-memory-source-study.md`
   - 作用：解释 Memoh 的 `Provider / Registry / storefs / Handler` 结构
   - 读完后你应该知道：本阶段为什么要借 `Provider + Registry` 的结构，而不是照搬多用户/多 Bot 形态

5. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/plan/memory/nion-memory-v3-one-shot-refactor-blueprint.md`
   - 作用：提供 Memory V3 的目标态蓝图和分阶段证据
   - 读完后你应该知道：本阶段只建立最小骨架，不做 V3 全量切换

### 2.2 必读代码

开发前必须先阅读以下代码，并明确它们位于哪条链路：

1. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/middlewares/memory_middleware.py`
   - 你需要确认 V2 写回入口在哪里，以及当前链路如何依赖 `thread_id`

2. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/memory/queue.py`
   - 你需要确认 V2 队列当前的职责边界，以及它为什么不适合作为长期架构的唯一中心

3. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/memory/updater.py`
   - 你需要确认 V2 的持久化和更新逻辑集中在哪里

4. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/lead_agent/prompt.py`
   - 你需要确认当前长期记忆注入入口在哪里

5. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/config/memory_config.py`
   - 你需要确认当前 memory config 已经承载了多少字段，以及哪些边界已经混在一起

6. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/gateway/routers/memory.py`
   - 你需要确认当前 memory API 还只是只读/状态型接口

7. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/config/paths.py`
   - 你需要确认当前全局与 agent 级记忆文件路径如何组织

8. `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/tests/test_memory_upload_filtering.py`
   - 你需要确认当前记忆相关测试风格和上传过滤边界

### 2.3 已知事实（禁止再猜）

以下事实已经由当前仓库与研究文档确认，执行 Agent 不要重复猜测：

- 当前真实链路是 `MemoryMiddleware -> MemoryUpdateQueue -> MemoryUpdater -> memory.json`
- 当前并没有正式的 `MemoryProvider / MemoryRegistry / MemoryRuntime` 实现
- 当前 `memory.json` 及 `agents/*/memory.json` 仍是事实源之一，不能在本阶段直接废弃
- 当前前后端契约修复优先于结构升级，Phase 2 必须兼容 Phase 1 的策略语义
- 当前 `docs/plan/memory/nion-memory-v3-one-shot-refactor-blueprint.md` 是目标态参考，不等于“本阶段就要全部实现”
- Memoh 值得借的是抽象边界，不是多租户/容器化形态

### 2.4 禁止假设

执行 Agent 在本阶段中**禁止**做以下假设：

- 禁止假设已经可以直接切换到新存储格式
- 禁止假设已经存在结构化文件布局（`overview/manifest/day-files`）
- 禁止假设当前要把所有记忆 API 一次性补齐
- 禁止假设当前必须引入向量检索或 BM25
- 禁止假设当前要把 V2 链路全部删除
- 禁止假设当前要做 Soul、Heartbeat、Evolution 的接线

---

## 3. 当前系统状态（As-Is Context）

### 3.1 当前已经有的能力

- 长期记忆已经可注入、可写回、可落盘
- 有全局记忆与 per-agent 记忆文件路径概念
- 有上传过滤相关的已有保护逻辑
- Phase 1 应已锁住 `memory_read / memory_write / session_mode` 的运行时语义

### 3.2 当前结构性缺口

- 当前缺少统一的 `Memory Core` 抽象层
- 当前 V2 单体链路里混合了：
  - 会话策略
  - 存储路径
  - LLM 更新逻辑
  - 注入格式化
  - 队列机制
- 当前新增能力会继续耦合到 V2 结构中，而不是接到一个稳定骨架上

### 3.3 为什么从“骨架化”而不是“直接迁移”开始

因为如果本阶段直接迁移存储格式、切 API、切写回路径：

- 风险会显著升高
- 很难精确定位回归来源
- 阶段边界会失控

因此本阶段只做一件事：

> **先建立骨架，让旧逻辑挂到新边界之下运行。**

也就是说，本阶段结束后，外部行为应尽量保持兼容，但内部结构开始具备后续演进空间。

---

## 4. 本阶段要解决的核心问题

本阶段只解决下面四个问题：

1. 缺少统一的 `Memory Core` 抽象边界，导致记忆能力继续堆叠在 V2 单体链路上
2. 会话策略、读写注入、持久化和未来维护能力之间没有稳定接口
3. 后续 `storefs / usage / compact / rebuild / provider management` 无法在当前结构上稳妥接入
4. 当前没有一个“旧链路可挂靠、新链路可替换”的兼容层

任何不能直接解决以上四个问题的改动，都不属于本阶段范围。

---

## 5. 本阶段目标

### 目标 1：建立 Memory Core 最小模块边界
正式引入最小骨架概念：

- `MemoryPolicy`
- `MemoryProvider`
- `MemoryRuntime`
- `MemoryRegistry`

### 目标 2：实现“旧逻辑挂到新骨架”
在不改变外部行为的前提下，让当前 V2 逻辑尽量通过新骨架接入，而不是继续被上层直接调用。

### 目标 3：统一读写入口的内部依赖方向
让上层调用方开始依赖 `Memory Core` 抽象，而不是直接依赖 V2 细节文件。

### 目标 4：为 Phase 3 做好结构前置
为后续结构化存储、维护 API、provider lifecycle 管理预留清晰挂点。

### 目标 5：补最小骨架测试
至少验证：

- 新骨架存在并可被调用
- 默认 provider 能工作
- 旧行为在兼容模式下不被破坏
- 读写策略仍遵守 Phase 1 定义

---

## 6. 本阶段明确不做

为了避免本阶段演变成“大重构”，本阶段**明确不做**：

- 不迁移 `memory.json` 到新文件结构
- 不实现 `overview / manifest / day-files`
- 不实现完整 `usage / compact / rebuild` 业务能力
- 不引入新的外部数据库或向量服务
- 不替换现有记忆 API 为新 API 面
- 不删除 V2 队列与 updater 的现有逻辑
- 不对前端记忆页面做大改
- 不做 Soul / Heartbeat / Evolution 的正式接线

如果你发现这些方向很值得做，只能记录为 `Phase 3+` 建议，不能在本阶段提前实现。

---

## 7. 默认规则与决策闭环

本阶段必须遵守以下默认决策，不能让执行 Agent 自己发明结构：

### 7.1 核心结构决策

本阶段的 Memory Core 只要求建立**最小可运行骨架**：

- `MemoryPolicy`：负责会话语义与读写策略
- `MemoryProvider`：负责统一上层接口
- `MemoryRuntime`：负责具体存取与更新
- `MemoryRegistry`：负责 provider 注册与获取

### 7.2 默认 provider 决策

- 本阶段只实现一个默认 provider，例如 `builtin` / `v2-compatible`
- 该 provider 的底层 runtime 仍可调用当前 V2 逻辑
- 本阶段不实现多 provider 配置管理界面

### 7.3 默认 runtime 决策

- 默认 runtime 继续兼容当前 `memory.json` 路线
- 即使内部命名升级，也不要让外部行为强制切换到新格式
- Phase 3 才讨论结构化文件布局与维护 API

### 7.4 上层依赖方向

从本阶段开始，上层应尽量依赖 `Memory Core` 边界，而不是直接摸到：

- `MemoryUpdater`
- `get_memory_data`
- `memory.json` 具体路径

但为了稳妥起见，本阶段允许保留部分兼容桥接。

### 7.5 推荐实现位置

推荐新增目录或文件（命名可微调，但职责不能漂移）：

- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/memory/core.py` 或 `provider.py`
- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/memory/runtime.py`
- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/memory/registry.py`
- 复用 `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/memory/policy.py`（如果 Phase 1 已落）

如果你选择拆成多个文件，职责必须单一；如果暂时合并到少数文件，也必须保持结构边界清晰。

---

## 8. 实现方案

### 8.1 工作包 A：定义 Memory Core 抽象边界

**目标**
- 引入最小的 `Policy / Provider / Runtime / Registry` 抽象

**建议修改点**
- 新增 `backend/src/agents/memory/` 下的核心边界文件
- 必要时补少量类型定义

**完成标准**
- 存在清晰的抽象入口
- 上层不再必须直接依赖 V2 的实现细节文件
- 命名与职责足够清晰，后续阶段可继续扩展

### 8.2 工作包 B：实现 V2-Compatible Runtime

**目标**
- 让现有 `memory.json` 逻辑挂到新骨架下运行

**建议修改点**
- 将现有 updater / data access 行为通过 runtime 封装出来
- 不要求删除旧实现，可先包装

**完成标准**
- 默认 runtime 仍能提供：
  - 读当前长期记忆
  - 写当前长期记忆
  - 继续兼容当前存储格式
- 普通会话行为不变

### 8.3 工作包 C：引入默认 Provider 与 Registry

**目标**
- 让上层通过一个明确 provider 获取记忆能力

**建议修改点**
- 新增默认 provider
- 新增 registry，并至少支持获取默认 provider

**完成标准**
- 存在一个稳定的默认 provider 获取路径
- 未来加新 provider 时不必重写上层链路

### 8.4 工作包 D：让读写链路开始依赖 Memory Core

**目标**
- 让注入链路和写回链路开始通过骨架访问记忆能力

**建议检查文件**
- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/lead_agent/prompt.py`
- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/middlewares/memory_middleware.py`
- 必要时检查 `queue.py` 和 `updater.py` 的调用入口

**完成标准**
- 上层使用新的 Memory Core 入口，而不是散乱地直接摸 V2 细节
- Phase 1 的读写策略仍然生效

### 8.5 工作包 E：补测试与兼容验证

**目标**
- 用测试锁住“骨架已建立，但行为未破坏”

**建议新增测试**
- `backend/tests/test_memory_core_registry.py`
- `backend/tests/test_memory_core_provider.py`
- 或根据项目风格并入现有相关测试文件

**最少覆盖场景**
- 默认 provider 可解析
- 默认 runtime 可读现有 memory data
- 写回在兼容模式下仍工作
- Phase 1 的 `memory_write=false` 仍禁止写入
- Phase 1 的 `memory_read=false` 仍禁止注入

---

## 9. Agent 实施顺序

执行 Agent 必须按下面顺序工作，不要跳步：

1. 阅读 `Context Pack` 中的文档与代码
2. 输出一段“现状理解摘要”，确认你理解：
   - 当前 V2 链路
   - 当前阶段为何只做骨架化
   - 当前阶段的非目标
3. 定义最小 `Memory Core` 抽象边界
4. 实现 V2-compatible runtime
5. 引入默认 provider 与 registry
6. 让注入/写回链路开始走 Memory Core 入口
7. 补最小测试
8. 跑最小相关测试
9. 输出改动总结，并明确写出“哪些内容被刻意留到 Phase 3+”

---

## 10. 验收标准

### 10.1 功能验收

- 记忆系统已具备最小 `Memory Core` 骨架
- 默认 provider 可用
- 默认 runtime 可兼容当前 `memory.json` 路线
- 普通会话记忆行为与当前基本兼容
- Phase 1 的读写策略仍然有效

### 10.2 回归验收

- 不破坏当前长期记忆注入与写回
- 不破坏上传过滤逻辑
- 不破坏自定义 agent 的记忆路径兼容
- 不破坏现有记忆状态 / 配置型 API

### 10.3 边界场景验收

- 新骨架存在但不要求多 provider 管理面
- 旧线程、旧记忆文件可继续运行
- 默认 provider 缺省时要有清晰回退或明确错误
- 不得因为骨架化而提前引入结构化存储假设

---

## 11. 回滚方案

本阶段必须保持可回滚，因为它仍处于“骨架引入期”。

### 回滚原则

- 新增的 `Memory Core` 文件可以整体绕过或删除
- 上层链路可以回退到直接调用 V2 逻辑
- 不修改现有长期记忆文件格式
- 不涉及数据迁移，因此不需要恢复脚本

### 回滚成功判定

- 聊天主链路恢复到原有 V2 路径
- 普通会话记忆读写继续可用
- 不存在新旧数据结构不兼容问题

---

## 12. 本阶段完成后的产品成效

做完这一阶段后，用户不会立刻看到很多“新功能按钮”，但产品内部会出现一个非常关键的质变：

1. 记忆系统不再是继续堆叠功能的单体黑盒
2. 后续的结构化存储、维护 API、Soul 和记忆联动，都有了稳定挂点
3. 我们终于可以在“不断增强记忆能力”的同时，避免每次都在 V2 旧链路上打补丁

对产品来说，这一阶段的价值是：

> **让长期记忆从“能用的功能”变成“可持续演进的内核”。**

---

## 13. 下一阶段衔接

本阶段完成后，下一阶段应进入：

- `Phase 3：结构化记忆存储与维护能力`

只有在 Phase 2 建立了 `Memory Core` 骨架后，Phase 3 才适合做：

- `overview / manifest / day-files`
- `usage / compact / rebuild`
- 更明确的 provider lifecycle
- 更好的运维与维护接口

也就是说：

> **Phase 2 先把骨架立起来，Phase 3 再把新器官装上去。**

---

## 14. 给 Claude 的启动 Prompt

```text
你现在是 Nion-Agent 仓库中的高级 Python / LangGraph 工程师。你的任务不是立刻改代码，而是先进入“实现前理解模式”。

项目根目录：
/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent

请先阅读以下文档与代码：

文档：
1. /Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-2-memory-core.md
2. /Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-1-runtime-contract.md
3. /Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/plans/2026-03-09-nion-memoh-research-architecture.md
4. /Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/plan/memory/nion-memory-as-is-source-study.md
5. /Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/plan/memory/memoh-memory-source-study.md
6. /Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/plan/memory/nion-memory-v3-one-shot-refactor-blueprint.md

代码：
1. /Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/middlewares/memory_middleware.py
2. /Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/memory/queue.py
3. /Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/memory/updater.py
4. /Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/lead_agent/prompt.py
5. /Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/config/memory_config.py
6. /Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/gateway/routers/memory.py
7. /Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/config/paths.py
8. /Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/tests/test_memory_upload_filtering.py

阅读完成后，不要立刻编码。请先输出：
1. 你理解的当前 V2 记忆读写链路
2. 你理解的当前结构性缺口
3. 你准备如何建立最小 Memory Core 骨架
4. 你认为本阶段明确不应该做的内容

输出必须简洁、准确、以实现为导向。
```

---

## 15. 给 Claude 的实施 Prompt

```text
你现在开始实施 Nion-Agent 的 Phase 2：Memory Core 骨架化。

项目根目录：
/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent

阶段计划文档：
/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/memoh/plan/2026-03-09-phase-2-memory-core.md

你的任务目标：
1. 为记忆系统建立最小 `MemoryPolicy + MemoryProvider + MemoryRuntime + MemoryRegistry` 骨架
2. 用 V2-compatible runtime 挂接当前 `memory.json` 逻辑
3. 让注入链路和写回链路开始依赖 Memory Core 抽象，而不是直接依赖 V2 细节
4. 保持 Phase 1 的运行时语义不被破坏
5. 为这些结构补充最小自动化测试

严格范围：
- 不做存储格式迁移
- 不做 `overview / manifest / day-files`
- 不做 `usage / compact / rebuild` 完整能力
- 不做新的前端记忆页面改造
- 不做 Soul / Heartbeat / Evolution 接线
- 不引入新的外部数据库或外部向量服务
- 不删除现有 V2 逻辑，只允许包装、桥接、重定向依赖方向

实现要求：
- 优先做最小可运行骨架，不要设计过重的框架
- 允许通过兼容层复用现有 updater/data access 逻辑
- 上层调用方应开始依赖新骨架，而不是继续直接摸 V2 细节
- 保持当前普通会话行为基本兼容
- Phase 1 的 `memory_read / memory_write / session_mode` 语义必须继续生效

建议重点文件：
- /Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/memory/
- /Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/middlewares/memory_middleware.py
- /Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/agents/lead_agent/prompt.py
- /Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/config/memory_config.py
- /Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/tests/

推荐新增方向：
- `policy.py`（如果 Phase 1 尚未落）
- `runtime.py`
- `registry.py`
- `provider.py` 或 `core.py`

默认规则：
- 默认只提供一个内建 provider
- 默认 runtime 继续兼容当前 `memory.json`
- 不引入真正多 provider 管理面
- 不把目标态蓝图一次性全部实现

测试最低要求：
1. 默认 provider 可解析
2. 默认 runtime 可兼容读取现有 memory data
3. 写回在兼容模式下继续工作
4. `memory_write=false` 仍禁止写入
5. `memory_read=false` 仍禁止注入

工作方式要求：
1. 先简述你准备怎么改
2. 再按最小骨架实施修改
3. 先跑最小相关测试，不要一上来跑全量慢测试
4. 完成前执行验证
5. 完成后执行代码评审或自查评审
6. 最终输出：
   - 修改了哪些文件
   - 引用了哪份阶段计划
   - 建立了哪些核心边界
   - 运行了哪些测试 / 验证 / 评审门禁
   - 哪些内容被明确留到 Phase 3+

如果你发现额外优化点，但超出本阶段范围，只记录，不实现。
```
