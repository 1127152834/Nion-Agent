# 向量模型配置功能实施文档

> 为 Nion-Agent 添加向量嵌入模型配置功能
> 生成时间: 2026-03-06
> 状态: 已完成核心实现

---

## 📋 功能概述

为 Nion-Agent 的 Memory v2 系统添加了完整的向量模型配置功能，支持：

1. **本地模型** - sentence-transformers 本地运行
2. **OpenAI API** - 使用 OpenAI 嵌入服务
3. **自定义 API** - 兼容 OpenAI 格式的第三方服务

---

## 📁 已创建的文件

### 后端文件

1. **`backend/src/config/embedding_config.py`** - 嵌入模型配置
   - `EmbeddingConfig` - 主配置类
   - `LocalEmbeddingConfig` - 本地模型配置
   - `OpenAIEmbeddingConfig` - OpenAI API 配置
   - `CustomEmbeddingConfig` - 自定义 API 配置
   - `PRESET_LOCAL_MODELS` - 预设本地模型列表（4个模型）
   - `PRESET_OPENAI_MODELS` - 预设 OpenAI 模型列表（3个模型）

2. **`backend/src/embedding_models/__init__.py`** - 模块初始化
   - 导出 `EmbeddingModelsService` 和 `EmbeddingModelsError`

3. **`backend/src/embedding_models/service.py`** - 嵌入模型服务
   - `EmbeddingModelsService` - 核心服务类
   - `get_status()` - 获取当前状态
   - `get_presets()` - 获取预设模型列表
   - `test_embedding()` - 测试嵌入功能
   - `set_active_model()` - 设置活动模型
   - 支持三种提供者的测试方法

4. **`backend/src/gateway/routers/embedding_models.py`** - API 路由
   - `GET /api/embedding-models/status` - 获取状态
   - `GET /api/embedding-models/presets` - 获取预设模型
   - `POST /api/embedding-models/test` - 测试嵌入
   - `POST /api/embedding-models/set-active` - 设置活动模型

### 前端文件

5. **`frontend/src/core/embedding-models/api.ts`** - 前端 API 客户端
   - `loadEmbeddingModelsStatus()` - 加载状态
   - `loadEmbeddingPresets()` - 加载预设模型
   - `setActiveEmbeddingModel()` - 设置活动模型
   - `testEmbedding()` - 测试嵌入
   - 类型定义和错误处理

6. **`frontend/src/components/workspace/settings/embedding-settings-page.tsx`** - 设置页面
   - 完整的 UI 组件
   - 三种提供者的配置界面
   - 预设模型选择
   - 测试和保存功能
   - 状态显示

---

## 🎯 预设模型列表

### 本地模型（sentence-transformers）

| 模型 ID | 名称 | 维度 | 大小 | 语言 | 描述 |
|---------|------|------|------|------|------|
| all-MiniLM-L6-v2 | MiniLM L6 v2 | 384 | 80MB | 多语言 | 快速轻量，通用 |
| paraphrase-multilingual-MiniLM-L12-v2 | Paraphrase Multilingual MiniLM L12 v2 | 384 | 420MB | 50+语言 | 更高质量 |
| all-mpnet-base-v2 | MPNet Base v2 | 768 | 420MB | 英文 | 英文高质量 |
| paraphrase-multilingual-mpnet-base-v2 | Paraphrase Multilingual MPNet Base v2 | 768 | 970MB | 50+语言 | 最高质量 |

### OpenAI 模型

| 模型 ID | 名称 | 维度 | 描述 |
|---------|------|------|------|
| text-embedding-3-small | OpenAI Embedding 3 Small | 1536 | 性价比高 |
| text-embedding-3-large | OpenAI Embedding 3 Large | 3072 | 最高质量 |
| text-embedding-ada-002 | OpenAI Ada 002 (Legacy) | 1536 | 旧版模型 |

---

## 🔧 集成步骤

### 1. 注册 API 路由

需要在 Gateway 应用中注册新的路由：

```python
# backend/src/gateway/app.py 或类似文件
from src.gateway.routers import embedding_models

app.include_router(embedding_models.router)
```

### 2. 更新主配置

在主配置文件中添加 embedding 配置：

```yaml
# config.yaml
embedding:
  enabled: true
  provider: local  # local | openai | custom
  local:
    model: all-MiniLM-L6-v2
    device: cpu  # cpu | cuda | mps
  openai:
    model: text-embedding-3-small
    api_key: $OPENAI_API_KEY
    dimension: 1536
  custom:
    model: ""
    api_base: ""
    api_key: ""
    dimension: 1536
```

### 3. 集成到 Memory v2

修改 `backend/src/agents/memory/memory.py`，使用新的嵌入配置：

```python
from src.config import get_config
from src.embedding_models import EmbeddingModelsService

class MemoryManager:
    def __init__(self, ...):
        # 使用新的嵌入配置
        config = get_config()
        if hasattr(config, 'embedding') and config.embedding.enabled:
            embedding_service = EmbeddingModelsService()
            # 使用 embedding_service 获取嵌入
```

### 4. 添加到设置菜单

在前端设置菜单中添加入口：

```tsx
// frontend/src/components/workspace/settings/settings-dialog.tsx
import { EmbeddingSettingsPage } from "./embedding-settings-page";

// 添加到设置菜单
{
  id: "embedding",
  label: "向量模型",
  component: <EmbeddingSettingsPage />
}
```

---

## 📝 使用说明

### 本地模型使用

1. **安装依赖**：
   ```bash
   pip install sentence-transformers
   ```

2. **选择模型**：在设置页面选择预设模型

3. **首次使用**：模型会自动下载到 `~/.cache/torch/sentence_transformers/`

4. **设备选择**：
   - `cpu` - CPU 运行（通用）
   - `cuda` - NVIDIA GPU（需要 CUDA）
   - `mps` - Apple Silicon GPU（M1/M2/M3）

### OpenAI API 使用

1. **配置 API Key**：
   - 直接输入：`sk-...`
   - 环境变量：`$OPENAI_API_KEY`

2. **选择模型**：推荐 `text-embedding-3-small`（性价比高）

3. **调整维度**：可选 64-3072 维（默认 1536）

### 自定义 API 使用

1. **配置 API Base**：输入兼容 OpenAI 格式的 API 地址

2. **配置模型名称**：输入模型标识符

3. **可选 API Key**：如果服务需要认证

---

## 🧪 测试功能

设置页面提供测试功能，可以验证配置是否正确：

1. 点击"测试"按钮
2. 系统会发送测试文本进行嵌入
3. 返回结果包含：
   - 提供者类型
   - 模型名称
   - 向量维度
   - 前5个维度的样本值

---

## 🔗 与 Memory v2 集成

### 修改 Memory v2 配置

更新 `backend/src/agents/memory/config.py`：

```python
from src.config.embedding_config import EmbeddingConfig

class MemoryRuntimeConfig:
    # 移除旧的嵌入配置字段
    # embedding_provider: str = "sentence-transformers"
    # embedding_model: str = "all-MiniLM-L6-v2"

    # 使用新的嵌入配置
    use_global_embedding_config: bool = True
```

### 修改 MemoryManager

更新 `backend/src/agents/memory/memory.py`：

```python
def _build_embedding_provider(self, embeddings_module: Any) -> Any:
    # 如果启用全局配置，使用 EmbeddingModelsService
    if self.runtime_config.use_global_embedding_config:
        from src.embedding_models import EmbeddingModelsService
        service = EmbeddingModelsService()
        # 返回适配器
        return EmbeddingServiceAdapter(service)

    # 否则使用旧的配置方式
    provider = self.runtime_config.embedding_provider.lower().strip()
    # ... 现有代码
```

---

## 📊 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (React)                          │
├─────────────────────────────────────────────────────────────┤
│  EmbeddingSettingsPage                                       │
│  ├─ 提供者选择 (Local/OpenAI/Custom)                        │
│  ├─ 预设模型列表                                             │
│  ├─ 配置表单                                                 │
│  └─ 测试/保存按钮                                            │
└─────────────────────────────────────────────────────────────┘
                            ↓ HTTP API
┌─────────────────────────────────────────────────────────────┐
│                    Backend (FastAPI)                         │
├─────────────────────────────────────────────────────────────┤
│  Gateway Router (/api/embedding-models)                      │
│  ├─ GET /status                                              │
│  ├─ GET /presets                                             │
│  ├─ POST /test                                               │
│  └─ POST /set-active                                         │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│              EmbeddingModelsService                          │
├─────────────────────────────────────────────────────────────┤
│  ├─ get_status()                                             │
│  ├─ get_presets()                                            │
│  ├─ test_embedding()                                         │
│  │   ├─ _test_local_embedding()                             │
│  │   ├─ _test_openai_embedding()                            │
│  │   └─ _test_custom_embedding()                            │
│  └─ set_active_model()                                       │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                  Embedding Providers                         │
├─────────────────────────────────────────────────────────────┤
│  ├─ sentence-transformers (本地)                            │
│  ├─ OpenAI API (云端)                                        │
│  └─ Custom API (自定义)                                      │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                    Memory v2 System                          │
├─────────────────────────────────────────────────────────────┤
│  MemoryManager                                               │
│  └─ ItemLayer                                                │
│      └─ 使用配置的嵌入提供者                                 │
└─────────────────────────────────────────────────────────────┘
```

---

## ⚠️ 注意事项

1. **依赖安装**：
   - 本地模型需要：`pip install sentence-transformers`
   - OpenAI API 需要：`pip install openai`

2. **模型下载**：
   - 本地模型首次使用会自动下载
   - 下载位置：`~/.cache/torch/sentence_transformers/`
   - 确保有足够的磁盘空间

3. **API 密钥安全**：
   - 使用环境变量存储 API 密钥
   - 不要在代码中硬编码密钥

4. **性能考虑**：
   - 本地模型：首次加载较慢，后续快速
   - OpenAI API：需要网络请求，有延迟
   - GPU 加速：使用 CUDA 或 MPS 可显著提升性能

5. **配置持久化**：
   - 当前实现的 `set_active_model()` 需要完善
   - 需要实际写入配置文件并重启服务

---

## 🚀 后续工作

### 必需完成的集成步骤

1. **注册 API 路由**
   - 在 Gateway 应用中注册 `embedding_models.router`
   - 确保路由可访问

2. **更新主配置文件**
   - 在 `config.yaml` 中添加 `embedding` 配置节
   - 或在配置加载逻辑中支持 `EmbeddingConfig`

3. **集成到 Memory v2**
   - 修改 `MemoryManager._build_embedding_provider()`
   - 使用新的 `EmbeddingModelsService`
   - 创建适配器类连接两个系统

4. **添加到设置菜单**
   - 在前端设置对话框中添加"向量模型"选项
   - 导入 `EmbeddingSettingsPage` 组件

5. **完善配置持久化**
   - 实现 `set_active_model()` 的配置写入逻辑
   - 支持热重载或提示用户重启

### 可选增强功能

1. **模型管理**
   - 显示已下载的本地模型列表
   - 支持删除本地模型
   - 显示模型文件大小和位置

2. **性能监控**
   - 记录嵌入生成时间
   - 显示 API 调用统计
   - 缓存常用嵌入结果

3. **批量测试**
   - 支持批量文本测试
   - 比较不同模型的效果
   - 生成性能报告

4. **自动选择**
   - 根据语言自动选择模型
   - 根据文本长度选择模型
   - 智能降级策略

---

## 📚 参考资料

### 老项目参考

本实现参考了 Nion_old 项目的检索模型系统：
- 配置结构：`backend/src/config/retrieval_models_config.py`
- API 路由：`backend/src/gateway/routers/retrieval_models.py`
- 前端页面：`frontend/src/components/workspace/settings/retrieval-settings-page.tsx`
- 桌面端管理：`desktop/electron/src/retrieval-model-manager.ts`

### 相关文档

- Memory v2 实施计划：`docs/MEMORY_V2_补全方案_主文档.md`
- Memory v2 代码示例：`docs/MEMORY_V2_补全方案_代码示例.md`
- Memory v2 完成计划：`docs/MEMORY_V2_COMPLETION_PLAN.md`

### 外部资源

- sentence-transformers: https://www.sbert.net/
- OpenAI Embeddings: https://platform.openai.com/docs/guides/embeddings
- Hugging Face Models: https://huggingface.co/models?pipeline_tag=sentence-similarity

---

## ✅ 完成状态

- [x] 创建后端配置模型
- [x] 创建后端服务层
- [x] 创建后端 API 路由
- [x] 创建前端 API 客户端
- [x] 创建前端设置页面
- [x] 定义预设模型列表
- [x] 实现测试功能
- [ ] 注册 API 路由到 Gateway
- [ ] 更新主配置文件
- [ ] 集成到 Memory v2 系统
- [ ] 添加到设置菜单
- [ ] 完善配置持久化

---

**文档结束**
