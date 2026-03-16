# Codex 执行提示词

> 直接复制下面 `---` 之间的全部内容发给 Codex。

---

你是 Nion 项目的重构执行者。请严格按照下面的 8 个 Phase 顺序执行后端目录架构重构。每完成一个 Phase 必须运行验证命令，通过后再进入下一个 Phase。如果某个 Phase 的验证失败，先修复问题再继续。

## 背景

将 `backend/src/` 平铺结构重构为两层：
- **Harness 层** `packages/harness/nion/` — 可独立发布的 Agent 框架，import 前缀 `nion.*`
- **App 层** `app/` — 应用代码（gateway、channels 等），import 前缀 `app.*`

## 工作目录

所有操作在 `backend/` 目录下执行，除非特别说明。

## Import 映射规则（核心参考表）

**→ `nion.*`（harness 层）**:
`src.agents` → `nion.agents` | `src.cli` → `nion.cli` | `src.client` → `nion.client` | `src.community` → `nion.community` | `src.config` → `nion.config` | `src.keychain` → `nion.keychain` | `src.mcp` → `nion.mcp` | `src.models` → `nion.models` | `src.processlog` → `nion.processlog` | `src.reflection` → `nion.reflection` | `src.runtime_profile` → `nion.runtime_profile` | `src.sandbox` → `nion.sandbox` | `src.scheduler` → `nion.scheduler` | `src.skills` → `nion.skills` | `src.subagents` → `nion.subagents` | `src.tools` → `nion.tools` | `src.utils` → `nion.utils`

**→ `app.*`（app 层）**:
`src.gateway` → `app.gateway` | `src.channels` → `app.channels` | `src.heartbeat` → `app.heartbeat` | `src.evolution` → `app.evolution` | `src.embedding_models` → `app.embedding_models` | `src.retrieval_models` → `app.retrieval_models` | `src.security` → `app.security` | `src.system` → `app.system`

---

## Phase 1: 解决反向依赖

物理搬迁后 harness 层不得 import app 层。当前有 5 处违规必须先修。

### 1A: 提取 skills validation

`src/client.py:789` 导入了 `src.gateway.routers.skills._validate_skill_frontmatter`。

1. 创建 `src/skills/validation.py`，从 `src/gateway/routers/skills.py` 中提取 `_validate_skill_frontmatter` 函数（大约在第 64 行）。这个函数只依赖 pathlib、yaml、re，无 gateway 依赖。
2. 在 `src/gateway/routers/skills.py` 中删除该函数定义，改为 `from src.skills.validation import _validate_skill_frontmatter`。
3. 在 `src/client.py` 中将 `from src.gateway.routers.skills import _validate_skill_frontmatter` 改为 `from src.skills.validation import _validate_skill_frontmatter`。

### 1B: 提取 file conversion

`src/client.py:921` 导入了 `src.gateway.routers.uploads.CONVERTIBLE_EXTENSIONS` 和 `convert_file_to_markdown`。

1. 创建 `src/utils/file_conversion.py`，从 `src/gateway/routers/uploads.py` 提取 `CONVERTIBLE_EXTENSIONS`（约第 18 行）和 `convert_file_to_markdown`（约第 62 行）。它们只依赖 pathlib、logging、markitdown。
2. 在 `src/gateway/routers/uploads.py` 中删除这两者的定义，改为 `from src.utils.file_conversion import CONVERTIBLE_EXTENSIONS, convert_file_to_markdown`。
3. 在 `src/client.py` 中改用新路径。

### 1C: 提取 system_manage_tools 的 gateway 依赖

`src/tools/builtins/system_manage_tools.py` 有 3 行违规 import：
```python
from src.gateway.routers.mcp import (McpConfigUpdateRequest, McpServerConfigResponse, get_mcp_configuration, update_mcp_configuration)
from src.gateway.routers.models import ModelConnectionTestRequest, test_model_connection
from src.gateway.routers.skills import SkillInstallRequest, SkillUpdateRequest, install_skill, update_skill
```

1. 创建 `src/tools/builtins/_service_ops.py`，从对应的 3 个 router 文件中提取上述 Pydantic model 和业务逻辑函数。如果函数内部用了 `HTTPException`，替换为普通异常（ValueError/RuntimeError），由 router 层做异常转换。
2. 修改 3 个 router 文件，删除被提取的定义，改为从 `_service_ops` 导入。Router endpoint 函数改为调用 `_service_ops` 函数并在外层 try/except 捕获异常转 HTTPException。
3. 修改 `system_manage_tools.py`，将 3 行 gateway import 替换为 `from src.tools.builtins._service_ops import ...`
4. 同步修改 `src/client.py` 和 `tests/test_client.py` 中对这些 Pydantic model 的导入路径。

### 1D: 解耦 scheduler → evolution/heartbeat

`src/scheduler/runner.py` 中 `_execute_workflow` 方法有两个 lazy import（第 839 和 864 行）：
```python
from src.evolution.service import get_evolution_service
from src.heartbeat.executor import HeartbeatExecutor
```

scheduler 是 harness 层，evolution/heartbeat 是 app 层，必须解耦。

1. 创建 `src/scheduler/mode_registry.py`：
```python
"""Registry for task mode executors — app layer registers at startup."""
from __future__ import annotations
import logging
from collections.abc import Callable
from typing import Any

logger = logging.getLogger(__name__)
_mode_executors: dict[str, Callable[..., Any]] = {}

def register_mode_executor(mode: str, executor: Callable[..., Any]) -> None:
    _mode_executors[mode] = executor
    logger.info("Registered scheduler mode executor: %s", mode)

def get_mode_executor(mode: str) -> Callable[..., Any] | None:
    return _mode_executors.get(mode)
```

2. 修改 `src/scheduler/runner.py` 的 `_execute_workflow`：删除 evolution/heartbeat 的 lazy import，改为调用 `get_mode_executor(task.mode.value)`。如果返回 None，raise ValueError。

3. 在 `src/gateway/app.py` 的 `lifespan` 函数中（`startup_scheduler()` 之前），注册两个 mode executor：
   - `"evolution"` → 包含原 runner 中 evolution 执行逻辑的 async callable
   - `"heartbeat"` → 包含原 runner 中 heartbeat 执行逻辑的 async callable

   从 runner.py 中完整复制执行逻辑，保持行为一致。

### Phase 1 验证

```bash
cd backend && PYTHONPATH=. uv run pytest tests/ -v
```
全部通过后 commit：`refactor: extract shared functions from gateway routers to harness layer`

---

## Phase 2: 物理搬迁 — harness 层

```bash
cd backend
mkdir -p packages/harness/nion
git mv src/agents packages/harness/nion/agents
git mv src/cli packages/harness/nion/cli
git mv src/client.py packages/harness/nion/client.py
git mv src/community packages/harness/nion/community
git mv src/config packages/harness/nion/config
git mv src/keychain packages/harness/nion/keychain
git mv src/mcp packages/harness/nion/mcp
git mv src/models packages/harness/nion/models
git mv src/processlog packages/harness/nion/processlog
git mv src/reflection packages/harness/nion/reflection
git mv src/runtime_profile packages/harness/nion/runtime_profile
git mv src/sandbox packages/harness/nion/sandbox
git mv src/scheduler packages/harness/nion/scheduler
git mv src/skills packages/harness/nion/skills
git mv src/subagents packages/harness/nion/subagents
git mv src/tools packages/harness/nion/tools
git mv src/utils packages/harness/nion/utils
touch packages/harness/nion/__init__.py
```

**不修改任何 import**，只做物理搬迁。Commit：`refactor: move harness modules to packages/harness/nion/`

---

## Phase 3: 物理搬迁 — app 层

```bash
cd backend
mkdir -p app
git mv src/gateway app/gateway
git mv src/channels app/channels
git mv src/heartbeat app/heartbeat
git mv src/evolution app/evolution
git mv src/embedding_models app/embedding_models
git mv src/retrieval_models app/retrieval_models
git mv src/security app/security
git mv src/system app/system
git mv src/nion_cli.py app/nion_cli.py
touch app/__init__.py
rm -rf src/services src/__pycache__ src/__init__.py
rmdir src 2>/dev/null || true
```

Commit：`refactor: move app modules to app/`

---

## Phase 4: 全量 import 重命名

### 4A: harness 层（`src.*` → `nion.*`）

```bash
find backend/packages/harness -name '*.py' -exec sed -i '' 's/from src\./from nion./g; s/import src\./import nion./g' {} +
```

验证无残留：`grep -rn 'from src\.\|import src\.' backend/packages/harness --include='*.py' | grep -v __pycache__` 应为空。

### 4B: app 层

Step 1 — 先全部改为 nion.*：
```bash
find backend/app -name '*.py' -exec sed -i '' 's/from src\./from nion./g; s/import src\./import nion./g' {} +
```

Step 2 — app 内模块互引修正为 app.*：
```bash
for mod in gateway channels heartbeat evolution embedding_models retrieval_models security system; do
  find backend/app -name '*.py' -exec sed -i '' "s/from nion\.${mod}/from app.${mod}/g; s/import nion\.${mod}/import app.${mod}/g" {} +
done
```

### 4C: tests

Step 1：`find backend/tests -name '*.py' -exec sed -i '' 's/from src\./from nion./g; s/import src\./import nion./g' {} +`

Step 2 — app 层模块修正：
```bash
for mod in gateway channels heartbeat evolution embedding_models retrieval_models security system; do
  find backend/tests -name '*.py' -exec sed -i '' "s/from nion\.${mod}/from app.${mod}/g; s/import nion\.${mod}/import app.${mod}/g" {} +
done
```

Step 3 — **mock patch 路径**（关键！）：
搜索 `grep -rn 'patch(.*src\.' backend/tests --include='*.py'`，对每一处按映射规则替换。同时处理 `patch("src.` 和 `patch('src.` 两种引号。同样的规则：harness 模块名 → `nion.`，app 模块名 → `app.`。

### 4D: conftest.py

替换 `backend/tests/conftest.py` 为：
```python
"""Test configuration for the backend test suite."""
import sys
from pathlib import Path
import pytest

backend_root = Path(__file__).parent.parent
sys.path.insert(0, str(backend_root))
sys.path.insert(0, str(backend_root / "packages" / "harness"))

@pytest.fixture
def anyio_backend():
    return "asyncio"
```

### 最终验证

```bash
grep -rn 'from src\.\|import src\.' backend/ --include='*.py' | grep -v __pycache__ | grep -v docs/
```
必须为空。Commit：`refactor: rename all imports src.* → nion.*/app.*`

---

## Phase 5: 更新配置文件

逐一修改以下文件：

**`backend/langgraph.json`**:
```json
{
  "$schema": "https://langgra.ph/schema.json",
  "dependencies": [".", "./packages/harness"],
  "env": ".env",
  "graphs": { "lead_agent": "nion.agents:make_lead_agent" },
  "checkpointer": { "path": "./packages/harness/nion/agents/checkpointer/async_provider.py:make_checkpointer" }
}
```

**`backend/pyproject.toml`** — 添加：
```toml
[tool.uv.workspace]
members = ["packages/harness"]

[tool.uv.sources]
nion-harness = { workspace = true }
```
修改 `[tool.coverage.run]` 的 `source = ["nion", "app"]`。

**创建 `backend/packages/harness/pyproject.toml`**:
```toml
[project]
name = "nion-harness"
version = "0.1.0"
description = "Nion agent harness framework"
requires-python = ">=3.12"
dependencies = []

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["nion"]
```

**`backend/ruff.toml`** — 添加：
```toml
[lint.isort]
known-first-party = ["nion", "app"]
```

**`backend/Makefile`** — 修改 gateway 命令：
`uv run uvicorn app.gateway.app:app --host 0.0.0.0 --port 8001`
修改 coverage 命令：`--cov=nion --cov=app`
修改 deadcode 命令：`uv run vulture packages/harness/nion app --min-confidence 80`

**`backend/Dockerfile`** — 将 `src.gateway.app:app` 改为 `app.gateway.app:app`

**`config.example.yaml`**（项目根目录）— 将所有 `src.` 前缀改为 `nion.`：
```bash
sed -i '' 's|src\.models\.|nion.models.|g; s|src\.community\.|nion.community.|g; s|src\.sandbox\.|nion.sandbox.|g' config.example.yaml
```

**SQLite config 迁移** — 在 `packages/harness/nion/config/migration.py` 中添加 `migrate_use_paths_src_to_nion()` 函数，递归遍历 config dict，将所有 `use` 字段中的 `src.` 前缀替换为 `nion.`。在 `app/gateway/app.py` 的 lifespan 中 `get_app_config()` 之前调用此迁移。

**`docker/docker-compose-dev.yaml`** — 将 `src.gateway.app:app` 改为 `app.gateway.app:app`

**`desktop/electron/src/process-manager.ts`** — 第 360 和 369 行：`src.gateway.app:app` → `app.gateway.app:app`

**`desktop/electron/src/runtime-ports-config.ts`** — 嵌入的 Python 代码中：
- `from src.config.config_repository import ConfigRepository` → `from nion.config.config_repository import ConfigRepository`
- `from src.config.config_store import VersionConflictError` → `from nion.config.config_store import VersionConflictError`

**`.github/copilot-instructions.md`** — `src.agents:make_lead_agent` → `nion.agents:make_lead_agent`

Commit：`refactor: update all config files for harness/app paths`

---

## Phase 6: 边界检查测试

创建 `backend/tests/test_harness_boundary.py`，包含两个测试：
1. `test_harness_does_not_import_app` — AST 扫描 `packages/harness/nion/` 所有 .py 文件，断言无 `app.*` import。
2. `test_no_residual_src_imports` — AST 扫描 harness + app + tests 所有 .py 文件，断言无 `src.*` import。

Commit：`test: add harness/app boundary enforcement tests`

---

## Phase 7: 全量验证

```bash
cd backend
uv sync
PYTHONPATH=. uv run pytest tests/ -v
uv run ruff check .
```

全部通过。如果有测试失败，修复后重跑。常见问题：
- mock patch 路径仍是 `src.` → 改为 `nion.`/`app.`
- conftest sys.path 未包含 harness → 检查 Phase 4D

---

## Phase 8: 更新文档

读取并全面更新 `backend/CLAUDE.md`：
1. 目录结构树替换为新结构
2. 所有 `src/` 路径和 `src.xxx` import 引用替换为新路径
3. 命令示例同步更新

Commit：`docs: update CLAUDE.md for harness/app structure`

---

**重要约束**:
- 前端代码不动（零修改）
- `backend/tests/` 目录位置不动，只改 import
- 每个 Phase 独立 commit，方便回滚
- 如果 `uv sync` 报 workspace 错误，检查 `pyproject.toml` 的 `[tool.uv.workspace]` 和 `packages/harness/pyproject.toml` 是否正确

---
