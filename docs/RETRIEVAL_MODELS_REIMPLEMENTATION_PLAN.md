# Retrieval Models 系统复刻计划 - 字符串级对齐老项目

## 概述

本文档定义了如何将 Nion-Agent（新项目）的向量模型系统完全对齐 Nion_old（老项目）的 Retrieval Models 系统。

**目标**：字符串级复刻老项目的完整功能，包括：
1. 两个模型系列：Embedding + Rerank
2. 本地模型下载和管理（4个预定义模型）
3. 向量数据库集成（Memory V2）
4. 完整的测试功能
5. Provider 配置（本地、OpenAI 兼容、Rerank API）

---

## Phase 0: 现状分析

### 新项目当前实现

**Frontend API**: `frontend/src/core/embedding-models/api.ts`
- 只有 Embedding 模型
- 没有 Rerank 模型
- 没有本地模型下载功能
- 没有向量数据库

**Frontend UI**: `frontend/src/components/workspace/settings/embedding-settings-page.tsx`
- 只有 Embedding 配置界面
- 没有 Rerank 配置界面
- 没有模型管理（下载/安装/删除）

**Backend**:
- 没有 retrieval_models router
- 没有 retrieval_models service

---

## Phase 1: Backend API 层复刻

### 1.1 创建 Backend Router

**文件**: `backend/src/gateway/routers/retrieval_models.py`

**参考**: `/Users/zhangtiancheng/Documents/项目/新项目/Nion_old/backend/src/gateway/routers/retrieval_models.py`

**需要实现的端点**:
```python
# 路由定义
@router.get("/status")
async def get_status() -> RetrievalOperationResponse

@router.post("/test-embedding")
async def test_embedding(request: TestEmbeddingRequest) -> RetrievalOperationResponse

@router.post("/test-rerank")
async def test_rerank(request: TestRerankRequest) -> RetrievalOperationResponse

@router.post("/set-active-model")
async def set_active_model(request: SetActiveModelRequest) -> RetrievalOperationResponse

@router.post("/test-provider-connection")
async def test_provider_connection(request: TestProviderConnectionRequest) -> RetrievalOperationResponse
```

**数据类型定义** (在 router 文件中或新建 `models.py`):
```python
class RetrievalOperationResponse(BaseModel):
    status: Literal["ok", "degraded", "disabled"]
    latency_ms: int
    error_code: str | None = None
    result: dict[str, Any] | None = None

class TestEmbeddingRequest(BaseModel):
    text: str
    profile: str | None = None

class TestRerankRequest(BaseModel):
    query: str
    documents: list[str]
    profile: str | None = None

class SetActiveModelRequest(BaseModel):
    family: Literal["embedding", "rerank"]
    provider: Literal["local_onnx", "openai_compatible", "rerank_api"]
    model_id: str | None = None
    model: str | None = None

class TestProviderConnectionRequest(BaseModel):
    family: Literal["embedding", "rerank"]
    provider: Literal["openai_compatible", "rerank_api"]
    model: str | None = None
```

### 1.2 创建 Backend Service

**文件**: `backend/src/retrieval_models/__init__.py` 和 `service.py`

**参考**: `/Users/zhangtiancheng/Documents/项目/新项目/Nion_old/backend/src/retrieval_models/service.py`

**核心类**:
```python
from dataclasses import dataclass
from typing import Any, Literal

@dataclass(frozen=True)
class LocalModelSpec:
    model_id: str
    family: str  # "embedding" | "rerank"
    display_name: str
    provider: str
    source_model_id: str
    source_file: str
    approx_size_bytes: int
    license: str
    dimension: int | None = None
    locale: str | None = None

# 预定义本地模型 (从老项目复制)
LOCAL_MODEL_SPECS: dict[str, LocalModelSpec] = {
    "zh-embedding-lite": LocalModelSpec(
        model_id="zh-embedding-lite",
        family="embedding",
        display_name="Jina Embeddings v2 Base ZH (INT8)",
        provider="local_onnx",
        source_model_id="jina/jina-embeddings-v2-base-zh-int8",
        source_file="onnx/model.onnx",
        approx_size_bytes=1610612736,
        license="apache-2.0",
        dimension=1024,
        locale="zh-CN",
    ),
    "en-embedding-lite": LocalModelSpec(
        model_id="en-embedding-lite",
        family="embedding",
        display_name="BGE Small EN v1.5 (ONNX)",
        provider="local_onnx",
        source_model_id="BAAI/bge-small-en-v1.5",
        source_file="onnx/model.onnx",
        approx_size_bytes=133169975,
        license="mit",
        dimension=384,
        locale="en-US",
    ),
    "zh-rerank-lite": LocalModelSpec(
        model_id="zh-rerank-lite",
        family="rerank",
        display_name="Jina Reranker v2 Base Multilingual (Quantized)",
        provider="local_onnx",
        source_model_id="jina/jina-reranker-v2-base-multilingual",
        source_file="onnx/model.onnx",
        approx_size_bytes=279577152,
        license="apache-2.0",
        dimension=None,
        locale="zh-CN",
    ),
    "en-rerank-lite": LocalModelSpec(
        model_id="en-rerank-lite",
        family="rerank",
        display_name="Jina Reranker v1 Tiny EN (INT8)",
        provider="local_onnx",
        source_model_id="jina/jina-reranker-v1-tiny-en",
        source_file="onnx/model.onnx",
        approx_size_bytes=33554432,
        license="apache-2.0",
        dimension=None,
        locale="en-US",
    ),
}

class RetrievalModelsService:
    def build_status(self) -> dict[str, Any]
    async def test_embedding(self, *, text: str, profile: str | None = None) -> dict[str, Any]
    async def test_rerank(self, *, query: str, documents: list[str], profile: str | None = None) -> dict[str, Any]
    async def test_provider_connection(self, *, family: str, provider: str, model: str | None = None) -> dict[str, Any]
    def set_active_model(self, *, family: str, provider: str, model_id: str | None = None, model: str | None = None) -> dict[str, Any]
```

### 1.3 创建 Config Schema

**文件**: `backend/src/config/retrieval_models_config.py`

**参考**: `/Users/zhangtiancheng/Documents/项目/新项目/Nion_old/backend/src/config/retrieval_models_config.py`

**配置结构**:
```python
from pydantic import BaseModel, Field
from typing import Literal

class OpenAICompatibleEmbeddingProviderConfig(BaseModel):
    enabled: bool = False
    name: str = "OpenAI-compatible Embedding"
    model: str = "text-embedding-3-small"
    api_key: str | None = "$OPENAI_API_KEY"
    api_base: str | None = None
    timeout_ms: int = 12_000
    dimension: int = 1536
    input: str = "text"

class RerankAPIProviderConfig(BaseModel):
    enabled: bool = False
    name: str = "Rerank API"
    model: str = "jina-reranker-v2-base-multilingual"
    api_key: str | None = None
    api_base: str | None = None
    path: str = "/rerank"
    timeout_ms: int = 12_000

class RetrievalProvidersConfig(BaseModel):
    openai_embedding: OpenAICompatibleEmbeddingProviderConfig = Field(default_factory=OpenAICompatibleEmbeddingProviderConfig)
    rerank_api: RerankAPIProviderConfig = Field(default_factory=RerankAPIProviderConfig)

class ActiveEmbeddingConfig(BaseModel):
    provider: Literal["local_onnx", "openai_compatible"] = "local_onnx"
    model_id: str | None = "zh-embedding-lite"
    model: str | None = None

class ActiveRerankConfig(BaseModel):
    provider: Literal["local_onnx", "rerank_api"] = "local_onnx"
    model_id: str | None = "zh-rerank-lite"
    model: str | None = None

class RetrievalActiveConfig(BaseModel):
    embedding: ActiveEmbeddingConfig = Field(default_factory=ActiveEmbeddingConfig)
    rerank: ActiveRerankConfig = Field(default_factory=ActiveRerankConfig)

class RetrievalModelsConfig(BaseModel):
    enabled: bool = True
    active: RetrievalActiveConfig = Field(default_factory=RetrievalActiveConfig)
    source_priority: list[Literal["modelscope", "manual_import"]] = Field(default_factory=lambda: ["modelscope", "manual_import"])
    providers: RetrievalProvidersConfig = Field(default_factory=RetrievalProvidersConfig)
    local_models_dir: str | None = None
    registry_file: str | None = None
```

---

## Phase 2: Frontend API 层复刻

### 2.1 重命名和扩展 API 文件

**当前文件**: `frontend/src/core/embedding-models/api.ts`
**新文件**: `frontend/src/core/retrieval-models/api.ts`

**参考**: `/Users/zhangtiancheng/Documents/项目/新项目/Nion_old/frontend/src/core/retrieval-models/api.ts`

**类型定义** (复制自老项目):
```typescript
export type RetrievalOperationResponse = {
  status: "ok" | "degraded" | "disabled";
  latency_ms: number;
  error_code: string | null;
  result: Record<string, unknown> | null;
};

export type RetrievalFamily = "embedding" | "rerank";
export type RetrievalProvider = "local_onnx" | "openai_compatible" | "rerank_api";

export type SetActiveModelPayload = {
  family: RetrievalFamily;
  provider: RetrievalProvider;
  model_id?: string;
  model?: string;
};

export type TestProviderConnectionPayload = {
  family: RetrievalFamily;
  provider: "openai_compatible" | "rerank_api";
  model?: string;
};
```

**API 函数** (复制自老项目):
```typescript
export async function loadRetrievalModelsStatus(): Promise<RetrievalOperationResponse>
export async function setActiveRetrievalModel(payload: SetActiveModelPayload): Promise<RetrievalOperationResponse>
export async function testRetrievalProviderConnection(payload: TestProviderConnectionPayload): Promise<RetrievalOperationResponse>
export async function testRetrievalEmbedding(text: string, profile?: string): Promise<RetrievalOperationResponse>
export async function testRetrievalRerank(query: string, documents: string[], profile?: string): Promise<RetrievalOperationResponse>
```

### 2.2 删除旧 API 文件

- 删除 `frontend/src/core/embedding-models/api.ts` 及其目录（如果只有这一个文件）
- 更新所有引用旧 API 的地方

---

## Phase 3: Frontend UI 层复刻

### 3.1 重命名 UI 文件

**当前文件**: `frontend/src/components/workspace/settings/embedding-settings-page.tsx`
**新文件**: `frontend/src/components/workspace/settings/retrieval-settings-page.tsx`

### 3.2 完全复制老项目 UI

**参考文件**: `/Users/zhangtiancheng/Documents/项目/新项目/Nion_old/frontend/src/components/workspace/settings/retrieval-settings-page.tsx`

**完整复制**该文件的全部内容（约 1450 行），包括：
- 三个 Tab: Embedding, Rerank, Testing
- 模型卡片显示和操作（下载/安装/删除）
- Provider 配置（OpenAI 兼容、Rerank API）
- 测试界面
- 确认对话框
- 状态管理
- Toast 通知

### 3.3 调整导入路径

复制后需要调整的导入：
```typescript
// 从
import { loadRetrievalModelsStatus, ... } from "@/core/retrieval-models/api";
// 到 (如果是重命名后的文件，保持不变)

// 从旧的 embedding-models/api
import { ... } from "@/core/embedding-models/api";
// 改为
import { ... } from "@/core/retrieval-models/api";
```

---

## Phase 4: Memory V2 向量数据库集成（可选）

### 4.1 如果新项目已有 Memory V2

检查 `backend/src/agents/memory/` 是否存在：
- 如果已有 Memory V2 实现，检查是否包含向量检索功能
- 如需要增强，参考老项目的 `retrieval/` 目录实现

### 4.2 如果新项目没有 Memory V2

需要创建：
- `backend/src/agents/memory/retrieval/models.py`
- `backend/src/agents/memory/retrieval/embeddings.py`
- `backend/src/agents/memory/retrieval/adapter.py`
- `backend/src/agents/memory/retrieval/service.py`

**参考**: `/Users/zhangtiancheng/Documents/项目/新项目/Nion_old/desktop/runtime/backend/src/agents/memory/retrieval/`

---

## Phase 5: Desktop 模型下载功能（可选）

### 5.1 Desktop 实现

如果需要本地模型下载功能，需要创建：

**文件**: `desktop/electron/src/retrieval-model-manager.ts`

**参考**: `/Users/zhangtiancheng/Documents/项目/新项目/Nion_old/desktop/electron/src/retrieval-model-manager.ts`

**核心功能**:
- `listModels()`: 列出所有可用模型
- `downloadModel(modelId)`: 下载模型
- `cancelModel(modelId)`: 取消下载
- `removeModel(modelId)`: 删除模型
- `importModel(modelId)`: 导入模型

### 5.2 下载源

- 主要源：ModelScope (https://modelscope.cn)
- 需要实现模型 URL 候选和回退逻辑

---

## Phase 6: 配置集成

### 6.1 更新 Gateway Router 注册

在 `backend/src/gateway/app.py` 中添加新的 router：
```python
from backend.src.gateway.routers import retrieval_models

app.include_router(retrieval_models.router, prefix="/api/retrieval-models", tags=["retrieval-models"])
```

### 6.2 更新 config.yaml

在 `config.yaml` 中添加：
```yaml
retrieval_models:
  enabled: true
  source_priority:
    - modelscope
    - manual_import
  providers:
    openai_embedding:
      enabled: false
      model: text-embedding-3-small
      api_key: $OPENAI_API_KEY
    rerank_api:
      enabled: false
      model: jina-reranker-v2-base-multilingual
  active:
    embedding:
      provider: local_onnx
      model_id: zh-embedding-lite
    rerank:
      provider: local_onnx
      model_id: zh-rerank-lite
```

---

## Phase 7: 验证

### 7.1 后端验证
- [ ] 启动后端服务
- [ ] 测试 `GET /api/retrieval-models/status`
- [ ] 测试 `POST /api/retrieval-models/test-embedding`
- [ ] 测试 `POST /api/retrieval-models/test-rerank`
- [ ] 测试 `POST /api/retrieval-models/set-active-model`
- [ ] 测试 `POST /api/retrieval-models/test-provider-connection`

### 7.2 前端验证
- [ ] 启动前端服务
- [ ] 访问设置页面
- [ ] 验证 Embedding Tab 显示正确
- [ ] 验证 Rerank Tab 显示正确
- [ ] 验证 Testing Tab 功能正常
- [ ] 验证模型卡片显示
- [ ] 验证 Provider 配置保存

---

## 文件清单

### 需要创建的新文件

| 文件路径 | 描述 |
|---------|------|
| `backend/src/gateway/routers/retrieval_models.py` | Backend Router |
| `backend/src/retrieval_models/__init__.py` | Service 模块入口 |
| `backend/src/retrieval_models/service.py` | Service 实现 |
| `backend/src/config/retrieval_models_config.py` | Config Schema |
| `frontend/src/core/retrieval-models/api.ts` | Frontend API (新) |
| `frontend/src/components/workspace/settings/retrieval-settings-page.tsx` | Frontend UI (新) |

### 需要删除的文件

| 文件路径 | 描述 |
|---------|------|
| `frontend/src/core/embedding-models/api.ts` | 旧 API |
| `frontend/src/components/workspace/settings/embedding-settings-page.tsx` | 旧 UI |

### 需要修改的文件

| 文件路径 | 修改内容 |
|---------|---------|
| `backend/src/gateway/app.py` | 添加 router 注册 |
| `config.yaml` | 添加 retrieval_models 配置 |

---

## 实施顺序

1. **Phase 1**: Backend API 层（Router + Service + Config）
2. **Phase 2**: Frontend API 层（创建新的 retrieval-models/api.ts）
3. **Phase 3**: Frontend UI 层（创建新的 retrieval-settings-page.tsx）
4. **Phase 4**: Memory V2 向量数据库（可选，如需要）
5. **Phase 5**: Desktop 模型下载（可选，如需要）
6. **Phase 6**: 配置集成
7. **Phase 7**: 验证

---

## 关键参考文件

- **Backend Router**: `/Users/zhangtiancheng/Documents/项目/新项目/Nion_old/backend/src/gateway/routers/retrieval_models.py`
- **Backend Service**: `/Users/zhangtiancheng/Documents/项目/新项目/Nion_old/backend/src/retrieval_models/service.py`
- **Config Schema**: `/Users/zhangtiancheng/Documents/项目/新项目/Nion_old/backend/src/config/retrieval_models_config.py`
- **Frontend API**: `/Users/zhangtiancheng/Documents/项目/新项目/Nion_old/frontend/src/core/retrieval-models/api.ts`
- **Frontend UI**: `/Users/zhangtiancheng/Documents/项目/新项目/Nion_old/frontend/src/components/workspace/settings/retrieval-settings-page.tsx`
