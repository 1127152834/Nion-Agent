# Codex 提示词 - 记忆系统 v2.0 开发

---

## 任务目标

为 Nion-Agent 实现记忆系统 v2.0 升级，参考文档:
- `docs/MEMORY_SYSTEM_IMPLEMENTATION_PLAN.md` (详细计划)
- `docs/MEMORY_SYSTEM_CODEX_GUIDE.md` (代码模板)

---

## 现有代码位置

```
backend/src/agents/memory/
├── __init__.py
├── prompt.py
├── queue.py
├── updater.py
└── middlewares/
    └── memory_middleware.py

backend/src/config/
└── memory_config.py
```

---

## 开发要求

### 1. 创建目录结构

在 `backend/src/agents/memory/` 下创建:

```
memory/
├── types.py                 # 数据类型定义
├── search/
│   ├── __init__.py
│   ├── embeddings.py       # 向量嵌入
│   ├── bm25.py            # BM25 索引
│   ├── vector_store.py    # SQLite 向量存储
│   └── hybrid.py          # 混合搜索
└── layers/
    ├── __init__.py
    ├── resource.py         # Layer 1: 原始资源
    ├── item.py             # Layer 2: 记忆项
    └── category.py         # Layer 3: 类别文件
```

### 2. 执行顺序

**Phase 1: 基础设施 (优先)**

1. `types.py` - 定义 MemoryItem, RawResource, Entity, Relation, MemoryCategory
2. `search/embeddings.py` - EmbeddingProvider 抽象类 + SentenceTransformerEmbedding + OpenAIEmbedding
3. `search/bm25.py` - BM25 类，实现 fit() 和 search()
4. `search/vector_store.py` - VectorStore 类，实现 add_vector() 和 search_similar()
5. `search/hybrid.py` - HybridSearch 类，整合 BM25 和向量搜索

**Phase 2: 三层架构**

6. `layers/resource.py` - ResourceLayer 类
7. `layers/item.py` - ItemLayer 类
8. `layers/category.py` - CategoryLayer 类

### 3. 核心实现要点

#### types.py
- MemoryCategory 枚举: PREFERENCE, KNOWLEDGE, CONTEXT, BEHAVIOR, GOAL, PROJECT
- Entity: name, type, mentions
- Relation: type, target, confidence
- MemoryItem: id, content, category, confidence, entities, relations, created_at, last_accessed, access_count

#### embeddings.py
- EmbeddingProvider 抽象类
- SentenceTransformerEmbedding: 使用 sentence-transformers
- OpenAIEmbedding: 使用 openai python SDK

#### bm25.py
- BM25(k1=1.5, b=0.75)
- fit(documents): 构建 IDF 索引
- search(query, top_k): 返回 [{"idx", "score", "document"}]

#### vector_store.py
- SQLite 存储
- add_vector(id, content, embedding, category, metadata)
- search_similar(query_embedding, k): 返回 [{"id", "content", "category", "similarity"}]
- 使用 numpy 计算余弦相似度

#### hybrid.py
- HybridSearch(vector_store, bm25, vector_weight=0.5, bm25_weight=0.5)
- search(query, query_embedding, top_k):
  1. 并行执行 BM25 和向量搜索
  2. 分数归一化后融合
  3. 按融合分数排序返回

#### layers/item.py (关键)
- ItemLayer 需要集成向量存储
- store(item): 存储时生成向量
- search(): 使用 HybridSearch
- update_access(): 更新访问统计

### 4. 更新导出

完成每个模块后，更新 `memory/__init__.py` 导出新模块。

---

## 验收标准

1. 所有模块可以 import 成功
2. BM25 搜索返回正确结果
3. 向量存储和搜索正常工作
4. 混合搜索返回融合结果
5. ItemLayer 可以存储和检索记忆项

---

## 注意事项

- 保持现有代码风格 (双引号、类型注解)
- 不破坏现有功能
- 使用项目中已有的依赖 (numpy, sqlite3)
- 需要新依赖时，在 pyproject.toml 中添加

---

开始开发 Phase 1 的 5 个模块。
