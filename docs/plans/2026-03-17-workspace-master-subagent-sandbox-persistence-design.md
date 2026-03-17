# Workspace-First + Master/SubAgent + Sandbox/持久化分离 设计文档（合并稿）
日期：2026-03-17  
状态：讨论结论汇总（设计冻结前草案）  
适用端：Web + Desktop（必须一致）

## 1. 背景与动机
当前系统以“对话（thread/session）”为中心：智能体可以在一次对话中产出文件与结论，但对话结束后缺少稳定的“资产沉淀载体”，导致产物难以跨会话复用、难以形成长期项目资产。

我们引入 Workspace 的核心目的不是“多智能体”，而是把智能体从“对话驱动”升级为“项目驱动”，让资产能够长期沉淀、可检索、可复用。

## 2. 顶层目标（Goals）
1. 引入一等概念 `Workspace`，用于沉淀项目资产与项目级上下文（记忆、索引、定时任务等）。
2. 引入一等概念 `Sandbox`，用于承载临时产物与中间文件。
3. 默认产物全部落在 `Sandbox`（无论 sandbox mode 还是 host mode），均视为临时产物。
4. 只有当用户明确表达“保存/沉淀/归档”，或用户在 UI 中手动保存（拖拽/按钮）时，才将产物从 Sandbox 保存到 Workspace，视为持久资产。
5. 一个 Workspace 具备一个主要责任主体：`master_agent`（替代历史命名 `lead_agent` 的产品定位）。
6. 一个 Workspace 内允许多个 `sub_agent`。系统在创建 Workspace 时自动生成内置 sub_agent：`general-purpose / researcher / writer / organizer / bash`，并在本期要求它们不可修改、不可删除。用户可以新增自定义 sub_agent。
7. 模式边界清晰：仅 `Ultra` 模式启用 sub_agent 调度能力；非 Ultra 禁止调用 sub_agent。
8. 必须保证 Web 与 Desktop 功能与语义一致，不出现“只有某端可用”的概念分裂。

## 3. 非目标（Non-Goals，当前不做）
1. 多 Workspace 联动（Inbox/Outbox、群发公共信箱、Workspace 间自动触发执行）暂不纳入本期实现。
2. 默认自动持久化产物（未经用户确认自动写入 Workspace）不做。
3. “系统永久内置 SubAgent 且全局升级自动生效”不作为长期前提：本期采用“按 Workspace 快照固化”策略，为未来“每个 Workspace 的 SubAgent 集合不同，甚至不再有内置 SubAgent”预留空间。

## 4. 核心决策（Normative，必须遵守）
1. `Workspace` 是持久化资产容器，`Sandbox` 是临时产物容器，两者必须物理隔离并在 UI 上显式区分。
2. 保存是显式动作，不是副作用。默认只写 Sandbox；写 Workspace 必须由用户触发。
3. 责任归属单点化：用户默认只与 `master_agent` 对话；`sub_agent` 仅作为“角色执行器”，由 master 调度与验收。
4. 写入收口：Workspace 记忆与定时任务仅允许 master 写入；sub_agent 只能提出提案（proposed_*），不得直接落库。
5. 权限边界要硬：不能只靠 prompt 约束，必须有运行时治理（工具白名单/路径边界/写入开关）。

## 5. 概念定义
### 5.1 Workspace（工作空间）
项目级、跨会话共享的持久容器，包含：
1. 用户确认要沉淀的文件资产（docs、assets、exports 等）。
2. 项目级长期记忆（Workspace Memory）。
3. 项目级定时任务（Workspace Scheduler）。
4. 项目级索引（索引文件、关键入口、决策记录等）。
5. Workspace 内角色配置：master 与 sub_agent 的能力快照与元数据。

### 5.2 Sandbox（沙箱/临时区）
对话级或运行时级临时容器，包含：
1. 上传（uploads）。
2. 产物（outputs）。
3. 任务过程文件（work）。
4. 日志与诊断（可选）。

Sandbox 产物默认可清理，需要配套：
1. 清理策略（TTL 或手动清理）。
2. 未保存提醒（避免用户误以为自动沉淀）。

### 5.3 Thread / Session（对话）
交互入口与执行上下文。一个 Workspace 可以有多个 Thread，均共享同一 Workspace 资产与 Workspace Memory。

### 5.4 Master/SubAgent（角色）
1. `master_agent`：Workspace 的主责任主体，执行大多数任务，验收 sub_agent 结果，指导保存与索引更新，写入 Workspace Memory 与 Scheduler。
2. `sub_agent`：角色执行器，由 master 调度完成拆分任务，默认只写 Sandbox 产物与给出提案。

## 6. 存储与目录布局（建议契约）
### 6.1 Workspace（持久）
建议持久目录：`{NION_HOME}/workspaces/{workspace_id}/`

建议结构（示例）：
1. `.nion/`：系统目录（必须隐藏与受控）
2. `.nion/workspace.json`：workspace 元数据（含 sub_agent 快照、版本等）
3. `.nion/master/`：master SOUL/IDENTITY/Evolution 元数据引用或索引
4. `.nion/memory/`：workspace memory 元数据或索引（实际存储可走 OpenViking）
5. `.nion/scheduler/`：workspace scheduler 元数据
6. `docs/`：用户持久文档
7. `assets/`：用户素材
8. `exports/`：导出物
9. `index/`：轻量索引（入口、产物清单、决策记录）

约束：
1. `.nion/` 必须在工具层与网关文件 API 双重屏蔽，防止误操作破坏系统元数据。
2. 用户可选择把持久资产保存到 workspace 的任意自定义目录，但系统应推荐默认目录（docs/assets/exports）。

### 6.2 Sandbox（临时）
建议临时目录：`{NION_HOME}/threads/{thread_id}/user-data/`（保持现有 thread user-data 作为 sandbox，降低迁移风险）

建议结构：
1. `uploads/`
2. `outputs/`
3. `workspace/`：现存 thread workdir，需在产品/文案/代码中降级为“临时 workdir”，不得再称为“Workspace（持久）”

## 7. 路径契约（工具与 API 的稳定入口）
目标：让模型与工具在不同运行模式下看到稳定路径，同时避免“workspace”语义冲突。

必须达成的稳定入口：
1. Sandbox 临时根：`/mnt/user-data/`（现状）
2. Workspace 持久根：`/mnt/workspace/`（新增，映射到 `{NION_HOME}/workspaces/{workspace_id}`）

约束：
1. 所有工具默认写入 Sandbox（`/mnt/user-data/...`）。
2. 写入 Workspace（`/mnt/workspace/...`）只在保存动作中发生，且必须来自用户显式触发。
3. `.nion/` 必须被屏蔽（UI 不显示、工具不可直接写、网关文件 API 不可访问）。

## 8. 产物生命周期与保存语义（关键）
### 8.1 默认策略
1. master/sub_agent 产物默认落在 Sandbox。
2. Sandbox 中产物默认视为临时，可被清理。
3. Workspace 中资产默认视为持久，可跨会话引用。

### 8.2 保存触发条件（仅两类）
1. 用户在对话中明确表达保存意图：如“保存到 workspace”“沉淀下来”“归档到项目里”。
2. 用户在 UI 中手动保存：拖拽 Sandbox 文件到 Workspace 树，或点击“保存到 Workspace”按钮。

### 8.3 保存流程（建议强制 master 验收）
1. master 验收 sub_agent 产物，生成“建议保存清单”。
2. 用户确认保存范围与目标路径（默认建议 docs/assets/exports）。
3. 执行保存：建议默认“复制”而不是“移动”，避免误操作导致数据损坏。
4. 保存成功后更新：
   - workspace 索引（产物清单、入口、版本）。
   - workspace 记忆（只写摘要与入口，不写全文，不引用临时路径）。

### 8.4 必须避免的设计缺陷
1. 禁止把 Workspace Memory 引用到 Sandbox 临时路径。
2. 禁止 sub_agent 直接写 Workspace Memory 或 Scheduler（只能提案）。
3. 必须提供未保存提醒与清理策略，否则用户会误以为“系统吞文件”。

## 9. 智能体资源归属
### 9.1 Workspace 维护（项目级）
1. Workspace Memory（长期记忆）
2. Workspace Scheduler（定时任务）
3. Workspace Index（资产索引、入口、决策记录）

### 9.2 master_agent 维护（主体人格与成长）
1. SOUL（风格、边界、价值观）
2. IDENTITY（身份设定）
3. Evolution / Self-Improvement（自我成长）

### 9.3 sub_agent 维护（仅执行态）
1. 不持久化独立记忆
2. 不维护定时任务
3. 不维护 SOUL/IDENTITY/Evolution
4. 可写 Sandbox 文件产物，可提出提案

## 10. SubAgent 体系设计
### 10.1 内置 SubAgent（按 Workspace 快照固化）
创建 Workspace 时生成并固化以下 sub_agent：
1. general-purpose
2. researcher
3. writer
4. organizer
5. bash

规则：
1. 本期内置 sub_agent 不可修改、不可删除。
2. 用户可新增自定义 sub_agent。
3. SubAgent 定义必须存入 workspace 元数据，确保可复现。

### 10.2 SubAgent 工具权限与 Skill/MCP/CLI（必须硬约束）
推荐策略：能力档案（Capability Profile）+ master 调用时收窄（交集）。

结论与规则：
1. sub_agent 可以执行工具，但必须受白名单限制。
2. sub_agent 默认允许写 Sandbox 文件产物。
3. sub_agent 默认禁止：
   - 写 Workspace Memory
   - 修改 Workspace Scheduler
   - 写入 Workspace 持久资产目录（除非通过“保存工具/保存流程”且由用户触发）
4. Skill 选择权在 master：sub_agent 可以建议使用某 skill，但启用与否由 master 决策。
5. MCP/CLI 是否允许由能力档案预置；master 调用时可以进一步收窄，但不建议做临时提权。

## 11. 模式系统（Flash/Thinking/Pro/Ultra）与后端映射
原则：
1. 模式必须在后端形成可观测的差异化策略，不能仅是文案。
2. 本期的关键边界：只有 Ultra 启用 sub_agent 调度与 `task` 工具。

建议定义（产品层）：
1. Flash：快速响应，禁止 sub_agent。
2. Thinking：更深思考，禁止 sub_agent。
3. Pro：更强模型/更高预算，禁止 sub_agent。
4. Ultra：启用 sub_agent 调度与并行能力，强调“拆解-委派-验收-保存建议-用户确认-沉淀”。

## 12. Web/桌面端一致性要求
1. Desktop 的 workspace 必须与 Web 一致：由系统在 `{NION_HOME}/workspaces/` 托管，尽量对普通用户隐藏，不要求用户手动进入真实目录。
2. host 模式不再要求用户选择 `host_workdir`。host/sandbox 的区别仅在执行环境，不决定是否持久化。
3. 文件面板必须同时展示：
   - Sandbox（临时产物树）
   - Workspace（持久资产树）
   并提供保存动作（拖拽/按钮）。

## 13. 当前系统基线与需要改动的点（对齐重构）
### 13.1 当前系统现状（基线）
1. 现有 `/mnt/user-data/workspace` 是 thread 级工作目录，并非产品意义的 Workspace（持久）。
2. 现有 gateway `workspace` tree API 以 thread 为粒度列出 `/mnt/user-data`。
3. host 模式要求用户手动选择 `host_workdir` 且校验空目录。
4. sub_agent 系统已存在（task 工具），但“记忆只读/权限边界”目前不够硬，存在污染风险。

### 13.2 必须的架构改动
1. 新增 Workspace 实体与 registry，并让 thread 绑定 workspace_id。
2. 引入 `/mnt/workspace` 的持久路径映射与 gateway 文件 API 支持。
3. 重构文件面板为“双树 + 保存动作”。
4. 重构 host 模式交互：移除“手动选目录”，并重置 host_workdir 的语义或逐步废弃。
5. sub_agent 权限硬收口：默认只写 sandbox，禁止写 memory/scheduler/workspace 资产。
6. 记忆与任务作用域迁移：以 workspace 为主，global 仅保留用户偏好（最小化）。

## 14. 页面与交互改动（目标态）
### 14.1 IA 从 Agents 迁移到 Workspaces
目标：Workspace 成为第一入口，Agent 降级为高级功能或兼容层。

建议新增页面：
1. Workspaces 列表页（主入口）
2. 创建 Workspace 页（对话式创建，复用 bootstrap 体验，但归属变化）
3. Workspace Chat 页（与 master 对话）
4. Workspace Settings 页（master 资产、workspace 记忆/任务/索引、sub_agents 管理）
5. 迁移/导入页（旧 thread/agent 资产导入到 workspace）

兼容策略：
1. 保留现有 Agents 入口一段时间，增加“迁移到 Workspace”的引导。
2. Chats 默认归属“默认 workspace”，并在 header 展示当前 workspace 可切换。

### 14.2 文件面板（必须重做：Sandbox vs Workspace）
必须同时展示两棵树：
1. Sandbox（临时产物）：按 thread 展示 uploads/outputs/work 等。
2. Workspace（持久资产）：按 workspace 展示资产目录，隐藏 `.nion/`。

必须提供动作：
1. Sandbox 文件：预览、复制路径、保存到 Workspace、批量保存。
2. Workspace 文件：预览、复制路径、标记入口（可选）。
3. 拖拽：Sandbox → Workspace（保存语义）。

必须提供提示：
1. Sandbox 文件标识“临时”，解释清理策略与未保存提醒。
2. Workspace 文件标识“已保存/可跨会话引用”。

## 15. 迁移与兼容（不丢资产）
必须保证两类历史资产可见可导入：
1. 历史 thread sandbox（旧 `/user-data/workspace`、outputs 等）：提供“历史 Sandbox 浏览器”，可一键复制导入到 workspace。
2. 历史 agent 资产（SOUL/IDENTITY 等）：提供“作为 master 模板导入”的能力或迁移向导。

记忆迁移原则：
1. 严禁自动把旧 agent-scope memory 无脑灌入 workspace（污染风险）。
2. 提供选择性导入或摘要导入。

## 16. 风险清单与防护（必须）
1. 风险：workspace/workdir 命名冲突导致语义混乱。
   - 防护：严格消歧义；`/mnt/user-data/workspace` 降级为 sandbox/workdir；`/mnt/workspace` 才是持久 workspace。
2. 风险：sub_agent 写入记忆/任务导致污染与不可审计。
   - 防护：运行时硬限制工具白名单；只允许提案；master 单点写入。
3. 风险：用户忘记保存导致资产丢失。
   - 防护：未保存提醒、建议保存清单、清理前提示、可配置 TTL。
4. 风险：Web/桌面端路径与权限不一致导致“某端可用某端不可用”。
   - 防护：统一 workspace 托管位置与 UI 文件树；host 模式去手动选目录。

## 17. 验收标准（Definition of Done）
1. 创建 workspace 后自动生成 master + 5 内置 sub_agent（快照固化），并可进入 workspace chat 工作。
2. 非 Ultra 模式不出现 sub_agent 调度行为，且 `task` 工具不可用。
3. Ultra 模式下 master 可调度 sub_agent 并行执行；sub_agent 产物落 sandbox，且不能写 workspace memory/scheduler/持久资产。
4. 文件面板双树可用：Sandbox 与 Workspace 都可浏览，`.nion/` 默认隐藏。
5. Sandbox 产物可通过 UI 保存到 Workspace，保存后跨会话可引用；保存前均为临时产物。
6. Desktop 与 Web 行为一致：Desktop workspace 系统托管、host 模式不要求手动选目录、保存语义一致。

---

## 附录 A：重构影响矩阵（摘要）
下列域必须在实施方案中逐项覆盖，避免“设计落空”：
1. Workspaces：新增 registry 与 thread 绑定
2. Threads：线程语义收敛为交互入口 + sandbox
3. Path Contract：/mnt/user-data（sandbox）与 /mnt/workspace（持久）
4. 保存：显式动作（复制优先）+ 索引/记忆更新
5. Agents：从主体降级为 workspace 内角色（master/sub）
6. SubAgents：Ultra 开关 + 权限硬收口 + 快照固化 + 自定义管理
7. Memory：从 global/agent 迁移到 workspace（写入由 master 收口）
8. Scheduler：从 agent 迁移到 workspace（写入由 master 收口）
9. Runtime Profile：host 模式去掉手动选目录
10. Frontend：Workspaces 新入口 + 双树文件面板 + 保存交互

