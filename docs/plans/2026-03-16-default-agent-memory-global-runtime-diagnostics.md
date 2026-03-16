# 默认智能体记忆与全局记忆一致性 + 运行时诊断 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让 `_default` 默认智能体与 `global` 全局记忆在“写入/检索/治理/展示”层面可验证地一致，并补齐“我现在到底连的是哪一个前后端/数据目录/后端版本”的诊断能力，避免再次出现“看起来没改/改了但跑的不是这套”的误判。

**Architecture:**  
1) 先做“系统化取证”，确认用户当前 UI 实际请求打到哪个 Gateway、Gateway 的 `NION_HOME`/数据目录是什么、是否仍存在旧实例（例如 `next-server` 指向旧目录、Gateway 未启动导致 `Failed to fetch`）。  
2) 在 Gateway 增加只读 `runtime info` 端点暴露关键运行时信息（`base_dir`、OpenViking ledger 路径、是否可 import `sentence-transformers`、`_default -> global` 归一化结果），前端新增“运行拓扑”诊断页展示这些信息。  
3) 在后端补齐 API 层回归测试：即使前端仍用旧参数（`scope=agent&agent_name=_default`），也必须稳定映射到 `global`；并补齐（可选）历史 `agent:_default` 作用域数据迁移，避免升级后默认智能体旧记忆“看不见”。

**Tech Stack:** Backend(Python 3.12, FastAPI, uv, SQLite) + Frontend(Next.js/React, TypeScript, pnpm)。

---

## Phase 0: 复现与证据采集（必须先做）

> 目标是把“你现在跑的是谁”定死：端口、进程 cwd、实际请求 URL、后端数据目录。**没有这一步，不允许改代码。**

### Step 0.1: 采集端口与进程证据

Run:
```bash
cd /Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent
lsof -nP -iTCP -sTCP:LISTEN | rg ":(2024|2026|8001|3000|4174|1933)\\b" || true
ps aux | rg -i "langgraph dev|uvicorn src\\.gateway\\.app:app|next-server|next dev|electron|openviking" | rg -v "rg -i" || true
```

Expected:
- `make dev` 模式：应看到 `2024/8001/3000/2026` 监听。
- 桌面端 runtime：应看到 `uvicorn ...:8001`，以及前端端口（默认 `3000`，可能被占用时自动换端口）。
- 若看到 `next-server` 的 `cwd` 指向 `Nion-Agent-pre-rewrite-backup-*`，基本可判定用户打开的是旧前端。

### Step 0.2: 直接用 curl 验证 Gateway 是否存活

Run:
```bash
curl -sS -o /dev/null -w "%{http_code}\\n" http://127.0.0.1:8001/health || true
curl -sS -o /dev/null -w "%{http_code}\\n" http://127.0.0.1:2026/health || true
```

Expected:
- 任意一个返回 `200`，说明 Gateway 存活；都不是 `200` 则 UI 的任何 `/api/*` 调用都会 `Failed to fetch`。

### Step 0.3: 记录“默认智能体记忆页”与“全局记忆页”的请求 URL

Action:
- 在浏览器或 Electron DevTools 的 Network 面板里，筛选 `openviking/items`，记录两页分别请求的完整 URL（包含 querystring）。

Expected:
- `_default` 智能体记忆页应请求 `scope=global`（或旧 UI 请求 `scope=agent&agent_name=_default` 但后端仍需兼容）。
- 全局记忆页应请求 `scope=global`。

---

## Phase 1: 用写失败测试锁定“_default 必须等价 global”的 API 行为

### Task 1: OpenViking `/items` 对 `_default` 的兼容映射回归测试

**Files:**
- Create: `backend/tests/test_openviking_items_default_agent_alias.py`

**Step 1: 写失败测试（router 层）**

Create `backend/tests/test_openviking_items_default_agent_alias.py`:
```python
from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

import app.gateway.routers.openviking as openviking_router


class _DummyProvider:
    name = "openviking"

    def __init__(self) -> None:
        self.calls: list[tuple[str, str | None]] = []

    def get_memory_items(self, *, scope: str = "global", agent_name: str | None = None):
        self.calls.append((scope, agent_name))
        return [{"memory_id": "m1", "summary": "demo", "uri": "viking://manifest/m1"}]


def test_BE_GATEWAY_MEM_501_items_default_agent_aliases_to_global(monkeypatch):
    provider = _DummyProvider()
    monkeypatch.setattr(openviking_router, "get_default_memory_provider", lambda: provider)

    app = FastAPI()
    app.include_router(openviking_router.router)
    client = TestClient(app)

    res = client.get("/api/openviking/items?scope=agent&agent_name=_default")
    assert res.status_code == 200
    payload = res.json()

    assert provider.calls == [("global", None)]
    assert payload["scope"] == "global"
    assert payload["items"] and payload["items"][0]["memory_id"] == "m1"
```

**Step 2: 运行测试，确认失败（若已通过则记录为“已有门禁”）**

Run:
```bash
cd backend
uv run pytest -q tests/test_openviking_items_default_agent_alias.py
```

Expected:
- 首次可能已经 PASS；若 FAIL，则后续 Task 1.2 修复 router 层映射。

**Step 3: 如失败则修复（最小改动）**

Fix hint:
- 检查 [openviking.py](/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/app/gateway/routers/openviking.py) 的 `_resolve_agent_by_scope` 与 `list_openviking_items()` 是否确实使用 `resolve_agent_for_memory_scope` 并把 `_default` 映射为 `None`。

**Step 4: 回归测试**

Run:
```bash
cd backend
uv run pytest -q tests/test_openviking_items_default_agent_alias.py
```

Expected:
- PASS

**Step 5: Commit（只提交本任务文件/改动，commit message 要写清根因/行为/验证）**

Run:
```bash
git add backend/tests/test_openviking_items_default_agent_alias.py backend/app/gateway/routers/openviking.py
git commit -m "test(memory): guard /api/openviking/items so _default always aliases to global" \
  -m "Why: users can still run older UIs that call scope=agent&agent_name=_default; backend must remain backward compatible and never create/return a separate agent:_default scope." \
  -m "Change: add FastAPI router-level unit test asserting provider is called with (scope=global, agent_name=None) and response scope is normalized to global." \
  -m "Files: backend/tests/test_openviking_items_default_agent_alias.py; backend/app/gateway/routers/openviking.py (if touched)" \
  -m "Verify: cd backend && uv run pytest -q tests/test_openviking_items_default_agent_alias.py"
```

---

## Phase 2: 增加“我现在连的是谁”的运行时诊断（解决“看起来没改/手动升级不生效/Failed to fetch”）

### Task 2: 新增 Gateway 运行时信息端点（base_dir / ledger 路径 / 依赖健康 / _default 映射）

**Files:**
- Create: `backend/app/gateway/routers/runtime_info.py`
- Modify: `backend/app/gateway/routers/__init__.py`
- Modify: `backend/app/gateway/app.py`
- Test: `backend/tests/test_runtime_info_endpoint.py`

**Step 1: 写失败测试**

Create `backend/tests/test_runtime_info_endpoint.py`:
```python
from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

import app.gateway.routers.runtime_info as runtime_info


def test_BE_GATEWAY_RUNTIME_601_runtime_info_reports_base_dir(monkeypatch, tmp_path):
    monkeypatch.setenv("NION_HOME", str(tmp_path))

    app = FastAPI()
    app.include_router(runtime_info.router)
    client = TestClient(app)

    res = client.get("/api/runtime/info")
    assert res.status_code == 200
    payload = res.json()

    assert payload["base_dir"] == str(tmp_path)
    assert payload["default_agent_name"] == "_default"
    assert payload["default_agent_normalized"] is None
    assert isinstance(payload["sentence_transformers_available"], bool)
```

**Step 2: 运行测试，确认失败**

Run:
```bash
cd backend
uv run pytest -q tests/test_runtime_info_endpoint.py
```

Expected:
- FAIL（模块不存在/路由不存在）

**Step 3: 实现最小后端端点**

Create `backend/app/gateway/routers/runtime_info.py`:
```python
from __future__ import annotations

import os
import subprocess
import sys
from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel

from nion.agents.memory.scope import normalize_agent_name_for_memory
from nion.config.default_agent import DEFAULT_AGENT_NAME
from nion.config.paths import get_paths

router = APIRouter(prefix="/api/runtime/info", tags=["runtime"])


def _safe_git_sha() -> str | None:
    try:
        out = subprocess.check_output(["git", "rev-parse", "HEAD"], stderr=subprocess.DEVNULL, text=True)
        sha = out.strip()
        return sha if sha else None
    except Exception:  # noqa: BLE001
        return None


def _has_sentence_transformers() -> bool:
    try:
        import sentence_transformers  # noqa: F401
    except Exception:  # noqa: BLE001
        return False
    return True


class RuntimeInfoResponse(BaseModel):
    runtime_mode: Literal["desktop", "web"]
    base_dir: str
    nion_home_env: str | None
    openviking_index_db: str
    python_version: str
    git_sha: str | None
    sentence_transformers_available: bool
    default_agent_name: str
    default_agent_normalized: str | None


@router.get("", response_model=RuntimeInfoResponse, summary="Inspect runtime info (debug)")
async def get_runtime_info() -> RuntimeInfoResponse:
    paths = get_paths()
    runtime_mode: Literal["desktop", "web"] = "desktop" if os.getenv("NION_DESKTOP_RUNTIME", "0") == "1" else "web"
    return RuntimeInfoResponse(
        runtime_mode=runtime_mode,
        base_dir=str(paths.base_dir),
        nion_home_env=os.getenv("NION_HOME"),
        openviking_index_db=str(paths.openviking_index_db),
        python_version=sys.version.split()[0],
        git_sha=_safe_git_sha(),
        sentence_transformers_available=_has_sentence_transformers(),
        default_agent_name=DEFAULT_AGENT_NAME,
        default_agent_normalized=normalize_agent_name_for_memory(DEFAULT_AGENT_NAME),
    )
```

**Step 4: 挂载 router 到 Gateway**

Modify:
- [__init__.py](/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/app/gateway/routers/__init__.py): `_ROUTER_MODULES` 加入 `"runtime_info"`
- [app.py](/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/app/gateway/app.py): import `runtime_info` 并 `app.include_router(runtime_info.router)`（建议紧跟 `runtime_topology`）

**Step 5: 重新运行测试**

Run:
```bash
cd backend
uv run pytest -q tests/test_runtime_info_endpoint.py
```

Expected:
- PASS

**Step 6: Commit**

Run:
```bash
git add backend/app/gateway/routers/runtime_info.py backend/app/gateway/routers/__init__.py backend/app/gateway/app.py backend/tests/test_runtime_info_endpoint.py
git commit -m "feat(runtime): add /api/runtime/info to expose base_dir + memory diagnostics" \
  -m "Root cause: debugging memory scope issues is ambiguous when multiple frontends/backends exist (e.g. stale next-server cwd, desktop runtime uses a different NION_HOME, gateway not started causing Failed to fetch). Without runtime introspection users cannot confirm which instance they are hitting." \
  -m "Change: add /api/runtime/info reporting runtime_mode, resolved base_dir, OpenViking ledger db path, python version, git sha best-effort, sentence-transformers availability, and default-agent memory normalization result (_default -> None/global)." \
  -m "Files: backend/app/gateway/routers/runtime_info.py; backend/app/gateway/routers/__init__.py; backend/app/gateway/app.py; backend/tests/test_runtime_info_endpoint.py" \
  -m "Verify: cd backend && uv run pytest -q tests/test_runtime_info_endpoint.py"
```

---

### Task 3: 前端补齐“运行拓扑(诊断)”设置页，展示前端视角 + Gateway 视角 + runtime info

**Files:**
- Create: `frontend/src/components/workspace/settings/diagnostics-settings-page.tsx`
- Create: `frontend/src/core/runtime-info/api.ts`
- Create: `frontend/src/core/runtime-info/hooks.ts`
- Create: `frontend/src/core/runtime-info/types.ts`
- Modify: `frontend/src/components/workspace/settings/settings-dialog.tsx`

**Step 1: 写最小 runtime-info 前端 API 封装**

Create `frontend/src/core/runtime-info/types.ts`:
```ts
export interface RuntimeInfoResponse {
  runtime_mode: "desktop" | "web";
  base_dir: string;
  nion_home_env: string | null;
  openviking_index_db: string;
  python_version: string;
  git_sha: string | null;
  sentence_transformers_available: boolean;
  default_agent_name: string;
  default_agent_normalized: string | null;
}
```

Create `frontend/src/core/runtime-info/api.ts`:
```ts
import { getBackendBaseURL } from "@/core/config";

import type { RuntimeInfoResponse } from "./types";

export async function loadRuntimeInfo(): Promise<RuntimeInfoResponse> {
  const response = await fetch(`${getBackendBaseURL()}/api/runtime/info`);
  if (!response.ok) {
    throw new Error(`Failed to load runtime info (${response.status})`);
  }
  return (await response.json()) as RuntimeInfoResponse;
}
```

Create `frontend/src/core/runtime-info/hooks.ts`:
```ts
import { useQuery } from "@tanstack/react-query";

import { loadRuntimeInfo } from "./api";

export function useRuntimeInfo() {
  return useQuery({
    queryKey: ["runtime-info"],
    queryFn: loadRuntimeInfo,
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });
}
```

**Step 2: 写 DiagnosticsSettingsPage（使用已有 i18n copy：`t.settings.diagnostics`）**

Create `frontend/src/components/workspace/settings/diagnostics-settings-page.tsx`:
```tsx
"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "@/core/i18n/hooks";
import { isElectron } from "@/core/platform";
import { getBackendBaseURL, getLangGraphBaseURL } from "@/core/config";
import { useRuntimeInfo } from "@/core/runtime-info/hooks";
import { useRuntimeTopology } from "@/core/runtime-topology/hooks";

function formatBool(value: boolean, copy: { booleanTrue: string; booleanFalse: string }) {
  return value ? copy.booleanTrue : copy.booleanFalse;
}

export function DiagnosticsSettingsPage() {
  const { t } = useI18n();
  const copy = t.settings.diagnostics;

  const runtimeTopology = useRuntimeTopology();
  const runtimeInfo = useRuntimeInfo();

  const platformType = isElectron() ? "electron" : "web";
  const windowOrigin = typeof window === "undefined" ? "-" : window.location.origin;
  const backendBaseUrl = getBackendBaseURL();
  const langgraphBaseUrl = getLangGraphBaseURL();

  const refresh = async () => {
    await Promise.all([runtimeTopology.refetch(), runtimeInfo.refetch()]);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">{copy.title}</h2>
          <p className="text-muted-foreground mt-1 text-sm">{copy.description}</p>
        </div>
        <Button variant="outline" onClick={() => void refresh()}>
          {copy.refresh}
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{copy.frontendTitle}</CardTitle>
          <p className="text-muted-foreground text-xs">{copy.frontendDescription}</p>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
          <div className="rounded-lg border p-3">
            <div className="text-muted-foreground text-xs">{copy.platformType}</div>
            <div className="mt-1 font-mono">{platformType}</div>
          </div>
          <div className="rounded-lg border p-3">
            <div className="text-muted-foreground text-xs">{copy.windowOrigin}</div>
            <div className="mt-1 font-mono">{windowOrigin}</div>
          </div>
          <div className="rounded-lg border p-3">
            <div className="text-muted-foreground text-xs">{copy.backendBaseUrl}</div>
            <div className="mt-1 font-mono break-all">{backendBaseUrl}</div>
          </div>
          <div className="rounded-lg border p-3">
            <div className="text-muted-foreground text-xs">{copy.langgraphBaseUrl}</div>
            <div className="mt-1 font-mono break-all">{langgraphBaseUrl}</div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-sm">{copy.gatewayTitle}</CardTitle>
            {runtimeTopology.data?.browser_should_use_gateway_facade ? (
              <Badge variant="secondary">{copy.gatewayFacadeBadge}</Badge>
            ) : null}
          </div>
          <p className="text-muted-foreground text-xs">{copy.gatewayDescription}</p>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {runtimeTopology.isLoading ? (
            <div className="text-muted-foreground text-sm">{copy.loading}</div>
          ) : runtimeTopology.error || !runtimeTopology.data ? (
            <div className="text-muted-foreground text-sm">{copy.unavailable}</div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-lg border p-3">
                <div className="text-muted-foreground text-xs">{copy.runtimeMode}</div>
                <div className="mt-1 font-mono">{runtimeTopology.data.runtime_mode}</div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-muted-foreground text-xs">{copy.langgraphUpstream}</div>
                <div className="mt-1 font-mono break-all">{runtimeTopology.data.langgraph_upstream}</div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-muted-foreground text-xs">{copy.gatewayHost}</div>
                <div className="mt-1 font-mono">{runtimeTopology.data.gateway_host}</div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-muted-foreground text-xs">{copy.gatewayPort}</div>
                <div className="mt-1 font-mono">{runtimeTopology.data.gateway_port}</div>
              </div>
              <div className="rounded-lg border p-3 sm:col-span-2">
                <div className="text-muted-foreground text-xs">{copy.gatewayFacadePath}</div>
                <div className="mt-1 font-mono break-all">{runtimeTopology.data.gateway_facade_path}</div>
              </div>
              <div className="rounded-lg border p-3 sm:col-span-2">
                <div className="text-muted-foreground text-xs">{copy.browserShouldUseGatewayFacade}</div>
                <div className="mt-1 font-mono">
                  {formatBool(runtimeTopology.data.browser_should_use_gateway_facade, copy)}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Runtime info</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {runtimeInfo.isLoading ? (
            <div className="text-muted-foreground text-sm">{copy.loading}</div>
          ) : runtimeInfo.error || !runtimeInfo.data ? (
            <div className="text-muted-foreground text-sm">{copy.unavailable}</div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-lg border p-3">
                <div className="text-muted-foreground text-xs">base_dir</div>
                <div className="mt-1 font-mono break-all">{runtimeInfo.data.base_dir}</div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-muted-foreground text-xs">openviking_index_db</div>
                <div className="mt-1 font-mono break-all">{runtimeInfo.data.openviking_index_db}</div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-muted-foreground text-xs">git_sha</div>
                <div className="mt-1 font-mono break-all">{runtimeInfo.data.git_sha ?? "-"}</div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-muted-foreground text-xs">sentence-transformers</div>
                <div className="mt-1 font-mono">
                  {formatBool(runtimeInfo.data.sentence_transformers_available, copy)}
                </div>
              </div>
              <div className="rounded-lg border p-3 sm:col-span-2">
                <div className="text-muted-foreground text-xs">default_agent_normalized</div>
                <div className="mt-1 font-mono">
                  {runtimeInfo.data.default_agent_name} =&gt; {runtimeInfo.data.default_agent_normalized ?? "global(None)"}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
```

**Step 3: 把诊断页接入 SettingsDialog**

Modify [settings-dialog.tsx](/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/frontend/src/components/workspace/settings/settings-dialog.tsx):
- `SettingsSection` union 增加 `"diagnostics"`
- `sections` 列表增加 diagnostics（使用 `t.settings.diagnostics.title` 与一个合适 icon，例如 `RouteIcon`）
- render 区域增加 `{activeSection === "diagnostics" && <DiagnosticsSettingsPage />}`

**Step 4: 类型检查**

Run:
```bash
cd frontend
pnpm -s typecheck
```

Expected:
- PASS

**Step 5: Commit**

Run:
```bash
git add frontend/src/components/workspace/settings/diagnostics-settings-page.tsx frontend/src/core/runtime-info/api.ts frontend/src/core/runtime-info/hooks.ts frontend/src/core/runtime-info/types.ts frontend/src/components/workspace/settings/settings-dialog.tsx
git commit -m "feat(ui): add runtime diagnostics page to reveal gateway topology + base_dir" \
  -m "Root cause: users reported 'still not fixed' and 'Failed to fetch' because multiple runtimes (desktop/web/old next-server) can exist; without a diagnostics page they cannot confirm the actual backend base URL, gateway ports, or backend data directory (NION_HOME)." \
  -m "Change: introduce Settings -> Diagnostics page showing frontend view (origin/base URLs), gateway topology (/api/runtime/topology), and runtime info (/api/runtime/info) including base_dir + OpenViking ledger path + dependency health." \
  -m "Files: frontend/src/components/workspace/settings/diagnostics-settings-page.tsx; frontend/src/components/workspace/settings/settings-dialog.tsx; frontend/src/core/runtime-info/*" \
  -m "Verify: cd frontend && pnpm -s typecheck"
```

---

## Phase 3: （可选）历史 `agent:_default` 作用域迁移，避免升级后默认智能体旧记忆不可见

> 仅在 Phase 0 查询到 `memory_index.db` 存在 `agent:_default` scope 时执行。

### Task 4: SQLite ledger scope 迁移（agent:_default -> global）

**Files:**
- Modify: `backend/packages/harness/nion/agents/memory/sqlite_index.py`
- Modify: `backend/packages/harness/nion/agents/memory/openviking_runtime.py`
- Test: `backend/tests/test_sqlite_index_migrate_default_scope.py`

**Step 1: 写失败测试**

Create `backend/tests/test_sqlite_index_migrate_default_scope.py`:
```python
from __future__ import annotations

import sqlite3
from pathlib import Path

from nion.agents.memory.sqlite_index import OpenVikingSQLiteIndex


def _count(conn: sqlite3.Connection, table: str, scope: str) -> int:
    cur = conn.execute(f"select count(*) from {table} where scope = ?", (scope,))
    return int(cur.fetchone()[0])


def test_BE_CORE_MEM_701_migrate_agent_default_scope_into_global(tmp_path):
    db_path = Path(tmp_path) / "memory_index.db"
    index = OpenVikingSQLiteIndex(db_path)

    with index.transaction() as conn:
        conn.execute(
            \"\"\"
            insert into memory_resources(scope, memory_id, uri, summary, score, status, created_at, updated_at)
            values(?, ?, ?, ?, 0.8, 'active', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
            \"\"\",
            ("agent:_default", "m1", "viking://manifest/m1", "demo"),
        )

    moved = index.migrate_scope(source_scope="agent:_default", target_scope="global")
    assert moved["moved"] >= 1

    with sqlite3.connect(db_path) as conn:
        assert _count(conn, "memory_resources", "agent:_default") == 0
        assert _count(conn, "memory_resources", "global") == 1
```

**Step 2: 运行测试，确认失败**

Run:
```bash
cd backend
uv run pytest -q tests/test_sqlite_index_migrate_default_scope.py
```

Expected:
- FAIL（`migrate_scope` 不存在）

**Step 3: 实现迁移方法（最小可用 + 冲突跳过）**

Implementation sketch:
- 在 `OpenVikingSQLiteIndex` 增加 `migrate_scope(source_scope, target_scope)`：
  - 对每个带 `scope` 的表做 `INSERT OR IGNORE INTO ... SELECT ...`（把 scope 改成 target）；
  - 再 `DELETE FROM table WHERE scope = source_scope AND <row 已成功复制>`（可用 `rowid` 或按主键二次判断）。
  - 返回 moved/skipped 计数。
- 在 `OpenVikingRuntime.__init__()` 里检测 `agent:_default` 是否存在且需要迁移，然后执行一次迁移并日志提示。

**Step 4: 回归测试**

Run:
```bash
cd backend
uv run pytest -q tests/test_sqlite_index_migrate_default_scope.py
```

Expected:
- PASS

**Step 5: Commit**

Run:
```bash
git add backend/packages/harness/nion/agents/memory/sqlite_index.py backend/packages/harness/nion/agents/memory/openviking_runtime.py backend/tests/test_sqlite_index_migrate_default_scope.py
git commit -m "fix(memory): migrate legacy agent:_default ledger scope into global on startup" \
  -m "Root cause: older builds wrote default-agent memories under scope=agent:_default. After defining '_default' as an alias of global, those legacy rows become invisible unless migrated." \
  -m "Change: add SQLiteIndex scope migration helper (conflict-safe via INSERT OR IGNORE) and invoke it once during OpenVikingRuntime initialization when legacy scope is detected." \
  -m "Files: backend/packages/harness/nion/agents/memory/sqlite_index.py; backend/packages/harness/nion/agents/memory/openviking_runtime.py; backend/tests/test_sqlite_index_migrate_default_scope.py" \
  -m "Verify: cd backend && uv run pytest -q tests/test_sqlite_index_migrate_default_scope.py"
```

---

## Phase 4: Dev 启停可靠性（避免旧 next-server 残留导致你跑错 UI）

### Task 5: Makefile stop/dev 补齐 next-server/next start 清理

**Files:**
- Modify: `Makefile`

**Step 1: 写失败复现（手工）**
- 启动一个旧 Next server（例如历史目录 `frontend` 下跑 `pnpm dev` 让它变成 `next-server`）。
- 运行 `make stop` 或 `make dev` 的 “Stopping existing services” 段，观察旧 `next-server` 是否仍残留。

**Step 2: 修改 Makefile**

Change:
- 在 `dev/stop/desktop-dev/desktop-stop` 的 stop 段落中，除了 `pkill -f "next dev"`，额外补：
  - `pkill -f "next-server" 2>/dev/null || true`
  - `pkill -f "next start" 2>/dev/null || true`

**Step 3: 验证**

Run:
```bash
make stop
ps aux | rg -i "next-server|next dev|next start" | rg -v "rg -i" || true
```

Expected:
- 不再残留 `next-server` 进程（避免用户打开旧 UI）。

**Step 4: Commit**

Run:
```bash
git add Makefile
git commit -m "chore(dev): stop stale next-server processes to avoid running wrong frontend" \
  -m "Root cause: Makefile only stopped 'next dev' but not 'next-server/next start'. Old Next instances (often from backup dirs) can keep listening on a random port, causing users to test against stale UI and conclude fixes did not apply." \
  -m "Change: extend dev/stop/desktop-dev/desktop-stop cleanup to also pkill next-server and next start." \
  -m "Files: Makefile" \
  -m "Verify: make stop; ps aux | rg -i 'next-server|next dev|next start'"
```

---

## Phase 5: 手工验收（覆盖你关心的“新增 + 命中 + 共通”）

### Step 6.1: 启动（任选其一）
- Web dev：`make dev`，打开 `http://localhost:2026`
- Desktop dev：`make desktop-dev`，在设置里打开“运行拓扑”

### Step 6.2: 验证你是否连对实例
- 打开：设置 -> 运行拓扑（Diagnostics）
- Expected：
  - `backend base url` 指向你当前启动的 gateway
  - `runtime info` 中 `base_dir`/`openviking_index_db` 合理且稳定

### Step 6.3: 默认智能体与全局记忆共通
1. 与默认智能体对话：发送“我叫张天成”，确保该轮触发记忆写入。
2. 打开：设置 -> 记忆（全局）
3. 打开：智能体设置 -> `_default` -> 记忆

Expected:
- 两处条目数量与列表内容一致（因为 `_default` 映射为 `global`）。

### Step 6.4: 命中验证（检索）
- 在任意对话中问：“我叫什么名字？”

Expected:
- 记忆命中结果包含“张天成”（若开启注入，可在 prompt 中看到；也可用 memory explain 工具验证）。

---

## 执行方式

计划已写完并保存到 `docs/plans/2026-03-16-default-agent-memory-global-runtime-diagnostics.md`。两种执行选择：

1. **Subagent-Driven（本会话执行）**：按 Task 逐个实现，每个 Task 绿测后立即 commit  
2. **Parallel Session（新会话执行）**：新会话使用 `superpowers:executing-plans` 严格逐任务执行

你选哪一种？

