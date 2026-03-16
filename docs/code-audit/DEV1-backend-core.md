# DEV1：后端核心层重构方案

> **分支**：`arch/dev1-backend-core`
> **职责范围**：Gateway API 层、配置系统、Store 层、后端测试
> **独占目录**：`backend/src/gateway/`, `backend/src/config/`, `backend/src/heartbeat/`, `backend/src/evolution/`, `backend/src/scheduler/`, `backend/src/processlog/`, `backend/tests/`
> **禁止触碰**：`frontend/`, `desktop/`, `backend/src/agents/`, `backend/src/channels/`

---

## Phase 1：API 响应标准化 + 全局异常处理

### Task 1.1：创建统一响应 Schema

**Files:**
- Create: `backend/src/gateway/schemas/__init__.py`
- Create: `backend/src/gateway/schemas/response.py`
- Create: `backend/src/gateway/schemas/pagination.py`
- Create: `backend/src/gateway/schemas/errors.py`

```python
# backend/src/gateway/schemas/response.py
from __future__ import annotations
from typing import Any, Generic, TypeVar
from pydantic import BaseModel, Field

T = TypeVar("T")

class PaginationMeta(BaseModel):
    total: int
    limit: int
    offset: int

class ApiResponse(BaseModel, Generic[T]):
    """统一 API 成功响应。"""
    data: T
    meta: dict[str, Any] = Field(default_factory=dict)

class PaginatedResponse(BaseModel, Generic[T]):
    """分页列表响应。"""
    data: list[T]
    meta: PaginationMeta

class ApiError(BaseModel):
    """统一错误响应。"""
    code: str
    message: str
    details: dict[str, Any] = Field(default_factory=dict)

class ErrorResponse(BaseModel):
    error: ApiError
```

```python
# backend/src/gateway/schemas/errors.py
"""标准错误码常量。"""

RESOURCE_NOT_FOUND = "RESOURCE_NOT_FOUND"
VALIDATION_ERROR = "VALIDATION_ERROR"
VERSION_CONFLICT = "VERSION_CONFLICT"
INTERNAL_ERROR = "INTERNAL_ERROR"
UNAUTHORIZED = "UNAUTHORIZED"
RATE_LIMITED = "RATE_LIMITED"
```

- [ ] Step 1: 创建 schemas/ 目录和上述文件
- [ ] Step 2: 编写单元测试 `tests/test_gateway_schemas.py` 验证序列化
- [ ] Step 3: Commit

### Task 1.2：实现全局异常处理

**Files:**
- Create: `backend/src/gateway/exception_handlers.py`
- Modify: `backend/src/gateway/app.py`

```python
# backend/src/gateway/exception_handlers.py
import logging
from fastapi import Request
from fastapi.responses import JSONResponse
from pydantic import ValidationError as PydanticValidationError
from src.gateway.schemas.response import ErrorResponse, ApiError
from src.gateway.schemas.errors import *

logger = logging.getLogger(__name__)

async def generic_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled exception on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content=ErrorResponse(
            error=ApiError(code=INTERNAL_ERROR, message="Internal server error")
        ).model_dump(),
    )

async def validation_exception_handler(request: Request, exc: PydanticValidationError) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content=ErrorResponse(
            error=ApiError(
                code=VALIDATION_ERROR,
                message="Validation error",
                details={"errors": exc.errors()},
            )
        ).model_dump(),
    )

# 在 app.py 中注册:
# app.add_exception_handler(Exception, generic_exception_handler)
# app.add_exception_handler(PydanticValidationError, validation_exception_handler)
```

- [ ] Step 1: 创建 exception_handlers.py
- [ ] Step 2: 在 app.py 的 `create_app()` 中注册 handler
- [ ] Step 3: 编写测试验证异常被正确捕获
- [ ] Step 4: Commit

### Task 1.3：逐步迁移 Router 响应格式（5 个 Router）

每个 Router 独立 commit，逐步迁移返回格式：

**优先迁移清单：**
1. `models.py` — 模型管理 API
2. `skills.py` — 技能管理 API
3. `heartbeat.py` — 心跳系统 API
4. `evolution.py` — 演化系统 API
5. `agents.py` — Agent 管理 API

**迁移模式：**
```python
# Before:
@router.get("/api/models")
async def list_models():
    return {"models": [...]}

# After:
@router.get("/api/models")
async def list_models() -> ApiResponse[list[ModelResponse]]:
    models = [...]
    return ApiResponse(data=models, meta={"total": len(models)})
```

- [ ] Step 1: 迁移 models.py（最简单，先建立模式）
- [ ] Step 2: 迁移 skills.py
- [ ] Step 3: 迁移 heartbeat.py
- [ ] Step 4: 迁移 evolution.py
- [ ] Step 5: 迁移 agents.py
- [ ] Step 6: 每个 Router 迁移后运行 `make test`
- [ ] Step 7: 逐个 Commit

---

## Phase 2：Repository 层抽象 + 统一分页

### Task 2.1：创建 Repository 基类

**Files:**
- Create: `backend/src/gateway/repositories/__init__.py`
- Create: `backend/src/gateway/repositories/base.py`

```python
# backend/src/gateway/repositories/base.py
from __future__ import annotations
from abc import ABC, abstractmethod
from typing import Generic, TypeVar
from pydantic import BaseModel

T = TypeVar("T", bound=BaseModel)

class PaginationParams(BaseModel):
    offset: int = 0
    limit: int = 20
    sort_by: str | None = None
    sort_order: str = "desc"  # "asc" | "desc"

class PaginatedResult(BaseModel, Generic[T]):
    items: list[T]
    total: int
    offset: int
    limit: int
```

- [ ] Step 1: 创建 repositories/ 目录和基类
- [ ] Step 2: 编写测试
- [ ] Step 3: Commit

### Task 2.2：迁移 Heartbeat Store → Repository

**Files:**
- Create: `backend/src/gateway/repositories/heartbeat.py`
- Modify: `backend/src/gateway/routers/heartbeat.py`（使用 repository 而非直接调用 store）

当前 heartbeat router 直接调用 `HeartbeatService` → `heartbeat/store.py`（文件 JSON）。
新增 repository 层作为 router 和 store 之间的桥梁：

```python
class HeartbeatRepository:
    def __init__(self, service: HeartbeatService):
        self._service = service

    def get_logs(self, agent_name: str, params: PaginationParams) -> PaginatedResult[HeartbeatLogRecord]:
        all_logs = self._service.get_logs(agent_name)
        # 排序 + 分页
        sorted_logs = sorted(all_logs, key=lambda l: l.timestamp, reverse=params.sort_order == "desc")
        page = sorted_logs[params.offset : params.offset + params.limit]
        return PaginatedResult(items=page, total=len(all_logs), offset=params.offset, limit=params.limit)
```

- [ ] Step 1: 创建 heartbeat repository
- [ ] Step 2: 修改 heartbeat router 使用 repository
- [ ] Step 3: 为分页端点编写测试
- [ ] Step 4: Commit

### Task 2.3：迁移 Evolution Store → Repository

同 Task 2.2 模式，为 Evolution 添加 repository 层。

- [ ] Step 1-4: 同上模式

### Task 2.4：统一分页查询参数

**Files:**
- Create: `backend/src/gateway/dependencies.py`

```python
# 统一分页参数依赖
from fastapi import Query

def pagination_params(
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=20, ge=1, le=100),
    sort_by: str | None = Query(default=None),
    sort_order: str = Query(default="desc", regex="^(asc|desc)$"),
) -> PaginationParams:
    return PaginationParams(offset=offset, limit=limit, sort_by=sort_by, sort_order=sort_order)
```

- [ ] Step 1: 创建 dependencies.py
- [ ] Step 2: 在所有列表端点使用 `Depends(pagination_params)`
- [ ] Step 3: Commit

---

## Phase 3：测试覆盖 + 大文件拆分

### Task 3.1：Gateway Router 集成测试

**Files:**
- Create: `backend/tests/test_gateway_models.py`
- Create: `backend/tests/test_gateway_skills.py`
- Create: `backend/tests/test_gateway_heartbeat.py`
- Create: `backend/tests/test_gateway_evolution.py`
- Create: `backend/tests/test_gateway_agents.py`

使用 `httpx.AsyncClient` + FastAPI `TestClient`：

```python
import pytest
from httpx import AsyncClient, ASGITransport
from src.gateway.app import create_app

@pytest.fixture
def app():
    return create_app()

@pytest.fixture
async def client(app):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c

@pytest.mark.asyncio
async def test_list_models(client):
    response = await client.get("/api/models")
    assert response.status_code == 200
    body = response.json()
    assert "data" in body  # 统一响应格式验证
```

- [ ] Step 1: 为 models router 编写 5 个测试
- [ ] Step 2: 为 skills router 编写 5 个测试
- [ ] Step 3: 为 heartbeat router 编写 5 个测试
- [ ] Step 4: 为 evolution router 编写 5 个测试
- [ ] Step 5: 为 agents router 编写 8 个测试（最复杂）
- [ ] Step 6: Commit

### Task 3.2：拆分 agents.py（1027 行）

当前 `agents.py` 有 45 个函数。按资源类型拆分：

**Files:**
- Create: `backend/src/gateway/routers/agents/__init__.py`
- Create: `backend/src/gateway/routers/agents/crud.py`（Agent CRUD）
- Create: `backend/src/gateway/routers/agents/assets.py`（Soul/Identity 资产操作）
- Create: `backend/src/gateway/routers/agents/config.py`（Agent 配置）
- Create: `backend/src/gateway/routers/agents/models.py`（Pydantic models）
- Delete: `backend/src/gateway/routers/agents.py`

- [ ] Step 1-6: 同 workbench.py 拆分模式

---

## 注意事项

1. **向后兼容**：Phase 1 的响应格式迁移需要和 DEV2 同步，确保前端 `apiFetch` 能处理新格式
2. **接口契约**：`schemas/` 目录是三个开发者的共享接口，修改需通知 DEV2 和 DEV3
3. **测试隔离**：所有 Gateway 测试必须 mock 外部依赖（LangGraph Server、MCP servers），不能依赖运行中的服务
4. **迁移策略**：响应格式迁移采用渐进式，先在新端点使用新格式，旧端点逐步迁移
