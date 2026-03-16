# Setup Agent Tests Isolation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让 `setup_agent` 相关单测在任何情况下都不触达真实 `~/.nion`、不触发 OpenViking embedding/外部网络请求，并把“是否写入 OpenViking managed resources”从单测默认路径中隔离出去。

**Architecture:**  
以“测试侧隔离优先、生产行为不变”为原则：在 `backend/tests/test_setup_agent_tool_bootstrap.py` 增加 `autouse` fixture，默认把 `setup_agent_tool.get_default_memory_provider()` patch 成 `NoopProvider`（非 openviking），从而让 `_sync_openviking_managed_resources()` 快速返回；需要验证 sync 行为的测试再显式 patch provider 为 dummy openviking provider。

**Tech Stack:** pytest + unittest.mock + uv（Python 3.12）。

---

## Task 0: 基线确认（不改代码）

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

---

## Task 1: 单测隔离（autouse fixture）

**Files:**
- Modify: `backend/tests/test_setup_agent_tool_bootstrap.py`

**Step 1: 增加 autouse fixture（先不改既有断言）**

在测试文件顶部增加：
- `import pytest`
- `class _NoopProvider: name = "noop"`
- `@pytest.fixture(autouse=True)` patch `src.tools.builtins.setup_agent_tool.get_default_memory_provider` 返回 `_NoopProvider()`

约束：
- 该 fixture 仅影响本文件测试，避免影响全套 memory/openviking 测试。
- 需要验证 sync 行为的测试（已存在）继续在 test 内部显式 patch `get_default_memory_provider` 为 dummy openviking provider。

**Step 2: 跑该文件用例**

Run:
```bash
cd backend
uv run -p /opt/homebrew/bin/python3.12 pytest -q tests/test_setup_agent_tool_bootstrap.py
```

Expected:
- PASS
- 且无 OpenViking embedding 相关网络错误输出（即使某条用例失败也不应出现外部请求噪音）

**Step 3: Commit**

```bash
git add backend/tests/test_setup_agent_tool_bootstrap.py
git commit -m "test(setup_agent): 隔离 OpenViking provider（默认 Noop，避免单测触发外部请求）"
```

---

## Task 2: 回归验证（防止隔离改动破坏其它测试）

**Files:**
- None

**Step 1: 全量后端单测**

Run:
```bash
cd backend
uv run -p /opt/homebrew/bin/python3.12 pytest -q
```

Expected: PASS

