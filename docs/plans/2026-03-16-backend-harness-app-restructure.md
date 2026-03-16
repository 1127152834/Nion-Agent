# Backend 目录架构重构：`src.*` → `nion.*` (harness) + `app.*` (app)

> **角色定义**：本文档是架构师给 Codex 的执行指令。每个 Phase 是一个独立的 Codex task，必须按序执行，每个 Phase 结束后验证通过再进入下一个。

## 术语

| 术语 | 含义 |
|------|------|
| **harness** | 可独立发布的 Agent 框架包，`packages/harness/nion/`，import 前缀 `nion.*` |
| **app** | 不发布的应用层，`backend/app/`，import 前缀 `app.*` |
| **反向依赖** | harness 层代码 import 了 app 层代码，违反分层原则 |

## 最终目标目录结构

```
backend/
├── packages/
│   └── harness/
│       ├── pyproject.toml          # nion-harness 包定义
│       └── nion/
│           ├── __init__.py
│           ├── agents/
│           ├── cli/
│           ├── client.py
│           ├── community/
│           ├── config/
│           ├── keychain/
│           ├── mcp/
│           ├── models/
│           ├── processlog/
│           ├── reflection/
│           ├── runtime_profile/
│           ├── sandbox/
│           ├── scheduler/
│           ├── skills/
│           ├── subagents/
│           ├── tools/
│           └── utils/
├── app/
│   ├── __init__.py
│   ├── gateway/
│   ├── channels/
│   ├── heartbeat/
│   ├── evolution/
│   ├── embedding_models/
│   ├── retrieval_models/
│   ├── security/
│   ├── system/
│   └── nion_cli.py
├── tests/                          # 不动位置
├── langgraph.json
├── pyproject.toml
├── ruff.toml
├── Makefile
├── Dockerfile
└── config.example.yaml
```

## Import 前缀映射规则

| 原始前缀 | 目标前缀 | 说明 |
|----------|----------|------|
| `src.agents` | `nion.agents` | harness |
| `src.cli` | `nion.cli` | harness |
| `src.client` | `nion.client` | harness |
| `src.community` | `nion.community` | harness |
| `src.config` | `nion.config` | harness |
| `src.keychain` | `nion.keychain` | harness |
| `src.mcp` | `nion.mcp` | harness |
| `src.models` | `nion.models` | harness |
| `src.processlog` | `nion.processlog` | harness |
| `src.reflection` | `nion.reflection` | harness |
| `src.runtime_profile` | `nion.runtime_profile` | harness |
| `src.sandbox` | `nion.sandbox` | harness |
| `src.scheduler` | `nion.scheduler` | harness |
| `src.skills` | `nion.skills` | harness |
| `src.subagents` | `nion.subagents` | harness |
| `src.tools` | `nion.tools` | harness |
| `src.utils` | `nion.utils` | harness |
| `src.gateway` | `app.gateway` | app |
| `src.channels` | `app.channels` | app |
| `src.heartbeat` | `app.heartbeat` | app |
| `src.evolution` | `app.evolution` | app |
| `src.embedding_models` | `app.embedding_models` | app |
| `src.retrieval_models` | `app.retrieval_models` | app |
| `src.security` | `app.security` | app |
| `src.system` | `app.system` | app |

---

## Phase 0: 预备 — 创建工作分支

**Codex 指令**:
```
创建并切换到新分支 refactor/harness-app-split。
不做任何代码变更。
```

**验证**: `git branch --show-current` 输出 `refactor/harness-app-split`

---

## Phase 1: 解决反向依赖（先于物理搬迁）

> 物理搬迁后 harness 层不得 import app 层。当前有 5 处违规，必须先解决。

### 1A: 提取 skills validation 到 harness 层

**问题**: `src/client.py:789` 导入 `src.gateway.routers.skills._validate_skill_frontmatter`

**操作**:

1. 创建 `backend/src/skills/validation.py`，从 `src/gateway/routers/skills.py:64` 提取 `_validate_skill_frontmatter` 函数（整个函数体）。这个函数只依赖标准库 `pathlib`、`yaml` 和 `re`，没有 gateway 依赖。
2. 修改 `backend/src/gateway/routers/skills.py`：删除 `_validate_skill_frontmatter` 函数定义，改为 `from src.skills.validation import _validate_skill_frontmatter`（在文件顶部加入此 import，删除原函数体）。
3. 修改 `backend/src/client.py:789`：将 `from src.gateway.routers.skills import _validate_skill_frontmatter` 改为 `from src.skills.validation import _validate_skill_frontmatter`。

**验证**: `PYTHONPATH=. python -c "from src.skills.validation import _validate_skill_frontmatter; print('OK')"`

### 1B: 提取 file conversion 到 harness 层

**问题**: `src/client.py:921` 导入 `src.gateway.routers.uploads.CONVERTIBLE_EXTENSIONS` 和 `convert_file_to_markdown`

**操作**:

1. 创建 `backend/src/utils/file_conversion.py`，从 `src/gateway/routers/uploads.py` 提取：
   - `CONVERTIBLE_EXTENSIONS` 常量（第 18 行附近）
   - `convert_file_to_markdown` 异步函数（第 62 行附近）
   - 这两者只依赖标准库 `pathlib`、`logging` 和 `markitdown`
2. 修改 `backend/src/gateway/routers/uploads.py`：删除 `CONVERTIBLE_EXTENSIONS` 和 `convert_file_to_markdown` 的定义，改为从新位置导入：`from src.utils.file_conversion import CONVERTIBLE_EXTENSIONS, convert_file_to_markdown`
3. 修改 `backend/src/client.py:921`：将 `from src.gateway.routers.uploads import CONVERTIBLE_EXTENSIONS, convert_file_to_markdown` 改为 `from src.utils.file_conversion import CONVERTIBLE_EXTENSIONS, convert_file_to_markdown`

**验证**: `PYTHONPATH=. python -c "from src.utils.file_conversion import CONVERTIBLE_EXTENSIONS; print('OK')"`

### 1C: 提取 system_manage_tools 的 gateway 依赖到 harness 层

**问题**: `src/tools/builtins/system_manage_tools.py` 导入了 3 个 gateway router 模块：

```python
from src.gateway.routers.mcp import (McpConfigUpdateRequest, McpServerConfigResponse, get_mcp_configuration, update_mcp_configuration)
from src.gateway.routers.models import ModelConnectionTestRequest, test_model_connection
from src.gateway.routers.skills import SkillInstallRequest, SkillUpdateRequest, install_skill, update_skill
```

**操作**:

1. 创建 `backend/src/tools/builtins/_service_ops.py`，把 system_manage_tools 需要的**纯业务逻辑函数和 Pydantic model** 从各 router 中提取过来。具体来说：

   **从 `gateway/routers/mcp.py` 提取**:
   - `McpConfigUpdateRequest` (Pydantic model)
   - `McpServerConfigResponse` (Pydantic model)
   - `get_mcp_configuration()` 函数（它只读取 extensions_config，不依赖 FastAPI）
   - `update_mcp_configuration()` 函数（它写入 extensions_config，不依赖 FastAPI）

   **从 `gateway/routers/models.py` 提取**:
   - `ModelConnectionTestRequest` (Pydantic model)
   - `test_model_connection()` 函数

   **从 `gateway/routers/skills.py` 提取**:
   - `SkillInstallRequest` (Pydantic model)
   - `SkillUpdateRequest` (Pydantic model)
   - `install_skill()` 函数
   - `update_skill()` 函数

   > **重要**: 仔细检查每个函数的实际依赖。如果某个函数内部依赖了 FastAPI 的 `HTTPException`，用通用 `ValueError` / `RuntimeError` 替代或让调用方处理。router 层改为薄包装：调用 `_service_ops` 函数，捕获异常转为 HTTPException。

2. 修改 `backend/src/gateway/routers/mcp.py`、`models.py`、`skills.py`：删除被提取的函数/model 定义，改为从 `src.tools.builtins._service_ops` 导入，并在 router 函数中包装调用。

3. 修改 `backend/src/tools/builtins/system_manage_tools.py`：将 3 行 gateway import 替换为 `from src.tools.builtins._service_ops import ...`

4. 修改 `backend/src/client.py` 中所有对 `src.gateway.routers.{mcp,models,skills}` 的 Pydantic model 导入，改为从 `src.tools.builtins._service_ops` 导入。同时检查 `backend/tests/test_client.py` 中的对应导入也一并修改。

**注意**: `test_client.py` 导入了这些 response model 做 Gateway Conformance 测试。提取后 router 和 `_service_ops` 共享同一个 model 类，所以 conformance 测试无需修改逻辑，只改 import 路径。

**验证**: `cd backend && PYTHONPATH=. uv run pytest tests/test_client.py -v`

### 1D: 解决 scheduler/runner → evolution/heartbeat 反向依赖

**问题**: `src/scheduler/runner.py:839` 和 `:864` 有两个 lazy import：
```python
from src.evolution.service import get_evolution_service  # line 839
from src.heartbeat.executor import HeartbeatExecutor      # line 864
```

scheduler 属于 harness 层，evolution 和 heartbeat 属于 app 层。必须打破。

**操作**:

1. 创建 `backend/src/scheduler/mode_registry.py`，实现回调注册机制：
```python
"""Registry for task mode executors.

App-layer modules (evolution, heartbeat) register their executors at startup.
Scheduler runner invokes them via this registry, avoiding direct imports.
"""
from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Any

logger = logging.getLogger(__name__)

# Key = TaskMode value (str), Value = async callable(task, trace_id) -> dict
_mode_executors: dict[str, Callable[..., Any]] = {}


def register_mode_executor(mode: str, executor: Callable[..., Any]) -> None:
    _mode_executors[mode] = executor
    logger.info("Registered scheduler mode executor: %s", mode)


def get_mode_executor(mode: str) -> Callable[..., Any] | None:
    return _mode_executors.get(mode)
```

2. 修改 `backend/src/scheduler/runner.py` 的 `_execute_workflow` 方法：
   - 删除 `from src.evolution.service import get_evolution_service` 和 `from src.heartbeat.executor import HeartbeatExecutor` 这两个 lazy import。
   - 改为调用 `from src.scheduler.mode_registry import get_mode_executor`，通过 `get_mode_executor(task.mode.value)` 获取执行器并调用。
   - 如果 executor 为 None，raise `ValueError(f"No executor registered for mode {task.mode.value}")`。

3. 在 `backend/src/gateway/app.py` 的 `lifespan` 函数中（scheduler startup 之前），添加注册逻辑：
```python
# Register app-layer mode executors for scheduler
from src.scheduler.mode_registry import register_mode_executor

async def _evolution_executor(task, trace_id):
    from src.evolution.service import get_evolution_service
    report = await asyncio.wait_for(get_evolution_service().run(task.agent_name), timeout=task.timeout_seconds)
    payload = report.model_dump(mode="json") if hasattr(report, "model_dump") else report
    return {"success": True, "mode": task.mode.value, "evolution": payload, "trace_id": trace_id}

async def _heartbeat_executor(task, trace_id):
    parts = task.name.split(":", 2)
    template_id = parts[2]
    from src.heartbeat.executor import HeartbeatExecutor
    record = await asyncio.wait_for(HeartbeatExecutor().execute(template_id, task.agent_name), timeout=task.timeout_seconds)
    payload = record.model_dump(mode="json") if hasattr(record, "model_dump") else record
    return {"success": True, "mode": task.mode.value, "heartbeat": payload, "trace_id": trace_id}

register_mode_executor("evolution", _evolution_executor)
register_mode_executor("heartbeat", _heartbeat_executor)
```

> **注意**: 从 runner.py 的 `_execute_workflow` 原始代码中复制完整的 evolution 和 heartbeat 执行逻辑到这里，确保行为一致。Runner 侧只保留调用 registry 获取 executor + asyncio.run(executor(task, trace_id)) 的逻辑。

**验证**:
- `cd backend && PYTHONPATH=. uv run pytest tests/test_scheduler_evolution_mode.py tests/test_evolution_auto_trigger.py -v`
- `PYTHONPATH=. python -c "from src.scheduler.mode_registry import register_mode_executor; print('OK')"`

### Phase 1 总验证

```bash
cd backend && PYTHONPATH=. uv run pytest tests/ -v
```

全部通过后提交：
```
git add -A && git commit -m "refactor: extract shared functions from gateway routers to harness layer

Break harness→app reverse dependencies in preparation for harness/app split:
- Extract _validate_skill_frontmatter to skills/validation.py
- Extract CONVERTIBLE_EXTENSIONS + convert_file_to_markdown to utils/file_conversion.py
- Extract MCP/models/skills service ops to tools/builtins/_service_ops.py
- Add scheduler mode_registry to decouple runner from evolution/heartbeat"
```

---

## Phase 2: 物理搬迁 — harness 层

**Codex 指令**:

```bash
cd backend

# 创建目录结构
mkdir -p packages/harness/nion

# 搬迁 17 个 harness 模块
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

# 创建 __init__.py
touch packages/harness/nion/__init__.py
```

**不要在此阶段修改 import，只做物理搬迁。**

提交：
```
git add -A && git commit -m "refactor: move harness modules to packages/harness/nion/"
```

---

## Phase 3: 物理搬迁 — app 层

**Codex 指令**:

```bash
cd backend

# 创建 app 目录
mkdir -p app

# 搬迁 9 个 app 模块
git mv src/gateway app/gateway
git mv src/channels app/channels
git mv src/heartbeat app/heartbeat
git mv src/evolution app/evolution
git mv src/embedding_models app/embedding_models
git mv src/retrieval_models app/retrieval_models
git mv src/security app/security
git mv src/system app/system
git mv src/nion_cli.py app/nion_cli.py

# 创建 __init__.py
touch app/__init__.py

# 删除空的 services 目录（只有空 __init__.py）
rm -rf src/services

# 删除残留的 src 目录（应该只剩 __init__.py 和 __pycache__）
rm -rf src/
```

提交：
```
git add -A && git commit -m "refactor: move app modules to app/"
```

---

## Phase 4: 全量 import 重命名

> 这是最大的一步。按照映射规则批量替换所有 `src.*` import。

**Codex 指令**:

### 4A: harness 层内部 import 重命名（`src.*` → `nion.*`）

**范围**: `backend/packages/harness/` 下所有 `.py` 文件

**替换规则**: 所有 `from src.` → `from nion.`，所有 `import src.` → `import nion.`

```bash
find backend/packages/harness -name '*.py' -exec sed -i '' 's/from src\./from nion./g; s/import src\./import nion./g' {} +
```

**手动检查**: 确认没有遗漏的 `src.` 引用：
```bash
grep -rn 'src\.' backend/packages/harness --include='*.py' | grep -v '__pycache__'
```
应该输出为空。

### 4B: app 层 import 重命名

**范围**: `backend/app/` 下所有 `.py` 文件

**两步走**:

**Step 1 — 把所有 `src.*` 先统一改为 `nion.*`**（因为 app 层引用 harness 的远多于 app 内互引）:
```bash
find backend/app -name '*.py' -exec sed -i '' 's/from src\./from nion./g; s/import src\./import nion./g' {} +
```

**Step 2 — 把 app 层模块的 import 从 `nion.*` 修正为 `app.*`**:
```bash
# gateway 内部互引
find backend/app -name '*.py' -exec sed -i '' \
  's/from nion\.gateway/from app.gateway/g; s/import nion\.gateway/import app.gateway/g' {} +

# channels
find backend/app -name '*.py' -exec sed -i '' \
  's/from nion\.channels/from app.channels/g; s/import nion\.channels/import app.channels/g' {} +

# heartbeat
find backend/app -name '*.py' -exec sed -i '' \
  's/from nion\.heartbeat/from app.heartbeat/g; s/import nion\.heartbeat/import app.heartbeat/g' {} +

# evolution
find backend/app -name '*.py' -exec sed -i '' \
  's/from nion\.evolution/from app.evolution/g; s/import nion\.evolution/import app.evolution/g' {} +

# embedding_models
find backend/app -name '*.py' -exec sed -i '' \
  's/from nion\.embedding_models/from app.embedding_models/g; s/import nion\.embedding_models/import app.embedding_models/g' {} +

# retrieval_models
find backend/app -name '*.py' -exec sed -i '' \
  's/from nion\.retrieval_models/from app.retrieval_models/g; s/import nion\.retrieval_models/import app.retrieval_models/g' {} +

# security
find backend/app -name '*.py' -exec sed -i '' \
  's/from nion\.security/from app.security/g; s/import nion\.security/import app.security/g' {} +

# system
find backend/app -name '*.py' -exec sed -i '' \
  's/from nion\.system/from app.system/g; s/import nion\.system/import app.system/g' {} +
```

**手动检查**: 确认 app 层没有残留的 `from src.` 或 `import src.`：
```bash
grep -rn 'from src\.\|import src\.' backend/app --include='*.py' | grep -v '__pycache__'
```

### 4C: tests import 重命名

**范围**: `backend/tests/` 下所有 `.py` 文件

**Step 1 — 先统一改为 nion.*（harness 模块）**:
```bash
find backend/tests -name '*.py' -exec sed -i '' 's/from src\./from nion./g; s/import src\./import nion./g' {} +
```

**Step 2 — 修正 app 层模块的 import**:
```bash
find backend/tests -name '*.py' -exec sed -i '' \
  's/from nion\.gateway/from app.gateway/g; s/import nion\.gateway/import app.gateway/g' {} +
find backend/tests -name '*.py' -exec sed -i '' \
  's/from nion\.channels/from app.channels/g; s/import nion\.channels/import app.channels/g' {} +
find backend/tests -name '*.py' -exec sed -i '' \
  's/from nion\.heartbeat/from app.heartbeat/g; s/import nion\.heartbeat/import app.heartbeat/g' {} +
find backend/tests -name '*.py' -exec sed -i '' \
  's/from nion\.evolution/from app.evolution/g; s/import nion\.evolution/import app.evolution/g' {} +
find backend/tests -name '*.py' -exec sed -i '' \
  's/from nion\.embedding_models/from app.embedding_models/g; s/import nion\.embedding_models/import app.embedding_models/g' {} +
find backend/tests -name '*.py' -exec sed -i '' \
  's/from nion\.retrieval_models/from app.retrieval_models/g; s/import nion\.retrieval_models/import app.retrieval_models/g' {} +
find backend/tests -name '*.py' -exec sed -i '' \
  's/from nion\.security/from app.security/g; s/import nion\.security/import app.security/g' {} +
find backend/tests -name '*.py' -exec sed -i '' \
  's/from nion\.system/from app.system/g; s/import nion\.system/import app.system/g' {} +
```

**Step 3 — 修正 tests 中 mock patch 路径**:

搜索 tests 中的 `patch("src.` 和 `patch('src.` 字符串，按上述映射规则替换。这些是 mock patch 路径，不是 import 但同样重要：
```bash
grep -rn "patch(.*src\." backend/tests --include='*.py'
```

对搜索结果中的每一处，根据模块归属替换为 `nion.` 或 `app.`。

### 4D: conftest.py 更新

修改 `backend/tests/conftest.py`：

```python
"""Test configuration for the backend test suite."""

import sys
from pathlib import Path

import pytest

# Make both `nion` (harness) and `app` importable from any working directory.
backend_root = Path(__file__).parent.parent
sys.path.insert(0, str(backend_root))
sys.path.insert(0, str(backend_root / "packages" / "harness"))


@pytest.fixture
def anyio_backend():
    return "asyncio"
```

**手动检查**: 全面扫描所有残留：
```bash
grep -rn 'from src\.\|import src\.\|"src\.' backend/ --include='*.py' | grep -v '__pycache__' | grep -v 'docs/'
```
应输出为空。

提交：
```
git add -A && git commit -m "refactor: rename all imports src.* → nion.*/app.*"
```

---

## Phase 5: 更新配置文件

### 5A: langgraph.json

**文件**: `backend/langgraph.json`

**修改为**:
```json
{
  "$schema": "https://langgra.ph/schema.json",
  "dependencies": [
    ".",
    "./packages/harness"
  ],
  "env": ".env",
  "graphs": {
    "lead_agent": "nion.agents:make_lead_agent"
  },
  "checkpointer": {
    "path": "./packages/harness/nion/agents/checkpointer/async_provider.py:make_checkpointer"
  }
}
```

### 5B: pyproject.toml（根）

**文件**: `backend/pyproject.toml`

添加 workspace 配置和更新 coverage source：

```toml
# 在 [tool.uv] section 下面添加:
[tool.uv.workspace]
members = ["packages/harness"]

[tool.uv.sources]
nion-harness = { workspace = true }

# 修改 coverage source:
[tool.coverage.run]
branch = true
source = ["nion", "app"]
omit = ["tests/*"]
```

### 5C: packages/harness/pyproject.toml（新文件）

**创建**: `backend/packages/harness/pyproject.toml`

```toml
[project]
name = "nion-harness"
version = "0.1.0"
description = "Nion agent harness framework"
requires-python = ">=3.12"
# 暂不拆分依赖，留空让根 pyproject.toml 管理
dependencies = []

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["nion"]
```

### 5D: ruff.toml

**文件**: `backend/ruff.toml`

添加 known-first-party：

```toml
line-length = 240
target-version = "py312"

[lint]
select = ["E", "F", "I", "UP"]
ignore = []

[lint.isort]
known-first-party = ["nion", "app"]

[format]
quote-style = "double"
indent-style = "space"
```

### 5E: Makefile

**文件**: `backend/Makefile`

```makefile
install:
	uv sync

dev:
	uv run langgraph dev --no-browser --allow-blocking --no-reload

gateway:
	PYTHONPATH=. uv run uvicorn app.gateway.app:app --host 0.0.0.0 --port 8001

test:
	PYTHONPATH=. uv run pytest tests/ -v

lint:
	uvx ruff check .

format:
	uvx ruff check . --fix && uvx ruff format .

coverage:
	PYTHONPATH=. uv run pytest tests/ -v --cov=nion --cov=app --cov-report=term-missing --cov-report=xml

coverage-html:
	PYTHONPATH=. uv run pytest tests/ -v --cov=nion --cov=app --cov-report=term-missing --cov-report=html

deadcode:
	uv run vulture packages/harness/nion app --min-confidence 80
```

### 5F: Dockerfile

**文件**: `backend/Dockerfile`

将第 28 行的 `src.gateway.app:app` 改为 `app.gateway.app:app`：

```dockerfile
CMD ["sh", "-c", "uv run uvicorn app.gateway.app:app --host 0.0.0.0 --port 8001"]
```

### 5G: config.example.yaml — `use` 路径

**文件**: `config.example.yaml`（在项目根目录）

将所有 `src.` 前缀替换为 `nion.`：

| 原始 | 替换为 |
|------|--------|
| `src.models.patched_deepseek:PatchedChatDeepSeek` | `nion.models.patched_deepseek:PatchedChatDeepSeek` |
| `src.community.web_search.tools:web_search_tool` | `nion.community.web_search.tools:web_search_tool` |
| `src.community.infoquest.tools:web_search_tool` | `nion.community.infoquest.tools:web_search_tool` |
| `src.community.web_fetch.tools:web_fetch_tool` | `nion.community.web_fetch.tools:web_fetch_tool` |
| `src.community.image_search.tools:image_search_tool` | `nion.community.image_search.tools:image_search_tool` |
| `src.sandbox.tools:*` | `nion.sandbox.tools:*` |
| `src.sandbox.local:LocalSandboxProvider` | `nion.sandbox.local:LocalSandboxProvider` |
| `src.community.aio_sandbox:AioSandboxProvider` | `nion.community.aio_sandbox:AioSandboxProvider` |

直接 sed：
```bash
sed -i '' 's|src\.models\.|nion.models.|g; s|src\.community\.|nion.community.|g; s|src\.sandbox\.|nion.sandbox.|g' config.example.yaml
```

### 5H: SQLite config store 中的 `use` 路径迁移

**重要**: 用户已弃用 config.yaml，改为 SQLite config store。已经写入 SQLite 的配置中 `use` 字段仍然是 `src.*` 前缀。需要添加一次性迁移。

**操作**:

在 `backend/packages/harness/nion/config/migration.py` 中（即原 `src/config/migration.py`，Phase 4 已重命名 import）添加迁移函数：

```python
def migrate_use_paths_src_to_nion() -> bool:
    """Migrate 'use' field paths from src.* to nion.* in SQLite config store.

    Called once at startup after the harness/app restructuring.
    Returns True if any changes were made.
    """
    store = create_config_store()
    try:
        data, version = store.read()
    except FileNotFoundError:
        return False

    if not isinstance(data, dict):
        return False

    changed = False

    def _migrate_use(obj):
        nonlocal changed
        if isinstance(obj, dict):
            for key, val in obj.items():
                if key == "use" and isinstance(val, str) and val.startswith("src."):
                    obj[key] = "nion." + val[4:]
                    changed = True
                else:
                    _migrate_use(val)
        elif isinstance(obj, list):
            for item in obj:
                _migrate_use(item)

    _migrate_use(data)

    if changed:
        store.write(data, expected_version=version)

    return changed
```

然后在 `app/gateway/app.py` 的 `lifespan` 中、`get_app_config()` 调用之前，调用此迁移：

```python
from nion.config.migration import migrate_use_paths_src_to_nion
try:
    if migrate_use_paths_src_to_nion():
        logger.info("Migrated config 'use' paths from src.* to nion.*")
except Exception as e:
    logger.warning("Config use-path migration failed (non-blocking): %s", e)
```

### 5I: Docker Compose

**文件**: `docker/docker-compose-dev.yaml`

第 113 行：将 `src.gateway.app:app` 改为 `app.gateway.app:app`

### 5J: Desktop Electron — process-manager.ts

**文件**: `desktop/electron/src/process-manager.ts`

第 360 行和第 369 行：将 `src.gateway.app:app` 改为 `app.gateway.app:app`

### 5K: Desktop Electron — runtime-ports-config.ts

**文件**: `desktop/electron/src/runtime-ports-config.ts`

第 32 行和第 60-61 行：嵌入的 Python 代码中有 `from src.config.config_repository import ConfigRepository` 和 `from src.config.config_store import VersionConflictError`。需要改为 `from nion.config.config_repository import ConfigRepository` 和 `from nion.config.config_store import VersionConflictError`。

**注意**: 这些是嵌入在 TypeScript 模板字面量中的 Python 代码，sed 可能不够精确，建议手动编辑。

### 5L: GitHub Copilot instructions

**文件**: `.github/copilot-instructions.md`

第 151 行：将 `src.agents:make_lead_agent` 改为 `nion.agents:make_lead_agent`

提交：
```
git add -A && git commit -m "refactor: update all config files for harness/app paths

- langgraph.json: entry points → nion.*
- pyproject.toml: add uv workspace, update coverage source
- packages/harness/pyproject.toml: new harness package definition
- ruff.toml: add known-first-party
- Makefile: update commands for new paths
- Dockerfile: app.gateway.app:app
- config.example.yaml: src.* → nion.*
- Add SQLite config use-path migration
- Docker compose: app.gateway.app:app
- Desktop electron: update embedded Python paths
- Copilot instructions: update entry point path"
```

---

## Phase 6: 添加边界检查测试

**创建**: `backend/tests/test_harness_boundary.py`

```python
"""Enforce harness→app import boundary.

The harness layer (packages/harness/nion/) must NEVER import from the app layer (app/).
This test statically scans all harness Python files to verify the boundary.
"""
import ast
from pathlib import Path

HARNESS_ROOT = Path(__file__).parent.parent / "packages" / "harness" / "nion"
BANNED_PREFIXES = ("app.",)


def test_harness_does_not_import_app():
    """Harness layer must not contain any imports from app layer."""
    violations = []
    for py_file in sorted(HARNESS_ROOT.rglob("*.py")):
        try:
            source = py_file.read_text(encoding="utf-8")
            tree = ast.parse(source)
        except (SyntaxError, UnicodeDecodeError):
            continue
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    if any(alias.name == p.rstrip(".") or alias.name.startswith(p) for p in BANNED_PREFIXES):
                        rel = py_file.relative_to(HARNESS_ROOT.parent.parent.parent)
                        violations.append(f"  {rel}:{node.lineno}  import {alias.name}")
            elif isinstance(node, ast.ImportFrom) and node.module:
                if any(node.module == p.rstrip(".") or node.module.startswith(p) for p in BANNED_PREFIXES):
                    rel = py_file.relative_to(HARNESS_ROOT.parent.parent.parent)
                    violations.append(f"  {rel}:{node.lineno}  from {node.module}")
    assert not violations, "Harness layer must not import from app layer:\n" + "\n".join(violations)


def test_no_residual_src_imports():
    """No Python file should still reference 'from src.' or 'import src.' after migration."""
    violations = []
    search_roots = [
        HARNESS_ROOT,
        Path(__file__).parent.parent / "app",
        Path(__file__).parent,  # tests/
    ]
    for root in search_roots:
        if not root.exists():
            continue
        for py_file in sorted(root.rglob("*.py")):
            try:
                source = py_file.read_text(encoding="utf-8")
                tree = ast.parse(source)
            except (SyntaxError, UnicodeDecodeError):
                continue
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    for alias in node.names:
                        if alias.name == "src" or alias.name.startswith("src."):
                            rel = py_file.relative_to(Path(__file__).parent.parent)
                            violations.append(f"  {rel}:{node.lineno}  import {alias.name}")
                elif isinstance(node, ast.ImportFrom) and node.module:
                    if node.module == "src" or node.module.startswith("src."):
                        rel = py_file.relative_to(Path(__file__).parent.parent)
                        violations.append(f"  {rel}:{node.lineno}  from {node.module}")
    assert not violations, "Residual src.* imports found:\n" + "\n".join(violations)
```

提交：
```
git add -A && git commit -m "test: add harness/app boundary enforcement tests"
```

---

## Phase 7: 全量验证

**Codex 指令**:

```bash
cd backend

# 1. 重新安装依赖（让 uv workspace 生效）
uv sync

# 2. 运行全部 92 个测试文件
PYTHONPATH=. uv run pytest tests/ -v

# 3. lint 通过
uv run ruff check .

# 4. 边界测试单独确认
PYTHONPATH=. uv run pytest tests/test_harness_boundary.py -v

# 5. 确认无残留 src.* 引用
grep -rn 'from src\.\|import src\.' . --include='*.py' | grep -v __pycache__ | grep -v docs/
```

如果有测试失败，逐个修复。常见问题：
- **mock patch 路径未更新**: `patch("src.xxx")` 需要改为 `patch("nion.xxx")` 或 `patch("app.xxx")`
- **conftest sys.path 未生效**: 确认 conftest.py 正确添加了 `packages/harness` 路径
- **gateway/routers/__init__.py 的 lazy import**: `import_module(f".{name}", package=__name__)` 会自动适配新路径，不需要改

---

## Phase 8: 更新文档

### 8A: CLAUDE.md

**文件**: `backend/CLAUDE.md`

需要更新以下部分：
1. **Project Structure** 区块：整个目录树替换为新结构
2. 所有 `src/` 路径引用替换为 `packages/harness/nion/` 或 `app/`
3. 所有 `src.xxx` import 引用替换为 `nion.xxx` 或 `app.xxx`
4. **Commands** 区块：`make gateway` 命令已更新
5. **Configuration System** 区块中 `config.yaml` 的 `use` 路径示例更新为 `nion.*`
6. **Coverage** 区块 `--cov=src` 更新为 `--cov=nion --cov=app`

> 这是一个大范围文档更新。Codex 应该先读取完整的 CLAUDE.md，然后按照新目录结构全面替换。

### 8B: 根目录 CLAUDE.md

**文件**: `CLAUDE.md`（项目根）

更新 `langgraph.json` 相关引用。

### 8C: 根目录 README.md

如果有 backend 路径引用，同步更新。

提交：
```
git add -A && git commit -m "docs: update CLAUDE.md and README.md for harness/app structure"
```

---

## 风险清单与处理策略

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| sed 批量替换误伤字符串常量（如 log message 中的 `src.`） | 低 | Phase 4 后全量 grep 检查 |
| SQLite 中存储的 `use` 路径未迁移 | 高 — 模型/工具/沙箱加载失败 | Phase 5H 添加启动时自动迁移 |
| mock patch 路径未更新 | 中 — 测试失败 | Phase 4C Step 3 专门处理 |
| `langgraph dev` 找不到 graph entry point | 高 — 服务启动失败 | Phase 5A 更新 langgraph.json |
| Desktop electron 启动失败 | 高 | Phase 5J/5K 更新嵌入路径 |
| Docker 构建失败 | 中 | Phase 5F/5I 更新 |
| `uv sync` 报 workspace 错误 | 中 | Phase 5B/5C pyproject.toml 配置 |

## 不变的部分

- **前端 API 路径**：所有 `/api/*` 路由不变，前端零修改
- **前端代码**：完全不受影响
- **测试文件位置**：`backend/tests/` 不动
- **数据目录**：`.nion/` 数据目录不变
- **LangGraph API 行为**：所有 Graph 运行行为不变

## 回滚方案

每个 Phase 都有独立 commit。如果某个 Phase 失败：
```bash
git log --oneline  # 找到最后一个正常的 commit
git revert HEAD    # 回滚最后一个失败的 commit
```

如果需要完全回滚：
```bash
git checkout main
git branch -D refactor/harness-app-split
```
