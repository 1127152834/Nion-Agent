# DEV3：基础设施与安全重构方案

> **分支**：`arch/dev3-infra-security`
> **职责范围**：认证鉴权、安全加固、Agent 系统、Channel 系统、可观测性、部署
> **独占目录**：`backend/src/agents/`, `backend/src/channels/`, `backend/src/sandbox/`, `backend/src/mcp/`, `backend/src/tools/`, `backend/src/models/`, `desktop/`, 项目根目录配置
> **禁止触碰**：`frontend/src/components/`, `backend/src/gateway/routers/`（DEV1 负责）

---

## Phase 0：紧急安全修复（Day 1 必须完成）

### Task 0.1：添加上传文件大小限制

**严重度:** CRITICAL — `await file.read()` 将整个文件读入内存，无大小限制

**Files:**
- Modify: `backend/src/gateway/routers/uploads.py`

```python
MAX_UPLOAD_SIZE = 100 * 1024 * 1024  # 100 MB

@router.post("/api/threads/{thread_id}/uploads")
async def upload_files(thread_id: str, files: list[UploadFile] = File(...)):
    for file in files:
        # 检查 Content-Length（如果有）
        if file.size and file.size > MAX_UPLOAD_SIZE:
            raise HTTPException(413, f"File {file.filename} exceeds {MAX_UPLOAD_SIZE // 1024 // 1024}MB limit")

        # 流式读取并检查实际大小
        chunks = []
        total = 0
        while chunk := await file.read(8192):
            total += len(chunk)
            if total > MAX_UPLOAD_SIZE:
                raise HTTPException(413, f"File {file.filename} exceeds size limit")
            chunks.append(chunk)
        content = b"".join(chunks)
        # ... 继续处理
```

- [ ] Step 1: 添加大小限制和流式读取
- [ ] Step 2: 添加文件类型白名单（允许：txt, md, pdf, pptx, xlsx, docx, csv, json, yaml, py, ts, js, png, jpg, gif, svg, zip）
- [ ] Step 3: 编写测试（超大文件被拒绝、非法类型被拒绝）
- [ ] Step 4: Commit

### Task 0.2：修复 Electron IPC 路径遍历

**严重度:** CRITICAL — `desktop:host-fs:read/write` 接受任意路径，可读写系统任何文件

**Files:**
- Modify: `desktop/electron/src/main.ts`

```typescript
// 添加路径白名单验证
function isPathAllowed(targetPath: string): boolean {
  const resolved = path.resolve(targetPath);
  // 只允许在工作区目录内操作
  const allowedRoots = [
    nionHome,  // .nion/ 数据目录
    // 可以添加用户选择的工作区根目录
  ];
  return allowedRoots.some(root => resolved.startsWith(root));
}

// 在 host-fs:read 和 host-fs:write handler 中：
if (!isPathAllowed(targetPath)) {
  throw new Error(`Access denied: ${targetPath} is outside allowed directories`);
}
```

- [ ] Step 1: 实现路径白名单验证函数
- [ ] Step 2: 在所有文件系统 IPC handler 中添加验证
- [ ] Step 3: 修复 `shell.openExternal` 添加 URL scheme 白名单（仅 http/https）
- [ ] Step 4: Commit

### Task 0.3：修复 HTML artifact XSS

**Files:**
- Modify: `backend/src/gateway/routers/artifacts.py`

```python
# 不再直接渲染 HTML，改为强制下载或 sandbox iframe
if mime_type == "text/html":
    # 选项 1: 强制下载
    return FileResponse(actual_path, media_type="application/octet-stream",
                       headers={"Content-Disposition": f"attachment; filename={path}"})
    # 选项 2: 添加 CSP 头禁止脚本执行
    return HTMLResponse(content, headers={
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:;"
    })
```

- [ ] Step 1: 为 HTML artifact 添加 CSP 头或强制下载
- [ ] Step 2: 编写安全测试（包含 `<script>` 标签的 HTML 被阻止执行）
- [ ] Step 3: Commit

---

## Phase 1：API Key 认证 + 安全审计修复

### Task 1.1：实现 API Key 认证中间件

**Files:**
- Create: `backend/src/gateway/middleware/__init__.py`
- Create: `backend/src/gateway/middleware/auth.py`
- Modify: `backend/src/gateway/app.py`（注册中间件）
- Modify: `backend/src/gateway/config.py`（添加 auth 配置）

```python
# backend/src/gateway/middleware/auth.py
"""API Key authentication middleware."""
from __future__ import annotations

import hashlib
import hmac
import logging
from typing import Callable

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

logger = logging.getLogger(__name__)

# 不需要认证的端点
PUBLIC_PATHS = frozenset({
    "/health",
    "/docs",
    "/openapi.json",
})

PUBLIC_PREFIXES = (
    "/api/config",  # GET only, see below
)


class ApiKeyAuthMiddleware(BaseHTTPMiddleware):
    """验证请求头中的 API Key。"""

    def __init__(self, app, api_keys: list[str] | None = None):
        super().__init__(app)
        # 存储 key 的 hash 而非明文
        self._key_hashes: set[str] = set()
        if api_keys:
            for key in api_keys:
                self._key_hashes.add(hashlib.sha256(key.encode()).hexdigest())
        self._enabled = bool(self._key_hashes)

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        if not self._enabled:
            return await call_next(request)

        path = request.url.path

        # Public endpoints
        if path in PUBLIC_PATHS:
            return await call_next(request)
        for prefix in PUBLIC_PREFIXES:
            if path.startswith(prefix) and request.method == "GET":
                return await call_next(request)

        # Check API key
        api_key = request.headers.get("X-API-Key") or request.query_params.get("api_key")
        if not api_key:
            return JSONResponse(
                status_code=401,
                content={"error": {"code": "UNAUTHORIZED", "message": "API key required"}},
            )

        key_hash = hashlib.sha256(api_key.encode()).hexdigest()
        if key_hash not in self._key_hashes:
            logger.warning("Invalid API key attempt from %s", request.client.host if request.client else "unknown")
            return JSONResponse(
                status_code=401,
                content={"error": {"code": "UNAUTHORIZED", "message": "Invalid API key"}},
            )

        return await call_next(request)
```

**配置扩展：**
```yaml
# config.yaml 新增
gateway:
  api_keys:
    - $NION_API_KEY      # 支持环境变量
  cors_origins:
    - "http://localhost:3000"
```

- [ ] Step 1: 创建 middleware/ 目录和 auth.py
- [ ] Step 2: 修改 gateway config 添加 api_keys 配置
- [ ] Step 3: 在 app.py 中注册中间件（在 CORS 之后）
- [ ] Step 4: 编写测试（有 key 通过、无 key 拒绝、错误 key 拒绝、公开端点放行）
- [ ] Step 5: Commit

### Task 1.2：CORS 安全收紧

**Files:**
- Modify: `backend/src/gateway/app.py`
- Modify: `backend/src/gateway/config.py`

当前 CORS 配置 `allow_origins=["*"]`（通过 gateway_config），且有 `allow_origin_regex` 匹配所有 localhost。
生产环境应收紧：

```python
# 开发环境保持宽松
if os.getenv("NION_ENV", "development") == "production":
    cors_origins = gateway_config.cors_origins  # 仅允许配置的域名
else:
    cors_origins = ["*"]  # 开发环境允许所有
```

- [ ] Step 1: 修改 CORS 配置支持环境区分
- [ ] Step 2: Commit

### Task 1.3：路径遍历安全审计

**Files:**
- Modify: `backend/src/sandbox/tools.py`（检查路径注入）
- Modify: `backend/src/gateway/routers/uploads.py`（检查文件名注入）

**审计清单：**
```python
# 检查所有文件操作是否有路径遍历防护
# 1. uploads.py — 文件名应 sanitize，不允许 ../
# 2. artifacts router — 路径参数应验证在允许范围内
# 3. sandbox tools — 虚拟路径转换后应验证在 sandbox 目录内
```

对每个文件操作添加路径验证：
```python
def _sanitize_filename(filename: str) -> str:
    """移除路径遍历字符。"""
    # 只保留文件名部分
    name = Path(filename).name
    # 拒绝隐藏文件
    if name.startswith("."):
        raise ValueError(f"Invalid filename: {name}")
    return name

def _validate_path_within(path: Path, root: Path) -> Path:
    """确保解析后的路径在根目录内。"""
    resolved = path.resolve()
    if not resolved.is_relative_to(root.resolve()):
        raise ValueError(f"Path traversal detected: {path}")
    return resolved
```

- [ ] Step 1: 审计 uploads.py 的文件名处理
- [ ] Step 2: 审计 artifacts router 的路径参数
- [ ] Step 3: 审计 sandbox tools 的路径转换
- [ ] Step 4: 添加路径验证函数
- [ ] Step 5: 编写安全测试（包含 `../` 攻击向量）
- [ ] Step 6: Commit

---

## Phase 2：Channel 系统拆分 + 可观测性

### Task 2.1：拆分 bridge_service.py（3345 行）

**当前结构分析：**
- `_ThreadWorkspaceBindingRepository`（~100 行）— 线程工作区绑定
- `ChannelAgentBridgeService`（~2500 行）— 核心桥接逻辑
- 大量内联辅助方法

**拆分计划：**

**Files:**
- Create: `backend/src/channels/bridge/__init__.py`
- Create: `backend/src/channels/bridge/thread_bindings.py`（线程绑定管理）
- Create: `backend/src/channels/bridge/message_adapter.py`（消息格式转换）
- Create: `backend/src/channels/bridge/stream_handler.py`（流式响应处理）
- Create: `backend/src/channels/bridge/service.py`（精简后的核心服务）
- Delete: `backend/src/channels/bridge_service.py`

- [ ] Step 1: 读取 bridge_service.py，标记逻辑边界
- [ ] Step 2: 提取 ThreadWorkspaceBindingRepository → thread_bindings.py
- [ ] Step 3: 提取消息转换逻辑 → message_adapter.py
- [ ] Step 4: 提取流式处理逻辑 → stream_handler.py
- [ ] Step 5: 精简核心 service → service.py
- [ ] Step 6: 创建 __init__.py 导出兼容接口
- [ ] Step 7: 更新所有 import
- [ ] Step 8: 运行测试
- [ ] Step 9: Commit

### Task 2.2：拆分 openviking_runtime.py（2214 行）

**Files:**
- Create: `backend/src/agents/memory/openviking/__init__.py`
- Create: `backend/src/agents/memory/openviking/client.py`（HTTP 客户端）
- Create: `backend/src/agents/memory/openviking/indexer.py`（索引管理）
- Create: `backend/src/agents/memory/openviking/query.py`（查询逻辑）
- Create: `backend/src/agents/memory/openviking/session.py`（会话管理）
- Delete: `backend/src/agents/memory/openviking_runtime.py`

- [ ] Step 1-9: 同 bridge_service 模式

### Task 2.3：添加结构化日志

**Files:**
- Create: `backend/src/observability/__init__.py`
- Create: `backend/src/observability/logging.py`
- Modify: `backend/src/gateway/app.py`（使用新日志配置）

```python
# backend/src/observability/logging.py
import logging
import json
import sys
from datetime import datetime, UTC


class StructuredFormatter(logging.Formatter):
    """JSON 结构化日志格式。"""

    def format(self, record: logging.LogRecord) -> str:
        log_entry = {
            "timestamp": datetime.now(UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        if record.exc_info and record.exc_info[1]:
            log_entry["exception"] = str(record.exc_info[1])
        # 附加上下文
        for key in ("thread_id", "agent_name", "request_id"):
            if hasattr(record, key):
                log_entry[key] = getattr(record, key)
        return json.dumps(log_entry, ensure_ascii=False)


def configure_logging(level: str = "INFO", structured: bool = False):
    """配置全局日志。"""
    root = logging.getLogger()
    root.setLevel(getattr(logging, level.upper(), logging.INFO))

    handler = logging.StreamHandler(sys.stdout)
    if structured:
        handler.setFormatter(StructuredFormatter())
    else:
        handler.setFormatter(logging.Formatter(
            "%(asctime)s - %(name)s - %(levelname)s - %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        ))
    root.handlers = [handler]
```

- [ ] Step 1: 创建 observability/ 模块
- [ ] Step 2: 替换 app.py 中的 basicConfig 为 configure_logging
- [ ] Step 3: 添加 request_id 中间件（给每个请求分配唯一 ID）
- [ ] Step 4: Commit

### Task 2.4：请求追踪中间件

**Files:**
- Create: `backend/src/gateway/middleware/request_id.py`

```python
import uuid
from starlette.middleware.base import BaseHTTPMiddleware

class RequestIdMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        request_id = request.headers.get("X-Request-ID", str(uuid.uuid4()))
        request.state.request_id = request_id
        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        return response
```

- [ ] Step 1: 创建中间件
- [ ] Step 2: 在 app.py 注册
- [ ] Step 3: Commit

---

## Phase 3：性能基准 + Electron 优化 + 部署

### Task 3.1：Gateway 性能基准测试

**Files:**
- Create: `backend/tests/benchmark/test_gateway_perf.py`

使用 `pytest-benchmark` 测量关键端点延迟：

```python
import pytest
from httpx import AsyncClient, ASGITransport
from src.gateway.app import create_app

@pytest.fixture
def app():
    return create_app()

@pytest.mark.asyncio
async def test_list_models_latency(app, benchmark):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        result = benchmark.pedantic(
            lambda: client.get("/api/models"),
            rounds=100,
        )
        assert result.status_code == 200
```

- [ ] Step 1: 安装 pytest-benchmark
- [ ] Step 2: 编写 5 个关键端点的基准测试
- [ ] Step 3: 建立性能基线文档
- [ ] Step 4: Commit

### Task 3.2：Electron 安全加固

**Files:**
- Modify: `desktop/electron/src/main.ts`

**审计清单：**
- [ ] 检查 `nodeIntegration` 是否为 false
- [ ] 检查 `contextIsolation` 是否为 true
- [ ] 检查 IPC channel 是否有输入验证
- [ ] 检查是否有 `shell.openExternal` 的 URL 白名单
- [ ] Commit

### Task 3.3：创建 Docker Compose 生产配置

**Files:**
- Create: `docker-compose.prod.yml`
- Create: `backend/Dockerfile.prod`
- Create: `frontend/Dockerfile.prod`

```yaml
# docker-compose.prod.yml
services:
  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile.prod
    environment:
      - NION_ENV=production
      - NION_API_KEY=${NION_API_KEY}
    ports:
      - "8001:8001"
    volumes:
      - nion-data:/app/.nion

  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile.prod
    ports:
      - "3000:3000"
    environment:
      - NEXT_PUBLIC_BACKEND_BASE_URL=http://backend:8001

  nginx:
    image: nginx:alpine
    ports:
      - "2026:80"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
    depends_on:
      - backend
      - frontend

volumes:
  nion-data:
```

- [ ] Step 1: 创建 Dockerfile.prod（多阶段构建）
- [ ] Step 2: 创建 docker-compose.prod.yml
- [ ] Step 3: 测试 `docker compose -f docker-compose.prod.yml up`
- [ ] Step 4: Commit

### Task 3.4：Agent 中间件链可观测性

**Files:**
- Modify: `backend/src/agents/lead_agent/agent.py`

为中间件链添加执行耗时日志：

```python
import time

async def _run_middleware_chain(middlewares, state, config):
    for mw in middlewares:
        name = type(mw).__name__
        start = time.perf_counter()
        state = await mw.process(state, config)
        elapsed = time.perf_counter() - start
        logger.debug("Middleware %s completed in %.3fs", name, elapsed)
    return state
```

- [ ] Step 1: 添加中间件链计时日志
- [ ] Step 2: 添加 Agent 请求总耗时日志
- [ ] Step 3: Commit

---

## 注意事项

1. **认证向后兼容**：API Key 认证默认关闭（`api_keys` 为空时跳过），不影响现有开发工作流
2. **CORS 不要破坏开发体验**：开发环境保持 `allow_origins=["*"]`，仅生产环境收紧
3. **bridge_service 拆分风险**：这是 Channel 系统的核心，拆分后必须确保所有 Channel 集成（微信、Slack 等）仍然正常
4. **Electron 改动需要在 macOS/Windows/Linux 上测试**
5. **Docker 配置不要影响现有 `make dev` 工作流**：生产 Docker 是独立配置
