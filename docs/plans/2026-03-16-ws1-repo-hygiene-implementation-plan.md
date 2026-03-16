# WS1 Repo Hygiene Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 产出“无效代码/资产候选清单 + 证据链”，并以小步、可回滚方式完成第一批低风险清理（优先 D/C 级），在不破坏稳定性的前提下降噪、控体量、为后续重构降低理解成本。

**Architecture:** 以“证据链删除”为核心方法论：候选发现（静态扫描/启发式工具）→ 逐项取证（静态引用 + 动态加载排查）→ 决策（删除/冻结/迁移/保留）→ 验证门禁（`make verify`）→ 记录沉淀（`docs/优化记录/`）→ 小步提交（可 `git revert`）。

**Tech Stack:** `rg`/`find`/git、Backend: `ruff`/`pytest`/`pytest-cov`/`vulture`、Frontend: `eslint`/`tsc`/`vitest`、Desktop: `tsc`/`node --test`、全栈门禁：`make verify`。

---

## 范围与约束（Scope Freeze）

### 范围（本阶段聚焦）

- D/C 级优先：`reports/`、`docs/`（非 plans/product-design/优化记录）、`openspec/`、低风险脚本/静态产物。
- 允许作为“候选线索”扫描：Backend `vulture` 输出（**不直接删除**，只作为候选线索）。

### 非目标（本阶段明确不做）

- 不触碰 A 级核心域（Memory/Sandbox/Channels/Scheduler/对外契约）的大规模删除或重构。
- 不做“目录大搬家/大重排”。
- 不把启发式工具（例如 vulture）当成删除依据。

---

## 产出物（本阶段必须交付）

- `docs/优化记录/2026-03-16-WS1-hygiene.md`：阶段执行记录（候选表 + 证据链 + 验证证据 + 回滚点）。
- 至少 1 个低风险清理提交（可回滚、小步、验证全绿）。

---

## Task 0: 初始化 WS1 优化记录文件（必做）

**Files:**
- Create: `docs/优化记录/2026-03-16-WS1-hygiene.md`
- Reference: `docs/优化记录/TEMPLATE.md`

**Step 1: 创建记录文件**

- 复制模板结构，填写：日期、Workstream、范围、风险等级、目标优先级、关联计划（本文件路径）。

**Step 2: 提交**

- 仅提交记录文件（不要混入其他改动）。

---

## Task 1: 生成“候选清单（D/C 级）”的初稿

**Files:**
- Modify: `docs/优化记录/2026-03-16-WS1-hygiene.md`

**Step 1: 收集候选目录与文件清单（不删除）**

运行（仓库根目录）：

```bash
find reports -type f | wc -l
find reports -type f | head -n 50
find openspec -type f | head -n 50
find docs -maxdepth 2 -type f | head -n 80
```

预期：命令成功返回；不要求结果为空。把观察到的“明显原型/过期产物/重复文档”先作为候选项写入记录表。

**Step 2: 提交记录更新**

提交只包含 `docs/优化记录/2026-03-16-WS1-hygiene.md` 的新增候选项，不包含删除动作。

---

## Task 2: 针对候选项逐条补齐证据链（决定删/冻/留）

**Files:**
- Modify: `docs/优化记录/2026-03-16-WS1-hygiene.md`

**Step 1: 对每个候选项执行静态引用扫描**

对候选文件/目录名、关键字符串、路由路径、配置 key 做 `rg`：

```bash
rg -n "<关键字符串或文件名>" .
```

预期：要么没有引用，要么引用点清晰可解释（例如只在 docs 中引用）。

**Step 2: 动态加载排查（关键）**

对任何可能被“目录扫描/注册表/配置驱动”加载的内容，必须额外排查：

- skills/plugins/marketplace 目录扫描点
- 通过配置启用的资源路径
- 通过字符串拼接形成的路径

（本步骤以人工审查为主，结果写入记录文档）

**Step 3: 决策并写入记录**

每条候选必须给出决策之一：

- `DELETE`：可直接删除（低风险、证据链充分）
- `FREEZE`：先冻结/隔离（动态引用不确定）
- `MIGRATE`：先迁移到新位置/合并后再删旧
- `KEEP`：保留（说明原因）

**Step 4: 提交记录更新**

仍然只提交记录文件更新，不做删除。

---

## Task 3: 后端启发式“死代码候选”扫描（只作为线索）

**Files:**
- Modify: `docs/优化记录/2026-03-16-WS1-hygiene.md`

**Step 1: 运行 vulture（候选线索）**

```bash
cd backend
make deadcode
```

预期：命令可能返回候选列表；把候选项写入记录的“线索区”，并标注“不可直接删除，需走证据链删除流程”。

**Step 2: 提交记录更新**

提交只包含记录文件更新。

---

## Task 4: 执行第一批低风险清理（小步、可回滚）

**Files:**
- Modify/Delete: （按 Task 2 的 DELETE 决策确定）
- Modify: `docs/优化记录/2026-03-16-WS1-hygiene.md`

**Step 1: 仅删除 1-3 个最确定的候选项**

原则：

- 优先 D 级：原型/报告/重复静态产物
- 一次只删很少，保证回滚粒度细

**Step 2: 跑全栈门禁**

```bash
make verify
```

预期：exit 0（frontend 允许 warnings，但不得有 errors）。

**Step 3: 更新优化记录**

写清楚：

- 删了什么、为什么
- 证据链（rg/dynamic）
- 验证证据（make verify 摘要）
- 回滚方式（git revert）

**Step 4: 提交（删除 + 记录）**

此提交可以同时包含：

- 删除动作
- 对应的 `docs/优化记录` 更新

但禁止混入其他无关重构/格式化。

---

## Task 5: WS1 阶段收尾（为后续并发 workstream 做准备）

**Step 1: 再跑一次 `make verify`（新鲜证据）**

**Step 2: 确保 `docs/优化记录/2026-03-16-WS1-hygiene.md` 包含**

- 候选表（含决策与证据链）
- 本阶段删除成果（如有）
- 风险点与回滚点
- 下一步候选（为 WS2/WS3/WS4 提供输入）

**Step 3: 合并到 main（ff-only）**

（如在独立分支/worktree 执行）

