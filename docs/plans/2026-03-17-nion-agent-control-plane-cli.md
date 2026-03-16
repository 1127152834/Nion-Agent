# Nion Agent Control-Plane CLI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 Nion 的 Agent 增加一个“控制面 CLI 风格”内置工具 `nion_manage`，让 Agent 能在桌面端与 Web 端以统一方式完成系统级管理与诊断（优先复用现有 service-ops / Gateway 业务逻辑），首期覆盖 `doctor` 与 `skills`（含 custom skill 改名）。

**Architecture:** `nion_manage` 是 LangChain tool（内置工具），入参用 `argv: list[str]` 模拟 CLI 子命令；实现上不 exec 外部进程、不依赖 URL，而是直接调用 `backend/packages/harness/nion/tools/builtins/_service_ops.py` 的业务函数与少量安全受限的本地读取（仅限 `NION_HOME` 下的运行时文件）。对于破坏性操作（禁用/改名）沿用 confirmation token 机制。

**Tech Stack:** Python 3.12、LangChain tool decorator、FastAPI 业务逻辑复用（service-ops）、Pydantic v2、pytest（`uv run pytest`）。

---

## Scope（MVP）

- 新增 tool：`nion_manage`
- 新增命令：
  - `nion doctor [--tail N] [--include-logs] [--include-processlog]`
  - `nion skills list`
  - `nion skills enable <skill>`
  - `nion skills disable <skill> [--confirmation-token <token>]`
  - `nion skills install --path <virtual .skill path> [--thread-id <id>]`
  - `nion skills rename <old> <new> [--confirmation-token <token>]`（仅允许 `skills/custom`）
- 输出：统一返回 `build_management_response()` 的 JSON 字符串（便于前端与 Agent 解析）。

## Non-Goals（本期不做）

- 不做“给人运维/脚本用”的外部 CLI 二进制或 npm 包。
- 不做公网鉴权/多租户权限系统（后续如果需要，优先在 Gateway 层做 auth + scope）。
- 不做“重启桌面端 runtime 进程”能力（需要 Electron IPC/专门 API，后续另案）。

---

### Task 1: 为 Skill 改名补齐 Service-Ops（可复用的业务层）

**Files:**
- Modify: `backend/packages/harness/nion/tools/builtins/_service_ops.py`
- Test: `backend/tests/test_skill_rename_service_ops.py`

**Step 1: 写失败测试（rename custom skill 正常路径）**

```python
import json
import os
from pathlib import Path

import pytest

from nion.config.extensions_config import ExtensionsConfig, reset_extensions_config
from nion.tools.builtins._service_ops import rename_skill  # to be added
from nion.skills.loader import load_skills


def _write_skill(dir_path: Path, *, name: str) -> None:
    dir_path.mkdir(parents=True, exist_ok=True)
    (dir_path / "SKILL.md").write_text(f"---\nname: {name}\ndescription: test\n---\n", encoding="utf-8")


@pytest.mark.unit
def test_rename_skill_custom_updates_skill_and_extensions_state(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    base_dir = tmp_path / "nion-home"
    skills_root = tmp_path / "skills"
    (skills_root / "custom").mkdir(parents=True, exist_ok=True)

    _write_skill(skills_root / "custom" / "alpha", name="alpha")
    _write_skill(skills_root / "public" / "bootstrap", name="bootstrap")

    monkeypatch.setenv("NION_HOME", str(base_dir))
    reset_extensions_config()
    cfg_path = ExtensionsConfig.default_config_path()
    cfg_path.parent.mkdir(parents=True, exist_ok=True)
    cfg_path.write_text(json.dumps({"skills": {"alpha": {"enabled": False}}}, ensure_ascii=False), encoding="utf-8")

    # act
    renamed = rename_skill("alpha", "beta", skills_path=skills_root)  # should exist after implementation

    # assert: skill name changed
    skills = load_skills(skills_path=skills_root, use_config=False, enabled_only=False)
    names = {s.name for s in skills}
    assert "alpha" not in names
    assert "beta" in names

    # assert: extensions state moved
    payload = json.loads(cfg_path.read_text(encoding="utf-8"))
    assert payload["skills"]["beta"]["enabled"] is False
    assert "alpha" not in payload["skills"]
    assert renamed.name == "beta"
```

**Step 2: 运行测试确认失败**

Run: `cd backend && uv run pytest tests/test_skill_rename_service_ops.py -q`  
Expected: FAIL（`rename_skill` 未实现 / import error）。

**Step 3: 最小实现（service-ops 增加 rename_skill）**

实现要点（写入代码时逐条落地）：
- 仅允许改名 `category=="custom"` 的 skill（通过 `load_skills(..., enabled_only=False)` 定位）。
- `new_name` 必须满足 `_validate_skill_frontmatter` 的命名规则（`^[a-z0-9-]+$`，长度<=64 等）。做法：
  - 先校验 `new_name` 字符串本身（复用 validation 逻辑或提取一个 name-only 校验函数）。
- 修改 SKILL.md：仅改 YAML frontmatter 的 `name` 字段，保留正文；采用“临时文件 + replace”原子写避免半写入。
- 更新 `extensions_config.json`：把 `skills[old]` 的 enabled 状态迁移到 `skills[new]`，并删除 `skills[old]`；写入同样用临时文件原子替换；随后 `reload_extensions_config(...)`。
- 冲突处理：
  - 若 `new_name` 已存在于任意 skill（public/custom），返回 `FileExistsError` 或 `ValueError`。
  - 若 `old_name` 不存在，抛 `FileNotFoundError`。

**Step 4: 运行测试确认通过**

Run: `cd backend && uv run pytest tests/test_skill_rename_service_ops.py -q`  
Expected: PASS。

**Step 5: 提交**

Run:
```bash
git add backend/packages/harness/nion/tools/builtins/_service_ops.py backend/tests/test_skill_rename_service_ops.py
git commit -m "feat(control-plane): add service-op to rename custom skills safely" -m "Goal: Introduce a reusable business-layer operation for renaming skills so that agent-side control-plane tooling can manage skills without invoking external CLIs.\n\nKey behavior:\n- Add rename_skill(old_name, new_name, skills_path=...) to shared service ops.\n- Enforce custom-skill only (skills/public is forbidden).\n- Validate new skill names (hyphen-case constraints) and prevent collisions.\n- Update SKILL.md YAML frontmatter atomically.\n- Migrate enabled state in extensions_config.json atomically (old key -> new key) and reload config cache.\n\nFiles:\n- backend/packages/harness/nion/tools/builtins/_service_ops.py\n- backend/tests/test_skill_rename_service_ops.py\n\nTests:\n- cd backend && uv run pytest tests/test_skill_rename_service_ops.py -q"
```

---

### Task 2: 为 `nion_manage` 增加 argv 路由与 help（CLI 风格工具壳）

**Files:**
- Modify: `backend/packages/harness/nion/tools/builtins/system_manage_tools.py`
- Modify: `backend/packages/harness/nion/tools/builtins/__init__.py`
- Modify: `backend/packages/harness/nion/tools/tools.py`
- Test: `backend/tests/test_nion_manage_tool_routing.py`

**Step 1: 写失败测试（help 与未知命令）**

```python
import json

import pytest

from nion.tools.builtins.system_manage_tools import nion_manage_tool  # to be added


class _Runtime:
    context = {}
    state = {}
    config = {}


@pytest.mark.unit
def test_nion_manage_help() -> None:
    out = nion_manage_tool(_Runtime(), argv=["help"])
    payload = json.loads(out)
    assert payload["success"] is True
    assert "Usage:" in payload["message"]


@pytest.mark.unit
def test_nion_manage_unknown_command() -> None:
    out = nion_manage_tool(_Runtime(), argv=["nope"])
    payload = json.loads(out)
    assert payload["success"] is False
```

**Step 2: 运行测试确认失败**

Run: `cd backend && uv run pytest tests/test_nion_manage_tool_routing.py -q`  
Expected: FAIL（`nion_manage_tool` 未实现）。

**Step 3: 最小实现（新增 @tool("nion_manage")）**

实现要点：
- `@tool("nion_manage")`，参数：`runtime, argv: list[str], confirmation_token: str|None=None, thread_id: str|None=None`。
- 内部只做 argv dispatch，不做重业务逻辑：
  - `argv[0] in {"help","-h","--help"}`：返回 usage 文本。
  - `argv[0]=="skills"`：转发到现有 `skills_manage_tool`（list/enable/disable/install）或直接调用新增 rename service-op。
  - `argv[0]=="doctor"`：先占位返回“未实现”直到 Task 3。
- 输出必须走 `build_management_response()`，并在 `data` 中回显 `argv` 方便追踪。

**Step 4: Wire 到工具注册表**

- 在 `backend/packages/harness/nion/tools/builtins/__init__.py` 增加 export map 条目（`nion_manage_tool`）。
- 在 `backend/packages/harness/nion/tools/tools.py` 的 `BUILTIN_TOOLS` 列表中追加 `nion_manage_tool`，确保 Agent 可见。

**Step 5: 运行测试确认通过**

Run: `cd backend && uv run pytest tests/test_nion_manage_tool_routing.py -q`  
Expected: PASS。

**Step 6: 提交**

```bash
git add backend/packages/harness/nion/tools/builtins/system_manage_tools.py backend/packages/harness/nion/tools/builtins/__init__.py backend/packages/harness/nion/tools/tools.py backend/tests/test_nion_manage_tool_routing.py
git commit -m "feat(control-plane): add nion_manage tool shell with argv routing" -m "Goal: Provide a single CLI-shaped control-plane tool for agents (nion_manage) that routes argv-style subcommands to existing management capabilities.\n\nChange:\n- Add @tool(\"nion_manage\") entry point and help/unknown-command handling.\n- Wire tool into builtins exports and tool registry so it becomes available to agents.\n\nFiles:\n- backend/packages/harness/nion/tools/builtins/system_manage_tools.py\n- backend/packages/harness/nion/tools/builtins/__init__.py\n- backend/packages/harness/nion/tools/tools.py\n- backend/tests/test_nion_manage_tool_routing.py\n\nTests:\n- cd backend && uv run pytest tests/test_nion_manage_tool_routing.py -q"
```

---

### Task 3: 实现 `nion doctor`（跨桌面端/Web 的诊断输出）

**Files:**
- Modify: `backend/packages/harness/nion/tools/builtins/system_manage_tools.py`
- (Optional) Create: `backend/packages/harness/nion/tools/builtins/doctor_utils.py`
- Test: `backend/tests/test_nion_manage_doctor.py`

**Step 1: 写失败测试（doctor 输出包含 runtime 基本信息）**

```python
import json
from pathlib import Path

import pytest

from nion.tools.builtins.system_manage_tools import nion_manage_tool


class _Runtime:
    context = {}
    state = {}
    config = {"metadata": {"trace_id": "t1"}}


@pytest.mark.unit
def test_nion_manage_doctor_includes_base_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("NION_HOME", str(tmp_path / "home"))
    out = nion_manage_tool(_Runtime(), argv=["doctor"])
    payload = json.loads(out)
    assert payload["success"] is True
    assert "base_dir" in payload["data"]
```

**Step 2: 运行测试确认失败**

Run: `cd backend && uv run pytest tests/test_nion_manage_doctor.py -q`  
Expected: FAIL（doctor 未实现）。

**Step 3: 最小实现（doctor 数据面）**

doctor 输出建议字段（全部 best-effort，不因缺失而失败）：
- `base_dir`: `str(get_paths().base_dir)`
- `runtime_mode`: `"desktop"` if `NION_DESKTOP_RUNTIME==1` else `"web"`
- `runtime_topology`: 仅在可获取时填（可以复用 `get_app_config_runtime_status()` 的 `runtime_processes`）
- `processlog`: 从 `{base_dir}/processlog/events.jsonl` 提取最近 N 条 `level=error|warning`（使用 `nion.processlog.store.load_events`）
- `desktop_logs_tail`: 仅允许读取 `{base_dir}/logs/desktop/*.log`（`gateway.log/langgraph.log/frontend.log`）的 tail N 行

安全约束：
- 只能读 `NION_HOME` 下的路径；禁止读取任意绝对路径（避免把 doctor 变成“读任意文件”后门）。

**Step 4: 运行测试确认通过**

Run: `cd backend && uv run pytest tests/test_nion_manage_doctor.py -q`  
Expected: PASS。

**Step 5: 提交**

```bash
git add backend/packages/harness/nion/tools/builtins/system_manage_tools.py backend/tests/test_nion_manage_doctor.py
git commit -m "feat(control-plane): implement nion doctor diagnostics for agent" -m "Goal: Let agents diagnose desktop/web runtime issues via a safe, CLI-shaped control-plane command.\n\nBehavior:\n- Add `nion_manage doctor` subcommand.\n- Report base_dir and runtime_mode.\n- Best-effort tail processlog errors and desktop runtime logs under NION_HOME only.\n- Never fail the tool due to missing optional files.\n\nFiles:\n- backend/packages/harness/nion/tools/builtins/system_manage_tools.py\n- backend/tests/test_nion_manage_doctor.py\n\nTests:\n- cd backend && uv run pytest tests/test_nion_manage_doctor.py -q"
```

---

### Task 4: `nion skills rename`（仅 custom + 二次确认 + 状态迁移）

**Files:**
- Modify: `backend/packages/harness/nion/tools/builtins/system_manage_tools.py`
- Test: `backend/tests/test_nion_manage_skills_rename.py`

**Step 1: 写失败测试（rename 需要确认 token）**

```python
import json

import pytest

from nion.tools.builtins.system_manage_tools import nion_manage_tool


class _Runtime:
    context = {}
    state = {}
    config = {}


@pytest.mark.unit
def test_nion_manage_skills_rename_requires_confirmation() -> None:
    out = nion_manage_tool(_Runtime(), argv=["skills", "rename", "a", "b"])
    payload = json.loads(out)
    assert payload["success"] is False
    assert payload["requires_confirmation"] is True
    assert payload["confirmation_token"]
```

**Step 2: 运行测试确认失败**

Run: `cd backend && uv run pytest tests/test_nion_manage_skills_rename.py -q`  
Expected: FAIL（rename 未实现）。

**Step 3: 最小实现（rename 分支 + token 校验）**

实现要点：
- `nion_manage argv=["skills","rename",old,new]`：
  - 若未提供 `confirmation_token`：`issue_confirmation_token(action="rename", target=f"skills:{old}:rename:{new}")`，返回 requires_confirmation。
  - 若提供 token：`consume_confirmation_token(...)`，不通过则失败。
  - 通过后调用 Task1 的 `rename_skill(old,new)`。
- 返回 payload：包含 `old_name/new_name/enabled/category`。

**Step 4: 运行测试确认通过**

Run: `cd backend && uv run pytest tests/test_nion_manage_skills_rename.py -q`  
Expected: PASS。

**Step 5: 提交**

```bash
git add backend/packages/harness/nion/tools/builtins/system_manage_tools.py backend/tests/test_nion_manage_skills_rename.py
git commit -m "feat(control-plane): add nion skills rename (custom-only) with confirmation" -m "Goal: Allow agents to rename custom skills safely via nion_manage argv interface.\n\nBehavior:\n- Implement `nion_manage skills rename <old> <new>`.\n- Custom-skill only; renames are guarded by confirmation tokens.\n- Reuse service-op rename_skill to update SKILL.md and migrate extensions state.\n\nFiles:\n- backend/packages/harness/nion/tools/builtins/system_manage_tools.py\n- backend/tests/test_nion_manage_skills_rename.py\n\nTests:\n- cd backend && uv run pytest tests/test_nion_manage_skills_rename.py -q"
```

---

### Task 5: 最小文档补齐（让团队知道怎么给 Agent 用）

**Files:**
- Modify: `backend/CLAUDE.md`

**Step 1: 写文档**

补充一段“Control-plane tool”说明：
- `nion_manage` 的定位、argv 约定、返回 JSON 结构、示例调用（skills list/rename/doctor）。

**Step 2: 轻量验证**

Run: `cd backend && uv run pytest tests/test_skills_loader.py -q`  
Expected: PASS（防止影响既有技能系统行为）。

**Step 3: 提交**

```bash
git add backend/CLAUDE.md
git commit -m "docs(control-plane): document nion_manage agent control-plane tool" -m "Goal: Document the new CLI-shaped control-plane tool for agents.\n\nDocs:\n- Describe argv contract and supported subcommands (doctor, skills).\n\nVerification:\n- cd backend && uv run pytest tests/test_skills_loader.py -q"
```

---

## Rollout / Safety Checklist

- 默认不移除既有 `skills_manage` / `mcp_manage` / `models_manage`，`nion_manage` 只是统一入口。
- `doctor` 严格限制读取目录为 `NION_HOME`，避免“任意文件读取”。
- `skills rename/disable` 必须有 confirmation token。
- `skills rename` 强制 custom-only，且 rename 冲突必须拒绝。

