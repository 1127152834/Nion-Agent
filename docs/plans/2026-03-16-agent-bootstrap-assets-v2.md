# Agent Bootstrap Assets V2 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让“创建智能体 / 默认助手入门引导”稳定生成并分别落盘 `SOUL.md + IDENTITY.md`，并在创建/更新时可选初始化 OpenViking Memory（profile/preference），彻底修复“SOUL 混入职责、IDENTITY 默认英文、Memory 空或随机”的问题。

**Architecture:**  
通过三层加固实现可靠性：前端首条消息显式请求 bootstrap skill（requested_skills），skill 侧强约束 SOUL/IDENTITY/MEMORY 边界并输出三份产物草稿，后端 `setup_agent` 工具强制 `identity` 非空并支持 `memory_items` 一键写入 OpenViking（避免模型忘记额外调用 memory_store）。

**Tech Stack:** FastAPI + LangGraph/LangChain tools + pytest；Next.js + TypeScript + pnpm。

---

## Task 0：确认工作区（不改代码）

**Step 1: 确认在隔离 worktree 分支执行**

Run:
```bash
git status --porcelain=v1
git branch --show-current
```

Expected:
- `git status` 为空
- 分支名以 `codex/` 开头

---

## Task 1：后端 TDD（setup_agent 强制 identity + 支持 memory_items）

### Task 1.1：新增失败测试（identity 必须非空）

**Files:**
- Modify: `backend/tests/test_setup_agent_tool_bootstrap.py`

**Step 1: 写 failing tests**

新增 2 个用例：
- custom：identity 为空应返回错误 ToolMessage，且不创建 agent 目录
- default：identity 为空应返回错误 ToolMessage，且不写入 `_default/IDENTITY.md`

**Step 2: 跑测试验证失败**

Run:
```bash
cd backend
uv run pytest -q tests/test_setup_agent_tool_bootstrap.py
```

Expected: FAIL（因为当前实现仍允许 identity 为空并落盘默认模板）

**Step 3: Commit（只提交测试）**

```bash
git add backend/tests/test_setup_agent_tool_bootstrap.py
git commit -m "test(setup_agent): identity 为空必须失败（bootstrap 资产边界门禁）"
```

---

### Task 1.2：新增行为测试（memory_items 写入 OpenViking，返回 memory_results）

**Files:**
- Modify: `backend/tests/test_setup_agent_tool_bootstrap.py`

**Step 1: 写 failing tests**

新增 2 个用例（用 patch stub，避免真实 OpenViking I/O）：
- custom：传入 memory_items（profile/preference）应调用 `store_memory_action`，并在 Command.update 中返回 `memory_results`
- default：同理，但 scope 应为 global（agent_name=None）

**Step 2: 跑测试验证失败**

Run:
```bash
cd backend
uv run pytest -q tests/test_setup_agent_tool_bootstrap.py
```

Expected: FAIL（因为当前 setup_agent 不支持 memory_items）

**Step 3: Commit（只提交测试）**

```bash
git add backend/tests/test_setup_agent_tool_bootstrap.py
git commit -m "test(setup_agent): 支持 memory_items 初始化 OpenViking 并回传结果（TDD）"
```

---

### Task 1.3：实现 setup_agent V2（identity 强制 + memory_items）

**Files:**
- Modify: `backend/src/tools/builtins/setup_agent_tool.py`

**Step 1: 实现 identity 非空门禁**
- 对 custom/default 都要求 `identity` 为非空字符串（strip 后仍非空）
- 若不满足：返回 ToolMessage 错误，并保证不写盘（custom 下尤其要避免创建目录后再报错）

**Step 2: 实现 memory_items 可选写入**
- 新增参数：`memory_items: list[dict] | None = None`
- 每条至少包含 `content: str`，可选 `tier` / `confidence`
- 写入逻辑：
  - custom：`store_memory_action(..., scope="agent", agent_name=<agent>)`，metadata 至少带 `tier`
  - default：`store_memory_action(..., scope="global", agent_name=None)`，metadata 同上
- 将写入结果聚合为 `memory_results` 放入 Command.update
- 写入失败时：不回滚已创建的 agent 文件资产，但要在 ToolMessage 内容中明确说明 memory 初始化失败（避免“看起来成功但实际没写”）

**Step 3: 跑测试**

Run:
```bash
cd backend
uv run pytest -q tests/test_setup_agent_tool_bootstrap.py
uv run pytest -q
```

Expected: PASS

**Step 4: Commit**

```bash
git add backend/src/tools/builtins/setup_agent_tool.py
git commit -m "feat(setup_agent): 强制 identity 非空并支持 memory_items 一键初始化 OpenViking"
```

---

## Task 2：重写 bootstrap skill（对齐 Soul/Identity/Memory 边界）

### Task 2.1：更新模板（SOUL/IDENTITY/MEMORY）

**Files:**
- Modify: `skills/public/bootstrap/templates/SOUL.template.md`
- Modify: `skills/public/bootstrap/templates/IDENTITY.template.md`
- Create: `skills/public/bootstrap/templates/MEMORY.template.md`

**Step 1: 更新 SOUL 模板**
- 只允许：人格、习惯、世界观、表达风格、关系边界
- 禁止：职责、交付物、工作流、工具列表

**Step 2: 更新 IDENTITY 模板**
- 只允许：角色定位、职责范围、交付物形态、边界禁区、质量标准、澄清策略
- 禁止：世界观/气质/人格癖好类内容（移到 SOUL）

**Step 3: 新增 MEMORY 模板（记忆初始化清单）**
- 输出为 3–8 条短句
- 每条标注 tier（profile/preference）
- 明确这些条目会写入 OpenViking memory（agent-scope 或 global）

**Step 4: Commit**

```bash
git add skills/public/bootstrap/templates/SOUL.template.md skills/public/bootstrap/templates/IDENTITY.template.md skills/public/bootstrap/templates/MEMORY.template.md
git commit -m "feat(bootstrap-skill): 重定义 SOUL/IDENTITY/MEMORY 模板边界（人格/角色/记忆三分离）"
```

---

### Task 2.2：更新对话引导与落盘逻辑（SKILL + guide）

**Files:**
- Modify: `skills/public/bootstrap/SKILL.md`
- Modify: `skills/public/bootstrap/references/conversation-guide.md`

**Step 1: 重写对话流程**
- 三轮抽取：Identity → Soul → Memory（必要时第四轮确认）
- 强制最终产物：SOUL.md + IDENTITY.md + memory_items（并给 description）

**Step 2: 更新工具调用示例**
- custom/default 都必须传 identity
- 使用 `memory_items` 参数一键写入

**Step 3: Commit**

```bash
git add skills/public/bootstrap/SKILL.md skills/public/bootstrap/references/conversation-guide.md
git commit -m "feat(bootstrap-skill): 三轮抽取并用 setup_agent(memory_items=...) 一键落盘（提升一致性）"
```

---

## Task 3：前端可靠性改造（强制 requested_skills=bootstrap）

### Task 3.1：新建智能体页首条消息携带 implicitMentions(skill=bootstrap)

**Files:**
- Modify: `frontend/src/app/workspace/agents/new/page.tsx`

**Step 1: 修改 sendMessage 首条消息**
- 在 message payload 增加 `implicitMentions: [{ kind: "skill", value: "bootstrap", mention: "bootstrap" }]`
- 保持文本仍以 `/bootstrap` 开头（双重保险）

**Step 2: tsc 验证**

Run:
```bash
pnpm -C frontend exec tsc --noEmit
```

**Step 3: Commit**

```bash
git add frontend/src/app/workspace/agents/new/page.tsx
git commit -m "fix(frontend): 创建智能体首条消息显式请求 bootstrap skill（requested_skills 门禁）"
```

---

### Task 3.2：默认助手引导页同样携带 implicitMentions

**Files:**
- Modify: `frontend/src/app/workspace/agents/bootstrap/page.tsx`

**Step 1: 自动首条消息增加 implicitMentions(skill=bootstrap)**

**Step 2: tsc 验证并 Commit**

Run:
```bash
pnpm -C frontend exec tsc --noEmit
```

Commit:
```bash
git add frontend/src/app/workspace/agents/bootstrap/page.tsx
git commit -m "fix(frontend): 默认助手引导页首条消息显式请求 bootstrap skill（避免按旧模板漂移）"
```

---

### Task 3.3：i18n 文案对齐三资产

**Files:**
- Modify: `frontend/src/core/i18n/locales/zh-CN.ts`
- Modify: `frontend/src/core/i18n/locales/en-US.ts`

**Step 1: 更新文案**
- 新建智能体 bootstrap 首条消息：明确会生成 SOUL/IDENTITY，并初始化 Memory（profile/preference）
- 默认助手 bootstrap startMessage：同理

**Step 2: tsc 验证并 Commit**

Run:
```bash
pnpm -C frontend exec tsc --noEmit
```

Commit:
```bash
git add frontend/src/core/i18n/locales/zh-CN.ts frontend/src/core/i18n/locales/en-US.ts
git commit -m "chore(i18n): bootstrap 文案明确三资产产物（SOUL/IDENTITY/Memory）"
```

---

## Task 4：最终验证

Run:
```bash
cd backend
uv run pytest -q
pnpm -C frontend exec tsc --noEmit
```

Expected:
- 后端全绿
- 前端类型检查通过

