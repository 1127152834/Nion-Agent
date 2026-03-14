# CLI 交互执行与工具优先召回 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让 Nion 的聊天助手在遇到“需要交互/扫码/登录/长时间等待输出”的 CLI 场景时，能够可靠地在聊天界面中打开可交互终端（PTY + xterm.js），并让助手形成“先检索内部工具（内置/MCP/skill/CLI）再行动”的硬流程（而不是靠模型碰运气）。

**Architecture:** 后端用 PTY 会话（`/api/cli/sessions/{id}/stream` WebSocket）承载交互式 CLI 的 stdout/stderr 流与 stdin 输入；Agent 侧通过 `CLIInteractiveMiddleware` 识别“需要交互终端”的命令并发出结构化 `cli_interactive` payload（包含 sessionId/websocketUrl/toolId/argv）；前端收到后渲染 `CLITerminal` 并连接 WebSocket。工具召回侧增加一个轻量、确定性的“内部工具检索/排序”中间件，在每次用户请求进入模型前生成 Top-K 推荐工具并注入 system context，确保“先内部工具”成为默认路径。

**Tech Stack:** 后端 FastAPI + LangGraph middleware + LocalSandbox + PTY(os.fork/pty) + pytest(通过 `uv run pytest`)；前端 Next.js/React + xterm.js + WebSocket + vitest；CLI 元数据来源 `backend/data/cli_marketplace/catalog.json` 与安装清单 `~/.nion/clis/manifests/*.json`。

---

## 背景与已定位根因（执行前必须读）

1. 当前“CLI 需要交互”的实现会**截断 CLI 真正执行**：`CLIInteractiveMiddleware` 在检测到 `interactive_commands` 后直接 `goto=END`（`backend/src/agents/middlewares/cli_interactive_middleware.py:83-122`），导致 `runtime_tools.py` 的 PATH/env 注入链路根本不发生，用户看到“卡住”等待但没有任何输出。
2. `CLIInteractiveMiddleware` 回放命令时用 `tool_id` 直接当可执行文件名拼 shell（`... | {tool_id} ...`，`cli_interactive_middleware.py:170-185`），但托管 CLI 的真实 bin 在 manifest 中（例如 `xhs-cli` 的 bin 是 `xhs`）。这会导致“输入 cookie 再执行”的路径本身就不可靠。
3. 已实现的 PTY 会话管理器 `CLIInteractiveSessionManager` 目前把 PATH 写死成 `CLIS_VIRTUAL_ROOT=/mnt/clis`（`backend/src/cli/interactive_session.py:60-64`），但在 macOS 主机上 `/mnt` 默认不存在，导致即便前端接入 WebSocket 也无法启动 CLI。
4. 前端 `CLITerminal` WebSocket URL 硬编码 `ws://localhost:8001`（`frontend/src/components/workspace/messages/cli-terminal.tsx:77`），Electron/桌面端实际后端基址不同（`frontend/src/core/config/index.ts` 已提供 `getBackendBaseURL()`），因此在应用内很容易连错地址。
5. CLI 元数据把 `xhs-cli login` 标成“stdin 输入 cookie”（`backend/data/cli_marketplace/catalog.json:39-46`），但实际 CLI 流程可能是“终端输出二维码/等待扫码/或尝试读取浏览器 cookie”。无论哪种，都必须优先解决“终端流式输出 + 可交互”的基础能力。

## 非目标（本期先不做）

- 不做 Electron 内置浏览器全套（BrowserWindow + Cookie Bridge + 会话隔离），那是更大工程。
- 不把所有 CLI 统一改造成 GUI；本期只保证“交互式 CLI 在聊天里可用”，GUI 需求作为后续增强路径。

## 验收标准（必须可验证）

1. 在桌面应用内触发 `xhs-cli` 登录时，聊天里会出现一个可交互终端组件，能够持续看到 CLI 输出（包括二维码/提示/错误），不会“黑盒卡死”。
2. WebSocket 连接地址不再硬编码端口，Electron/Web 两种模式均能正常连接后端。
3. `CLIInteractiveMiddleware` 不再尝试用 `tool_id` 直接拼 shell 运行；所有“交互式 CLI 执行”必须走同一套“解析真实可执行入口”的逻辑。
4. 新增/更新的关键逻辑必须有 pytest/vitest 覆盖，并在 CI/本地可跑：`uv run pytest`、`pnpm -C frontend test:unit`。
5. 工具优先召回：当用户描述“我要登录小红书/做视频处理”等需求时，在模型生成行动前能看到明确的“内部工具推荐（Top-K）”注入或 UI 提示，并能显著提高 CLI/MCP/Skill 的首轮命中率。

## 执行约束

- 强制小步提交：每完成一个可独立回滚的子变更，立刻 `git commit`（提交信息必须包含动机、影响范围、涉及文件、测试证据）。
- 执行请在隔离 worktree 中完成，避免污染当前脏工作区（当前主工作区已有未提交变更）。

---

## Phase A: 交互式 CLI 的 PTY 会话跑通（先解决“卡住看不到输出”）

### Task 1: 新增“托管 CLI 可执行入口解析”纯函数（先写测试）

**Files:**
- Create: `backend/src/cli/managed_cli_exec.py`
- Test: `backend/tests/test_managed_cli_exec.py`

**Step 1: Write the failing test**

```python
# backend/tests/test_managed_cli_exec.py
from __future__ import annotations

from pathlib import Path

import pytest

from src.cli.managed_cli_exec import resolve_managed_cli_command


def test_resolve_managed_cli_command_uses_manifest_shim_path(tmp_path, monkeypatch):
    # Arrange: fake ~/.nion paths
    from src.config import paths as paths_mod

    fake_root = tmp_path / "nion"
    (fake_root / "clis" / "manifests").mkdir(parents=True)
    (fake_root / "clis" / "bin").mkdir(parents=True)

    # shim path in manifest can be "bin/<name>" (relative to clis root)
    shim_rel = "bin/xhs"
    shim_abs = fake_root / "clis" / shim_rel
    shim_abs.write_text("#!/bin/sh\necho ok\n", encoding="utf-8")
    shim_abs.chmod(0o755)

    manifest_json = {
        "tool_id": "xhs-cli",
        "version": "0.1.4",
        "os": "macos",
        "arch": "arm64",
        "bins": [{"name": "xhs", "shim_rel": shim_rel, "real_rel": "uv/tools/xhs-cli/bin/xhs"}],
        "healthcheck_argv": [],
        "healthcheck_expect_contains": None,
    }
    (fake_root / "clis" / "manifests" / "xhs-cli.json").write_text(
        __import__("json").dumps(manifest_json),
        encoding="utf-8",
    )

    # Patch get_paths() singleton to point to fake root
    monkeypatch.setattr(paths_mod, "_paths", paths_mod.Paths(base_dir=fake_root))

    # Act
    cmd = resolve_managed_cli_command("xhs-cli", ["login"])

    # Assert
    assert cmd[0] == str(shim_abs)
    assert cmd[1:] == ["login"]


def test_resolve_managed_cli_command_raises_when_manifest_missing(tmp_path, monkeypatch):
    from src.config import paths as paths_mod

    fake_root = tmp_path / "nion"
    fake_root.mkdir(parents=True)
    monkeypatch.setattr(paths_mod, "_paths", paths_mod.Paths(base_dir=fake_root))

    with pytest.raises(RuntimeError):
        resolve_managed_cli_command("missing-cli", ["--version"])
```

**Step 2: Run test to verify it fails**

Run:

```bash
cd backend
uv run pytest tests/test_managed_cli_exec.py -v
```

Expected: FAIL（模块/函数不存在）。

**Step 3: Write minimal implementation**

```python
# backend/src/cli/managed_cli_exec.py
from __future__ import annotations

from pathlib import Path

from src.cli.manifests import load_cli_install_manifest
from src.config.paths import get_paths


def resolve_managed_cli_command(tool_id: str, argv: list[str]) -> list[str]:
    """
    Resolve a managed CLI's executable entrypoint to a host-absolute shim path
    based on the installed manifest.
    """
    manifest = load_cli_install_manifest(tool_id)
    if manifest is None or not manifest.bins:
        raise RuntimeError(f"Managed CLI manifest missing or has no bins: {tool_id}")

    shim_rel = manifest.bins[0].shim_rel
    rel = str(Path(shim_rel)).lstrip("/").replace("\\", "/")
    shim_abs = (get_paths().clis_root_dir / rel).resolve()
    return [str(shim_abs), *argv]
```

**Step 4: Run test to verify it passes**

Run:

```bash
cd backend
uv run pytest tests/test_managed_cli_exec.py -v
```

Expected: PASS。

**Step 5: Commit**

```bash
git add backend/src/cli/managed_cli_exec.py backend/tests/test_managed_cli_exec.py
git commit -m "feat(cli): resolve managed CLI shim path for interactive sessions" -m "Problem: interactive CLI execution cannot reliably locate the real executable entrypoint; middleware incorrectly uses tool_id as a binary name.\n\nSolution: introduce resolve_managed_cli_command(tool_id, argv) that uses the installed CLI manifest to map tool_id -> host-absolute shim path under ~/.nion/clis, returning a full command list suitable for PTY exec.\n\nFiles:\n- backend/src/cli/managed_cli_exec.py (new)\n- backend/tests/test_managed_cli_exec.py (new)\n\nTests:\n- uv run pytest tests/test_managed_cli_exec.py -v"
```

---

### Task 2: 修复 PTY Session Manager 的 PATH/command 语义（不要依赖 /mnt）

**Files:**
- Modify: `backend/src/cli/interactive_session.py:40-110`
- Test: `backend/tests/test_cli_interactive_session_contract.py`

**Step 1: Write the failing test**

目标：`CLIInteractiveSessionManager.start_session()` 不再要求传入 `command`（包含可执行文件），而是传 `argv`（参数）+ `tool_id`，内部用 `resolve_managed_cli_command()` 构造命令；并在 macOS 上不依赖 `/mnt` 存在。

```python
# backend/tests/test_cli_interactive_session_contract.py
from __future__ import annotations

import pytest


def test_start_session_builds_command_via_resolver(monkeypatch):
    from src.cli import interactive_session as mod

    built: dict = {}

    def fake_resolve(tool_id: str, argv: list[str]) -> list[str]:
        built["tool_id"] = tool_id
        built["argv"] = argv
        return ["/bin/echo", *argv]

    # Avoid real fork/pty in unit test
    monkeypatch.setattr(mod, "pty", type("P", (), {"openpty": lambda: (100, 101)})())
    monkeypatch.setattr(mod.os, "fork", lambda: 12345)
    monkeypatch.setattr(mod.os, "close", lambda *_: None)
    monkeypatch.setattr(mod, "resolve_managed_cli_command", fake_resolve)
    monkeypatch.setattr(mod.asyncio, "create_task", lambda *_: None)

    mgr = mod.CLIInteractiveSessionManager()
    session = mgr.start_session(session_id="sid", tool_id="xhs-cli", argv=["login"], output_callback=None)

    assert built == {"tool_id": "xhs-cli", "argv": ["login"]}
    assert session.command[:2] == ["/bin/echo", "login"]
```

**Step 2: Run test to verify it fails**

Run:

```bash
cd backend
uv run pytest tests/test_cli_interactive_session_contract.py -v
```

Expected: FAIL（`start_session` 参数/实现不匹配）。

**Step 3: Write minimal implementation**

在 `backend/src/cli/interactive_session.py`：

- 替换 `from src.config.paths import CLIS_VIRTUAL_ROOT` 为 `from src.cli.managed_cli_exec import resolve_managed_cli_command`
- 修改 `start_session(..., command: list[str])` 为 `start_session(..., argv: list[str])`
- `command = resolve_managed_cli_command(tool_id, argv)`
- `env` 从 `os.environ.copy()` 来，不再写死 `/mnt/clis/bin`
- 仍保留 PTY + fork 逻辑（posix）。

**Step 4: Run test to verify it passes**

Run:

```bash
cd backend
uv run pytest tests/test_cli_interactive_session_contract.py -v
```

Expected: PASS。

**Step 5: Commit**

```bash
git add backend/src/cli/interactive_session.py backend/tests/test_cli_interactive_session_contract.py
git commit -m "fix(cli): make PTY interactive sessions resolve managed CLI executables on host" -m "Root cause: interactive_session.py relies on CLIS_VIRTUAL_ROOT=/mnt/clis which does not exist on macOS host; the API also assumes callers pass a full command including the executable.\n\nChange:\n- start_session now accepts argv-only and resolves the managed CLI shim path via resolve_managed_cli_command(tool_id, argv)\n- remove /mnt dependency from PTY runner\n\nFiles:\n- backend/src/cli/interactive_session.py\n- backend/tests/test_cli_interactive_session_contract.py\n\nTests:\n- uv run pytest tests/test_cli_interactive_session_contract.py -v"
```

---

### Task 3: 修正 WebSocket init 协议（tool_id + argv），并保持兼容

**Files:**
- Modify: `backend/src/gateway/routers/cli_interactive.py:18-105`
- Test: `backend/tests/test_cli_interactive_router_contract.py`

**Step 1: Write the failing test**

目标：WebSocket init message 支持：

- 新协议：`{ tool_id: "xhs-cli", argv: ["login"] }`
- 兼容旧字段：若传 `command`，仍可用（但会打印 deprecation warning）。

```python
# backend/tests/test_cli_interactive_router_contract.py
from __future__ import annotations

import asyncio

import pytest


@pytest.mark.asyncio
async def test_ws_init_accepts_tool_id_and_argv(monkeypatch):
    from src.gateway.routers import cli_interactive as mod

    started: dict = {}

    class FakeWS:
        def __init__(self):
            self.sent = []
            self._accepted = False
            self._rx = [
                {"tool_id": "xhs-cli", "argv": ["login"]},
                {"type": "terminate"},
            ]

        async def accept(self):
            self._accepted = True

        async def receive_json(self):
            return self._rx.pop(0)

        async def send_json(self, payload):
            self.sent.append(payload)

        async def close(self):
            return

    # Stub manager.start_session to avoid real PTY/fork.
    class FakeMgr:
        def start_session(self, *, session_id, tool_id, argv, output_callback):
            started.update({"session_id": session_id, "tool_id": tool_id, "argv": argv})
            return type("S", (), {"session_id": session_id})()

        def send_input(self, *_):
            return True

        def resize_terminal(self, *_):
            return True

        def terminate_session(self, *_):
            return True

        def get_session(self, *_):
            return None

        def cleanup_session(self, *_):
            return None

    monkeypatch.setattr(mod, "get_session_manager", lambda: FakeMgr())
    monkeypatch.setattr(mod, "get_keychain", lambda: type("K", (), {"load_session": lambda *_: None, "save_session": lambda *_: None})())

    ws = FakeWS()
    await mod.stream_cli_session(ws, session_id="sid-1")

    assert ws._accepted is True
    assert started == {"session_id": "sid-1", "tool_id": "xhs-cli", "argv": ["login"]}
    assert any(m.get("type") == "started" for m in ws.sent)
```

**Step 2: Run test to verify it fails**

Run:

```bash
cd backend
uv run pytest tests/test_cli_interactive_router_contract.py -v
```

Expected: FAIL（router 仍读取 init_msg["command"]）。

**Step 3: Write minimal implementation**

在 `stream_cli_session()`：

- 读取 `tool_id = init_msg["tool_id"]`
- 优先读取 `argv = init_msg.get("argv")`（list[str]）
- 若没有 argv，则兼容读取 `command`：
  - 若 `command` 为 list 且第一个元素像是可执行文件，则转成 argv（去掉 command[0]）
  - 或者直接把 command 当 argv（视你们当前真实用法而定，但必须写清楚规则）
- 调用 `manager.start_session(session_id=..., tool_id=tool_id, argv=argv, ...)`

**Step 4: Run test to verify it passes**

```bash
cd backend
uv run pytest tests/test_cli_interactive_router_contract.py -v
```

Expected: PASS。

**Step 5: Commit**

```bash
git add backend/src/gateway/routers/cli_interactive.py backend/tests/test_cli_interactive_router_contract.py
git commit -m "fix(cli): define websocket init contract as tool_id+argv for PTY sessions" -m "Clarify the CLI interactive WebSocket protocol:\n- New: init message uses {tool_id, argv}\n- Compatibility: accept legacy {tool_id, command} with documented mapping\n\nThis aligns interactive sessions with the argv-only contract used by cli_* tools.\n\nTests:\n- uv run pytest tests/test_cli_interactive_router_contract.py -v"
```

---

### Task 4: 前端 CLITerminal 连接地址与 init 消息对齐（不再硬编码 localhost:8001）

**Files:**
- Modify: `frontend/src/components/workspace/messages/cli-terminal.tsx:16-110`
- (Optional) Create: `frontend/src/core/config/ws.ts`
- Test: `frontend/src/core/config/ws.test.ts`

**Step 1: Write the failing test**

先把“HTTP base URL -> WS base URL”提成纯函数，避免 UI 里散落 string replace。

```ts
// frontend/src/core/config/ws.test.ts
import { describe, expect, it } from "vitest";
import { toWebSocketBaseURL } from "./ws";

describe("toWebSocketBaseURL", () => {
  it("converts http to ws", () => {
    expect(toWebSocketBaseURL("http://localhost:8001")).toBe("ws://localhost:8001");
  });

  it("converts https to wss", () => {
    expect(toWebSocketBaseURL("https://example.com")).toBe("wss://example.com");
  });

  it("keeps ws/wss", () => {
    expect(toWebSocketBaseURL("ws://x")).toBe("ws://x");
    expect(toWebSocketBaseURL("wss://x")).toBe("wss://x");
  });
});
```

**Step 2: Run test to verify it fails**

```bash
pnpm -C frontend test:unit -- --run frontend/src/core/config/ws.test.ts
```

Expected: FAIL（模块不存在）。

**Step 3: Write minimal implementation**

```ts
// frontend/src/core/config/ws.ts
export function toWebSocketBaseURL(baseURL: string): string {
  const normalized = baseURL.replace(/\/$/, "");
  if (normalized.startsWith("wss://") || normalized.startsWith("ws://")) {
    return normalized;
  }
  if (normalized.startsWith("https://")) {
    return `wss://${normalized.slice("https://".length)}`;
  }
  if (normalized.startsWith("http://")) {
    return `ws://${normalized.slice("http://".length)}`;
  }
  // Fallback: treat as host
  return `ws://${normalized}`;
}
```

并修改 `CLITerminal`：

- 用 `getBackendBaseURL()` 取 base
- `const wsUrl = `${toWebSocketBaseURL(getBackendBaseURL())}/api/cli/sessions/${sessionId}/stream``
- init message 从 `{tool_id, command}` 改为 `{tool_id, argv}`（这里的 props 也建议改名为 argv，或者在组件内映射）

**Step 4: Run test to verify it passes**

```bash
pnpm -C frontend test:unit -- --run frontend/src/core/config/ws.test.ts
```

Expected: PASS。

**Step 5: Commit**

```bash
git add frontend/src/core/config/ws.ts frontend/src/core/config/ws.test.ts frontend/src/components/workspace/messages/cli-terminal.tsx
git commit -m "fix(ui): connect CLITerminal websocket via configured backend base url" -m "Root cause: CLITerminal hardcodes ws://localhost:8001 which breaks in Electron mode and any non-default backend base.\n\nChange:\n- Introduce toWebSocketBaseURL() helper\n- CLITerminal now derives websocket URL from getBackendBaseURL()\n- Align init payload with backend contract (tool_id+argv)\n\nTests:\n- pnpm -C frontend test:unit -- --run frontend/src/core/config/ws.test.ts"
```

---

## Phase B: Agent 与前端消息流接入（真正让“交互终端”出现在聊天里）

### Task 5: 修正 CLI marketplace 的交互元数据（xhs-cli login 应标为 PTY）

**Files:**
- Modify: `backend/data/cli_marketplace/catalog.json:29-46`
- Test: `backend/tests/test_cli_catalog_compat.py`（如需新增断言）

**Step 1: Write the failing test**

在 `backend/tests/test_cli_catalog_compat.py` 增加断言：`xhs-cli` 的 `interactive_commands` 中 `login` 的 `type` 为 `"pty"`（或你定义的字段），并且 prompt 提示为“在终端扫码”。

**Step 2: Run test to verify it fails**

```bash
cd backend
uv run pytest tests/test_cli_catalog_compat.py -v
```

Expected: FAIL（当前为 stdin cookie）。

**Step 3: Write minimal implementation**

将：

```json
{ "pattern": "login", "type": "input", "prompt": "...cookie...", "input_method": "stdin" }
```

改为类似：

```json
{
  "pattern": "login",
  "type": "pty",
  "prompt": "该命令需要交互终端。请在弹出的终端中按提示扫码/完成登录（若输出二维码，请用小红书 App 扫码）。",
  "input_method": "pty"
}
```

字段名可以更干净：例如 `mode: "pty"`，`type` 保留 UI 类型；但要注意兼容当前 middleware 的读取逻辑（`interactive_config.get("type")`）。

**Step 4: Run test to verify it passes**

```bash
cd backend
uv run pytest tests/test_cli_catalog_compat.py -v
```

Expected: PASS。

**Step 5: Commit**

```bash
git add backend/data/cli_marketplace/catalog.json backend/tests/test_cli_catalog_compat.py
git commit -m "fix(cli-catalog): mark xhs-cli login as PTY-interactive command" -m "Correct the interaction metadata for xhs-cli login.\n\nRationale: login is not a one-shot stdin cookie input; it requires a streaming interactive terminal to display QR/prompt and wait for user action.\n\nTests:\n- uv run pytest tests/test_cli_catalog_compat.py -v"
```

---

### Task 6: 改造 CLIInteractiveMiddleware：对 PTY 命令发出“打开终端”的结构化 payload

**Files:**
- Modify: `backend/src/agents/middlewares/cli_interactive_middleware.py:62-214`
- Create/Modify: `backend/src/agents/middlewares/cli_interactive_payload.py`（可选，避免 dict 魔法）
- Test: `backend/tests/test_cli_interactive_middleware_pty.py`

**Step 1: Write the failing test**

目标：当检测到 `type == "pty"`（或 `input_method == "pty"`）时：

- middleware 不调用 handler（不执行 cli_* tool）
- 返回 `ToolMessage`，`additional_kwargs.cli_interactive` 包含：
  - `status: "awaiting_terminal"`
  - `tool_id`
  - `argv`（不是 command）
  - `session_id`（uuid）
  - `websocket_url: "/api/cli/sessions/{session_id}/stream"`

```python
# backend/tests/test_cli_interactive_middleware_pty.py
from __future__ import annotations

import re

from langgraph.prebuilt.tool_node import ToolCallRequest

from src.agents.middlewares.cli_interactive_middleware import CLIInteractiveMiddleware


def test_cli_interactive_middleware_emits_terminal_payload_for_pty(monkeypatch):
    mw = CLIInteractiveMiddleware()

    # Force interactive detection without depending on catalog file parsing.
    monkeypatch.setattr(
        mw,
        "_detect_interactive_command",
        lambda tool_id, argv: {"pattern": "login", "type": "pty", "prompt": "scan qrcode", "input_method": "pty"},
    )

    req = ToolCallRequest(
        tool_call={"name": "cli_xhs-cli", "args": {"argv": ["login"]}, "id": "tc1"},
        config={},
        input={},
    )

    result = mw.wrap_tool_call(req, handler=lambda _: (_ for _ in ()).throw(AssertionError("handler should not be called")))
    # wrap_tool_call returns ToolMessage or Command; for interrupt we expect Command with goto=END
    assert hasattr(result, "goto")
    tool_msg = result.update["messages"][0]
    payload = tool_msg.additional_kwargs["cli_interactive"]
    assert payload["status"] == "awaiting_terminal"
    assert payload["tool_id"] == "xhs-cli"
    assert payload["argv"] == ["login"]
    assert re.fullmatch(r"[0-9a-f\\-]{36}", payload["session_id"])
    assert payload["websocket_url"].endswith(f"/api/cli/sessions/{payload['session_id']}/stream")
```

**Step 2: Run test to verify it fails**

```bash
cd backend
uv run pytest tests/test_cli_interactive_middleware_pty.py -v
```

Expected: FAIL（当前 payload 是 awaiting_input + command）。

**Step 3: Write minimal implementation**

在 `CLIInteractiveMiddleware._build_cli_interactive_payload()` 中：

- 当 `interactive_config["type"] == "pty"`（或 `input_method == "pty"`）时：
  - payload status 改为 `awaiting_terminal`
  - 字段用 `argv` 替代 `command`
  - 生成 `session_id = uuid.uuid4()`（在 middleware 内 import uuid）
  - 生成 `websocket_url`

同时：

- 删除/禁用 `before_agent()` 中“echo pipe + sandbox.execute_command”逻辑，至少对 PTY 类型完全不走这条路径（保留 stdin 类型也要修复可执行名解析）。
- `formatted_message` 文案改成“已为你打开终端会话，请在终端完成登录”。

**Step 4: Run test to verify it passes**

```bash
cd backend
uv run pytest tests/test_cli_interactive_middleware_pty.py -v
```

Expected: PASS。

**Step 5: Commit**

```bash
git add backend/src/agents/middlewares/cli_interactive_middleware.py backend/tests/test_cli_interactive_middleware_pty.py
git commit -m "feat(agent): emit PTY terminal session payload for interactive CLI commands" -m "Behavior change: interactive CLI commands marked as PTY no longer prompt for a single stdin value.\n\nInstead, CLIInteractiveMiddleware now emits a structured cli_interactive payload containing session_id + websocket_url + argv so the UI can open a streaming terminal.\n\nThis avoids the previous broken behavior where the middleware terminated execution and then attempted to run {tool_id} as an executable.\n\nTests:\n- uv run pytest tests/test_cli_interactive_middleware_pty.py -v"
```

---

### Task 7: 前端消息渲染接入 CLITerminal（同一 group type 下条件渲染）

**Files:**
- Modify: `frontend/src/core/messages/utils.ts:50-63`
- Modify: `frontend/src/components/workspace/messages/message-list.tsx:225-237`
- Modify: `frontend/src/components/workspace/messages/cli-interactive-card.tsx`（可选：当是 PTY 时不渲染输入框）
- Test: `frontend/src/core/messages/utils.test.ts`（或新增）

**Step 1: Write the failing test**

目标：`CLIInteractivePayload` 增加字段 `session_id/websocket_url/argv/status=awaiting_terminal`；并且 message list 在检测到这些字段时渲染 `CLITerminal`，而不是 `CLIInteractiveCard`。

测试建议聚焦纯逻辑：给一个 tool message（模拟 additional_kwargs），验证 groupMessages 仍产出 `assistant:cli-interactive`，并且渲染分支选择 terminal（可用轻量组件测试或把判定逻辑提成纯函数）。

**Step 2: Run test to verify it fails**

```bash
pnpm -C frontend test:unit
```

Expected: FAIL（字段不存在/分支未更新）。

**Step 3: Write minimal implementation**

- 更新 `CLIInteractivePayload`：
  - `argv?: string[]`
  - `session_id?: string`
  - `websocket_url?: string`
  - 保留 `command?: string[]` 以兼容旧消息
- 修改 `MessageList`：
  - 在 `assistant:cli-interactive` 分支读取 payload
  - 若 payload.status === "awaiting_terminal" 且 session_id 存在：
    - 渲染 `<CLITerminal sessionId=... toolId=... argv=... />`
  - 否则走旧 `<CLIInteractiveCard />`

**Step 4: Run test to verify it passes**

```bash
pnpm -C frontend test:unit
```

Expected: PASS。

**Step 5: Commit**

```bash
git add frontend/src/core/messages/utils.ts frontend/src/components/workspace/messages/message-list.tsx frontend/src/components/workspace/messages/cli-interactive-card.tsx
git commit -m "feat(ui): render CLITerminal for PTY-interactive CLI tool messages" -m "UI now supports streaming PTY sessions in chat:\n- Extend CLIInteractivePayload with session_id/websocket_url/argv\n- MessageList renders CLITerminal when payload indicates awaiting_terminal\n\nTests:\n- pnpm -C frontend test:unit"
```

---

## Phase C: “先内部工具再行动”的工具召回硬流程（参考 CodePilot）

> 说明：这部分不是只靠 system prompt；需要一个确定性的检索/排序步骤，将 Top-K 内部工具高亮注入上下文，降低模型在海量工具下的检索失败率。

### Task 8: 增加内部工具索引与 Top-K 推荐（纯函数 + 测试）

**Files:**
- Create: `backend/src/tools/internal_tool_recall.py`
- Test: `backend/tests/test_internal_tool_recall.py`

**Step 1: Write the failing test**

```python
# backend/tests/test_internal_tool_recall.py
from __future__ import annotations

from src.tools.internal_tool_recall import recommend_internal_tools


def test_recommend_internal_tools_prefers_xhs_cli_for_xiaohongshu_login():
    hits = recommend_internal_tools("我要登录小红书", limit=3)
    assert any(h.tool_type == "cli" and h.tool_id == "xhs-cli" for h in hits)
```

**Step 2: Run test to verify it fails**

```bash
cd backend
uv run pytest tests/test_internal_tool_recall.py -v
```

Expected: FAIL（模块不存在）。

**Step 3: Write minimal implementation**

实现建议（保持低复杂度）：

- 工具来源：
  - CLI：`ExtensionsConfig.from_file().clis` 中 `enabled=true` 的 tool_id，并从 `backend/data/cli_marketplace/catalog.json` 取 `description/tags`
  - Skills/MCP：先只做占位（结构上留口，后续补齐）
- 打分：对 query 与 `tool_id/name/tags/description` 做简单 substring/keyword match，命中加分；中英文同义词表（例如 `"小红书" -> ["xhs", "xiaohongshu"]`）可用小字典硬编码（不引入依赖）
- 输出：返回 dataclass 列表（tool_type/tool_id/why/example_call）

**Step 4: Run test to verify it passes**

```bash
cd backend
uv run pytest tests/test_internal_tool_recall.py -v
```

Expected: PASS。

**Step 5: Commit**

```bash
git add backend/src/tools/internal_tool_recall.py backend/tests/test_internal_tool_recall.py
git commit -m "feat(agent): add deterministic internal tool recall (top-k) for CLI/MCP/skills" -m "Add a lightweight internal tool recommender to reduce tool-miss under large toolsets.\n\nScope (v1): CLI tools from extensions_config + marketplace catalog metadata; simple keyword scoring; returns top-k candidates with rationale and example call.\n\nTests:\n- uv run pytest tests/test_internal_tool_recall.py -v"
```

---

### Task 9: 将 Top-K 工具推荐注入到每轮对话（Middleware，不靠模型自觉）

**Files:**
- Create: `backend/src/agents/middlewares/internal_tool_recall_middleware.py`
- Modify: `backend/src/agents/lead_agent/agent.py:280-320`
- Test: `backend/tests/test_internal_tool_recall_middleware.py`

**Step 1: Write the failing test**

目标：当最新消息是 HumanMessage 时，中间件会在 messages 中插入一个 SystemMessage（或 ToolMessage）包含 `<recommended_internal_tools>` block；且长度受控（例如最多 5 个）。

**Step 2: Run test to verify it fails**

```bash
cd backend
uv run pytest tests/test_internal_tool_recall_middleware.py -v
```

Expected: FAIL（中间件不存在/未注入）。

**Step 3: Write minimal implementation**

实现要点：

- 仅在满足条件时注入：
  - 最后一条是 HumanMessage
  - 且上一条注入不是同一个 query（避免重复）
- 内容：使用 `recommend_internal_tools()` 生成 Top-K，渲染成短 XML 块：

```xml
<recommended_internal_tools>
  <tool type="cli" id="xhs-cli">理由... 示例: cli_xhs-cli argv=["login"]</tool>
</recommended_internal_tools>
```

- 注入位置：建议作为 SystemMessage 放在 messages 尾部、但在模型推理前可见即可。
- 在 `lead_agent/agent.py` 注册该 middleware，位置建议：
  - 在 `ToolPolicyGuardMiddleware` 之前（因为它只影响模型决策，不执行工具）
  - 在 `CLIInteractiveMiddleware` 之前/之后均可，但要确保它不影响 tool call 拦截。

**Step 4: Run test to verify it passes**

```bash
cd backend
uv run pytest tests/test_internal_tool_recall_middleware.py -v
```

Expected: PASS。

**Step 5: Commit**

```bash
git add backend/src/agents/middlewares/internal_tool_recall_middleware.py backend/src/agents/lead_agent/agent.py backend/tests/test_internal_tool_recall_middleware.py
git commit -m "feat(agent): enforce 'internal tools first' via ToolRecall middleware injection" -m "Introduce InternalToolRecallMiddleware to deterministically inject top-k recommended internal tools before the model decides on actions.\n\nThis turns the 'look for internal tools first' guideline into an execution-time guarantee rather than a best-effort prompt instruction.\n\nTests:\n- uv run pytest tests/test_internal_tool_recall_middleware.py -v"
```

---

## Phase D: 文档与门禁

### Task 10: 更新交互模式文档（修正 command/argv 语义与 ws base）

**Files:**
- Modify: `docs/CLI_INTERACTIVE_MODE.md`

**Step 1: Write doc changes**

- 修正示例：init message 必须是 `{ tool_id, argv }`
- 明确：`CLITerminal` 不能硬编码 `localhost:8001`，必须使用 `getBackendBaseURL()`
- 明确：某些 CLI 登录不会弹浏览器，而是终端扫码/提示，这是预期行为；“是否弹浏览器”属于 CLI 自身策略

**Step 2: Verify docs lint (optional)**

无强制，但建议 `rg` 检查旧字段残留：

```bash
rg -n "command\\\": \\[\\\"login\\\"\\]|ws://localhost:8001" docs/CLI_INTERACTIVE_MODE.md
```

**Step 3: Commit**

```bash
git add docs/CLI_INTERACTIVE_MODE.md
git commit -m "docs(cli): align interactive mode docs with PTY argv contract and dynamic websocket base url" -m "Docs cleanup:\n- Update websocket init payload to {tool_id, argv}\n- Remove hardcoded ws://localhost:8001 guidance\n- Clarify terminal-based QR login vs external browser pop-up expectations"
```

---

## 总体验证（合并前门禁）

后端：

```bash
cd backend
uv run pytest tests/test_managed_cli_exec.py tests/test_cli_interactive_session_contract.py tests/test_cli_interactive_router_contract.py tests/test_cli_interactive_middleware_pty.py tests/test_internal_tool_recall.py tests/test_internal_tool_recall_middleware.py -v
```

前端：

```bash
pnpm -C frontend test:unit
pnpm -C frontend exec tsc --noEmit
```

手动验收（桌面应用）：

1. 在聊天里让助手执行 `xhs-cli login`（或触发需要交互的命令）。
2. 观察是否出现 `CLITerminal`，并能看到持续输出。
3. 扫码/完成登录后终端输出应提示成功或至少不再“无输出卡死”。
4. 新开一轮对话输入“我要登录小红书”，观察模型是否先提到/调用内部工具（来自注入的 recommended tools）。

---

## 参考与对标（CodePilot 可借鉴点，供 Phase C/D 迭代）

- CLI 工具目录 + 探测 + TTL 缓存 + 注入 `<available_cli_tools>`：CodePilot `src/lib/cli-tools-catalog.ts` / `cli-tools-detect.ts` / `cli-tools-context.ts`
- UI 显式选择工具（popover + badge），并在发送时 append 简短偏好提示：`src/lib/message-input-logic.ts`（`buildCliAppend`）
- “能力缓存（capabilities）”按 provider 维度缓存，避免海量工具漂移：`src/lib/agent-sdk-capabilities.ts`

