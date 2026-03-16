# Alma 机制学习与 Nion 可借鉴点 学习计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 系统化学习 Alma 的核心机制（RTK、self-involve/self-management、记忆系统、Tools、Artifacts 预览），并输出一份可落地的 Nion 借鉴清单与 PoC 迭代路线。

**Architecture:** 采用“文档理解 -> 包体逆向/验证 -> 与 Nion 现状对照 -> 形成可迁移的设计点 -> 小步 PoC 验证”的闭环。先把 Alma 的机制拆成可复用的抽象与约束（边界、状态持久化、权限、失败/回退路径），再映射到 Nion 现有模块（backend/gateway、tool runtime、memory provider、frontend artifacts/workbench、desktop runtime），最终产出最小可回滚的改造方案。

**Tech Stack:** Alma（Electron + better-sqlite3 + drizzle-orm + sqlite-vec + fts5/jieba + Vercel AI SDK + MCP + Playwright）；Nion（FastAPI Gateway + LangGraph + 桌面端 Electron + Next.js 工作台 + 结构化长期记忆/OpenViking + Artifacts 系统）。

---

## 已确认的 Alma 包体线索（基于已安装 Alma.app v0.0.699）

1. **RTK 是一个独立的 CLI proxy 二进制**：位于 `Alma.app/Contents/Resources/rtk/rtk`，作为“命令包装器”运行，用于在输出进入 LLM 上下文前进行过滤/摘要并记录节省数据。
2. **RTK 的启用方式是“选择性命令重写”**：对 `git/rg/ls/cat/pytest/curl/...` 等白名单命令，在不包含 `| & ; \` $ ( ) { }` 等元字符时，把原命令重写成 `rtk <original_cmd>`；并通过环境变量 `RTK_DB_PATH` 指定写入统计数据库的位置（`rtk-tracking.db`）。
3. **self-involve 的一个落地实现是“FatigueService”**：把疲劳/睡眠状态持久化到 `~/.config/alma/fatigue.json`，每次消息更新疲劳值，并动态生成一段强约束的提示词片段注入对话（例如在疲劳高时倾向委派、要求执行 `alma sleep/wake/rest` 以同步外部状态）。
4. **self-management 的一个落地实现是“MissionExecutorService”**：把 mission/goals/agents 状态持久化到 `~/.config/alma/missions/missions.json`，周期性与事件驱动地调度子 agent，处理重试/卡死/失联任务；当子 agent 多次失败会触发“chat takeover”回退，让主聊天接管完成目标。
5. **记忆系统是 SQLite + vec0 向量表 + FTS5**：`memories` 表存文本与 metadata；`memory_embeddings` 虚拟表使用 `vec0` 存向量；并有 embedding model 变更时的重建逻辑、维度自适应、检索后访问统计回写（accessCount/lastAccessedAt）。

这 5 点足够支撑我们在 Nion 中做“可迁移设计点”的抽象：命令输出压缩、可观测 token 节省、可持久化自状态（疲劳/情绪等）、长期任务编排与回退、记忆检索的工程化细节（FTS、向量维度迁移、访问统计）。

---

## 学习范围与产出物

**核心主题：**
- RTK（Token 节省、工具输出压缩、统计与观测）
- self-involve（自状态：疲劳/情绪/偏好，如何影响行为）
- self-management（mission/goal/subagent 编排、失败回退与可恢复性）
- 记忆系统（抽取/写入/检索/管理/迁移）
- Tools（工具集合、权限、Tool Model、沙箱）
- Artifacts（生成物预览、预览服务器、打开方式、与对话/项目的绑定）

**建议新增的研究文档（落在仓库内，便于团队复盘与迭代）：**
- `docs/research/alma/rtk.md`
- `docs/research/alma/self-involve-self-management.md`
- `docs/research/alma/memory.md`
- `docs/research/alma/tools.md`
- `docs/research/alma/artifacts.md`
- `docs/research/alma/nion-gap-and-proposals.md`（最终落地清单与优先级）

---

### Task 1: 拉通 Alma 文档的“工具/Artifacts/记忆”心智模型（只做结构化笔记）

**Files:**
- Create: `docs/research/alma/tools.md`
- Create: `docs/research/alma/artifacts.md`
- Create: `docs/research/alma/memory.md`

**Step 1: 阅读 Tools 文档并提炼固定框架**
- 关注：工具分类、Tool Model、工具权限、沙箱隔离、Computer Use、MCP、文件系统/终端类工具的边界。
- 输出统一模板：`能力 -> 触发入口 -> 权限/配置 -> 数据输入输出 -> 失败模式 -> 可观测指标 -> Nion 对照点`。

**Step 2: 阅读 Artifacts 文档并提炼预览与项目绑定语义**
- 关注：支持的预览类型、iframe/外部浏览器/系统打开差异、预览服务器的启停策略与资源回收。

**Step 3: 阅读 记忆系统文档并提炼“抽取/写入/检索/管理”闭环**
- 关注：自动 vs 手动记忆、检索数量与阈值、用户态管理动作。

**Step 4: 验证笔记完整性（快速自检）**
- 自检点：每篇文档至少包含 2 个“我们可以立刻借鉴”的机制与 2 个“需要谨慎”的边界条件。

**Step 5: Commit**
- `git add docs/research/alma/*.md`
- `git commit -m "docs(alma): add structured notes for tools/artifacts/memory" -m "<详细注释：学习目标、提炼框架、后续对照点>"`

---

### Task 2: 逆向确认 RTK 的“拦截点、白名单、统计口径”（不抄实现，只做机制抽象）

**Files:**
- Create: `docs/research/alma/rtk.md`

**Step 1: 从 Alma.app 包体确认 RTK 的调用链**
- 命令重写策略：白名单命令、元字符黑名单、环境变量注入（例如 `RTK_DB_PATH`）。
- 统计落库：数据库文件位置、统计字段口径（input/output/saved/timing）。

**Step 2: 把 RTK 的机制抽象成 Nion 可实现的“ToolOutputCompressor”接口**
- 输入：tool_name、raw_output、上下文（命令/参数/文件路径/采样策略）
- 输出：compressed_output、saved_estimate、debug_meta

**Step 3: 给出 Nion 迁移建议（两档方案）**
- 方案 A（低成本）：纯截断 + 结构化摘要（按 tool 类型规则化）
- 方案 B（更强）：引入“二级工具模型”做输出压缩（需评估成本、稳定性、隐私）

**Step 4: Commit**
- `git add docs/research/alma/rtk.md`
- `git commit -m "docs(alma): analyze RTK mechanism and map to Nion compressor interface" -m "<详细注释：RTK 机制抽象、口径、Nion 借鉴方案与风险>"`

---

### Task 3: 逆向确认 self-involve（Fatigue/Emotion）与 self-management（Mission/Goal/Agent）的状态机与持久化策略

**Files:**
- Create: `docs/research/alma/self-involve-self-management.md`

**Step 1: 提炼 FatigueService 的关键设计点**
- 状态：fatigue/messageCount/lastMessageTime/lastRestTime/manualSleep/manualWake
- 演化：衰减/增长、时间段加权、自动唤醒条件
- 注入：把状态翻译成“强约束提示词片段”，并要求执行外部命令同步状态

**Step 2: 提炼 MissionExecutorService 的关键设计点**
- 状态：mission/goals/agents/logs/summary/updatedAt
- 调度：事件驱动 + safety interval；全局/局部并发上限
- 可靠性：卡死 kill、重试计数、重启后 reconcile、chat takeover 回退、人工 retry/reactivate

**Step 3: 映射到 Nion**
- Nion 侧候选落点：scheduler、subagent_runs、heartbeat/evolution、threads、tool runtime
- 重点回答：哪些能力我们已有，哪些缺少“状态持久化 + 可恢复性 + 可观测”这三件套

**Step 4: Commit**
- `git add docs/research/alma/self-involve-self-management.md`
- `git commit -m \"docs(alma): extract self-involve/self-management state machines and Nion mapping\" -m \"<详细注释：状态机、持久化、调度/回退策略、对照 Nion 的落点>\"`

---

### Task 4: 对照 Nion 现状做 Gap Analysis，并产出可落地的“借鉴清单 + 优先级”

**Files:**
- Create: `docs/research/alma/nion-gap-and-proposals.md`
- Modify (参考对照，必要时补链路说明): `docs/plans/2026-03-16-module-map.md`

**Step 1: 列出 Nion 对照的核心模块与入口**
- Tools：`backend/app/gateway/routers/tools.py`、`backend/app/gateway/routers/cli_interactive.py`
- Artifacts：`backend/app/gateway/routers/artifacts.py`、`frontend/src/components/workspace/artifacts/*`
- Memory：`backend/app/gateway/routers/memory.py`、`backend/packages/harness/nion/agents/memory/*`
- Desktop：`desktop/electron/src/*`（与前端运行时/代理相关）

**Step 2: 用同一张表输出差异**
- 维度：能力、配置、权限、可观测、失败/回退、可恢复性、用户可控性

**Step 3: 形成 3 个层级的落地建议**
- Level 1（本周可落地）：低风险小改动
- Level 2（两周 PoC）：需要新增少量模块/接口
- Level 3（产品化里程碑）：需要 UI/后端/桌面端联动

**Step 4: Commit**
- `git add docs/research/alma/nion-gap-and-proposals.md docs/plans/2026-03-16-module-map.md`
- `git commit -m \"docs(alma): produce Nion gap analysis and adoption backlog\" -m \"<详细注释：差异表、优先级、收益与风险、推荐 PoC 顺序>\"`

---

### Task 5: PoC 选题与验证门禁（先选 1 个，避免摊大饼）

**Files:**
- Create: `docs/plans/YYYY-MM-DD-<poc-name>.md`（按实际 PoC 再开新 plan）

**Step 1: 从以下 PoC 中选 1 个作为第一优先**
- PoC-A：工具输出压缩与 token 节省统计（对标 RTK 的“可观测 + 可解释”）
- PoC-B：任务/目标编排最小闭环（对标 Mission 的“可恢复调度 + 回退”）
- PoC-C：自状态注入（疲劳/能量）并打通“外部状态同步命令”

**Step 2: 定义 PoC 验证门禁（必须量化）**
- 成功指标：节省 token、失败率、误裁剪率、用户满意度（最小反馈）
- 回滚策略：开关、灰度、数据兼容

**Step 3: Commit**
- 只在创建 PoC plan 文档时提交（不在本任务直接改代码）。

