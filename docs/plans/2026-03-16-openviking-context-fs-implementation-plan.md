# OpenViking Context FS 升级 Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把 OpenViking 升级为可被智能体稳定使用的 Context Filesystem（tool-first），并与 Nion Curated Memory 明确分工，保证混用模型（Anthropic-compatible + OpenAI-compatible）不依赖额外 system message 注入也可工作。

**Architecture:**  
1) OpenViking 负责 FS 能力（resources/session + L0/L1/L2 + search/find + grep/tree/read）。  
2) Nion Curated Memory 负责可注入摘要、tier/TTL、治理与 explain。  
3) 默认路径 tool-first：通过 `ovfs_*` 工具按需拉取 OpenViking 内容，不依赖注入式 middleware。  
4) session 原文沉淀只作为证据层：ledger 标记为 `trace` 且 TTL 受控，默认不注入、不参与默认检索。

**Tech Stack:** Backend(Python 3.12, FastAPI, uv, OpenViking SDK 0.2.1, SQLite)。

---

## Task 0：落阶段文档与实施计划文档（门禁）

**Files:**
- Create: `docs/memoh/plan/2026-03-16-phase-3a-openviking-context-fs.md`
- Create: `docs/plans/2026-03-16-openviking-context-fs-implementation-plan.md`

**Step 1: Verify docs exist**

Run:
```bash
cd /Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent
test -f docs/memoh/plan/2026-03-16-phase-3a-openviking-context-fs.md
test -f docs/plans/2026-03-16-openviking-context-fs-implementation-plan.md
```

Expected: exit code 0

**Step 2: Commit**

Run:
```bash
cd /Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent
git add docs/memoh/plan/2026-03-16-phase-3a-openviking-context-fs.md docs/plans/2026-03-16-openviking-context-fs-implementation-plan.md
git commit -m "docs(openviking): add Phase 3A Context FS plan and implementation plan" \
  -m "Plan: establish Phase 3A spec + execution plan for OpenViking Context FS upgrade (tool-first, mixed-model stable)." \
  -m "Why: current OpenViking usage is partial and injection-based enhancements are skipped for Anthropic-compatible models; we need a stable tool-first path plus clear separation between OpenViking FS and Curated Memory." \
  -m "What: add Phase 3A stage doc (context pack, goals, out-of-scope, acceptance, rollback) and an executable implementation plan that enforces task-level commits." \
  -m "Validation: docs files exist; no code behavior changed." \
  -m "Follow-up: execute Tasks 1-6 in this plan with one commit per task and targeted pytest runs."
```

---

## Task 1：修复 OpenViking client 并发安全（全局锁 + env 还原）

**Files:**
- Modify: `backend/src/agents/memory/openviking_runtime.py`
- Modify: `backend/tests/test_openviking_runtime_retrieval.py`

**Step 1: Write failing test**
- Add a unit test ensuring that the runtime’s OpenViking client context restores `OPENVIKING_CONFIG_FILE` even when switching scopes.

**Step 2: Run test to verify it fails**

Run:
```bash
cd backend
uv run pytest -q tests/test_openviking_runtime_retrieval.py::test_BE_CORE_MEM_3xx_openviking_env_restored_between_scopes
```

Expected: FAIL (test missing / behavior incorrect)

**Step 3: Implement minimal fix**
- Add `self._ov_env_lock = threading.Lock()` in `OpenVikingRuntime.__init__`
- Add a contextmanager that:
  - acquires the lock
  - sets env to scope-specific `ov.conf`
  - yields a `SyncOpenViking` client
  - closes client and restores env in `finally`
- Route all SDK calls through this contextmanager (at minimum: `_openviking_find`, `_openviking_rm`, `commit_session`, plus new FS APIs in Task 2)

**Step 4: Run the test**

Run:
```bash
cd backend
uv run pytest -q tests/test_openviking_runtime_retrieval.py::test_BE_CORE_MEM_3xx_openviking_env_restored_between_scopes
```

Expected: PASS

**Step 5: Commit**

Commit message must explicitly explain why per-scope locks are insufficient (env is global).

---

## Task 2：在 Runtime/Provider 增加 OpenViking FS 只读能力

**Files:**
- Modify: `backend/src/agents/memory/openviking_runtime.py`
- Modify: `backend/src/agents/memory/openviking_provider.py`
- Create: `backend/tests/test_openviking_runtime_fs_readonly.py`

**Steps:**
1) Add `fs_find/fs_search/fs_overview/fs_read/fs_ls/fs_tree/fs_grep/fs_glob/fs_stat` methods in runtime, all using the Task 1 contextmanager.
2) Return unified shape:
   - list results: `[{\"uri\": ..., \"score\": ..., \"abstract\": ...}]`
   - best-effort abstract via `client.abstract(uri)` (failure -> empty)
3) Add provider wrappers that forward to runtime.
4) Add unit tests with dummy client via monkeypatch.

**Verify:**
```bash
cd backend
uv run pytest -q tests/test_openviking_runtime_fs_readonly.py
```

**Commit:** runtime + provider + tests as one commit.

---

## Task 3：新增 `ovfs_*` 内置工具（tool-first 主入口）

**Files:**
- Create: `backend/src/tools/builtins/openviking_fs_tools.py`
- Modify: `backend/src/tools/builtins/__init__.py`
- Modify: `backend/src/tools/tools.py`
- Create: `backend/tests/test_openviking_fs_tools_contract.py`

**Steps:**
1) Implement only-read tools that call provider FS methods.
2) Use `resolve_agent_for_memory_scope` to normalize scope + `_default -> global`.
3) Output unified JSON string: `{ok, scope, agent_name, data}`
4) Export tools through builtin registry and tools list.

**Verify:**
```bash
cd backend
uv run pytest -q tests/test_openviking_fs_tools_contract.py
```

**Commit:** tools + exports + tests.

---

## Task 4：接线 `openviking_session_commit_enabled`（trace 化）

**Files:**
- Modify: `backend/src/agents/middlewares/memory_middleware.py`
- Modify: `backend/src/agents/memory/openviking_runtime.py`
- Create: `backend/tests/test_memory_session_commit_queue_wiring.py`

**Steps:**
1) In `MemoryMiddleware.after_agent`, when `policy.allow_write` and config flag enabled, call `get_memory_queue().add(thread_id, filtered_messages, agent_name)`.
2) In `_upsert_runtime_indexes`, set metadata: `tier=trace`, `retention_policy=short_term_7d`, `expires_at=...`.
3) Ensure trace is excluded from default injection and default sparse retrieval.

**Verify:**
```bash
cd backend
uv run pytest -q tests/test_memory_session_commit_queue_wiring.py
```

**Commit:** middleware + runtime + tests.

---

## Task 5：升级 `<memory>` 注入为 tier-aware（强约束）

**Files:**
- Modify: `backend/src/agents/memory/openviking_runtime.py`
- Modify: `backend/src/agents/memory/prompt.py`
- Create: `backend/tests/test_memory_injection_tier_formatting.py`

**Rules to enforce:**
- Exclude: `tier=trace`, expired, non-active by default.
- Token budget priority: Profile > Preference > Episode.
- Episodes only top-N by `quality_score`.

**Verify:**
```bash
cd backend
uv run pytest -q tests/test_memory_injection_tier_formatting.py
```

**Commit:** injection changes + tests.

---

## Task 6：`setup_agent` 完成后同步 Soul/Identity/User(marker) 到 OpenViking resources

**Files:**
- Modify: `backend/src/tools/builtins/setup_agent_tool.py`
- Modify: `backend/src/agents/memory/openviking_provider.py`
- Modify: `backend/src/agents/memory/openviking_runtime.py`
- Modify: `backend/tests/test_setup_agent_tool_bootstrap.py`

**Mapping (fixed, managed prefix only):**
- `viking://resources/nion/managed/user/USER.md`
- `viking://resources/nion/managed/agents/<agent_name>/SOUL.md`
- `viking://resources/nion/managed/agents/<agent_name>/IDENTITY.md`
- optional: `.../agent.json`

**Strategy:**
1) mkdir target dir (best-effort)
2) rm target file uri (not found tolerated)
3) add_resource(path=local file, target=dir uri, reason="nion_asset_sync", wait=False)
4) failure logs warning only; must not break agent creation/update.

**Verify:**
```bash
cd backend
uv run pytest -q tests/test_setup_agent_tool_bootstrap.py
```

**Commit:** sync implementation + tests.

