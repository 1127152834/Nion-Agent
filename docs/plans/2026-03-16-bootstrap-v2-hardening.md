# Bootstrap V2 Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让“创建智能体 / 默认助手入门引导”的 bootstrap 流程稳定产出并落盘 **SOUL(persona) + IDENTITY(role) + Memory seed**，并在后端通过可测试的门禁避免 SOUL/IDENTITY 内容混写导致的行为漂移。

**Architecture:**  
在现有 Bootstrap V2 基础上补齐两类“硬约束”：(1) `setup_agent` 工具侧对 SOUL 做轻量可解释的内容校验，发现职责/交付物等“Identity 内容”混入时直接拒绝写盘；(2) bootstrap skill 增加“Draft 自检”步骤，确保在展示与落盘前先把信息正确拆分到 SOUL/IDENTITY/Memory。

**Tech Stack:** Python(FastAPI/LangGraph tools/pytest/uv) + Next.js(TypeScript/pnpm) + Skills assets。

---

## Task 0: 准备与基线（不改业务代码）

**Files:**
- None

**Step 1: 确认在 worktree 分支执行**

Run:
```bash
git status --porcelain=v1
git branch --show-current
```

Expected:
- `git status` 为空
- 分支名以 `codex/` 开头

**Step 2: 跑最小基线验证（避免在“红底盘”上开发）**

Run:
```bash
cd backend
uv run -p /opt/homebrew/bin/python3.12 pytest -q
cd ../frontend
pnpm exec tsc --noEmit
```

Expected:
- 后端单测全绿
- 前端类型检查通过

---

## Task 1: 后端门禁（TDD）- 拒绝 “Identity 内容混入 SOUL”

### Task 1.1: 新增失败测试（custom/default 两条路径）

**Files:**
- Modify: `backend/tests/test_setup_agent_tool_bootstrap.py`

**Step 1: 写 failing tests（先锁定期望行为）**

新增 2 个用例：
- custom：`soul` 内含明显 Identity 标题（例如 `## 主要任务与范围` / `典型输入 → 输出`），应返回错误 ToolMessage，且 **不创建** `agents/{name}` 目录。
- default：同理，且 **不创建** `agents/_default` 目录（不应触发 `ensure_default_agent()`）。

建议测试断言要点：
- `result.update["messages"][0].content` 包含 “SOUL” 与 “IDENTITY” 的迁移提示（可行动）。
- 写盘副作用为 0：目录/文件不存在。

**Step 2: 运行测试验证失败**

Run:
```bash
cd backend
uv run -p /opt/homebrew/bin/python3.12 pytest -q tests/test_setup_agent_tool_bootstrap.py
```

Expected: FAIL（当前实现会写盘，不会拒绝）

**Step 3: Commit（仅测试）**

Commit（示例，务必写完整 commit body）：
```bash
git add backend/tests/test_setup_agent_tool_bootstrap.py
git commit -m "test(setup_agent): 增加 SOUL 内容边界门禁（混入职责/交付物应拒绝写盘）" \
  -m "Plan: 为 bootstrap 资产落盘增加可测试的 SOUL/IDENTITY 边界门禁（先加失败测试再实现）。" \
  -m "Why: 线上反馈显示 SOUL 被写成职责说明书，注入后会导致行为漂移；需要工具侧兜底防止资产污染。" \
  -m "What: 在 setup_agent 的 custom/default 两条路径上，新增 SOUL 含 Identity 结构化标题时的拒绝写盘测试。" \
  -m "Validation: uv run -p /opt/homebrew/bin/python3.12 pytest -q tests/test_setup_agent_tool_bootstrap.py（预期失败）。" \
  -m "Follow-up: 下一提交实现最小校验器并确保在任何写盘动作前返回错误。"
```

---

### Task 1.2: 实现最小 SOUL 校验器（不引入重依赖）

**Files:**
- Modify: `backend/src/tools/builtins/setup_agent_tool.py`

**Step 1: 最小实现**

实现一个轻量、可解释、低误伤的校验：
- 仅匹配“强信号”的 Identity 结构化标题/关键词（中英各一组，case-insensitive）。
- 一旦命中：返回 `_tool_error(...)`，并提示把对应内容移动到 `IDENTITY.md`。
- 校验必须发生在任何写盘行为之前：
  - custom：在读取 `get_paths()` 并创建目录之前直接返回
  - default：在 `ensure_default_agent()` 之前直接返回

建议命中集合（可扩展，但先保守）：
- `主要任务`、`职责`、`交付物`、`典型输入`、`输入 → 输出`、`质量标准`、`边界与禁区`
- `Role`、`Tasks`、`Deliverables`、`Input`、`Output`

**Step 2: 跑测试**

Run:
```bash
cd backend
uv run -p /opt/homebrew/bin/python3.12 pytest -q tests/test_setup_agent_tool_bootstrap.py
uv run -p /opt/homebrew/bin/python3.12 pytest -q
```

Expected: PASS

**Step 3: Commit（实现）**

```bash
git add backend/src/tools/builtins/setup_agent_tool.py
git commit -m "feat(setup_agent): 增加 SOUL 边界校验并在混写时拒绝写盘（bootstrap 兜底）" \
  -m "Plan: 按上一提交的失败测试，实现最小可解释校验器，确保在任何写盘前阻断 SOUL/IDENTITY 混写。" \
  -m "Why: 仅靠 prompt/skill 约束不够稳，工具侧需要作为最后一道防线，防止人格资产被职责信息污染。" \
  -m "What: setup_agent 在 custom/default 分支增加 SOUL 文本检查；命中强信号 Identity 标题/关键词时返回错误 ToolMessage，不产生写盘副作用。" \
  -m "Validation: uv run -p /opt/homebrew/bin/python3.12 pytest -q tests/test_setup_agent_tool_bootstrap.py; uv run -p /opt/homebrew/bin/python3.12 pytest -q（全绿）。" \
  -m "Follow-up: 如出现误伤案例，再以 whitelist/更强结构化匹配方式迭代，避免扩大规则面。"
```

---

## Task 2: 更新默认助手初始化模板（对齐 Soul/Identity 边界）

**Files:**
- Modify: `backend/src/config/default_agent.py`
- Test: `backend/tests/test_default_agent_init.py`（若调整 description 文案）

**Step 1: 写最小变更**
- 将 `DEFAULT_SOUL_CONTENT` 改为“人格资产”风格（气质/价值观/表达/边界），避免写职责清单。
- 将 “能力/职责/交付物/澄清策略” 放到 `DEFAULT_IDENTITY_CONTENT`。
- 尽量保持 `ensure_default_agent()` 行为不变（仍然只在缺失 `agent.json` 时初始化）。

**Step 2: 运行测试**

Run:
```bash
cd backend
uv run -p /opt/homebrew/bin/python3.12 pytest -q tests/test_default_agent_init.py
```

Expected: PASS

**Step 3: Commit**

```bash
git add backend/src/config/default_agent.py backend/tests/test_default_agent_init.py
git commit -m "fix(default-agent): 初始化 SOUL/IDENTITY 默认内容对齐人格/角色边界（避免 SOUL 混入职责）" \
  -m "Plan: 调整默认助手的首次初始化模板，使其符合 Soul Core 的注入语义（SOUL=人格，IDENTITY=角色）。" \
  -m "Why: 当前默认模板把能力/任务写进 SOUL，容易造成注入后行为漂移，并与 Bootstrap V2 的资产边界定义冲突。" \
  -m "What: 重写 DEFAULT_SOUL_CONTENT/DEFAULT_IDENTITY_CONTENT；如必要同步更新 default agent init 单测的预期 description。" \
  -m \"Validation: uv run -p /opt/homebrew/bin/python3.12 pytest -q tests/test_default_agent_init.py（PASS）。\" \
  -m "Follow-up: 若需要迁移既有 ~/.nion/agents/_default 资产，建议通过 /workspace/agents/bootstrap 引导流程完成（不做自动覆盖）。"
```

---

## Task 3: Skill 加固 - Draft 自检与强约束拆分

**Files:**
- Modify: `skills/public/bootstrap/SKILL.md`
- Modify: `skills/public/bootstrap/references/conversation-guide.md`
- (Optional) Modify: `skills/public/bootstrap/templates/SOUL.template.md`
- (Optional) Modify: `skills/public/bootstrap/templates/IDENTITY.template.md`

**Step 1: 增加“Draft 自检”段落（必须项）**
- 在展示草稿前增加 checklist：
  - SOUL 不得出现 “主要任务/交付物/输入输出/工具/工作流/职责” 等结构化段落或标题
  - IDENTITY 不得出现 “气质/世界观/价值观/表达癖好” 等人格信息
  - memory_items 必须短句、稳定、3–8 条、tier 仅 profile/preference
- 若发现混写：先在草稿中修正后再展示给用户确认（避免把错误资产带入落盘环节）。

**Step 2: Commit**

```bash
git add skills/public/bootstrap/SKILL.md skills/public/bootstrap/references/conversation-guide.md skills/public/bootstrap/templates/SOUL.template.md skills/public/bootstrap/templates/IDENTITY.template.md
git commit -m "feat(bootstrap-skill): 增加 Draft 自检与强拆分约束（降低 SOUL/IDENTITY 混写概率）" \
  -m "Plan: 在 skill 层加入可执行的自检清单，确保在落盘前完成 SOUL/IDENTITY/Memory 的边界校正。" \
  -m "Why: 用户反馈显示模型易把职责写入 SOUL；仅靠模板描述仍可能被忽略，需要更显式的流程门禁。" \
  -m "What: 更新 bootstrap skill 文档/对话指南（必要时微调模板），加入混写检测与修正步骤。" \
  -m "Validation: 手动走一遍创建智能体与默认助手引导，确认产物分离且 setup_agent 能成功落盘；前端首条消息仍以 /bootstrap 触发。" \
  -m "Follow-up: 如仍有漂移，考虑加入更强的结构化输出（例如固定标题集）或引入离线 prompt-eval。"
```

---

## Task 4: 最终验收（手动 E2E）

Run:
```bash
cd backend
uv run -p /opt/homebrew/bin/python3.12 pytest -q
cd ../frontend
pnpm exec tsc --noEmit
```

手动流程（必须过）：
1. 新建智能体页创建一个新 agent：完成后检查 `~/.nion/agents/<slug>/SOUL.md` 不含职责段落，`IDENTITY.md` 含职责/交付物。
2. 同步 seed memory：设置页 Memory tab 能看到 tier=profile/preference 的条目（若用户允许 memory_write）。
3. 默认助手入门引导：更新 `_default/SOUL.md` 与 `_default/IDENTITY.md`，并验证不再是旧的 “Core Capabilities” 混写风格。

