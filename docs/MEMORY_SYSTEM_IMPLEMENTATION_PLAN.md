# Nion-Agent 记忆系统 v2.0 实施计划

> 可直接交给 Codex 执行开发的详细实施计划
> 版本: 1.0
> 目标: 构建企业级单人 AI 助手记忆系统

---

## 背景与目标

### 当前状态

Nion-Agent 目前有一个基础的记忆系统:
- 存储在 `memory.json` 文件中
- 结构: user (workContext, personalContext, topOfMind) + history + facts
- 检索方式: TF-IDF + 余弦相似度
- 更新机制: MemoryMiddleware + Queue + Debounce(30s) + LLM驱动

### 目标状态

构建一个更强大的记忆系统 v2.0:
- 混合搜索 (BM25 + 向量)
- 三层记忆架构 (Resource → Item → Category)
- 主动记忆能力 (意图预测、上下文预加载)
- 自我进化能力 (自动优化)
- 更好的 Workspace 文件支持

---

## 项目结构

创建以下目录结构:

```
backend/src/agents/memory/
├── __init__.py              # 导出所有模块
├── config.py                 # 记忆配置
├── types.py                 # 数据类型定义
│
├── layers/                  # 三层记忆架构
│   ├── __init__.py
│   ├── resource.py         # Layer 1: Raw Resources
│   ├── item.py             # Layer 2: Memory Items
│   └── category.py         # Layer 3: Category Files
│
├── search/                 # 搜索模块
│   ├── __init__.py
│   ├── embeddings.py       # 向量嵌入
│   ├── vector_store.py     # 向量存储 (SQLite)
│   ├── bm25.py            # BM25 索引
│   └── hybrid.py           # 混合搜索
│
├── proactive/              # 主动记忆
│   ├── __init__.py
│   ├── dual_mode.py       # Dual-Mode 检索
│   ├── context_loader.py   # 上下文预加载
│   └── patterns.py        # 使用模式分析
│
├── evolving/               # 自我进化
│   ├── __init__.py
│   ├── self_evolver.py    # 进化引擎
│   └── scheduler.py        # 进化调度器
│
├── soul/                  # Soul/Identity 系统
│   ├── __init__.py
│   ├── workspace.py       # Workspace 文件管理
│   ├── identity_cascade.py # Identity 级联
│   └── heartbeat.py       # 定时任务
│
├── intention/              # 用户意图预测
│   ├── __init__.py
│   └── intention_predictor.py
│
├── linking/                # 记忆链接
│   ├── __init__.py
│   └── memory_linker.py
│
├── storage/                # 存储层
│   ├── __init__.py
│   └── manager.py         # 存储管理器
│
└── memory.py              # 主入口，兼容现有接口
```

---

## 实施步骤

### Step 1: 创建数据类型定义

**文件**: `backend/src/agents/memory/types.py`

**任务描述**:
创建所有核心数据类型定义，包括:
- MemoryItem: 单个记忆项
- MemoryCategory: 记忆类别枚举
- Entity, Relation: 实体和关系
- RawResource: 原始资源
- MemoryConfig: 配置

**验收标准**:
- 定义所有数据类
- 包含完整的类型注解
- 导出所有类型供其他模块使用

---

### Step 2: 实现向量嵌入支持

**文件**: `backend/src/agents/memory/search/embeddings.py`

**任务描述**:
实现嵌入提供者，支持:
- SentenceTransformerEmbedding: 本地嵌入
- OpenAIEmbedding: OpenAI 嵌入

**实现要点**:
```python
class EmbeddingProvider(ABC):
    @abstractmethod
    def embed(self, text: str) -> List[float]: pass

    @abstractmethod
    def embed_batch(self, texts: List[str]) -> List[List[float]]: pass
```

**验收标准**:
- EmbeddingProvider 基类
- SentenceTransformerEmbedding 实现
- OpenAIEmbedding 实现
- 支持批量嵌入

---

### Step 3: 实现 BM25 索引

**文件**: `backend/src/agents/memory/search/bm25.py`

**任务描述**:
实现 BM25 检索算法:
- fit(): 构建索引
- search(): 搜索

**实现要点**:
```python
class BM25:
    def __init__(self, k1: float = 1.5, b: float = 0.75): ...
    def fit(self, documents: List[str]): ...
    def search(self, query: str, top_k: int = 5) -> List[Dict]: ...
```

**验收标准**:
- BM25 算法正确实现
- 支持批量文档索引
- 搜索结果相关性正确

---

### Step 4: 实现 SQLite 向量存储

**文件**: `backend/src/agents/memory/search/vector_store.py`

**任务描述**:
实现向量存储，使用 SQLite + numpy:
- add_vector(): 添加向量
- search_similar(): 向量相似度搜索

**验收标准**:
- 使用 SQLite 存储
- 支持向量添加和搜索
- 包含访问统计更新

---

### Step 5: 实现混合搜索

**文件**: `backend/src/agents/memory/search/hybrid.py`

**任务描述**:
实现混合搜索，整合 BM25 和向量搜索:
- 并行执行两种搜索
- 分数融合
- MMR 重排序
- 时间衰减

**实现要点**:
```python
class HybridSearch:
    def search(self, query, query_embedding, top_k=5) -> List[Dict]:
        # 1. BM25 搜索
        # 2. 向量搜索
        # 3. 分数融合
        # 4. MMR 重排
        # 5. 时间衰减
```

**验收标准**:
- BM25 和向量搜索并行执行
- 分数正确融合
- MMR 重排序有效
- 时间衰减生效

---

### Step 6: 实现 Raw Resources Layer

**文件**: `backend/src/agents/memory/layers/resource.py`

**任务描述**:
实现第一层记忆 - 原始资源:
- RawResource 数据类
- ResourceLayer: 存储原始对话等
- 按月份组织存储

**验收标准**:
- 支持存储和检索原始资源
- 按月份组织
- 支持日期范围搜索

---

### Step 7: 实现 Memory Items Layer

**文件**: `backend/src/agents/memory/layers/item.py`

**任务描述**:
实现第二层记忆 - 结构化记忆项:
- MemoryItem 数据类 (含 entities, relations)
- ItemLayer: 管理所有记忆项
- 支持向量存储集成
- 访问统计更新

**验收标准**:
- MemoryItem 包含 entities 和 relations
- 支持存储、检索、搜索
- 访问计数正确更新

---

### Step 8: 实现 Category Layer

**文件**: `backend/src/agents/memory/layers/category.py`

**任务描述**:
实现第三层记忆 - 类别文件:
- CategoryLayer: 管理类别
- 自动分类功能
- 生成 LLM 可读的 Markdown 文件

**验收标准**:
- 默认类别正确初始化
- 支持添加/移除记忆项到类别
- 生成可读的 Markdown 文件
- LLM 可以直接读取类别文件

---

### Step 9: 实现 Dual-Mode 检索

**文件**: `backend/src/agents/memory/proactive/dual_mode.py`

**任务描述**:
实现双模式检索:
- FAST_CONTEXT: 快速简单搜索
- DEEP_REASONING: LLM 参与推理
- 自动模式选择

**实现要点**:
```python
class DualModeRetriever:
    def retrieve(self, query, query_embedding, force_mode=None):
        # 自动判断使用哪种模式
        # Fast: 高置信度结果
        # Deep: 低置信度或复杂查询
```

**验收标准**:
- 自动模式选择正确
- Fast 模式使用混合搜索
- Deep 模式 LLM 参与重排序
- 返回模式标识

---

### Step 10: 实现自我进化引擎

**文件**: `backend/src/agents/memory/evolving/self_evolver.py`

**任务描述**:
实现记忆自我进化:
- 记录使用模式
- 记忆压缩 (合并相似项)
- 类别优化
- 陈旧记忆处理

**验收标准**:
- 正确记录使用模式
- 相似记忆可以合并
- 陈旧记忆有处理策略

---

### Step 11: 实现 Workspace 文件管理

**文件**: `backend/src/agents/memory/soul/workspace.py`

**任务描述**:
实现 Workspace 文件管理:
- SOUL.md: 性格定义
- IDENTITY.md: 展示信息
- USER.md: 用户信息
- MEMORY.md: 记忆摘要

**验收标准**:
- 可以创建和读取各个文件
- 支持 Workspace 级联
- 兼容现有 SOUL.md 格式

---

### Step 12: 实现 Identity 级联

**文件**: `backend/src/agents/memory/soul/identity_cascade.py`

**任务描述**:
实现 Identity 三级级联:
- Global Config → Agent Config → Workspace

**验收标准**:
- 正确优先级解析
- 支持覆盖

---

### Step 13: 整合现有系统

**文件**: `backend/src/agents/memory/memory.py`

**任务描述**:
整合新旧系统:
- 保留现有 updater.py 的 LLM 驱动更新逻辑
- 新增向量搜索能力
- 兼容现有 API

**验收标准**:
- 现有功能正常工作
- 新增搜索能力可用
- 内存占用合理

---

### Step 14: 配置更新

**文件**: `backend/src/config/memory_config.py`

**任务描述**:
添加新的配置项:
- 向量嵌入配置
- 混合搜索权重
- BM25 参数
- 进化调度配置

**验收标准**:
- 新配置项可用
- 旧配置兼容

---

## 执行顺序

```
Phase 1: 基础设施
├── Step 1: 类型定义
├── Step 2: 嵌入支持
├── Step 3: BM25
├── Step 4: 向量存储
└── Step 5: 混合搜索

Phase 2: 三层架构
├── Step 6: Resource Layer
├── Step 7: Item Layer
└── Step 8: Category Layer

Phase 3: 主动记忆
├── Step 9: Dual-Mode 检索
└── Step 10: 自我进化

Phase 4: Soul/Identity
├── Step 11: Workspace 文件
└── Step 12: Identity 级联

Phase 5: 整合
├── Step 13: 系统整合
└── Step 14: 配置更新
```

---

## 关键设计决策

### 1. 向量存储

使用 SQLite + numpy 存储向量，不依赖外部向量数据库:
- 简单轻量
- 无额外依赖
- 适合单人场景

### 2. 嵌入模型

支持两种嵌入:
- sentence-transformers (本地，离线可用)
- OpenAI (云端，更高精度)

### 3. 混合搜索权重

默认配置:
- BM25: 50%
- Vector: 50%

可配置

### 4. 兼容策略

保留现有 memory.json 格式:
- v2.0 使用新的三层架构
- 旧数据自动迁移
- 可回滚到 v1.0

---

## 数据流

```
用户消息
    │
    ▼
MemoryMiddleware
    │
    ├──▶ 过滤消息 (保留用户输入 + AI响应)
    │
    ▼
MemoryUpdateQueue (Debounce 30s)
    │
    ▼
MemoryUpdater (LLM驱动)
    │
    ├──▶ Resource Layer (存储原始对话)
    │
    ├──▶ Item Layer (提取事实，生成向量)
    │
    └──▶ Category Layer (自动分类)

用户下次请求
    │
    ▼
HybridSearch (BM25 + Vector)
    │
    ▼
DualModeRetriever (Fast/Deep)
    │
    ▼
System Prompt (注入记忆)
```

---

## 测试策略

### 单元测试

每个模块需要单元测试:
- embeddings.py: 测试嵌入生成
- bm25.py: 测试搜索相关性
- hybrid.py: 测试分数融合
- item.py: 测试 CRUD 操作

### 集成测试

- 端到端记忆存储和检索
- 混合搜索结果质量
- 向后兼容性

### 性能测试

- 1000 条记忆的检索延迟
- 向量生成时间
- 内存占用

---

## 注意事项

1. **保持简单**: 优先实现核心功能，不过度设计
2. **渐进开发**: 每个 Step 可独立测试
3. **向后兼容**: 不破坏现有功能
4. **代码质量**: 遵循项目现有的代码风格

---

## 预计工作量

| Phase | Steps | 工作量 |
|-------|-------|--------|
| Phase 1 | 1-5 | 5-7 天 |
| Phase 2 | 6-8 | 5-7 天 |
| Phase 3 | 9-10 | 4-5 天 |
| Phase 4 | 11-12 | 3-4 天 |
| Phase 5 | 13-14 | 2-3 天 |

总计: 约 3-4 周
