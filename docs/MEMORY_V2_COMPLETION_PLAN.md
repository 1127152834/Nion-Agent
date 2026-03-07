# Memory v2.0 补全计划

> 生成时间: 2026-03-06
> 基于: MEMORY_V2_COMPLETION_STATUS.md
> 目标: 补全 Memory v2.0 系统的剩余功能

---

## 📋 执行摘要

Memory v2.0 系统的**核心功能已 100% 完成**，包括：
- ✅ 三层记忆架构（Resource → Item → Category）
- ✅ 混合搜索（BM25 + Vector）
- ✅ 主动记忆（Dual-Mode 检索）
- ✅ 自我进化引擎
- ✅ Soul/Identity 系统
- ✅ 向量模型配置（95% 完成）

**待补全功能**主要集中在：
1. 配置持久化（向量模型配置）
2. 测试覆盖
3. 文档完善
4. 可选的增强功能

---

## 🎯 补全任务清单

### 任务 1: 向量模型配置持久化 ⭐⭐⭐

**优先级**: 高
**预计工作量**: 2-3 小时
**依赖**: 无

#### 当前状态

`EmbeddingModelsService.set_active_model()` 方法只返回成功消息，没有实际写入配置文件。

#### 实施步骤

**Step 1.1: 实现配置写入逻辑**

修改 `backend/backend/src/embedding_models/service.py` 的 `set_active_model()` 方法：

```python
def set_active_model(
    self,
    provider: str,
    model: str,
    **kwargs: Any,
) -> dict[str, Any]:
    """Set active embedding model and persist to config file."""
    try:
        from pathlib import Path
        import yaml
        from src.config import get_config

        # 1. 读取当前配置文件
        config = get_config()
        config_path = getattr(config, '_config_path', None)

        if not config_path:
            # 尝试查找配置文件
            possible_paths = [
                Path.cwd() / 'config.yaml',
                Path.cwd().parent / 'config.yaml',
            ]
            for path in possible_paths:
                if path.exists():
                    config_path = path
                    break

        if not config_path or not Path(config_path).exists():
            raise EmbeddingModelsError(
                "Config file not found. Cannot persist configuration.",
                "config_not_found"
            )

        # 2. 读取 YAML 配置
        with open(config_path, 'r', encoding='utf-8') as f:
            config_data = yaml.safe_load(f)

        # 3. 更新 embedding 配置
        if 'embedding' not in config_data:
            config_data['embedding'] = {}

        config_data['embedding']['enabled'] = True
        config_data['embedding']['provider'] = provider

        # 更新提供者特定配置
        if provider == 'local':
            if 'local' not in config_data['embedding']:
                config_data['embedding']['local'] = {}
            config_data['embedding']['local']['model'] = model
            if 'device' in kwargs:
                config_data['embedding']['local']['device'] = kwargs['device']

        elif provider == 'openai':
            if 'openai' not in config_data['embedding']:
                config_data['embedding']['openai'] = {}
            config_data['embedding']['openai']['model'] = model
            if 'api_key' in kwargs:
                config_data['embedding']['openai']['api_key'] = kwargs['api_key']
            if 'dimension' in kwargs:
                config_data['embedding']['openai']['dimension'] = kwargs['dimension']

        elif provider == 'custom':
            if 'custom' not in config_data['embedding']:
                config_data['embedding']['custom'] = {}
            config_data['embedding']['custom']['model'] = model
            if 'api_base' in kwargs:
                config_data['embedding']['custom']['api_base'] = kwargs['api_base']
            if 'api_key' in kwargs:
                config_data['embedding']['custom']['api_key'] = kwargs['api_key']
            if 'dimension' in kwargs:
                config_data['embedding']['custom']['dimension'] = kwargs['dimension']

        # 4. 写回配置文件
        with open(config_path, 'w', encoding='utf-8') as f:
            yaml.safe_dump(config_data, f, allow_unicode=True, default_flow_style=False)

        return {
            "success": True,
            "provider": provider,
            "model": model,
            "message": "Configuration saved successfully. Restart may be required for changes to take effect.",
            "config_path": str(config_path),
        }

    except Exception as e:
        logger.error(f"Failed to save configuration: {e}")
        raise EmbeddingModelsError(
            f"Failed to save configuration: {str(e)}",
            "save_failed"
        )
```

**Step 1.2: 添加配置重载功能**

在 `backend/src/agents/memory/memory.py` 中添加配置重载支持：

```python
def reload_memory_manager(agent_name: str | None = None) -> MemoryManager:
    """Force recreate manager for one scope."""
    # 重新加载配置
    from src.config import reload_config
    reload_config()  # 如果有这个函数的话

    return get_memory_manager(agent_name=agent_name, reload=True)
```

**Step 1.3: 前端提示用户重启**

修改 `frontend/src/components/workspace/settings/embedding-settings-page.tsx` 的 `handleSave()` 方法：

```typescript
const handleSave = async () => {
  setSaving(true);
  try {
    // ... 现有代码 ...

    const response = await setActiveEmbeddingModel(payload);
    if (response.status === "ok") {
      toast.success("保存成功", {
        description: "配置已更新。建议重启应用以使更改生效。",
        action: {
          label: "重启应用",
          onClick: () => {
            // 如果是桌面端，可以调用重启 API
            // 如果是 Web 端，提示用户刷新页面
            window.location.reload();
          },
        },
      });
      await loadStatus();
    }
    // ... 现有代码 ...
  }
  // ... 现有代码 ...
};
```

#### 验收标准

- [ ] `set_active_model()` 成功写入配置文件
- [ ] 配置文件格式正确（YAML）
- [ ] 重启后配置生效
- [ ] 前端显示保存成功提示
- [ ] 错误处理完善

---

### 任务 2: 测试覆盖 ⭐⭐⭐

**优先级**: 高
**预计工作量**: 1-2 周
**依赖**: 无

#### 实施步骤

**Step 2.1: 创建测试目录结构**

```bash
backend/tests/agents/memory/
├── __init__.py
├── test_types.py
├── test_embeddings.py
├── test_bm25.py
├── test_vector_store.py
├── test_hybrid_search.py
├── test_resource_layer.py
├── test_item_layer.py
├── test_category_layer.py
├── test_dual_mode.py
├── test_self_evolver.py
├── test_memory_manager.py
└── test_integration.py
```

**Step 2.2: 编写单元测试示例**

`backend/tests/agents/memory/test_embeddings.py`:

```python
"""Test embedding providers."""

import pytest
from src.agents.memory.search.embeddings import (
    SentenceTransformerEmbedding,
    OpenAIEmbedding,
)


def test_sentence_transformer_embed():
    """Test SentenceTransformer embedding."""
    provider = SentenceTransformerEmbedding(model_name="all-MiniLM-L6-v2")

    text = "This is a test sentence."
    embedding = provider.embed(text)

    assert isinstance(embedding, list)
    assert len(embedding) == 384  # MiniLM-L6-v2 dimension
    assert all(isinstance(x, float) for x in embedding)


def test_sentence_transformer_embed_batch():
    """Test batch embedding."""
    provider = SentenceTransformerEmbedding(model_name="all-MiniLM-L6-v2")

    texts = ["First sentence.", "Second sentence.", "Third sentence."]
    embeddings = provider.embed_batch(texts)

    assert isinstance(embeddings, list)
    assert len(embeddings) == 3
    assert all(len(emb) == 384 for emb in embeddings)


@pytest.mark.skipif(
    not os.getenv("OPENAI_API_KEY"),
    reason="OpenAI API key not available"
)
def test_openai_embed():
    """Test OpenAI embedding."""
    provider = OpenAIEmbedding(
        model="text-embedding-3-small",
        api_key=os.getenv("OPENAI_API_KEY")
    )

    text = "This is a test sentence."
    embedding = provider.embed(text)

    assert isinstance(embedding, list)
    assert len(embedding) == 1536  # text-embedding-3-small dimension
```

**Step 2.3: 编写集成测试示例**

`backend/tests/agents/memory/test_integration.py`:

```python
"""Integration tests for memory system."""

import pytest
from pathlib import Path
from src.agents.memory.memory import MemoryManager


@pytest.fixture
def temp_memory_dir(tmp_path):
    """Create temporary memory directory."""
    return tmp_path / "memory_test"


def test_end_to_end_memory_flow(temp_memory_dir):
    """Test complete memory flow: store → search → retrieve."""
    # 1. Create memory manager
    manager = MemoryManager(base_dir=temp_memory_dir)

    # 2. Store conversation
    conversation = {
        "id": "conv_test_001",
        "type": "conversation",
        "content": "User likes Python programming and uses VS Code.",
        "metadata": {"thread_id": "test_thread"},
    }
    manager.store_conversation(conversation)

    # 3. Store memory item
    item = {
        "content": "User prefers Python for backend development",
        "category": "preference",
        "confidence": 0.9,
    }
    stored_item = manager.store_item(item)

    # 4. Search memory
    results = manager.search("What programming language does user like?", top_k=5)

    # 5. Verify results
    assert results["mode"] in ["fast", "deep"]
    assert len(results["results"]) > 0
    assert any("Python" in r.get("content", "") for r in results["results"])

    # 6. Cleanup
    manager.close()
```

**Step 2.4: 编写性能测试**

`backend/tests/agents/memory/test_performance.py`:

```python
"""Performance tests for memory system."""

import time
import pytest
from src.agents.memory.memory import MemoryManager


def test_search_performance_1000_items(temp_memory_dir):
    """Test search performance with 1000 memory items."""
    manager = MemoryManager(base_dir=temp_memory_dir)

    # Store 1000 items
    for i in range(1000):
        item = {
            "content": f"Memory item {i}: This is test content about topic {i % 10}",
            "category": "knowledge",
            "confidence": 0.8,
        }
        manager.store_item(item)

    # Measure search time
    start_time = time.time()
    results = manager.search("topic 5", top_k=10)
    search_time = time.time() - start_time

    # Verify performance
    assert search_time < 1.0  # Should complete within 1 second
    assert len(results["results"]) > 0

    manager.close()
```

#### 验收标准

- [ ] 单元测试覆盖率 > 80%
- [ ] 所有核心模块有测试
- [ ] 集成测试通过
- [ ] 性能测试通过
- [ ] CI/CD 集成

---

### 任务 3: 文档完善 ⭐⭐

**优先级**: 中
**预计工作量**: 3-5 天
**依赖**: 无

#### 实施步骤

**Step 3.1: 创建用户使用指南**

`docs/MEMORY_V2_USER_GUIDE.md`:

```markdown
# Memory v2.0 用户指南

## 快速开始

### 1. 配置向量模型

在设置页面中配置向量嵌入模型：

1. 打开设置 → 向量模型
2. 选择提供者（本地/OpenAI/自定义）
3. 选择模型
4. 测试连接
5. 保存配置

### 2. 使用记忆系统

记忆系统会自动学习你的对话内容：

- 自动提取事实和知识
- 自动分类记忆
- 自动建立关联

### 3. 搜索记忆

使用自然语言搜索记忆：

```python
from src.agents.memory import get_memory_manager

manager = get_memory_manager()
results = manager.search("我喜欢什么编程语言？", top_k=5)
```

## 高级功能

### Dual-Mode 检索

系统会自动选择最佳检索模式：

- **Fast Mode**: 快速简单搜索
- **Deep Mode**: LLM 参与推理

### 自我进化

系统会自动优化记忆：

- 合并相似记忆
- 清理陈旧记忆
- 优化类别结构

## 配置选项

详见 `config.yaml` 中的 `memory` 配置节。
```

**Step 3.2: 创建 API 参考文档**

`docs/MEMORY_V2_API_REFERENCE.md`:

```markdown
# Memory v2.0 API 参考

## MemoryManager

### 初始化

```python
from src.agents.memory import MemoryManager

manager = MemoryManager(
    base_dir="/path/to/memory",
    embedding_provider=None,  # 自动从配置加载
    llm=None,  # 可选，用于 Deep Mode
)
```

### 方法

#### store_conversation(resource: dict) -> dict

存储原始对话资源。

**参数**:
- `resource`: 资源字典，包含 `id`, `type`, `content`, `metadata`

**返回**: 存储的资源字典

#### store_item(item: dict) -> dict

存储结构化记忆项。

**参数**:
- `item`: 记忆项字典，包含 `content`, `category`, `confidence` 等

**返回**: 存储的记忆项字典

#### search(query: str, top_k: int = 5) -> dict

搜索记忆。

**参数**:
- `query`: 搜索查询
- `top_k`: 返回结果数量

**返回**: 搜索结果字典，包含 `mode`, `results`, `reasoning`

## 更多 API

详见各模块的文档字符串。
```

**Step 3.3: 创建故障排查指南**

`docs/MEMORY_V2_TROUBLESHOOTING.md`:

```markdown
# Memory v2.0 故障排查指南

## 常见问题

### 1. 向量模型加载失败

**症状**: 启动时报错 "Failed to load embedding model"

**解决方案**:
1. 检查是否安装了 `sentence-transformers`: `pip install sentence-transformers`
2. 检查模型名称是否正确
3. 检查网络连接（首次使用会下载模型）

### 2. 搜索结果不准确

**症状**: 搜索返回不相关的结果

**解决方案**:
1. 检查向量模型是否正确加载
2. 调整混合搜索权重（`config.yaml` 中的 `vector_weight` 和 `bm25_weight`）
3. 增加记忆项数量（系统需要足够的数据才能准确检索）

### 3. 内存占用过高

**症状**: 系统内存占用持续增长

**解决方案**:
1. 检查是否有内存泄漏（运行 `evolve()` 清理陈旧记忆）
2. 调整 `max_items_before_compress` 配置
3. 定期运行自我进化

## 日志调试

启用详细日志：

```python
import logging
logging.basicConfig(level=logging.DEBUG)
```

## 性能优化

详见 `docs/MEMORY_V2_PERFORMANCE.md`
```

#### 验收标准

- [ ] 用户使用指南完整
- [ ] API 参考文档完整
- [ ] 故障排查指南完整
- [ ] 配置说明文档完整
- [ ] 所有文档经过审核

---

### 任务 4: 知识图谱增强 ⭐ (可选)

**优先级**: 低
**预计工作量**: 2-3 周
**依赖**: 任务 1, 2

#### 实施步骤

**Step 4.1: 实体识别和提取**

使用 NER 模型提取实体：

```python
# backend/src/agents/memory/knowledge_graph/entity_extractor.py

from typing import List, Dict
from transformers import pipeline

class EntityExtractor:
    """Extract entities from text using NER model."""

    def __init__(self, model_name: str = "dslim/bert-base-NER"):
        self.ner = pipeline("ner", model=model_name, aggregation_strategy="simple")

    def extract(self, text: str) -> List[Dict]:
        """Extract entities from text."""
        entities = self.ner(text)
        return [
            {
                "name": ent["word"],
                "type": ent["entity_group"].lower(),
                "score": ent["score"],
            }
            for ent in entities
        ]
```

**Step 4.2: 关系抽取**

使用 LLM 提取关系：

```python
# backend/src/agents/memory/knowledge_graph/relation_extractor.py

class RelationExtractor:
    """Extract relations between entities using LLM."""

    def __init__(self, llm):
        self.llm = llm

    def extract(self, text: str, entities: List[Dict]) -> List[Dict]:
        """Extract relations between entities."""
        prompt = f"""
        Given the following text and entities, extract relationships between them.

        Text: {text}
        Entities: {entities}

        Return a list of relations in the format:
        [
            {{"source": "entity1", "relation": "works_on", "target": "entity2"}},
            ...
        ]
        """

        response = self.llm.invoke(prompt)
        # Parse response and return relations
        return parse_relations(response)
```

**Step 4.3: 知识图谱构建**

```python
# backend/src/agents/memory/knowledge_graph/graph_builder.py

import networkx as nx

class KnowledgeGraphBuilder:
    """Build knowledge graph from memory items."""

    def __init__(self):
        self.graph = nx.DiGraph()

    def add_item(self, item: Dict):
        """Add memory item to graph."""
        # Add entities as nodes
        for entity in item.get("entities", []):
            self.graph.add_node(
                entity["name"],
                type=entity["type"],
                mentions=entity.get("mentions", 1)
            )

        # Add relations as edges
        for relation in item.get("relations", []):
            self.graph.add_edge(
                relation["source"],
                relation["target"],
                type=relation["type"],
                confidence=relation.get("confidence", 1.0)
            )

    def query(self, entity: str, max_depth: int = 2) -> Dict:
        """Query knowledge graph."""
        # Find all connected entities within max_depth
        subgraph = nx.ego_graph(self.graph, entity, radius=max_depth)
        return {
            "nodes": list(subgraph.nodes(data=True)),
            "edges": list(subgraph.edges(data=True)),
        }
```

#### 验收标准

- [ ] 实体识别准确率 > 80%
- [ ] 关系抽取准确率 > 70%
- [ ] 知识图谱可视化
- [ ] 知识图谱查询功能
- [ ] 性能测试通过

---

### 任务 5: 主动记忆高级功能 ⭐ (可选)

**优先级**: 低
**预计工作量**: 1-2 周
**依赖**: 任务 1, 2

#### 实施步骤

**Step 5.1: 智能上下文预加载**

增强 `proactive/context_loader.py`：

```python
class SmartContextLoader:
    """Smart context preloading based on user patterns."""

    def __init__(self, memory_manager, pattern_analyzer):
        self.memory_manager = memory_manager
        self.pattern_analyzer = pattern_analyzer

    def preload(self, current_context: Dict) -> List[Dict]:
        """Preload relevant context based on patterns."""
        # 1. Analyze current context
        patterns = self.pattern_analyzer.analyze(current_context)

        # 2. Predict next topics
        predicted_topics = self._predict_topics(patterns)

        # 3. Preload relevant memories
        preloaded = []
        for topic in predicted_topics:
            results = self.memory_manager.search(topic, top_k=3)
            preloaded.extend(results["results"])

        return preloaded

    def _predict_topics(self, patterns: Dict) -> List[str]:
        """Predict next topics based on patterns."""
        # Use pattern analysis to predict
        # e.g., if user often asks about Python after discussing projects
        return patterns.get("likely_next_topics", [])
```

**Step 5.2: 使用模式分析增强**

增强 `proactive/patterns.py`：

```python
class AdvancedPatternAnalyzer:
    """Advanced usage pattern analysis."""

    def __init__(self):
        self.patterns = {}

    def record(self, event: Dict):
        """Record usage event."""
        # Record: query, results, time, context
        event_type = event.get("type")
        if event_type not in self.patterns:
            self.patterns[event_type] = []
        self.patterns[event_type].append(event)

    def analyze(self, context: Dict) -> Dict:
        """Analyze patterns and return insights."""
        return {
            "frequent_topics": self._get_frequent_topics(),
            "time_patterns": self._get_time_patterns(),
            "topic_sequences": self._get_topic_sequences(),
            "likely_next_topics": self._predict_next_topics(context),
        }

    def _get_frequent_topics(self) -> List[str]:
        """Get most frequently accessed topics."""
        # Analyze query patterns
        pass

    def _get_time_patterns(self) -> Dict:
        """Get time-based patterns."""
        # e.g., user asks about work in morning, personal in evening
        pass

    def _get_topic_sequences(self) -> List[List[str]]:
        """Get common topic sequences."""
        # e.g., [project] -> [Python] -> [debugging]
        pass

    def _predict_next_topics(self, context: Dict) -> List[str]:
        """Predict next likely topics."""
        # Use sequence patterns to predict
        pass
```

#### 验收标准

- [ ] 上下文预加载准确率 > 70%
- [ ] 模式分析有效
- [ ] 性能影响 < 10%
- [ ] 用户体验改善

---

## 📅 实施时间表

### 第 1 周: 配置持久化 + 测试框架

- Day 1-2: 实现配置持久化（任务 1）
- Day 3-5: 创建测试框架和基础测试（任务 2.1-2.2）

### 第 2-3 周: 测试覆盖

- Week 2: 编写单元测试（任务 2.2）
- Week 3: 编写集成测试和性能测试（任务 2.3-2.4）

### 第 4 周: 文档完善

- Day 1-2: 用户使用指南（任务 3.1）
- Day 3-4: API 参考文档（任务 3.2）
- Day 5: 故障排查指南（任务 3.3）

### 第 5-7 周: 可选增强功能

- Week 5-6: 知识图谱增强（任务 4，可选）
- Week 7: 主动记忆高级功能（任务 5，可选）

---

## ✅ 验收标准

### 必需完成

- [ ] 配置持久化功能正常工作
- [ ] 测试覆盖率 > 80%
- [ ] 所有核心功能有文档
- [ ] CI/CD 集成

### 可选完成

- [ ] 知识图谱功能
- [ ] 主动记忆高级功能
- [ ] 性能优化

---

## 📊 成功指标

1. **功能完整性**: 所有必需功能 100% 完成
2. **代码质量**: 测试覆盖率 > 80%，无严重 bug
3. **文档质量**: 所有核心功能有完整文档
4. **性能指标**:
   - 1000 条记忆检索 < 1 秒
   - 向量生成 < 100ms
   - 内存占用 < 500MB

---

## 🔗 相关文档

- [MEMORY_V2_COMPLETION_STATUS.md](./MEMORY_V2_COMPLETION_STATUS.md) - 实施状态报告
- [MEMORY_SYSTEM_IMPLEMENTATION_PLAN.md](./MEMORY_SYSTEM_IMPLEMENTATION_PLAN.md) - 原始实施计划
- [MEMORY_SYSTEM_UPGRADE_PLAN.md](./MEMORY_SYSTEM_UPGRADE_PLAN.md) - 升级计划
- [MEMORY_SYSTEM_CODEX_GUIDE.md](./MEMORY_SYSTEM_CODEX_GUIDE.md) - Codex 执行指南
- [EMBEDDING_MODELS_IMPLEMENTATION.md](./EMBEDDING_MODELS_IMPLEMENTATION.md) - 向量模型配置实施文档

---

**文档结束**
