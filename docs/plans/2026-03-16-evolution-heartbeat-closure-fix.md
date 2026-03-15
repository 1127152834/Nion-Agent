# Evolution/Heartbeat 闭环修复 + Scheduler 时区按钮移除 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 修复自我进化（Evolution）“手动分析必失败 + 自动触发无效”的闭环，同时让心跳（Heartbeat）在 UI 上可自证可手动执行，并删除智能体定时任务页头的“时区设置”按钮。

**Architecture:** 后端以现有 `scheduler` 为唯一周期执行底座，引入 `TaskMode.EVOLUTION` 承载 Evolution 系统任务（不对用户暴露）；Evolution 手动触发走 `/api/evolution/run`，自动触发由 `EvolutionService.update_settings()` 创建/更新系统任务并在开启时立即异步跑一次。前端补齐 Evolution 报告可读性与 Heartbeat 状态/手动执行入口，定时任务页仅删页头时区按钮，保留时区 Badge 与编辑器内跳转。

**Tech Stack:** Python 3.12 (通过 `uv run`)、FastAPI、Pydantic v2、APScheduler、Next.js、React、TanStack React Query、sonner、Tailwind/shadcn。

---

## Task 0: 隔离工作区与复现基线

**Files:**
- Create: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/plans/2026-03-16-evolution-heartbeat-closure-fix.md`（把本计划原样保存进去）

### Step 1: 创建独立 worktree（避免当前工作区已有大量未提交删除变更污染提交）

Run:
```bash
cd /Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent
git worktree add ../Nion-Agent.wt/evolution-heartbeat-closure-fix -b codex/evolution-heartbeat-closure-fix
```

Expected:
- 新目录 `../Nion-Agent.wt/evolution-heartbeat-closure-fix` 存在
- `git status` 干净

### Step 2: 确认后端测试环境只能用 uv 的 Python

Run:
```bash
cd /Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend
uv run python -V
```

Expected:
- 输出 `Python 3.12.x`

### Step 3: 复现当前 Evolution 手动分析失败的根因（作为修复前证据）

Run:
```bash
cd /Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend
uv run python - <<'PY'
import asyncio
from src.evolution.service import EvolutionService
async def main():
    try:
        await EvolutionService().run("_default")
    except Exception as e:
        print(type(e).__name__, str(e))
asyncio.run(main())
PY
```

Expected:
- 输出包含 `TypeError EvolutionAnalyzer.analyze() takes 2 positional arguments but 3 were given`

---

## Task 1: 修复 Evolution 手动分析必失败（参数签名不匹配）并提供可读错误

**Files:**
- Modify: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/evolution/analyzer.py`
- Modify: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/gateway/routers/evolution.py`
- Test: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/tests/test_evolution_router.py`

### Step 1: 写一个失败的 Router 测试，锁定“/run 必须返回 202 + report_id”

Create `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/tests/test_evolution_router.py`:
```python
from __future__ import annotations

import time
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.config.paths import Paths
from src.gateway.routers.evolution import router


def _make_app() -> FastAPI:
    app = FastAPI()
    app.include_router(router)
    return app


def test_evolution_run_creates_report_and_returns_202(tmp_path):
    app = _make_app()
    paths = Paths(base_dir=tmp_path)

    with patch("src.evolution.store.get_paths", return_value=paths):
        with TestClient(app) as client:
            resp = client.post("/api/evolution/run?agent_name=_default")
            assert resp.status_code == 202
            payload = resp.json()
            assert payload["status"] == "completed"
            assert payload["report_id"]

            # reports endpoint should return the new record
            reports = client.get("/api/evolution/reports?agent_name=_default").json()
            assert len(reports) >= 1
            assert reports[0]["report_id"] == payload["report_id"]
```

### Step 2: 运行测试确认失败

Run:
```bash
cd /Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend
uv run pytest -q tests/test_evolution_router.py
```

Expected:
- FAIL
- 报错包含 `EvolutionAnalyzer.analyze() takes 2 positional arguments...`

### Step 3: 最小实现修复 analyzer 签名，并让 /run 在异常时返回 detail

Modify `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/evolution/analyzer.py`，把签名改为接收 `agent_name`，并在内部按 agent 读取 Heartbeat/Soul/Memory（仅修正明显错用参数与统计字段，不做复杂策略）：
```python
from datetime import datetime

from src.evolution.models import EvolutionSuggestion, SuggestionPriority, SuggestionType


class EvolutionAnalyzer:
    """Evolution analyzer."""

    async def analyze(self, report_id: str, agent_name: str = "_default") -> list[EvolutionSuggestion]:
        """Analyze and generate suggestions."""
        suggestions: list[EvolutionSuggestion] = []

        suggestions.extend(await self._analyze_memory(report_id, agent_name))
        suggestions.extend(await self._analyze_soul(report_id, agent_name))
        suggestions.extend(await self._analyze_agent(report_id, agent_name))

        return suggestions

    async def _analyze_memory(self, report_id: str, agent_name: str) -> list[EvolutionSuggestion]:
        from src.agents.memory.maintenance import get_usage_stats
        from src.agents.memory.registry import get_memory_registry

        suggestions: list[EvolutionSuggestion] = []
        try:
            registry = get_memory_registry()
            provider = registry.get_default()

            scope = "global" if agent_name == "_default" else "agent"
            scope_agent_name = None if scope == "global" else agent_name
            usage = get_usage_stats(provider._runtime, scope=scope, agent_name=scope_agent_name)

            entry_count = int(usage.get("active_entries", 0))
            if entry_count > 200:
                suggestions.append(
                    EvolutionSuggestion(
                        report_id=report_id,
                        type=SuggestionType.MEMORY,
                        target_domain="memory",
                        content=f"建议压缩长期记忆，当前有 {entry_count} 条 active 记录",
                        evidence_summary="基于 Memory usage 统计",
                        impact_scope="影响范围：记忆检索性能",
                        confidence=0.85,
                        priority=SuggestionPriority.MEDIUM,
                    )
                )
        except Exception:
            pass
        return suggestions

    async def _analyze_soul(self, report_id: str, agent_name: str) -> list[EvolutionSuggestion]:
        from src.agents.soul.resolver import SoulResolver

        suggestions: list[EvolutionSuggestion] = []
        try:
            resolver = SoulResolver()
            resolved = None if agent_name == "_default" else agent_name
            soul_asset = resolver.load_soul(agent_name=resolved)
            identity_asset = resolver.load_identity(agent_name=resolved)

            if not soul_asset:
                suggestions.append(
                    EvolutionSuggestion(
                        report_id=report_id,
                        type=SuggestionType.SOUL,
                        target_domain="soul",
                        content="建议创建 SOUL.md 文件，定义助手个性",
                        evidence_summary="基于 Soul 资产检查",
                        impact_scope="影响范围：助手身份一致性",
                        confidence=0.90,
                        priority=SuggestionPriority.HIGH,
                    )
                )
            if not identity_asset:
                suggestions.append(
                    EvolutionSuggestion(
                        report_id=report_id,
                        type=SuggestionType.SOUL,
                        target_domain="soul",
                        content="建议创建 IDENTITY.md 文件，定义助手身份",
                        evidence_summary="基于 Soul 资产检查",
                        impact_scope="影响范围：助手角色定位",
                        confidence=0.90,
                        priority=SuggestionPriority.HIGH,
                    )
                )
        except Exception:
            pass
        return suggestions

    async def _analyze_agent(self, report_id: str, agent_name: str) -> list[EvolutionSuggestion]:
        from src.heartbeat.service import get_heartbeat_service

        suggestions: list[EvolutionSuggestion] = []
        try:
            heartbeat_service = get_heartbeat_service()
            logs = heartbeat_service.get_logs(agent_name, limit=20)

            failed_count = sum(1 for log in logs if log.status == "failed")
            if failed_count > 5:
                suggestions.append(
                    EvolutionSuggestion(
                        report_id=report_id,
                        type=SuggestionType.AGENT,
                        target_domain="agent",
                        content=f"建议检查任务失败原因，最近 20 次中有 {failed_count} 次失败",
                        evidence_summary="基于 Heartbeat 日志分析",
                        impact_scope="影响范围：任务执行稳定性",
                        confidence=0.75,
                        priority=SuggestionPriority.MEDIUM,
                    )
                )
        except Exception:
            pass
        return suggestions
```

Modify `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/gateway/routers/evolution.py`，在 `/run` 包一层错误 detail（服务内部仍会落盘 failed report）：
```python
@router.post("/run", status_code=202)
async def run_evolution(agent_name: str = "_default") -> dict:
    service = get_evolution_service()
    settings = service.get_settings(agent_name)

    if not settings.enabled:
        raise HTTPException(status_code=403, detail="Evolution is disabled")

    try:
        report = await service.run(agent_name)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc))

    return {"status": "completed", "report_id": report.report_id}
```

### Step 4: 运行测试确认通过

Run:
```bash
cd /Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend
uv run pytest -q tests/test_evolution_router.py
```

Expected:
- PASS

### Step 5: Commit（只 add 精确路径，避免混入无关变更）

Run:
```bash
cd /Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent.wt/evolution-heartbeat-closure-fix
git add backend/src/evolution/analyzer.py backend/src/gateway/routers/evolution.py backend/tests/test_evolution_router.py
git commit -m "fix(evolution): 修复手动分析必失败并返回可读错误" \
  -m "现象: UI 点击“立即分析一次”产生 0s failed report，错误为 analyze() 参数签名不匹配。" \
  -m "根因: EvolutionService.run() 传入 (report_id, agent_name) 但 EvolutionAnalyzer.analyze() 仅接收 report_id。" \
  -m "改动: analyzer 签名与内部按 agent 读取 Heartbeat/Soul/Memory；/api/evolution/run 异常返回 detail 便于前端展示。" \
  -m "验证: uv run pytest -q tests/test_evolution_router.py" \
  -m "回滚: git revert 本提交即可恢复旧行为。"
```

---

## Task 2: 为自动触发打通 scheduler 执行通道（新增 TaskMode.EVOLUTION 并将其视为系统任务过滤掉）

**Files:**
- Modify: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/scheduler/models.py`
- Modify: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/scheduler/runner.py`
- Modify: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/gateway/routers/scheduler.py`
- Test: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/tests/test_scheduler_evolution_mode.py`

### Step 1: 写失败测试（当前不支持 mode=evolution，且会被当作用户任务暴露）

Create `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/tests/test_scheduler_evolution_mode.py`:
```python
from __future__ import annotations

import time
from datetime import UTC, datetime
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.config.paths import Paths
from src.gateway.routers.scheduler import router
from src.scheduler.models import ScheduledTask, TriggerConfig, TriggerType
from src.scheduler.service import get_scheduler, shutdown_scheduler


class _StubEvolutionService:
    async def run(self, agent_name: str = "_default"):
        from src.evolution.models import EvolutionReport, ReportStatus
        return EvolutionReport(
            status=ReportStatus.COMPLETED,
            duration_seconds=0,
            summary="ok",
        )


def _make_app() -> FastAPI:
    app = FastAPI()
    app.include_router(router)
    return app


def test_scheduler_filters_out_evolution_system_tasks(tmp_path):
    app = _make_app()
    paths = Paths(base_dir=tmp_path)

    with patch("src.scheduler.store.get_paths", return_value=paths):
        with patch("src.evolution.service.get_evolution_service", return_value=_StubEvolutionService()):
            with TestClient(app) as client:
                scheduler = get_scheduler()
                scheduler.start()
                try:
                    # NOTE: mode uses raw string on purpose. This should fail before implementation.
                    task = ScheduledTask.model_validate(
                        {
                            "agent_name": "agent-a",
                            "name": "evolution:agent-a:auto_trigger",
                            "description": "Evolution auto trigger",
                            "mode": "evolution",
                            "trigger": {
                                "type": "interval",
                                "interval_seconds": 3600,
                                "timezone": "UTC",
                            },
                            "steps": [],
                            "enabled": True,
                            "created_by": "evolution",
                            "timeout_seconds": 60,
                            "max_concurrent_steps": 1,
                            "created_at": datetime.now(UTC).isoformat(),
                        }
                    )

                    created = scheduler.add_task(task)
                    assert client.post(f"/api/scheduler/tasks/{created.id}/run").status_code == 202

                    # list should not expose evolution system tasks
                    tasks = client.get("/api/scheduler/tasks?agent_name=agent-a").json()
                    assert all(item["id"] != created.id for item in tasks)

                    # wait for history to be recorded and completed
                    history = []
                    for _ in range(200):
                        history = client.get(f"/api/scheduler/tasks/{created.id}/history").json()
                        if history:
                            break
                        time.sleep(0.02)
                    assert history
                    assert history[0]["status"] == "completed"
                finally:
                    shutdown_scheduler()
```

### Step 2: 运行确认失败

Run:
```bash
cd /Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend
uv run pytest -q tests/test_scheduler_evolution_mode.py
```

Expected:
- FAIL
- 失败点包含 `Input should be 'workflow', 'reminder' or 'heartbeat'`（TaskMode 不支持 evolution）或执行分支不支持

### Step 3: 最小实现（新增 enum + 校验 + runner 执行分支 + router 过滤系统任务）

Modify `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/scheduler/models.py`：
- 在 `TaskMode` 增加一项：
```python
class TaskMode(str, Enum):
    WORKFLOW = "workflow"
    REMINDER = "reminder"
    HEARTBEAT = "heartbeat"
    EVOLUTION = "evolution"
```
- 在 `ScheduledTask.validate_mode()` 增加：
```python
if self.mode == TaskMode.EVOLUTION:
    if self.steps:
        raise ValueError("steps must be empty for evolution mode")
```

Modify `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/scheduler/runner.py`：
- 将 `_should_emit_task_event()` 扩展为识别系统任务：
```python
def _should_emit_task_event(self, task: ScheduledTask | None) -> bool:
    if task is None:
        return False
    return task.mode not in {TaskMode.HEARTBEAT, TaskMode.EVOLUTION}
```
- 在 `_execute_workflow()` 增加 `TaskMode.EVOLUTION` 分支（与 heartbeat 同级）：
```python
if task.mode == TaskMode.EVOLUTION:
    from src.evolution.service import get_evolution_service

    report = asyncio.run(
        asyncio.wait_for(
            get_evolution_service().run(task.agent_name),
            timeout=task.timeout_seconds,
        )
    )
    payload = report.model_dump(mode="json") if hasattr(report, "model_dump") else report
    return {
        "success": True,
        "mode": task.mode.value,
        "evolution": payload,
        "trace_id": trace_id,
        "triggered_at": datetime.now(UTC).isoformat(),
    }
```

Modify `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/gateway/routers/scheduler.py`：
- 将 `_is_system_task()` 改为基于 mode 判断（保留旧前缀兼容）：
```python
def _is_system_task(task: ScheduledTask) -> bool:
    return task.mode in {TaskMode.HEARTBEAT, TaskMode.EVOLUTION} or task.name.startswith("heartbeat:")
```

### Step 4: 运行测试确认通过

Run:
```bash
cd /Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend
uv run pytest -q tests/test_scheduler_evolution_mode.py
```

Expected:
- PASS

### Step 5: Commit

Run:
```bash
cd /Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent.wt/evolution-heartbeat-closure-fix
git add backend/src/scheduler/models.py backend/src/scheduler/runner.py backend/src/gateway/routers/scheduler.py backend/tests/test_scheduler_evolution_mode.py
git commit -m "feat(scheduler): 支持 evolution 系统任务并从用户列表过滤" \
  -m "目的: 为 Evolution 自动触发提供统一执行底座（复用现有 scheduler），且不污染用户任务视图/指标。" \
  -m "改动: 新增 TaskMode.EVOLUTION；runner 支持执行 evolution；scheduler router 将 heartbeat/evolution 视为系统任务过滤。" \
  -m "验证: uv run pytest -q tests/test_scheduler_evolution_mode.py" \
  -m "回滚: git revert 本提交即可撤销 EVOLUTION mode 支持。"
```

---

## Task 3: 实现 Evolution “自动触发分析”闭环（开启后先跑一次）

**Files:**
- Modify: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/evolution/service.py`
- Modify: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/evolution/models.py`
- Test: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/tests/test_evolution_auto_trigger.py`

### Step 1: 写失败测试（update_settings 目前只写文件，不会创建系统任务，更不会触发一次 run）

Create `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/tests/test_evolution_auto_trigger.py`:
```python
from __future__ import annotations

import time
from unittest.mock import patch

from src.config.paths import Paths
from src.evolution.models import EvolutionSettings
from src.evolution.service import EvolutionService
from src.scheduler.service import get_scheduler, shutdown_scheduler
from src.scheduler import store as scheduler_store


class _StubEvolutionService:
    async def run(self, agent_name: str = "_default"):
        from src.evolution.models import EvolutionReport, ReportStatus
        return EvolutionReport(status=ReportStatus.COMPLETED, duration_seconds=0, summary="ok")


def test_evolution_auto_trigger_creates_system_task_and_runs_once(tmp_path):
    paths = Paths(base_dir=tmp_path)

    with patch("src.scheduler.store.get_paths", return_value=paths):
        with patch("src.evolution.store.get_paths", return_value=paths):
            with patch("src.evolution.service.get_evolution_service", return_value=_StubEvolutionService()):
                scheduler = get_scheduler()
                scheduler.start()
                try:
                    service = EvolutionService()

                    settings = EvolutionSettings(enabled=True, interval_hours=24, auto_trigger=True)
                    service.update_settings(settings, agent_name="agent-a")

                    tasks = scheduler.list_tasks()
                    evo_tasks = [t for t in tasks if t.name == "evolution:agent-a:auto_trigger"]
                    assert len(evo_tasks) == 1
                    evo_task = evo_tasks[0]
                    assert evo_task.mode.value == "evolution"

                    history = []
                    for _ in range(200):
                        history = scheduler_store.load_history().get(evo_task.id, [])
                        if history:
                            break
                        time.sleep(0.02)
                    assert history
                    assert history[0].status.value == "completed"
                    assert history[0].success is True
                finally:
                    shutdown_scheduler()
```

### Step 2: 运行确认失败

Run:
```bash
cd /Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend
uv run pytest -q tests/test_evolution_auto_trigger.py
```

Expected:
- FAIL
- evo system task 不存在或 history 为空

### Step 3: 最小实现（在 update_settings 内创建/更新/删除系统任务，并在开启时 run_task_now）

Modify `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/evolution/models.py`（加约束，避免无效 interval）：
```python
from pydantic import BaseModel, Field

class EvolutionSettings(BaseModel):
    enabled: bool = True
    interval_hours: int = Field(default=24, ge=1, le=168)
    auto_trigger: bool = False
```

Modify `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/evolution/service.py`（核心逻辑）：
- 在 `update_settings()` 中：
- 先读取 `current = load_settings(agent_name)` 作为差分基线
- `save_settings(settings, agent_name)`
- `scheduler = get_scheduler(); scheduler.start()`
- 任务名固定为 `evolution:{agent_name}:auto_trigger`
- 若 `not settings.enabled or not settings.auto_trigger`：
  - 若系统任务存在则 `scheduler.remove_task(task.id)` 幂等移除
- 若开启：
  - 构造 `TriggerConfig(type=INTERVAL, interval_seconds=settings.interval_hours*3600, timezone="UTC")`
  - 若存在则 `scheduler.update_task(...)` 更新 trigger
  - 若此前 `current.auto_trigger` 为 False 或 `current.enabled` 为 False，则 `scheduler.run_task_now(task.id)` 立即跑一次

### Step 4: 运行测试确认通过

Run:
```bash
cd /Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend
uv run pytest -q tests/test_evolution_auto_trigger.py
```

Expected:
- PASS

### Step 5: Commit

Run:
```bash
cd /Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent.wt/evolution-heartbeat-closure-fix
git add backend/src/evolution/models.py backend/src/evolution/service.py backend/tests/test_evolution_auto_trigger.py
git commit -m "feat(evolution): 打通自动触发分析闭环(开启后先跑一次)" \
  -m "行为: 保存 settings 时若 enabled+auto_trigger=true，创建/更新 evolution 系统任务并立即异步跑一次；关闭则移除系统任务。" \
  -m "实现: 复用 scheduler TaskMode.EVOLUTION，不对用户任务列表暴露。" \
  -m "验证: uv run pytest -q tests/test_evolution_auto_trigger.py" \
  -m "回滚: git revert 本提交；并删除已创建的 evolution 系统任务记录。"
```

---

## Task 4: 前端 Evolution 报告可读性修复（priority 映射 + failed 显示 error_message）

**Files:**
- Modify: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/frontend/src/components/workspace/agents/settings/evolution-reports.tsx`

### Step 1: 写最小修改（兼容后端 priority=high/medium/low，failed 状态展示 error_message）
- `priorityClass()` 与 `priorityLabel()` 改为识别小写 `high|medium|low`
- 报告列表渲染中：
  - 若 `report.status === "failed"` 且 `report.error_message` 存在，显示一行 `错误信息: ...`（复用 `copy.error` 文案）

### Step 2: Typecheck

Run:
```bash
cd /Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent
pnpm --dir frontend typecheck
```

Expected:
- 0 errors

### Step 3: Commit

Run:
```bash
cd /Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent.wt/evolution-heartbeat-closure-fix
git add frontend/src/components/workspace/agents/settings/evolution-reports.tsx
git commit -m "fix(frontend): Evolution 报告/建议优先级映射与失败原因展示" \
  -m "问题: 后端 priority 为 low/medium/high，但前端按 HIGH/MEDIUM/LOW 判断导致样式与文案失效；failed 报告不展示 error_message 难排障。" \
  -m "改动: 统一 priority 映射为小写；failed 报告列表展示 error_message。" \
  -m "验证: pnpm --dir frontend typecheck" \
  -m "回滚: git revert 本提交。"
```

---

## Task 5: Heartbeat “可感知”改造（状态 + 手动执行）

**Files:**
- Modify: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/gateway/routers/heartbeat.py`
- Modify: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/heartbeat/service.py`
- Modify: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/frontend/src/core/agents/heartbeat-api.ts`
- Modify: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/frontend/src/core/agents/heartbeat-hooks.ts`
- Modify: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/frontend/src/components/workspace/agents/settings/heartbeat-settings.tsx`
- Modify: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/frontend/src/core/i18n/locales/zh-CN.ts`
- Modify: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/frontend/src/core/i18n/locales/en-US.ts`
- Modify: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/frontend/src/core/i18n/locales/types.ts`

### Step 1: 后端修复 execute 返回字段语义，并让“未 bootstrap 也能执行”更鲁棒
- `/api/heartbeat/execute/{template_id}` 返回从 `{"task_id": ...}` 改为 `{"run_id": ...}`（因为 service 返回的是 scheduler run_id）
- `HeartbeatService.execute_heartbeat()`：若找不到对应任务，先 `bootstrap(agent_name)` 再查一次；仍找不到再报错

### Step 2: 前端补齐 API + hooks
- `heartbeat-api.ts` 新增：
  - `getHeartbeatStatus(agentName)`（GET `/api/heartbeat/status`）
  - `getHeartbeatTemplates()`（GET `/api/heartbeat/templates`）
  - `executeHeartbeat(agentName, templateId)`（POST `/api/heartbeat/execute/{templateId}`）
- `heartbeat-hooks.ts` 新增：
  - `useHeartbeatStatus(agentName)`
  - `useHeartbeatTemplates()`
  - `useExecuteHeartbeat(agentName)`（执行后 invalidate status/logs，并 toast 提示）

### Step 3: HeartbeatSettingsComponent 增加“心跳状态”卡片
- 列表展示：
  - 模板名（优先用 templates endpoint 的 `name`，fallback 为 template_id）
  - `next_run`（来自 status.next_runs）
  - “立即执行一次”按钮（调用 execute）
- 禁用规则：
  - 全局 heartbeat `enabled=false` 时禁用所有执行按钮
  - mutation pending 时禁用当前按钮

### Step 4: i18n 补齐最小文案
- 在 `t.agents.settings.heartbeat` 下增加：
  - `statusTitle`
  - `nextRunLabel`
  - `runNowLabel`
  - `runningLabel`
- 在 `t.agents.settings.toasts` 下增加：
  - `heartbeatRunTriggered`

### Step 5: Typecheck

Run:
```bash
cd /Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent
pnpm --dir frontend typecheck
```

Expected:
- 0 errors

### Step 6: Commit

Run:
```bash
cd /Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent.wt/evolution-heartbeat-closure-fix
git add backend/src/gateway/routers/heartbeat.py backend/src/heartbeat/service.py \
  frontend/src/core/agents/heartbeat-api.ts frontend/src/core/agents/heartbeat-hooks.ts \
  frontend/src/components/workspace/agents/settings/heartbeat-settings.tsx \
  frontend/src/core/i18n/locales/zh-CN.ts frontend/src/core/i18n/locales/en-US.ts frontend/src/core/i18n/locales/types.ts
git commit -m "feat(heartbeat): 增加状态与手动执行入口，提升可感知性" \
  -m "目标: 让用户能看到每个心跳模板的下次运行，并可手动触发一次以验证心跳链路。" \
  -m "改动: 后端 execute 返回 run_id 且缺任务时自动 bootstrap；前端增加 status/templates/execute API 与状态卡片；补齐 i18n。" \
  -m "验证: pnpm --dir frontend typecheck" \
  -m "回滚: git revert 本提交；必要时清理已落盘的 heartbeat logs。"
```

---

## Task 6: 删除智能体定时任务页头“时区设置”按钮（保留时区 Badge 与编辑器内跳转）

**Files:**
- Modify: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/frontend/src/components/workspace/agents/settings/scheduler-settings.tsx`
- Modify: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/frontend/src/core/i18n/locales/zh-CN.ts`
- Modify: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/frontend/src/core/i18n/locales/en-US.ts`
- Modify: `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/frontend/src/core/i18n/locales/types.ts`

### Step 1: 删除页头按钮
- 在 SchedulerSettingsPanel header 中移除：
  - `<Button asChild variant="outline">` 指向 `timezoneSettingsHref`
- 保持：
  - `Timezone: {timezone}` Badge
  - 编辑器表单中的 `timezoneAction` 链接（“去修改/Edit”）

### Step 2: i18n 清理
- 删除 scheduler settings 的 `heartbeatLink` 键（仅用于页头按钮）
- 同步删除 locales/types 对应字段，确保类型不漂移

### Step 3: Typecheck

Run:
```bash
cd /Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent
pnpm --dir frontend typecheck
```

Expected:
- 0 errors

### Step 4: Commit

Run:
```bash
cd /Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent.wt/evolution-heartbeat-closure-fix
git add frontend/src/components/workspace/agents/settings/scheduler-settings.tsx \
  frontend/src/core/i18n/locales/zh-CN.ts frontend/src/core/i18n/locales/en-US.ts frontend/src/core/i18n/locales/types.ts
git commit -m "fix(scheduler-ui): 删除定时任务页头时区设置按钮" \
  -m "决策: 仅删除页头按钮；保留时区 Badge 与编辑器内“去修改”跳转，避免信息架构重复入口。" \
  -m "验证: pnpm --dir frontend typecheck" \
  -m "回滚: git revert 本提交。"
```

---

## Task 7: 手工验收（真实闭环验证）

**Files:**
- None (manual verification)

### Step 1: 后端启动后验收 Evolution
- 在 UI 中：
  - 打开智能体设置 -> 自我进化 -> 点击“立即分析一次”
  - 期望：报告列表出现 `completed`，不再 0s failed；若失败，报告列表能直接看到 error_message

### Step 2: 验收 Evolution 自动触发
- 开启“自动触发分析”并保存
- 期望：保存后很快出现一条新报告（开启后先跑一次）
- 观察后端 `~/.nion/scheduler/tasks.json`：
  - 存在 `name=evolution:<agent>:auto_trigger` 系统任务
  - 不应出现在前端定时任务列表

### Step 3: 验收 Heartbeat 可感知
- 打开心跳设置页
- 期望：能看到每个模板 `next_run`，点击“立即执行一次”后日志页能看到记录（成功或失败均应落盘）

---

## Execution Handoff

计划完成后保存到：
- `/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/docs/plans/2026-03-16-evolution-heartbeat-closure-fix.md`

两种执行方式：

1. Subagent-Driven（同一会话）
- REQUIRED SUB-SKILL: superpowers:subagent-driven-development

2. Parallel Session（新会话，按任务逐条执行）
- REQUIRED SUB-SKILL: superpowers:executing-plans

