# Codex 执行指南 - 记忆系统 v2.0

> 给 Codex 看的详细上下文和执行指南

---

## 上下文

你是 Codex，需要实现 Nion-Agent 的记忆系统升级。

### 现有代码位置

```
backend/src/agents/memory/
├── __init__.py          # 现有导出
├── prompt.py            # 现有提示词
├── queue.py             # 现有队列 (Threading)
├── updater.py           # 现有 LLM 驱动更新
└── middlewares/
    └── memory_middleware.py  # 现有中间件

backend/src/config/
└── memory_config.py     # 现有配置
```

### 新代码位置

所有新代码创建在:
```
backend/src/agents/memory/
```

---

## Step 1: 类型定义

### 文件: `backend/src/agents/memory/types.py`

```python
"""记忆系统数据类型定义"""
from dataclasses import dataclass, field
from datetime import datetime
from typing import List, Dict, Optional
from enum import Enum
import uuid

class MemoryCategory(Enum):
    """记忆类别"""
    PREFERENCE = "preference"
    KNOWLEDGE = "knowledge"
    CONTEXT = "context"
    BEHAVIOR = "behavior"
    GOAL = "goal"
    PROJECT = "project"

@dataclass
class Entity:
    """实体"""
    name: str
    type: str  # person, project, tool, concept
    mentions: int = 1

@dataclass
class Relation:
    """关系"""
    type: str  # works_on, prefers, knows, manages
    target: str
    confidence: float = 1.0

@dataclass
class MemoryItem:
    """记忆项"""
    id: str = field(default_factory=lambda: f"item_{uuid.uuid4().hex[:8]}")
    content: str = ""
    category: MemoryCategory = MemoryCategory.CONTEXT
    confidence: float = 0.5

    entities: List[Entity] = field(default_factory=list)
    relations: List[Relation] = field(default_factory=list)

    source_resource_id: Optional[str] = None
    created_at: datetime = field(default_factory=datetime.utcnow)
    last_accessed: datetime = field(default_factory=datetime.utcnow)
    access_count: int = 0

    aggregated_from: List[str] = field(default_factory=list)

@dataclass
class RawResource:
    """原始资源"""
    id: str = field(default_factory=lambda: f"res_{uuid.uuid4().hex[:8]}")
    type: str = "conversation"  # conversation, file, event
    content: any = None
    metadata: Dict = field(default_factory=dict)
    created_at: datetime = field(default_factory=datetime.utcnow)

# 导出
__all__ = [
    "MemoryCategory",
    "Entity",
    "Relation",
    "MemoryItem",
    "RawResource",
]
```

---

## Step 2: 嵌入支持

### 文件: `backend/src/agents/memory/search/embeddings.py`

```python
"""向量嵌入支持"""
from abc import ABC, abstractmethod
from typing import List
import numpy as np

class EmbeddingProvider(ABC):
    @abstractmethod
    def embed(self, text: str) -> List[float]:
        pass

    @abstractmethod
    def embed_batch(self, texts: List[str]) -> List[List[float]]:
        pass

class SentenceTransformerEmbedding(EmbeddingProvider):
    """本地 sentence-transformers 嵌入"""
    def __init__(self, model_name: str = "all-MiniLM-L6-v2"):
        from sentence_transformers import SentenceTransformer
        self.model = SentenceTransformer(model_name)

    def embed(self, text: str) -> List[float]:
        return self.model.encode(text).tolist()

    def embed_batch(self, texts: List[str]) -> List[List[float]]:
        return self.model.encode(texts).tolist()

class OpenAIEmbedding(EmbeddingProvider):
    """OpenAI 嵌入"""
    def __init__(self, model: str = "text-embedding-3-small", api_key: str = None):
        from openai import OpenAI
        self.client = OpenAI(api_key=api_key)
        self.model = model

    def embed(self, text: str) -> List[float]:
        response = self.client.embeddings.create(
            model=self.model,
            input=text
        )
        return response.data[0].embedding

    def embed_batch(self, texts: List[str]) -> List[List[float]]:
        response = self.client.embeddings.create(
            model=self.model,
            input=texts
        )
        return [item.embedding for item in response.data]

__all__ = ["EmbeddingProvider", "SentenceTransformerEmbedding", "OpenAIEmbedding"]
```

---

## Step 3: BM25

### 文件: `backend/src/agents/memory/search/bm25.py`

```python
"""BM25 检索实现"""
import math
from collections import Counter
from typing import List, Dict

class BM25:
    """BM25 检索算法"""
    def __init__(self, k1: float = 1.5, b: float = 0.75):
        self.k1 = k1
        self.b = b
        self.documents: List[str] = []
        self.doc_lengths: List[int] = []
        self.avgdl: float = 0
        self.idf: Dict[str, float] = {}
        self.corpus_size: int = 0

    def _tokenize(self, text: str) -> List[str]:
        import re
        return re.findall(r'\w+', text.lower())

    def fit(self, documents: List[str]):
        """构建索引"""
        self.documents = documents
        self.corpus_size = len(documents)
        self.doc_lengths = [len(self._tokenize(doc)) for doc in documents]
        self.avgdl = sum(self.doc_lengths) / max(self.corpus_size, 1)

        # 计算 IDF
        doc_freqs = Counter()
        for doc in documents:
            tokens = set(self._tokenize(doc))
            for token in tokens:
                doc_freqs[token] += 1

        for token, df in doc_freqs.items():
            self.idf[token] = math.log((self.corpus_size - df + 0.5) / (df + 0.5) + 1)

    def search(self, query: str, top_k: int = 5) -> List[Dict]:
        """搜索"""
        query_tokens = self._tokenize(query)
        scores = []

        for idx, doc in enumerate(self.documents):
            doc_tokens = self._tokenize(doc)
            doc_len = self.doc_lengths[idx]
            doc_tf = Counter(doc_tokens)

            score = 0
            for token in query_tokens:
                if token in self.idf:
                    tf = doc_tf.get(token, 0)
                    idf = self.idf[token]
                    numerator = tf * (self.k1 + 1)
                    denominator = tf + self.k1 * (1 - self.b + self.b * doc_len / self.avgdl)
                    score += idf * numerator / denominator

            if score > 0:
                scores.append({
                    "idx": idx,
                    "score": score,
                    "document": doc
                })

        scores.sort(key=lambda x: x["score"], reverse=True)
        return scores[:top_k]

__all__ = ["BM25"]
```

---

## Step 4: 向量存储

### 文件: `backend/src/agents/memory/search/vector_store.py`

```python
"""SQLite 向量存储"""
import sqlite3
import json
import numpy as np
from typing import List, Dict, Optional

class VectorStore:
    """向量存储"""
    def __init__(self, db_path: str):
        self.db_path = db_path
        self.conn = sqlite3.connect(db_path)
        self._init_schema()

    def _init_schema(self):
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS memory_vectors (
                id TEXT PRIMARY KEY,
                content TEXT NOT NULL,
                category TEXT,
                embedding BLOB,
                metadata TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_accessed TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                access_count INTEGER DEFAULT 0
            )
        """)
        self.conn.commit()

    def add_vector(self, id: str, content: str, embedding: List[float],
                   category: str = None, metadata: dict = None):
        """添加向量"""
        self.conn.execute("""
            INSERT OR REPLACE INTO memory_vectors
            (id, content, category, embedding, metadata)
            VALUES (?, ?, ?, ?, ?)
        """, (id, content, category,
              np.array(embedding).astype(np.float32).tobytes(),
              json.dumps(metadata) if metadata else None))
        self.conn.commit()

    def search_similar(self, query_embedding: List[float], k: int = 5) -> List[Dict]:
        """向量相似度搜索 (简化版，使用内积)"""
        cursor = self.conn.execute(
            "SELECT id, content, category, embedding, access_count FROM memory_vectors"
        )

        results = []
        query_vec = np.array(query_embedding)
        query_norm = np.linalg.norm(query_vec)

        for row in cursor.fetchall():
            stored_embedding = np.frombuffer(row[3], dtype=np.float32)
            similarity = np.dot(stored_embedding, query_vec) / (
                np.linalg.norm(stored_embedding) * query_norm + 1e-8
            )
            results.append({
                "id": row[0],
                "content": row[1],
                "category": row[2],
                "similarity": float(similarity),
                "access_count": row[4]
            })

        results.sort(key=lambda x: x["similarity"], reverse=True)
        return results[:k]

    def update_access(self, id: str):
        """更新访问统计"""
        self.conn.execute("""
            UPDATE memory_vectors
            SET access_count = access_count + 1,
                last_accessed = CURRENT_TIMESTAMP
            WHERE id = ?
        """, (id,))
        self.conn.commit()

    def close(self):
        self.conn.close()

__all__ = ["VectorStore"]
```

---

## Step 5: 混合搜索

### 文件: `backend/src/agents/memory/search/hybrid.py`

```python
"""混合搜索"""
from typing import List, Dict
import math

class HybridSearch:
    """混合 BM25 + 向量搜索"""
    def __init__(self, vector_store, bm25,
                 vector_weight: float = 0.5, bm25_weight: float = 0.5):
        self.vector_store = vector_store
        self.bm25 = bm25
        self.vector_weight = vector_weight
        self.bm25_weight = bm25_weight

    def search(self, query: str, query_embedding: List[float],
               top_k: int = 5) -> List[Dict]:
        # 1. BM25 搜索
        bm25_results = self.bm25.search(query, top_k * 2)
        bm25_by_id = {r["document"]: r for r in bm25_results}
        bm25_max = max((r["score"] for r in bm25_results), default=1)

        # 2. 向量搜索
        vector_results = self.vector_store.search_similar(query_embedding, top_k * 2)
        vector_by_id = {r["content"]: r for r in vector_results}
        vector_max = max((r["similarity"] for r in vector_results), default=1)

        # 3. 分数融合
        all_ids = set(bm25_by_id.keys()) | set(vector_by_id.keys())
        fused_scores = []

        for id in all_ids:
            bm25_score = bm25_by_id.get(id, {}).get("score", 0) / bm25_max if bm25_max > 0 else 0
            vector_score = vector_by_id.get(id, {}).get("similarity", 0) / vector_max if vector_max > 0 else 0

            fused = self.vector_weight * vector_score + self.bm25_weight * bm25_score

            # 获取向量结果的信息
            vec = vector_by_id.get(id, {})
            fused_scores.append({
                "id": vec.get("id") or id,
                "content": id,
                "fused_score": fused,
                "category": vec.get("category"),
                "access_count": vec.get("access_count", 0)
            })

        # 4. 排序
        fused_scores.sort(key=lambda x: x["fused_score"], reverse=True)

        # 5. 时间衰减
        for r in fused_scores[:top_k]:
            if r.get("access_count", 0) > 0:
                # 简化: 访问次数多则加分
                r["fused_score"] *= (1 + 0.05 * min(r["access_count"], 10))

        return fused_scores[:top_k]

__all__ = ["HybridSearch"]
```

---

## Step 6-8: 三层架构

由于代码较长，我会创建简化版本。关键是理解架构:

### Layer 1: Resource
- 存储原始对话
- 按月份组织 (YYYY-MM/)

### Layer 2: Item
- 存储结构化记忆项
- 包含 entities, relations
- 与向量存储集成

### Layer 3: Category
- 管理类别
- 生成 Markdown 文件供 LLM 读取
- 自动分类

---

## 执行建议

1. **先跑通 Step 1-5**: 基础设施是核心
2. **每个 Step 独立测试**: 确保基本功能工作
3. **渐进增加复杂度**: 不要一次写太多
4. **参考现有代码风格**: 双引号、类型注解

---

## 关键文件

创建后需要更新:
- `backend/src/agents/memory/__init__.py`: 导出新模块
- `backend/src/config/memory_config.py`: 添加新配置
