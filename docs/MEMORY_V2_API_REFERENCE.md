# Memory v2.0 API 参考文档

> 版本: 2.0
> 更新时间: 2026-03-06

---

## 📚 概述

本文档提供 Memory v2.0 系统的完整 API 参考。

**主要模块**：
- `MemoryManager` - 记忆管理器（主入口）
- `ItemLayer` - 记忆项层
- `ResourceLayer` - 原始资源层
- `CategoryLayer` - 类别层
- `HybridSearch` - 混合搜索
- `DualModeRetriever` - 双模式检索
- `SelfEvolvingEngine` - 自我进化引擎

---

## MemoryManager

记忆管理器是 Memory v2.0 的主入口，提供统一的记忆操作接口。

### 初始化

```python
from src.agents.memory import MemoryManager

manager = MemoryManager(
    base_dir="/path/to/memory",      # 存储目录
    embedding_provider=None,          # 嵌入提供者（None = 自动从配置加载）
    llm=None,                         # LLM 实例（用于 Deep Mode）
    enable_legacy=True,               # 启用 v1 兼容模式
    config=None,                      # 运行时配置（dict 或 MemoryRuntimeConfig）
)
```

**参数**：
- `base_dir` (str | Path | None): 存储目录，默认为当前目录
- `embedding_provider` (Any | None): 嵌入提供者实例，None 时自动从配置加载
- `llm` (Any | None): LLM 实例，用于 Deep Mode 检索
- `enable_legacy` (bool): 是否启用 v1 兼容模式，默认 True
- `config` (dict | None): 运行时配置，覆盖默认配置

**返回**：`MemoryManager` 实例

---

### store_conversation()

存储原始对话资源。

```python
stored = manager.store_conversation(resource)
```

**参数**：
- `resource` (dict): 资源字典，包含：
  - `id` (str): 资源 ID
  - `type` (str): 资源类型（如 "conversation"）
  - `content` (str): 资源内容
  - `metadata` (dict): 元数据

**返回**：`dict` - 存储的资源字典

**示例**：
```python
resource = {
    "id": "conv_001",
    "type": "conversation",
    "content": "User: Hello\nAI: Hi there!",
    "metadata": {"thread_id": "thread_123"},
}
stored = manager.store_conversation(resource)
```

---

### store_item()

存储结构化记忆项。

```python
stored = manager.store_item(item)
```

**参数**：
- `item` (dict): 记忆项字典，包含：
  - `content` (str): 记忆内容
  - `category` (str): 类别（preference/knowledge/context/behavior/goal/project）
  - `confidence` (float): 置信度（0-1）
  - `entities` (list, 可选): 实体列表
  - `relations` (list, 可选): 关系列表

**返回**：`dict` - 存储的记忆项字典（包含生成的 `id`）

**示例**：
```python
item = {
    "content": "用户喜欢 Python 编程",
    "category": "preference",
    "confidence": 0.9,
}
stored = manager.store_item(item)
print(f"存储的记忆 ID: {stored['id']}")
```

---

### search()

搜索记忆。

```python
results = manager.search(
    query="我喜欢什么编程语言？",
    top_k=5,
    query_embedding=None,
    force_mode=None,
)
```

**参数**：
- `query` (str): 搜索查询
- `top_k` (int): 返回结果数量，默认 5
- `query_embedding` (list[float] | None): 查询向量，None 时自动生成
- `force_mode` (str | None): 强制使用的模式（"fast" 或 "deep"），None 时自动选择

**返回**：`dict` - 搜索结果字典，包含：
- `mode` (str): 使用的检索模式（"fast" 或 "deep"）
- `results` (list[dict]): 搜索结果列表
- `reasoning` (str, 可选): 推理说明（Deep Mode）

**示例**：
```python
# 自动模式选择
results = manager.search("Python", top_k=5)
print(f"检索模式: {results['mode']}")

# 强制 Fast Mode
results = manager.search("Python", force_mode="fast")

# 强制 Deep Mode
results = manager.search("为什么我喜欢 Python？", force_mode="deep")
```

---

### evolve()

运行一次进化循环。

```python
report = manager.evolve()
```

**参数**：无

**返回**：`dict` - 进化报告，包含：
- `timestamp` (str): 执行时间戳
- `actions` (list[dict]): 执行的操作列表
- `metrics` (dict): 性能指标

**示例**：
```python
report = manager.evolve()
print(f"执行的操作: {len(report['actions'])}")
print(f"记忆效率: {report['metrics']['memory_efficiency']}")
```

---

### get_memory_data()

获取记忆数据。

```python
data = manager.get_memory_data(agent_name=None)
```

**参数**：
- `agent_name` (str | None): Agent 名称，用于 v1 兼容模式

**返回**：`dict` - 记忆数据字典，包含：
- `version` (str): 记忆系统版本（"2.0"）
- `items` (list[dict]): 记忆项列表
- `categories` (dict): 类别字典
- `resources` (list[dict]): 原始资源列表
- `legacy` (dict, 可选): v1 兼容数据

**示例**：
```python
data = manager.get_memory_data()
print(f"记忆版本: {data['version']}")
print(f"记忆项数量: {len(data['items'])}")
print(f"类别数量: {len(data['categories'])}")
```

---

### close()

关闭记忆管理器，释放资源。

```python
manager.close()
```

**参数**：无

**返回**：无

**示例**：
```python
manager = MemoryManager()
# ... 使用 manager ...
manager.close()
```

---

## 全局函数

### get_memory_manager()

获取或创建单例记忆管理器。

```python
from src.agents.memory import get_memory_manager

manager = get_memory_manager(
    agent_name=None,
    reload=False,
)
```

**参数**：
- `agent_name` (str | None): Agent 名称，用于多 Agent 场景
- `reload` (bool): 是否强制重新创建管理器，默认 False

**返回**：`MemoryManager` 实例

**示例**：
```python
# 获取默认管理器
manager = get_memory_manager()

# 获取特定 Agent 的管理器
manager = get_memory_manager(agent_name="my_agent")

# 强制重新创建管理器（配置更改后）
manager = get_memory_manager(reload=True)
```

---

### reload_memory_manager()

强制重新创建记忆管理器。

```python
from src.agents.memory import reload_memory_manager

manager = reload_memory_manager(agent_name=None)
```

**参数**：
- `agent_name` (str | None): Agent 名称

**返回**：`MemoryManager` 实例

**示例**：
```python
# 配置更改后重新加载
manager = reload_memory_manager()
```

---

### get_memory_data()

读取记忆数据（通过 v2 管理器）。

```python
from src.agents.memory import get_memory_data

data = get_memory_data(agent_name=None)
```

**参数**：
- `agent_name` (str | None): Agent 名称

**返回**：`dict` - 记忆数据字典

---

### reload_memory_data()

重新加载记忆管理器并返回新数据。

```python
from src.agents.memory import reload_memory_data

data = reload_memory_data(agent_name=None)
```

**参数**：
- `agent_name` (str | None): Agent 名称

**返回**：`dict` - 记忆数据字典

---

## 搜索模块

### HybridSearch

混合搜索（BM25 + 向量搜索）。

#### 初始化

```python
from src.agents.memory.search.hybrid import HybridSearch

search = HybridSearch(
    vector_store=vector_store,
    bm25=bm25,
    vector_weight=0.5,
    bm25_weight=0.5,
)
```

#### search()

执行混合搜索。

```python
results = search.search(
    query="Python programming",
    query_embedding=[0.1, 0.2, ...],
    top_k=5,
)
```

**返回**：`list[dict]` - 搜索结果列表

---

### VectorStore

向量存储（SQLite）。

#### 初始化

```python
from src.agents.memory.search.vector_store import VectorStore

store = VectorStore(db_path="/path/to/vectors.db")
```

#### add_vector()

添加向量。

```python
store.add_vector(
    id="item_1",
    content="Python programming",
    embedding=[0.1, 0.2, ...],
    category="knowledge",
    metadata={"source": "conversation"},
)
```

#### search_similar()

搜索相似向量。

```python
results = store.search_similar(
    query_embedding=[0.1, 0.2, ...],
    k=5,
)
```

**返回**：`list[dict]` - 相似向量列表

---

### BM25

BM25 检索算法。

#### 初始化

```python
from src.agents.memory.search.bm25 import BM25

bm25 = BM25(k1=1.5, b=0.75)
```

#### fit()

构建索引。

```python
documents = [
    "Python is a programming language",
    "JavaScript is also a programming language",
]
bm25.fit(documents)
```

#### search()

搜索文档。

```python
results = bm25.search(
    query="Python programming",
    top_k=5,
)
```

**返回**：`list[dict]` - 搜索结果列表

---

## 嵌入模块

### EmbeddingProvider

嵌入提供者基类。

```python
from src.agents.memory.search.embeddings import EmbeddingProvider

class MyEmbedding(EmbeddingProvider):
    def embed(self, text: str) -> list[float]:
        # 实现嵌入逻辑
        pass

    def embed_batch(self, texts: list[str]) -> list[list[float]]:
        # 实现批量嵌入逻辑
        pass
```

---

### SentenceTransformerEmbedding

本地 sentence-transformers 嵌入。

```python
from src.agents.memory.search.embeddings import SentenceTransformerEmbedding

provider = SentenceTransformerEmbedding(
    model_name="all-MiniLM-L6-v2"
)

# 单个文本嵌入
embedding = provider.embed("Python programming")

# 批量嵌入
embeddings = provider.embed_batch([
    "Python programming",
    "JavaScript coding",
])
```

---

### OpenAIEmbedding

OpenAI 嵌入。

```python
from src.agents.memory.search.embeddings import OpenAIEmbedding

provider = OpenAIEmbedding(
    model="text-embedding-3-small",
    api_key="sk-...",
)

# 单个文本嵌入
embedding = provider.embed("Python programming")

# 批量嵌入
embeddings = provider.embed_batch([
    "Python programming",
    "JavaScript coding",
])
```

---

## 配置

### MemoryRuntimeConfig

运行时配置类。

```python
from src.agents.memory.config import MemoryRuntimeConfig

config = MemoryRuntimeConfig(
    # 嵌入配置
    embedding_provider="local",
    embedding_model="all-MiniLM-L6-v2",

    # 搜索配置
    vector_weight=0.5,
    bm25_weight=0.5,
    bm25_k1=1.5,
    bm25_b=0.75,

    # 主动记忆配置
    proactive_enabled=True,
    fast_mode_threshold=0.8,
    deep_mode_threshold=0.5,

    # 进化配置
    evolution_enabled=True,
    compression_threshold=0.7,
    merge_similarity_threshold=0.85,
    staleness_threshold_days=90,
    max_items_before_compress=1000,
)
```

---

## 数据类型

### MemoryItem

记忆项数据类。

```python
from src.agents.memory.types import MemoryItem, MemoryCategory

item = MemoryItem(
    id="item_001",                    # 自动生成
    content="用户喜欢 Python 编程",
    category=MemoryCategory.PREFERENCE,
    confidence=0.9,
    entities=[],                      # 实体列表
    relations=[],                     # 关系列表
    source_resource_id="conv_001",    # 来源资源 ID
    created_at=datetime.utcnow(),     # 创建时间
    last_accessed=datetime.utcnow(),  # 最后访问时间
    access_count=0,                   # 访问次数
)
```

---

### Entity

实体数据类。

```python
from src.agents.memory.types import Entity

entity = Entity(
    name="Python",
    type="programming_language",
    mentions=5,
)
```

---

### Relation

关系数据类。

```python
from src.agents.memory.types import Relation

relation = Relation(
    type="prefers",
    target="Python",
    confidence=0.9,
)
```

---

## 错误处理

### 异常类型

Memory v2.0 使用标准 Python 异常：

- `ImportError`: 缺少依赖（如 sentence-transformers）
- `FileNotFoundError`: 配置文件或数据文件不存在
- `ValueError`: 参数值无效
- `RuntimeError`: 运行时错误

**示例**：
```python
try:
    manager = MemoryManager()
    results = manager.search("Python")
except ImportError as e:
    print(f"缺少依赖: {e}")
except FileNotFoundError as e:
    print(f"文件不存在: {e}")
except Exception as e:
    print(f"未知错误: {e}")
```

---

## 最佳实践

### 1. 使用单例模式

```python
# 推荐：使用全局函数获取单例
from src.agents.memory import get_memory_manager

manager = get_memory_manager()

# 不推荐：每次创建新实例
manager = MemoryManager()  # 会创建多个实例
```

### 2. 正确关闭管理器

```python
# 使用 try-finally 确保关闭
manager = get_memory_manager()
try:
    results = manager.search("Python")
finally:
    manager.close()

# 或使用上下文管理器（如果支持）
with get_memory_manager() as manager:
    results = manager.search("Python")
```

### 3. 批量操作

```python
# 推荐：批量存储
items = [
    {"content": "Item 1", "category": "knowledge", "confidence": 0.8},
    {"content": "Item 2", "category": "knowledge", "confidence": 0.9},
]
for item in items:
    manager.store_item(item)

# 不推荐：频繁创建管理器
for item in items:
    manager = MemoryManager()
    manager.store_item(item)
    manager.close()
```

### 4. 错误处理

```python
# 推荐：捕获特定异常
try:
    results = manager.search("Python")
except ImportError:
    print("请安装 sentence-transformers")
except Exception as e:
    print(f"搜索失败: {e}")

# 不推荐：捕获所有异常
try:
    results = manager.search("Python")
except:
    pass  # 忽略所有错误
```

---

## 性能优化

### 1. 使用批量嵌入

```python
# 推荐：批量嵌入
texts = ["Text 1", "Text 2", "Text 3"]
embeddings = provider.embed_batch(texts)

# 不推荐：逐个嵌入
embeddings = [provider.embed(text) for text in texts]
```

### 2. 缓存查询结果

```python
# 缓存频繁查询的结果
cache = {}

def cached_search(query, top_k=5):
    if query not in cache:
        cache[query] = manager.search(query, top_k=top_k)
    return cache[query]
```

### 3. 定期进化

```python
# 定期运行进化以优化性能
import schedule

def evolve_memory():
    manager = get_memory_manager()
    report = manager.evolve()
    print(f"进化完成: {len(report['actions'])} 个操作")

# 每周运行一次
schedule.every().week.do(evolve_memory)
```

---

## 版本兼容性

### v1 兼容模式

Memory v2.0 支持 v1 兼容模式，可以读取和更新 v1 格式的记忆数据。

```python
# 启用 v1 兼容模式（默认）
manager = MemoryManager(enable_legacy=True)

# 获取 v1 格式数据
data = manager.get_memory_data()
if "legacy" in data:
    v1_data = data["legacy"]
    print(f"v1 事实数量: {len(v1_data.get('facts', []))}")
```

### 迁移到 v2

```python
# 1. 读取 v1 数据
from src.agents.memory.updater import get_memory_data as get_v1_data

v1_data = get_v1_data()

# 2. 转换为 v2 格式
manager = MemoryManager()
for fact in v1_data.get("facts", []):
    manager.store_item({
        "content": fact["content"],
        "category": fact["category"],
        "confidence": fact["confidence"],
    })

# 3. 禁用 v1 兼容模式
manager = MemoryManager(enable_legacy=False)
```

---

## 相关文档

- [用户使用指南](./MEMORY_V2_USER_GUIDE.md) - 快速开始和使用说明
- [故障排查指南](./MEMORY_V2_TROUBLESHOOTING.md) - 常见问题解决方案
- [实施状态报告](./MEMORY_V2_FINAL_STATUS_REPORT.md) - 系统实施状态
- [补全计划](./MEMORY_V2_COMPLETION_PLAN.md) - 功能补全计划

---

**文档结束**
