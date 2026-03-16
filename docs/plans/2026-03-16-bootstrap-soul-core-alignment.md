# Bootstrap（入门引导）重设计 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:**  
把 `bootstrap`（入门引导）从旧 nion 语义升级为“资产引导生成器”，对齐当前 Nion 的 Soul Core：支持“新建自定义智能体”与“默认助手初始化/更新”两条路径，最终落盘 `SOUL.md + IDENTITY.md`，并可同步更新全局 `USER.md`（用户画像）。

**Architecture:**  
保持“文件资产 + 运行时注入”的轻量策略不变：`SOUL.md / IDENTITY.md / USER.md` 仍落在 `{base_dir}` 下，由 `SoulResolver/SoulSummarizer` 汇总并注入到 `SYSTEM_PROMPT`。本次只做 bootstrap skill 与 `setup_agent` 工具的对齐与加固，不引入数据库、不做 Heartbeat/Evolution 接线改造。

**Tech Stack:** Python 3.12 + FastAPI + LangGraph/LangChain + pytest；前端 Next.js + TypeScript + pnpm。

---

## 执行前说明（强烈建议）

当前仓库工作区存在大量无关脏改动（`git status` 非空）。为避免把无关改动混进本需求提交，本计划默认在独立 worktree 分支中执行。

### Task 0：创建隔离 worktree（不改代码）

**Step 1: 创建 worktree 分支**

Run:
```bash
git worktree add -b codex/bootstrap-soul-core-20260316 .worktrees/codex-bootstrap-soul-core-20260316 HEAD
```

Expected:
- 生成目录 `.worktrees/codex-bootstrap-soul-core-20260316/`
- 新 worktree 中 `git status --porcelain` 为空

**Step 2: 进入 worktree**

Run:
```bash
cd .worktrees/codex-bootstrap-soul-core-20260316
```

---

## 后端：扩展并加固 `setup_agent` 工具（TDD）

### Task 1：为 `setup_agent` 扩展能力写失败测试

**Files:**
- Create: `backend/tests/test_setup_agent_tool_bootstrap.py`

**Step 1: 写失败测试（覆盖 custom/default + USER.md marker + 重复创建安全）**

```python
from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest


def _paths(base_dir: Path):
    from nion.config.paths import Paths
    return Paths(base_dir=base_dir)


def _runtime(*, agent_name: str | None, agent_display_name: str | None = None):
    context: dict[str, object] = {}
    if agent_name is not None:
        context["agent_name"] = agent_name
    if agent_display_name is not None:
        context["agent_display_name"] = agent_display_name
    # setup_agent 会读取 runtime.tool_call_id 来构造 ToolMessage
    return SimpleNamespace(context=context, tool_call_id="test-call")


def test_setup_agent_custom_creates_assets_and_user_profile_block(tmp_path: Path):
    from nion.tools.builtins.setup_agent_tool import setup_agent

    with patch("nion.tools.builtins.setup_agent_tool.get_paths", return_value=_paths(tmp_path)):
        result = setup_agent.func(
            soul="# SOUL\\ncustom soul",
            description="A custom agent for writing and editing.",
            runtime=_runtime(agent_name="writer", agent_display_name="写作助手"),
            target="custom",
            identity="# IDENTITY\\ncustom identity",
            user_profile="# USER\\nuser profile v1",
            user_profile_strategy="replace_generated_block",
        )

    agent_dir = tmp_path / "agents" / "writer"
    assert (agent_dir / "SOUL.md").read_text(encoding="utf-8") == "# SOUL\\ncustom soul"
    assert (agent_dir / "IDENTITY.md").read_text(encoding="utf-8") == "# IDENTITY\\ncustom identity"

    config = json.loads((agent_dir / "agent.json").read_text(encoding="utf-8"))
    assert config["name"] == "writer"
    assert config["description"] == "A custom agent for writing and editing."
    assert config["heartbeat_enabled"] is True
    assert config["evolution_enabled"] is True
    assert config["display_name"] == "写作助手"

    user_md = (tmp_path / "USER.md").read_text(encoding="utf-8")
    assert "<!-- nion:bootstrap:user_profile:start -->" in user_md
    assert "# USER\\nuser profile v1" in user_md
    assert "<!-- nion:bootstrap:user_profile:end -->" in user_md


def test_setup_agent_custom_rejects_existing_agent_dir_without_mutation(tmp_path: Path):
    from nion.tools.builtins.setup_agent_tool import setup_agent

    agent_dir = tmp_path / "agents" / "writer"
    agent_dir.mkdir(parents=True, exist_ok=True)
    sentinel = agent_dir / "sentinel.txt"
    sentinel.write_text("do-not-delete", encoding="utf-8")

    with patch("nion.tools.builtins.setup_agent_tool.get_paths", return_value=_paths(tmp_path)):
        result = setup_agent.func(
            soul="new soul",
            description="new desc",
            runtime=_runtime(agent_name="writer", agent_display_name="写作助手"),
            target="custom",
        )

    # 不应删除/覆盖既有目录
    assert sentinel.exists()
    assert sentinel.read_text(encoding="utf-8") == "do-not-delete"
    # 失败应返回 ToolMessage（Command.update.messages）
    assert result.update.get("messages")
    assert "already exists" in (result.update["messages"][0].content or "").lower()


def test_setup_agent_default_updates_assets_without_agent_name(tmp_path: Path):
    from nion.tools.builtins.setup_agent_tool import setup_agent

    with patch("nion.tools.builtins.setup_agent_tool.get_paths", return_value=_paths(tmp_path)):
        result = setup_agent.func(
            soul="# SOUL\\ndefault soul v2",
            description="ignored",
            runtime=_runtime(agent_name=None),
            target="default",
            identity="# IDENTITY\\ndefault identity v2",
            user_profile="# USER\\nuser profile v2",
        )

    default_dir = tmp_path / "agents" / "_default"
    assert (default_dir / "SOUL.md").read_text(encoding="utf-8") == "# SOUL\\ndefault soul v2"
    assert (default_dir / "IDENTITY.md").read_text(encoding="utf-8") == "# IDENTITY\\ndefault identity v2"
    user_md = (tmp_path / "USER.md").read_text(encoding="utf-8")
    assert "# USER\\nuser profile v2" in user_md


def test_user_profile_marker_replaces_existing_block(tmp_path: Path):
    from nion.tools.builtins.setup_agent_tool import setup_agent

    existing = (
        "manual header\\n"
        "<!-- nion:bootstrap:user_profile:start -->\\n"
        "old block\\n"
        "<!-- nion:bootstrap:user_profile:end -->\\n"
        "manual footer\\n"
    )
    (tmp_path / "USER.md").write_text(existing, encoding="utf-8")

    with patch("nion.tools.builtins.setup_agent_tool.get_paths", return_value=_paths(tmp_path)):
        _ = setup_agent.func(
            soul="soul",
            description="desc",
            runtime=_runtime(agent_name=None),
            target="default",
            user_profile="new block",
        )

    updated = (tmp_path / "USER.md").read_text(encoding="utf-8")
    assert "manual header" in updated
    assert "manual footer" in updated
    assert "old block" not in updated
    assert "new block" in updated
```

**Step 2: 跑测试验证失败**

Run:
```bash
cd backend
uv run pytest -q tests/test_setup_agent_tool_bootstrap.py
```

Expected (Fail):
- `setup_agent` 目前不支持 `target/identity/user_profile/user_profile_strategy`
- 重复创建场景没有保护（会覆盖或可能误删），测试应失败

**Step 3: Commit（仅提交测试）**

```bash
git add backend/tests/test_setup_agent_tool_bootstrap.py
git commit -m "test(bootstrap): add failing tests for setup_agent target+identity+user_profile"
```

---

### Task 2：实现 USER.md marker 写入策略 + `setup_agent` 扩展（让测试转绿）

**Files:**
- Modify: `backend/packages/harness/nion/tools/builtins/setup_agent_tool.py`

**Step 1: 实现 USER.md marker upsert（最小可读实现）**

在 `setup_agent_tool.py` 内新增常量与 helper（示例实现，保持易读即可）：

```python
USER_PROFILE_MARKER_START = "<!-- nion:bootstrap:user_profile:start -->"
USER_PROFILE_MARKER_END = "<!-- nion:bootstrap:user_profile:end -->"


def _render_user_profile_block(content: str) -> str:
    normalized = (content or "").strip()
    return f"{USER_PROFILE_MARKER_START}\n{normalized}\n{USER_PROFILE_MARKER_END}\n"


def _upsert_user_profile_block(*, user_md_path: Path, content: str) -> None:
    normalized = (content or "").strip()
    if not normalized:
        return

    block = _render_user_profile_block(normalized)
    if not user_md_path.exists():
        user_md_path.write_text(block, encoding="utf-8")
        return

    raw = user_md_path.read_text(encoding="utf-8")
    start = raw.find(USER_PROFILE_MARKER_START)
    end = raw.find(USER_PROFILE_MARKER_END)

    if start != -1 and end != -1 and end > start:
        end += len(USER_PROFILE_MARKER_END)
        before = raw[:start].rstrip("\n")
        after = raw[end:].lstrip("\n")
        merged = before + ("\n\n" if before else "") + block.strip("\n") + ("\n\n" if after else "\n") + after
        user_md_path.write_text(merged, encoding="utf-8")
        return

    # No marker block found: append
    merged = raw.rstrip("\n") + "\n\n" + block
    user_md_path.write_text(merged, encoding="utf-8")
```

**Step 2: 扩展 `setup_agent` 参数与行为**

要求（写成代码时必须严格满足）：
- 新增参数：
  - `target: Literal["custom", "default"] = "custom"`
  - `identity: str | None = None`
  - `user_profile: str | None = None`
  - `user_profile_strategy: Literal["replace_generated_block"] = "replace_generated_block"`
- `target="custom"`：
  - 必须有 `runtime.context["agent_name"]`
  - agent 目录已存在则返回错误 `ToolMessage`，不得写盘、不得清理目录
  - 使用 `mkdir(..., exist_ok=False)` 或显式 exists 检查，避免覆盖
  - `IDENTITY.md` 写入：优先使用入参 `identity`；为空则用默认模板
- `target="default"`：
  - 不要求 `agent_name`
  - `ensure_default_agent()` 保障 `_default` 存在
  - 只覆盖写入 `_default` 的 `SOUL.md/IDENTITY.md`（不要改 agent.json 的 description）
- `user_profile`：
  - 非空则按 marker 策略更新 `{base_dir}/USER.md`

**Step 3: 跑测试**

Run:
```bash
cd backend
uv run pytest -q tests/test_setup_agent_tool_bootstrap.py
```

Expected:
- PASS

**Step 4: Commit（后端实现）**

```bash
git add backend/packages/harness/nion/tools/builtins/setup_agent_tool.py
git commit -m "feat(bootstrap): extend setup_agent for default target + identity + USER.md marker update"
```

---

## Skill：重写 `skills/public/bootstrap`（资产引导生成器）

> 说明：Skill 属于提示词资产，无法通过单测覆盖；但必须保证与工具签名一致、路径一致，并能在对话中稳定触发 `/bootstrap`。

### Task 3：更新/新增 bootstrap 模板（SOUL/IDENTITY/USER）

**Files:**
- Modify: `skills/public/bootstrap/templates/SOUL.template.md`
- Create: `skills/public/bootstrap/templates/IDENTITY.template.md`
- Create: `skills/public/bootstrap/templates/USER.template.md`

**Step 1: 更新 `SOUL.template.md`（从“伙伴人设”转为“可注入行为与风格”）**

要求：
- 控制长度，强调“行为规则/沟通风格/风险偏好/失败处理”
- 允许中文或英文（默认跟随对话语言）

**Step 2: 新增 `IDENTITY.template.md`**

要求：
- 明确 Role/Responsibilities/Non-goals/Boundaries/Outputs
- 这份资产要比 SOUL 更偏“职责与边界”，便于长期维护

**Step 3: 新增 `USER.template.md`**

要求：
- 用户背景、目标、偏好、禁区
- 这份资产最终写入全局 `USER.md` 的 marker block

**Step 4: Commit（模板）**

```bash
git add skills/public/bootstrap/templates
git commit -m "docs(bootstrap): add IDENTITY/USER templates and refocus SOUL template"
```

---

### Task 4：重写 bootstrap 的对话指南与落盘规则

**Files:**
- Modify: `skills/public/bootstrap/SKILL.md`
- Modify: `skills/public/bootstrap/references/conversation-guide.md`

**Step 1: `conversation-guide.md` 改为 4 轮对话（按计划）**

必须包含：
- 分流规则：
  - runtime context 存在 `agent_name` -> 自定义智能体创建
  - 否则 -> 默认助手初始化/更新
- 每轮最多 1-3 个问题，优先用“提议 + 纠正”

**Step 2: `SKILL.md` 对齐新产物与工具调用**

必须包含：
- 产物：`SOUL.md + IDENTITY.md + （可选）USER.md`
- 工具调用示例（两条路径都写清楚）：
  - 自定义智能体：
    - `setup_agent(soul="...", description="...", identity="...", user_profile="...", target="custom", user_profile_strategy="replace_generated_block")`
  - 默认助手：
    - `setup_agent(soul="...", description="ignored", identity="...", user_profile="...", target="default", user_profile_strategy="replace_generated_block")`
- 删除“SOUL.md 必须英文”的旧规则，改为“默认跟随对话语言”

**Step 3: Commit（skill 文档）**

```bash
git add skills/public/bootstrap/SKILL.md skills/public/bootstrap/references/conversation-guide.md
git commit -m "docs(bootstrap): redesign onboarding flow for Soul Core assets (custom/default + USER.md)"
```

---

## 前端：新建智能体强制触发 `/bootstrap` + 默认助手入门引导入口

### Task 5：更新“新建智能体”首条消息（强制触发 skill，并说明资产范围）

**Files:**
- Modify: `frontend/src/app/workspace/agents/new/page.tsx`
- Modify: `frontend/src/core/i18n/locales/zh-CN.ts`
- Modify: `frontend/src/core/i18n/locales/en-US.ts`

**Step 1: 更新 i18n 文案 `t.agents.nameStepBootstrapMessage`**

要求：
- 文案以 `/bootstrap` 开头（第一行）
- 说明将生成 `SOUL.md + IDENTITY.md`，并会在需要时更新全局 `USER.md`

**Step 2: NewAgentPage 仍使用该文案作为第一条 user message**

（保持现有代码结构不变，仅替换文案即可）

**Step 3: 前端类型检查**

Run:
```bash
pnpm -C frontend exec tsc --noEmit
```

Expected:
- PASS

**Step 4: Commit（新建智能体入口）**

```bash
git add frontend/src/app/workspace/agents/new/page.tsx frontend/src/core/i18n/locales/zh-CN.ts frontend/src/core/i18n/locales/en-US.ts
git commit -m "feat(agents): force /bootstrap on new agent onboarding and clarify generated assets"
```

---

### Task 6：新增默认助手“入门引导”页面（bootstrap chat）

**Files:**
- Create: `frontend/src/app/workspace/agents/bootstrap/page.tsx`
- Modify: `frontend/src/core/i18n/locales/zh-CN.ts`
- Modify: `frontend/src/core/i18n/locales/en-US.ts`

**Step 1: 新增页面（参考 `agents/new/page.tsx` 的 chat UI 结构）**

要求：
- `useThreadStream` context 必须包含：
  - `is_bootstrap: true`
  - 建议 `mode: "flash"`（对齐现有 new agent bootstrap）
- 页面 mount 后自动发送第一条消息，第一行以 `/bootstrap` 开头，并明确：
  - 目标：更新默认助手 `_default` 的 `SOUL.md + IDENTITY.md`
  - 同步更新全局 `USER.md`（marker block）
- `onToolEnd` 捕捉 `setup_agent` 成功后：
  - 跳转到 `/workspace/agents/_default/settings?section=soul` 便于人工复核

**Step 2: 新增 i18n copy（至少包含按钮标题与首条消息内容）**

**Step 3: 前端类型检查**

Run:
```bash
pnpm -C frontend exec tsc --noEmit
```

Expected:
- PASS

**Step 4: Commit（默认助手 bootstrap 页面）**

```bash
git add frontend/src/app/workspace/agents/bootstrap/page.tsx frontend/src/core/i18n/locales/zh-CN.ts frontend/src/core/i18n/locales/en-US.ts
git commit -m "feat(agents): add default agent bootstrap chat page (SOUL/IDENTITY + USER.md)"
```

---

### Task 7：在默认智能体卡片增加“入门引导”入口按钮

**Files:**
- Modify: `frontend/src/components/workspace/agents/agent-card.tsx`
- Modify: `frontend/src/core/i18n/locales/zh-CN.ts`
- Modify: `frontend/src/core/i18n/locales/en-US.ts`

**Step 1: AgentCard（仅 default）增加一个 icon button**

要求：
- 仅 `isDefault === true` 时展示
- 点击跳转到 `/workspace/agents/bootstrap`
- Tooltip 使用 i18n 文案（例如“入门引导”）

**Step 2: 前端类型检查**

Run:
```bash
pnpm -C frontend exec tsc --noEmit
```

Expected:
- PASS

**Step 3: Commit（入口按钮）**

```bash
git add frontend/src/components/workspace/agents/agent-card.tsx frontend/src/core/i18n/locales/zh-CN.ts frontend/src/core/i18n/locales/en-US.ts
git commit -m "feat(agents): add default agent bootstrap entry on agent card"
```

---

## 最终门禁（必须通过）

**Backend:**
```bash
cd backend
uv run pytest -q
```

**Frontend:**
```bash
pnpm -C frontend exec tsc --noEmit
```

---

## 手动验收清单（桌面端）

1. 新建智能体：
   - 输入中文显示名，slug 自动生成
   - 首条消息以 `/bootstrap` 开头，模型进入入门引导
   - 完成后自动创建 agent 目录，设置页可看到 `SOUL/IDENTITY`
   - 再次使用同名 slug 创建，应返回明确错误，不应覆盖/删除既有 agent
2. 默认助手入门引导：
   - 从默认卡片进入 `/workspace/agents/bootstrap`
   - 引导完成后，跳转到默认智能体设置页
   - `USER.md` 存在 marker block，且可重复执行覆盖该 block 而不破坏其它手写内容

