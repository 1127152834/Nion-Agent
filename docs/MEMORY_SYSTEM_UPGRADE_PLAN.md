# Nion-Agent 记忆系统升级计划 (v2.0)

> 详细实施计划 - 对标优质开源项目源码实现
> 版本: 2.0
> 目标: 构建企业级单人 AI 助手记忆系统

---

## 一、当前系统回顾

### 1.1 现有架构

```
Nion-Agent 当前记忆系统:
├── memory.json (结构化存储)
│   ├── user (workContext, personalContext, topOfMind)
│   ├── history (recentMonths, earlierContext, longTermBackground)
│   └── facts[] (离散事实, 5类, 置信度)
├── 检索: TF-IDF + 余弦相似度 + tiktoken
├── 更新: MemoryMiddleware + Queue + Debounce(30s) + LLM驱动
└── Soul: Bootstrap对话生成 + SOUL.md
```

### 1.2 现有代码结构

```
backend/src/agents/memory/
├── __init__.py          # 导出
├── prompt.py            # 提示词模板
├── queue.py             # 异步队列 (Threading)
├── updater.py           # LLM驱动更新
└── middlewares/
    └── memory_middleware.py  # 触发器

backend/src/config/
└── memory_config.py     # 配置
```

---

## 二、目标架构 (详细设计)

### 2.1 最终架构图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Nion-Agent Memory v2.0                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                      Workspace Files (per-agent)                      │   │
│  │  ┌─────────┐ ┌──────────┐ ┌─────────┐ ┌─────────┐ ┌───────────┐   │   │
│  │  │SOUL.md  │ │IDENTITY  │ │ USER.md │ │MEMORY.md│ │HEARTBEAT  │   │   │
│  │  │(性格)   │ │  .md    │ │ (用户)  │ │ (记忆)  │ │   .md    │   │   │
│  │  │         │ │ (展示)   │ │         │ │         │ │(定时任务) │   │   │
│  │  └─────────┘ └──────────┘ └─────────┘ └─────────┘ └───────────┘   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│                                    ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    三层记忆架构 (对标 memU)                          │   │
│  │                                                                      │   │
│  │  Layer 3: Category ─────────────────────────────────────────────    │   │
│  │  • user_preferences.md  (用户偏好)                                  │   │
│  │  • project_context.md   (项目背景)                                  │   │
│  │  • tech_stack.md       (技术栈)                                    │   │
│  │  • personal_goals.md   (个人目标)                                  │   │
│  │  • behavioral_patterns.md (行为模式)                                │   │
│  │                                                                      │   │
│  │  Layer 2: Memory Items ──────────────────────────────────────────    │   │
│  │  • id, content, category, confidence                               │   │
│  │  • entities[], relations[]                                        │   │
│  │  • createdAt, lastAccessed, accessCount                           │   │
│  │                                                                      │   │
│  │  Layer 1: Raw Resources ────────────────────────────────────────    │   │
│  │  • conversations/YYYY-MM/ (原始对话)                              │   │
│  │  • uploads/ (上传文件元数据)                                       │   │
│  │  • events/ (重要事件)                                              │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│                                    ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                 混合检索引擎 (对标 OpenCLAW)                        │   │
│  │                                                                      │   │
│  │   Query                                                              │   │
│  │     │                                                               │   │
│  │     ├──▶ BM25 (关键词) ──┐                                         │   │
│  │     │                    │                                         │   │
│  │     ├──▶ Vector (语义) ──┼──▶ Score Fusion ──▶ MMR ──▶ Results   │   │
│  │     │                    │                          │                │   │
│  │     └──▶ LLM Direct ─────┘                          │                │   │
│  │                                                      ▼                │   │
│  │                                              Temporal Decay          │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│                                    ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                 Identity 级联 (对标 OpenCLAW)                       │   │
│  │                                                                      │   │
│  │        Global Config ──▶ Agent Config ──▶ Workspace File            │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 三、详细实施计划 (Phase by Phase)

### Phase 1: 基础设施升级

**目标**: 搭建混合搜索基础框架

| 任务ID | 功能 | 对标项目 | 源码参考 | 优先级 | 工作量 |
|--------|------|----------|----------|--------|--------|
| 1.1 | 向量嵌入支持 | OpenCLAW | `src/mcp/embeddings.ts` | P0 | 3d |
| 1.2 | SQLite向量存储 | OpenCLAW | `src/db/vector-store.ts` | P0 | 2d |
| 1.3 | BM25索引实现 | OpenCLAW | `src/memory/search/bm25.ts` | P0 | 2d |
| 1.4 | 混合搜索融合 | OpenCLAW | `src/memory/search/hybrid.ts` | P0 | 3d |

#### 任务 1.1: 向量嵌入支持

**对标源码参考**:
- OpenCLAW: `src/mcp/embeddings.ts` - 支持多种嵌入模型
- mem0: `mem0/embeddings/base.py` - 嵌入模型基类

**实现方案**:

```python
# backend/src/agents/memory/embeddings.py

from abc import ABC, abstractmethod
from typing import List, Optional
import numpy as np

class EmbeddingProvider(ABC):
    """嵌入提供者基类 - 对标 mem0/embeddings/base.py"""

    @abstractmethod
    def embed(self, text: str) -> List[float]:
        """将文本转换为向量"""
        pass

    @abstractmethod
    def embed_batch(self, texts: List[str]) -> List[List[float]]:
        """批量嵌入"""
        pass


class SentenceTransformerEmbedding(EmbeddingProvider):
    """本地 sentence-transformers 嵌入 - 对标 OpenCLAW 本地嵌入"""

    def __init__(self, model_name: str = "all-MiniLM-L6-v2"):
        from sentence_transformers import SentenceTransformer
        self.model = SentenceTransformer(model_name)

    def embed(self, text: str) -> List[float]:
        return self.model.encode(text).tolist()

    def embed_batch(self, texts: List[str]) -> List[List[float]]:
        return self.model.encode(texts).tolist()


class OpenAIEmbedding(EmbeddingProvider):
    """OpenAI 嵌入 - 对标 mem0 OpenAI 嵌入"""

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
```

#### 任务 1.2: SQLite向量存储

**对标源码参考**:
- OpenCLAW: `src/db/vector-store.ts` - SQLite向量存储
- memU: 使用 sqlite-vec 扩展

**实现方案**:

```python
# backend/src/agents/memory/vector_store.py

import sqlite3
import json
from typing import List, Tuple, Optional
import numpy as np

class VectorStore:
    """向量存储 - 对标 OpenCLAW sqlite-vec 实现"""

    def __init__(self, db_path: str):
        self.db_path = db_path
        self.conn = sqlite3.connect(db_path)
        self._init_schema()

    def _init_schema(self):
        """初始化向量存储表结构"""
        # 启用向量扩展 (需要 sqlite-vec)
        self.conn.execute("SELECT load_extension('vec0')")

        # 创建向量表
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

        # 创建向量索引
        self.conn.execute("""
            CREATE VIRTUAL TABLE IF NOT EXISTS memory_vectors_idx
            USING vec0(
                embedding=1536,
                metric='cosine'
            )
        """)

        # 创建 BM25 表
        self.conn.execute("""
            CREATE VIRTUAL TABLE IF NOT EXISTS memory_bm25
            USING bm25(content, category, metadata)
        """)

        self.conn.commit()

    def add_vector(self, id: str, content: str, embedding: List[float],
                   category: str = None, metadata: dict = None):
        """添加向量 - 对标 OpenCLAW addDoc()"""

        # 存储原始内容
        self.conn.execute("""
            INSERT OR REPLACE INTO memory_vectors
            (id, content, category, embedding, metadata)
            VALUES (?, ?, ?, ?, ?)
        """, (id, content, category,
              np.array(embedding).astype(np.float32).tobytes(),
              json.dumps(metadata) if metadata else None))

        # 存储向量
        self.conn.execute("""
            INSERT INTO memory_vectors_idx (id, embedding)
            VALUES (?, ?)
        """, (id, np.array(embedding).astype(np.float32).tobytes()))

        self.conn.commit()

    def search_similar(self, query_embedding: List[float], k: int = 5,
                       category: str = None) -> List[dict]:
        """向量相似度搜索 - 对标 OpenCLAW similaritySearch()"""

        # 更新访问统计
        self.conn.execute("""
            UPDATE memory_vectors
            SET access_count = access_count + 1,
                last_accessed = CURRENT_TIMESTAMP
            WHERE id IN (SELECT id FROM memory_vectors_idx
                        ORDER BY distance
                        LIMIT ?)
        """, (k,))

        # 执行向量搜索
        cursor = self.conn.execute("""
            SELECT v.id, v.content, v.category, v.metadata,
                   v.access_count, v.last_accessed,
                   (1 - d.distance) as similarity
            FROM memory_vectors_idx n
            JOIN memory_vectors v ON v.id = n.id
            JOIN memory_vectors_idx d ON d.id = n.id
            WHERE n.embedding MATCH ?
            ORDER BY d.distance
            LIMIT ?
        """, (np.array(query_embedding).astype(np.float32).tobytes(), k))

        results = []
        for row in cursor.fetchall():
            results.append({
                "id": row[0],
                "content": row[1],
                "category": row[2],
                "metadata": json.loads(row[3]) if row[3] else {},
                "access_count": row[4],
                "last_accessed": row[5],
                "similarity": row[6]
            })

        return results

    def search_bm25(self, query: str, k: int = 5, category: str = None) -> List[dict]:
        """BM25 搜索 - 对标 OpenCLAW bm25Search()"""

        sql = """
            SELECT id, content, category, metadata,
                   bm25(memory_bm25) as score
            FROM memory_bm25
            WHERE memory_bm25 MATCH ?
        """
        params = [query]

        if category:
            sql += " AND category = ?"
            params.append(category)

        sql += " ORDER BY score LIMIT ?"
        params.append(k)

        cursor = self.conn.execute(sql, params)

        results = []
        for row in cursor.fetchall():
            results.append({
                "id": row[0],
                "content": row[1],
                "category": row[2],
                "metadata": json.loads(row[3]) if row[3] else {},
                "bm25_score": row[4]
            })

        return results
```

#### 任务 1.3: BM25索引实现

**对标源码参考**:
- OpenCLAW: `src/memory/search/bm25.ts`

**实现方案**:

```python
# backend/src/agents/memory/search/bm25.py

import math
from collections import Counter
from typing import List, Dict
import re

class BM25:
    """BM25 检索 - 对标 OpenCLAW BM25 实现"""

    def __init__(self, k1: float = 1.5, b: float = 0.75):
        self.k1 = k1
        self.b = b
        self.documents: List[str] = []
        self.doc_lengths: List[int] = []
        self.avgdl: float = 0
        self.doc_freqs: Dict[str, int] = {}
        self.idf: Dict[str, float] = {}
        self.corpus_size: int = 0

    def _tokenize(self, text: str) -> List[str]:
        """分词"""
        return re.findall(r'\w+', text.lower())

    def fit(self, documents: List[str]):
        """构建索引 - 对标 OpenCLAW buildIndex()"""
        self.documents = documents
        self.corpus_size = len(documents)

        # 计算文档长度
        self.doc_lengths = [len(self._tokenize(doc)) for doc in documents]
        self.avgdl = sum(self.doc_lengths) / max(self.corpus_size, 1)

        # 计算词频和文档频率
        doc_freqs = Counter()
        for doc in documents:
            tokens = set(self._tokenize(doc))
            for token in tokens:
                doc_freqs[token] += 1

        # 计算 IDF
        for token, df in doc_freqs.items():
            self.idf[token] = math.log((self.corpus_size - df + 0.5) / (df + 0.5) + 1)

    def search(self, query: str, top_k: int = 5) -> List[Dict]:
        """搜索 - 对标 OpenCLAW search()"""
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

                    # BM25 公式
                    numerator = tf * (self.k1 + 1)
                    denominator = tf + self.k1 * (1 - self.b + self.b * doc_len / self.avgdl)
                    score += idf * numerator / denominator

            if score > 0:
                scores.append({
                    "idx": idx,
                    "score": score,
                    "document": doc
                })

        # 排序返回 top_k
        scores.sort(key=lambda x: x["score"], reverse=True)
        return scores[:top_k]
```

#### 任务 1.4: 混合搜索融合

**对标源码参考**:
- OpenCLAW: `src/memory/search/hybrid.ts`

```python
# backend/src/agents/memory/search/hybrid.py

from typing import List, Dict, Optional
import numpy as np

class HybridSearch:
    """混合搜索 - 对标 OpenCLAW HybridSearch 实现"""

    def __init__(
        self,
        vector_store,
        bm25: BM25,
        vector_weight: float = 0.5,
        bm25_weight: float = 0.5,
        enable_mmr: bool = True,
        mmr_lambda: float = 0.5
    ):
        self.vector_store = vector_store
        self.bm25 = bm25
        self.vector_weight = vector_weight
        self.bm25_weight = bm25_weight
        self.enable_mmr = enable_mmr
        self.mmr_lambda = mmr_lambda

    def search(
        self,
        query: str,
        query_embedding: List[float],
        category: str = None,
        top_k: int = 5,
        use_mmr: bool = True
    ) -> List[Dict]:
        """混合搜索 - 对标 OpenCLAW hybridSearch()"""

        # 1. 并行执行向量搜索和 BM25 搜索
        vector_results = self.vector_store.search_similar(
            query_embedding, k=top_k * 2, category=category
        )

        bm25_results = self.bm25.search(query, top_k * 2)
        bm25_by_id = {r["id"]: r for r in bm25_results}

        # 2. 分数归一化
        vector_max = max((r["similarity"] for r in vector_results), default=1)
        bm25_max = max((r["bm25_score"] for r in bm25_results), default=1)

        # 3. 分数融合
        fused_scores = {}
        for r in vector_results:
            r["vector_score"] = r["similarity"] / vector_max if vector_max > 0 else 0
            r["bm25_score"] = 0
            fused_scores[r["id"]] = r

        for r in bm25_results:
            if r["id"] in fused_scores:
                fused_scores[r["id"]]["bm25_score"] = r["bm25_score"] / bm25_max if bm25_max > 0 else 0
            else:
                r["vector_score"] = 0
                r["similarity"] = 0
                fused_scores[r["id"]] = r

        # 计算融合分数
        for r in fused_scores.values():
            r["fused_score"] = (
                self.vector_weight * r["vector_score"] +
                self.bm25_weight * r["bm25_score"]
            )

        # 4. MMR 重排序 (可选)
        if use_mmr and self.enable_mmr:
            results = self._mmr_rerank(list(fused_scores.values()), query, top_k)
        else:
            results = sorted(
                fused_scores.values(),
                key=lambda x: x["fused_score"],
                reverse=True
            )[:top_k]

        # 5. 时间衰减
        results = self._apply_temporal_decay(results)

        return results

    def _mmr_rerank(self, results: List[Dict], query: str, top_k: int) -> List[Dict]:
        """MMR 多样性重排序 - 对标 OpenCLAW mmrRerank()"""

        selected = []
        remaining = results.copy()

        while len(selected) < top_k and remaining:
            best_score = -float('inf')
            best_idx = 0

            for idx, item in enumerate(remaining):
                # 相关性分数
                relevance = item["fused_score"]

                # 与已选结果的最大相似度
                max_similarity = 0
                if selected:
                    # 简化版: 基于类别差异
                    selected_categories = set(s.get("category", "") for s in selected)
                    if item.get("category") in selected_categories:
                        max_similarity = 0.5

                # MMR 公式
                mmr_score = (
                    self.mmr_lambda * relevance -
                    (1 - self.mmr_lambda) * max_similarity
                )

                if mmr_score > best_score:
                    best_score = mmr_score
                    best_idx = idx

            selected.append(remaining.pop(best_idx))

        return selected

    def _apply_temporal_decay(self, results: List[Dict]) -> List[Dict]:
        """时间衰减 - 对标 OpenCLAW temporalDecay()"""

        from datetime import datetime, timedelta

        now = datetime.utcnow()
        decay_rate = 0.1  # 每月衰减 10%

        for r in results:
            if r.get("last_accessed"):
                try:
                    last_access = datetime.fromisoformat(r["last_accessed"].replace("Z", "+00:00"))
                    days_old = (now - last_access.replace(tzinfo=None)).days

                    # 指数衰减
                    decay = math.exp(-decay_rate * days_old / 30)
                    r["fused_score"] *= decay
                    r["temporal_decay"] = decay
                except:
                    pass

        return sorted(results, key=lambda x: x["fused_score"], reverse=True)
```

---

### Phase 2: 三层记忆架构 (核心)

**目标**: 实现 memU 风格的三层记忆架构

| 任务ID | 功能 | 对标项目 | 源码参考 | 优先级 | 工作量 |
|--------|------|----------|----------|--------|--------|
| 2.1 | Raw Resources Layer | memU | `memu/layers/resource.py` | P0 | 3d |
| 2.2 | Memory Items Layer | memU | `memu/layers/item.py` | P0 | 4d |
| 2.3 | Category Layer | memU | `memu/layers/category.py` | P0 | 3d |
| 2.4 | 双向追溯链 | memU | `memu/layers/traceability.py` | P1 | 2d |
| 2.5 | 记忆压缩/合并 | memU | `memu/layers/compaction.py` | P1 | 3d |

#### 任务 2.1: Raw Resources Layer

**对标源码参考**:
- memU: `memu/layers/resource.py` - 原始资源层

```python
# backend/src/agents/memory/layers/resource.py

from dataclasses import dataclass, field
from datetime import datetime
from typing import List, Dict, Any, Optional
import json
from pathlib import Path

@dataclass
class RawResource:
    """原始资源 - 对标 memU RawResource"""
    id: str
    type: str  # conversation, file, event
    content: Any  # 原始内容
    metadata: Dict[str, Any] = field(default_factory=dict)
    created_at: datetime = field(default_factory=datetime.utcnow)
    embeddings: List[float] = field(default_factory=list)

    def to_dict(self) -> Dict:
        return {
            "id": self.id,
            "type": self.type,
            "content": self.content,
            "metadata": self.metadata,
            "created_at": self.created_at.isoformat() + "Z"
        }


class ResourceLayer:
    """资源层 - 对标 memU ResourceLayer"""

    def __init__(self, storage_path: Path):
        self.storage_path = storage_path
        self.storage_path.mkdir(parents=True, exist_ok=True)

    def store(self, resource: RawResource) -> str:
        """存储原始资源 - 对标 memU memorize()"""

        # 按月份组织存储
        month_dir = self.storage_path / resource.created_at.strftime("%Y-%m")
        month_dir.mkdir(parents=True, exist_ok=True)

        # 存储文件
        file_path = month_dir / f"{resource.id}.json"
        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(resource.to_dict(), f, ensure_ascii=False, indent=2)

        return resource.id

    def get(self, resource_id: str, created_at: datetime = None) -> Optional[RawResource]:
        """获取原始资源"""

        if created_at is None:
            # 搜索所有月份
            for month_dir in self.storage_path.glob("????-??/):
                file_path = month_dir / f"{resource_id}.json"
                if file_path.exists():
                    return self._load_resource(file_path)
            return None

        month_dir = self.storage_path / created_at.strftime("%Y-%m")
        file_path = month_dir / f"{resource_id}.json"

        if file_path.exists():
            return self._load_resource(file_path)
        return None

    def _load_resource(self, file_path: Path) -> RawResource:
        with open(file_path, encoding="utf-8") as f:
            data = json.load(f)

        return RawResource(
            id=data["id"],
            type=data["type"],
            content=data["content"],
            metadata=data.get("metadata", {}),
            created_at=datetime.fromisoformat(data["created_at"].replace("Z", "+00:00")),
            embeddings=data.get("embeddings", [])
        )

    def search_by_date_range(
        self,
        start: datetime,
        end: datetime
    ) -> List[RawResource]:
        """按日期范围搜索"""
        results = []

        for month_dir in self.storage_path.glob("????-??/"):
            try:
                month_date = datetime.strptime(month_dir.name, "%Y-%m")
                if start <= month_date <= end:
                    for file_path in month_dir.glob("*.json"):
                        resource = self._load_resource(file_path)
                        if resource:
                            results.append(resource)
            except ValueError:
                continue

        return sorted(results, key=lambda r: r.created_at, reverse=True)
```

#### 任务 2.2: Memory Items Layer

**对标源码参考**:
- memU: `memu/layers/item.py` - 记忆项层

```python
# backend/src/agents/memory/layers/item.py

from dataclasses import dataclass, field
from datetime import datetime
from typing import List, Dict, Any, Optional
from enum import Enum

class MemoryCategory(Enum):
    """记忆类别 - 对标 memU Category"""
    PREFERENCE = "preference"
    KNOWLEDGE = "knowledge"
    CONTEXT = "context"
    BEHAVIOR = "behavior"
    GOAL = "goal"
    # 新增类别
    PROJECT = "project"
    RELATIONSHIP = "relationship"
    EVENT = "event"


@dataclass
class Entity:
    """实体 - 对标 memU Entity"""
    name: str
    type: str  # person, project, tool, concept
    mentions: int = 1


@dataclass
class Relation:
    """关系 - 对标 memU Relation"""
    type: str  # works_on, prefers, knows, manages
    target: str
    confidence: float = 1.0


@dataclass
class MemoryItem:
    """记忆项 - 对标 memU MemoryItem"""
    id: str
    content: str
    category: MemoryCategory
    confidence: float

    # 实体和关系 (新增)
    entities: List[Entity] = field(default_factory=list)
    relations: List[Relation] = field(default_factory=list)

    # 元数据
    source_resource_id: Optional[str] = None
    created_at: datetime = field(default_factory=datetime.utcnow)
    last_accessed: datetime = field(default_factory=datetime.utcnow)
    access_count: int = 0

    # 聚合信息
    aggregated_from: List[str] = field(default_factory=list)  # 从哪些 item 聚合

    def to_dict(self) -> Dict:
        return {
            "id": self.id,
            "content": self.content,
            "category": self.category.value,
            "confidence": self.confidence,
            "entities": [
                {"name": e.name, "type": e.type, "mentions": e.mentions}
                for e in self.entities
            ],
            "relations": [
                {"type": r.type, "target": r.target, "confidence": r.confidence}
                for r in self.relations
            ],
            "source_resource_id": self.source_resource_id,
            "created_at": self.created_at.isoformat() + "Z",
            "last_accessed": self.last_accessed.isoformat() + "Z",
            "access_count": self.access_count,
            "aggregated_from": self.aggregated_from
        }


class ItemLayer:
    """记忆项层 - 对标 memU ItemLayer"""

    def __init__(self, vector_store, embedding_provider):
        self.vector_store = vector_store
        self.embedding_provider = embedding_provider
        self.items: Dict[str, MemoryItem] = {}

    def store(self, item: MemoryItem) -> str:
        """存储记忆项 - 对标 memU store()"""

        # 生成向量
        embedding = self.embedding_provider.embed(item.content)

        # 存储到向量数据库
        self.vector_store.add_vector(
            id=item.id,
            content=item.content,
            embedding=embedding,
            category=item.category.value,
            metadata={
                "confidence": item.confidence,
                "entities": [e.name for e in item.entities],
                "created_at": item.created_at.isoformat()
            }
        )

        # 存储到内存
        self.items[item.id] = item

        return item.id

    def get(self, item_id: str) -> Optional[MemoryItem]:
        """获取记忆项"""
        return self.items.get(item_id)

    def search(
        self,
        query: str,
        query_embedding: List[float],
        category: MemoryCategory = None,
        min_confidence: float = 0.0,
        limit: int = 10
    ) -> List[MemoryItem]:
        """搜索记忆项"""

        # 混合搜索
        from backend.src.agents.memory.search.hybrid import HybridSearch
        # ... 调用混合搜索

        # 过滤低置信度
        results = [
            self.items[r["id"]]
            for r in search_results
            if r["id"] in self.items
            and r.get("metadata", {}).get("confidence", 0) >= min_confidence
        ]

        return results[:limit]

    def update_access(self, item_id: str):
        """更新访问统计"""
        if item_id in self.items:
            item = self.items[item_id]
            item.access_count += 1
            item.last_accessed = datetime.utcnow()

    def delete(self, item_id: str) -> bool:
        """删除记忆项"""
        if item_id in self.items:
            del self.items[item_id]
            # 从向量存储中删除
            return True
        return False
```

#### 任务 2.3: Category Layer

**对标源码参考**:
- memU: `memu/layers/category.py` - 记忆类别层

```python
# backend/src/agents/memory/layers/category.py

from dataclasses import dataclass
from datetime import datetime
from typing import List, Dict, Optional
import uuid
import json

@dataclass
class MemoryCategory:
    """记忆类别文件 - 对标 memU CategoryFile"""
    name: str  # e.g., "preferences", "projects", "tech_stack"
    description: str
    items: List[str] = None  # 记忆项 ID 列表

    def __post_init__(self):
        if self.items is None:
            self.items = []


class CategoryLayer:
    """类别层 - 对标 memU CategoryLayer"""

    def __init__(self, storage_path):
        self.storage_path = storage_path
        self.categories: Dict[str, MemoryCategory] = {}
        self._init_default_categories()

    def _init_default_categories(self):
        """初始化默认类别 - 对标 memU 默认类别"""
        defaults = [
            MemoryCategory(
                name="preferences",
                description="User preferences and dislikes"
            ),
            MemoryCategory(
                name="knowledge",
                description="User's expertise and knowledge areas"
            ),
            MemoryCategory(
                name="context",
                description="Background context about the user"
            ),
            MemoryCategory(
                name="behavior",
                description="User's behavioral patterns"
            ),
            MemoryCategory(
                name="goals",
                description="User's goals and objectives"
            ),
            MemoryCategory(
                name="projects",
                description="Projects the user is working on"
            ),
            MemoryCategory(
                name="tech_stack",
                description="Technologies the user works with"
            ),
            MemoryCategory(
                name="relationships",
                description="Important relationships and interactions"
            ),
        ]

        for cat in defaults:
            self.categories[cat.name] = cat

    def get_category(self, name: str) -> Optional[MemoryCategory]:
        """获取类别"""
        return self.categories.get(name)

    def add_item_to_category(self, category_name: str, item_id: str):
        """添加记忆项到类别 - 对标 memU addToCategory()"""
        if category_name in self.categories:
            cat = self.categories[category_name]
            if item_id not in cat.items:
                cat.items.append(item_id)
                self._save_category_file(cat)

    def remove_item_from_category(self, category_name: str, item_id: str):
        """从类别中移除记忆项"""
        if category_name in self.categories:
            cat = self.categories[category_name]
            if item_id in cat.items:
                cat.items.remove(item_id)
                self._save_category_file(cat)

    def _save_category_file(self, category: MemoryCategory):
        """保存类别文件 - 对标 memU saveCategoryFile()

        关键设计: 类别文件是 LLM 可直接读取的 Markdown 格式
        """
        file_path = self.storage_path / f"{category.name}.md"

        # 构建 Markdown 内容
        content = f"""# {category.name.title()}

{description}

## Memory Items

"""

        # 按访问频率排序
        # ... 添加记忆项内容

        with open(file_path, "w", encoding="utf-8") as f:
            f.write(content)

    def get_category_file_content(self, category_name: str) -> Optional[str]:
        """获取类别文件内容 - 对标 memU readCategoryFile()

        这个方法是 memU 的核心创新: LLM 可以直接读取类别文件
        """
        file_path = self.storage_path / f"{category_name}.md"
        if file_path.exists():
            with open(file_path, encoding="utf-8") as f:
                return f.read()
        return None

    def get_all_categories_for_llm(self) -> str:
        """获取所有类别文件的聚合内容 - 对标 memU getAllForLLM()"""

        contents = []
        for name, cat in self.categories.items():
            content = self.get_category_file_content(name)
            if content:
                contents.append(content)

        return "\n\n---\n\n".join(contents)

    def auto_categorize_item(self, item_content: str) -> str:
        """自动决定记忆项的类别 - 对标 memU autoCategorize()

        使用 LLM 判断应该归入哪个类别
        """
        # ... 实现 LLM 驱动的自动分类
        pass

    def merge_items(self, source_ids: List[str], target_id: str):
        """合并记忆项 - 对标 memU mergeItems()"""
        # 将多个记忆项合并为一个
        pass
```

---

### Phase 3: Soul/Identity 系统升级

**目标**: 对标 OpenCLAW 的 Workspace 文件系统

| 任务ID | 功能 | 对标项目 | 源码参考 | 优先级 | 工作量 |
|--------|------|----------|----------|--------|--------|
| 3.1 | 多文件拆分 | OpenCLAW | workspace files | P1 | 2d |
| 3.2 | Identity 级联 | OpenCLAW | `src/agents/identity.ts` | P1 | 2d |
| 3.3 | USER.md 支持 | OpenCLAW | workspace/USER.md | P1 | 2d |
| 3.4 | HEARTBEAT.md | OpenCLAW | `src/agents/heartbeat.ts` | P2 | 3d |

#### 任务 3.1: Workspace 文件拆分

**对标源码参考**:
- OpenCLAW: `workspace/{SOUL,IDENTITY,USER,MEMORY,HEARTBEAT}.md`

```python
# backend/src/agents/soul/workspace.py

from pathlib import Path
from dataclasses import dataclass
from typing import Optional
import json

@dataclass
class WorkspaceFiles:
    """Workspace 文件管理器 - 对标 OpenCLAW WorkspaceFiles"""

    workspace_path: Path

    # 文件路径
    soul_file: Path = None
    identity_file: Path = None
    user_file: Path = None
    memory_file: Path = None
    heartbeat_file: Path = None

    def __post_init__(self):
        self.soul_file = self.workspace_path / "SOUL.md"
        self.identity_file = self.workspace_path / "IDENTITY.md"
        self.user_file = self.workspace_path / "USER.md"
        self.memory_file = self.workspace_path / "MEMORY.md"
        self.heartbeat_file = self.workspace_path / "HEARTBEAT.md"

    @classmethod
    def create_for_agent(cls, agent_name: str, base_path: Path) -> "WorkspaceFiles":
        """为 Agent 创建 Workspace"""
        workspace_path = base_path / "workspaces" / agent_name
        workspace_path.mkdir(parents=True, exist_ok=True)
        return cls(workspace_path=workspace_path)

    # ===== SOUL.md (当前保留) =====
    def get_soul(self) -> Optional[str]:
        """获取 Soul 内容"""
        if self.soul_file.exists():
            return self.soul_file.read_text(encoding="utf-8")
        return None

    def set_soul(self, content: str):
        """设置 Soul 内容"""
        self.soul_file.write_text(content, encoding="utf-8")

    # ===== IDENTITY.md (新增) =====
    def get_identity(self) -> Optional[dict]:
        """获取 Identity - 对标 OpenCLAW getIdentity()"""
        if self.identity_file.exists():
            content = self.identity_file.read_text(encoding="utf-8")
            return self._parse_identity(content)
        return None

    def set_identity(self, name: str = None, tone: str = None,
                     avatar: str = None, description: str = None):
        """设置 Identity"""
        lines = ["# Identity\n"]
        if name:
            lines.append(f"- **Name**: {name}")
        if tone:
            lines.append(f"- **Tone**: {tone}")
        if avatar:
            lines.append(f"- **Avatar**: {avatar}")
        if description:
            lines.append(f"\n{description}")

        self.identity_file.write_text("\n".join(lines), encoding="utf-8")

    def _parse_identity(self, content: str) -> dict:
        """解析 Identity 文件"""
        # ... 简单解析
        return {"content": content}

    # ===== USER.md (新增) =====
    def get_user(self) -> Optional[dict]:
        """获取 User 信息 - 对标 OpenCLAW USER.md"""
        if self.user_file.exists():
            return self._parse_user_file()
        return None

    def set_user(self, name: str = None, preferences: dict = None,
                 context: dict = None):
        """设置 User 信息"""
        lines = ["# User\n"]

        if name:
            lines.append(f"- **Name**: {name}")

        if preferences:
            lines.append("\n## Preferences\n")
            for k, v in preferences.items():
                lines.append(f"- {k}: {v}")

        if context:
            lines.append("\n## Context\n")
            for k, v in context.items():
                lines.append(f"- {k}: {v}")

        self.user_file.write_text("\n".join(lines), encoding="utf-8")

    # ===== MEMORY.md (新增) =====
    def get_memory_summary(self) -> Optional[str]:
        """获取 Memory 摘要 - 对标 OpenCLAW MEMORY.md"""
        if self.memory_file.exists():
            return self.memory_file.read_text(encoding="utf-8")
        return None

    def update_memory_summary(self, summary: str):
        """更新 Memory 摘要"""
        self.memory_file.write_text(summary, encoding="utf-8")

    # ===== HEARTBEAT.md (新增) =====
    def get_heartbeat_config(self) -> Optional[dict]:
        """获取定时任务配置 - 对标 OpenCLAW HEARTBEAT.md"""
        if self.heartbeat_file.exists():
            content = self.heartbeat_file.read_text(encoding="utf-8")
            return self._parse_heartbeat(content)
        return None

    def set_heartbeat(self, schedule: str, tasks: list):
        """设置定时任务"""
        lines = ["# Heartbeat\n", f"Schedule: {schedule}\n", "\n## Tasks\n"]
        for task in tasks:
            lines.append(f"- {task}")

        self.heartbeat_file.write_text("\n".join(lines), encoding="utf-8")
```

#### 任务 3.2: Identity 级联

**对标源码参考**:
- OpenCLAW: `src/agents/identity.ts` - Identity 解析和级联

```python
# backend/src/agents/soul/identity_cascade.py

from typing import Optional, Dict, Any
from dataclasses import dataclass

@dataclass
class Identity:
    """Identity 信息 - 对标 OpenCLAW Identity"""
    name: str
    tone: str
    avatar: Optional[str] = None
    description: Optional[str] = None
    language: Optional[str] = None
    custom: Dict[str, Any] = None


class IdentityCascade:
    """Identity 级联 - 对标 OpenCLAW Identity Cascade

    优先级: Global Config → Agent Config → Workspace File
    """

    def __init__(self, global_config: dict = None):
        self.global_config = global_config or {}

    def resolve_identity(
        self,
        agent_name: str = None,
        agent_config: dict = None,
        workspace_files = None
    ) -> Identity:
        """解析最终 Identity - 对标 OpenCLAW resolveIdentity()"""

        # 1. 从全局配置获取默认值
        identity = Identity(
            name=self.global_config.get("name", "Assistant"),
            tone=self.global_config.get("tone", "professional")
        )

        # 2. Agent 配置覆盖
        if agent_config and "identity" in agent_config:
            agent_identity = agent_config["identity"]
            if "name" in agent_identity:
                identity.name = agent_identity["name"]
            if "tone" in agent_identity:
                identity.tone = agent_identity["tone"]
            if "avatar" in agent_identity:
                identity.avatar = agent_identity["avatar"]
            if "description" in agent_identity:
                identity.description = agent_identity["description"]

        # 3. Workspace 文件覆盖 (最高优先级)
        if workspace_files:
            ws_identity = workspace_files.get_identity()
            if ws_identity and ws_identity.get("content"):
                # 解析 Workspace Identity
                content = ws_identity.get("content", "")
                # ... 解析并覆盖

        return identity


class SoulResolver:
    """Soul 解析器 - 对标 OpenCLAW SoulResolver"""

    def __init__(self, workspace_manager):
        self.workspace_manager = workspace_manager

    def resolve_soul(
        self,
        agent_name: str = None,
        bootstrap_soul: str = None
    ) -> str:
        """解析 Soul 内容 - 对标 OpenCLAW resolveSoul()"""

        # 1. 优先使用 bootstrap 生成的 Soul
        if bootstrap_soul:
            return bootstrap_soul

        # 2. 从 Workspace 加载
        workspace = self.workspace_manager.get_workspace(agent_name)
        if workspace:
            soul = workspace.get_soul()
            if soul:
                return soul

        # 3. 返回默认 Soul
        return self._get_default_soul()

    def _get_default_soul(self) -> str:
        """获取默认 Soul"""
        return """**Identity**

[AI Name] — Your AI assistant.

**Core Traits**

- Be helpful and concise
- Proactive in surfacing relevant information

**Communication**

- Professional but approachable
- Match user's language preference

**Growth**

Learn about the user through conversations and adapt to their preferences over time.

**Lessons Learned**

_(No lessons recorded yet)_
"""
```

---

### Phase 4: 主动记忆系统 (Proactive)

**目标**: 实现类 memU Proactive Memory

| 任务ID | 功能 | 对标项目 | 源码参考 | 优先级 | 工作量 |
|--------|------|----------|----------|--------|--------|
| 4.1 | Dual-Mode 检索 | memU | `memu/core/dual_mode.py` | P1 | 3d |
| 4.2 | 上下文预加载 | memU | `memu/core/proactive.py` | P1 | 4d |
| 4.3 | 使用模式分析 | memU | `memu/core/patterns.py` | P1 | 3d |
| 4.4 | **自我进化引擎** | memU | `memu/core/evolving.py` | P1 | 4d |

#### 任务 4.4: 自我进化引擎 (Self-Evolving)

**对标源码参考**:
- memU: `memu/core/evolving.py` - 记忆自我进化
- memU 核心理念: "Agents Evolve Through Memory, Not Context"

```python
# backend/src/agents/memory/evolving/self_evolver.py

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import List, Dict, Set, Optional
from collections import Counter
import json

@dataclass
class UsagePattern:
    """使用模式 - 对标 memU UsagePattern"""
    query_patterns: Counter = field(default_factory=Counter)  # 查询模式
    accessed_categories: Counter = field(default_factory=Counter)  # 访问的类别
    time_patterns: Dict[str, int] = field(default_factory=dict)  # 时间模式
    topic_trends: List[str] = field(default_factory=list)  # 话题趋势
    avg_session_length: float = 0.0


@dataclass
class EvolutionMetrics:
    """进化指标 - 对标 memU EvolutionMetrics"""
    memory_efficiency: float = 0.0  # 记忆效率
    retrieval_accuracy: float = 0.0  # 检索准确率
    relevance_score: float = 0.0    # 相关性得分
    redundancy_rate: float = 0.0    # 冗余率
    staleness_score: float = 0.0    # 陈旧度


class SelfEvolvingEngine:
    """自我进化引擎 - 对标 memU SelfEvolvingEngine

    核心理念: 记忆系统能够根据使用模式自动优化自身
    """

    def __init__(
        self,
        item_layer,
        category_layer,
        llm,
        config: dict = None
    ):
        self.item_layer = item_layer
        self.category_layer = category_layer
        self.llm = llm
        self.config = config or {}

        # 使用模式跟踪
        self.usage_pattern = UsagePattern()

        # 进化阈值
        self.compression_threshold = self.config.get("compression_threshold", 10)
        self.merge_similarity_threshold = self.config.get("merge_similarity_threshold", 0.85)
        self.staleness_threshold_days = self.config.get("staleness_threshold_days", 90)

    # ===== 使用模式跟踪 =====

    def record_query(self, query: str, category: str = None):
        """记录查询 - 对标 memU recordQuery()"""
        # 记录查询模式
        self.usage_pattern.query_patterns[query.lower().split()[0] if query else ""] += 1

        # 记录类别访问
        if category:
            self.usage_pattern.accessed_categories[category] += 1

        # 记录时间模式
        hour = datetime.utcnow().hour
        self.usage_pattern.time_patterns[str(hour)] = \
            self.usage_pattern.time_patterns.get(str(hour), 0) + 1

    def analyze_topic_trends(self, time_window_days: int = 7):
        """分析话题趋势 - 对标 memU analyzeTopicTrends()"""
        # 收集最近 N 天的记忆项
        recent_items = self._get_recent_items(time_window_days)

        # 提取话题
        topics = []
        for item in recent_items:
            # 简单实现: 从内容中提取关键词
            words = item.content.lower().split()
            topics.extend([w for w in words if len(w) > 3])

        # 统计趋势
        self.usage_pattern.topic_trends = [
            item[0] for item in Counter(topics).most_common(10)
        ]

        return self.usage_pattern.topic_trends

    # ===== 自动优化 =====

    def should_compress(self) -> bool:
        """判断是否需要压缩 - 对标 memU shouldCompress()"""
        total_items = len(self.item_layer.items)

        # 如果记忆项过多，触发压缩
        if total_items > self.config.get("max_items_before_compress", 200):
            return True

        # 如果冗余率高，触发压缩
        redundancy = self._calculate_redundancy()
        if redundancy > self.config.get("redundancy_threshold", 0.3):
            return True

        return False

    def should_create_category(self, item: 'MemoryItem') -> bool:
        """判断是否需要创建新类别 - 对标 memU shouldCreateCategory()"""
        # 检查现有类别是否有足够多的相关项
        related_count = 0
        for existing_item in self.item_layer.items.values():
            if self._calculate_similarity(item.content, existing_item.content) > 0.7:
                related_count += 1

        # 如果相关项足够多但没有独立类别，考虑创建
        return related_count >= 5

    def evolve(self) -> Dict[str, any]:
        """执行自我进化 - 对标 memU evolve()

        返回进化报告
        """
        report = {
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "actions": []
        }

        # 1. 记忆压缩
        if self.should_compress():
            compressed = self._compress_memory()
            report["actions"].extend(compressed)
            report["compressed"] = True

        # 2. 记忆合并
        merged = self._merge_similar_items()
        if merged:
            report["actions"].extend(merged)
            report["merged_count"] = len(merged)

        # 3. 类别优化
        category_actions = self._optimize_categories()
        if category_actions:
            report["actions"].extend(category_actions)

        # 4. 陈旧记忆处理
        stale_actions = self._handle_stale_memories()
        if stale_actions:
            report["actions"].extend(stale_actions)

        # 5. 更新进化指标
        report["metrics"] = self._calculate_evolution_metrics()

        return report

    def _compress_memory(self) -> List[Dict]:
        """记忆压缩 - 对标 memU compressMemory()

        将多个相似记忆项合并为一个更紧凑的表示
        """
        actions = []

        # 按类别分组
        by_category: Dict[str, List['MemoryItem']] = {}
        for item in self.item_layer.items.values():
            if item.category.value not in by_category:
                by_category[item.category.value] = []
            by_category[item.category.value].append(item)

        # 对每个类别进行压缩
        for category, items in by_category.items():
            if len(items) < self.compression_threshold:
                continue

            # 找到需要合并的组
            groups = self._find_mergeable_groups(items)

            for group in groups:
                if len(group) < 2:
                    continue

                # 使用 LLM 合并
                merged_content = self._llm_merge_items(group)

                # 创建新记忆项
                new_item = MemoryItem(
                    id=f"compressed_{datetime.utcnow().strftime('%Y%m%d%H%M%S')}",
                    content=merged_content,
                    category=group[0].category,
                    confidence=max(i.confidence for i in group),
                    aggregated_from=[i.id for i in group]
                )

                # 删除旧项，添加新项
                for old_item in group:
                    self.item_layer.delete(old_item.id)

                self.item_layer.store(new_item)

                actions.append({
                    "type": "compress",
                    "category": category,
                    "merged_count": len(group),
                    "new_id": new_item.id
                })

        return actions

    def _merge_similar_items(self) -> List[Dict]:
        """合并相似记忆项 - 对标 memU mergeSimilarItems()"""
        actions = []
        merged_ids: Set[str] = set()

        items = list(self.item_layer.items.values())

        for i, item1 in enumerate(items):
            if item1.id in merged_ids:
                continue

            for item2 in items[i+1:]:
                if item2.id in merged_ids:
                    continue

                # 计算相似度
                similarity = self._calculate_similarity(
                    item1.content,
                    item2.content
                )

                if similarity >= self.merge_similarity_threshold:
                    # 合并
                    merged = self._merge_two_items(item1, item2)
                    merged_ids.add(item1.id)
                    merged_ids.add(item2.id)

                    self.item_layer.store(merged)

                    actions.append({
                        "type": "merge",
                        "from": [item1.id, item2.id],
                        "to": merged.id
                    })

        return actions

    def _optimize_categories(self) -> List[Dict]:
        """优化类别结构 - 对标 memU optimizeCategories()"""
        actions = []

        # 分析类别使用频率
        category_usage = self.usage_pattern.accessed_categories

        # 识别低频类别
        low_freq_categories = [
            cat for cat, count in category_usage.items()
            if count < 3
        ]

        # 合并低频类别
        for cat in low_freq_categories:
            # 找到最相似的活跃类别
            target_cat = self._find_similar_active_category(cat)
            if target_cat:
                # 移动记忆项到新类别
                moved = self._move_items_to_category(cat, target_cat)
                if moved:
                    actions.append({
                        "type": "move_category",
                        "from": cat,
                        "to": target_cat,
                        "count": moved
                    })

        return actions

    def _handle_stale_memories(self) -> List[Dict]:
        """处理陈旧记忆 - 对标 memU handleStaleMemories()"""
        actions = []
        now = datetime.utcnow()

        stale_threshold = now - timedelta(days=self.staleness_threshold_days)

        stale_items = [
            item for item in self.item_layer.items.values()
            if item.last_accessed < stale_threshold
        ]

        for item in stale_items:
            # 检查是否重要
            if item.confidence > 0.8 or item.access_count > 10:
                # 重要记忆: 降低权重但不删除
                item.confidence *= 0.9  # 降低置信度
                self.item_layer.store(item)

                actions.append({
                    "type": "degrade",
                    "item_id": item.id,
                    "new_confidence": item.confidence
                })
            else:
                # 不重要: 标记为待删除
                # (实际删除可以定期批量执行)
                actions.append({
                    "type": "mark_stale",
                    "item_id": item.id
                })

        return actions

    # ===== 辅助方法 =====

    def _calculate_similarity(self, text1: str, text2: str) -> float:
        """计算文本相似度"""
        # 简化实现: 词重叠
        words1 = set(text1.lower().split())
        words2 = set(text2.lower().split())

        if not words1 or not words2:
            return 0.0

        intersection = words1 & words2
        union = words1 | words2

        return len(intersection) / len(union)

    def _calculate_redundancy(self) -> float:
        """计算冗余率"""
        items = list(self.item_layer.items.values())
        if len(items) < 2:
            return 0.0

        redundancy_count = 0
        for i, item1 in enumerate(items):
            for item2 in items[i+1:]:
                if self._calculate_similarity(item1.content, item2.content) > 0.8:
                    redundancy_count += 1

        return redundancy_count / len(items)

    def _calculate_evolution_metrics(self) -> EvolutionMetrics:
        """计算进化指标"""
        items = list(self.item_layer.items.values())

        return EvolutionMetrics(
            memory_efficiency=len(items) / max(1, sum(i.access_count for i in items)),
            redundancy_rate=self._calculate_redundancy(),
            staleness_score=self._calculate_staleness_score()
        )

    def _calculate_staleness_score(self) -> float:
        """计算陈旧度分数"""
        now = datetime.utcnow()
        items = list(self.item_layer.items.values())

        if not items:
            return 0.0

        staleness = 0
        for item in items:
            days_since_access = (now - item.last_accessed).days
            staleness += min(days_since_access / 90, 1.0)  # 90天为最大

        return staleness / len(items)

    def _llm_merge_items(self, items: List['MemoryItem']) -> str:
        """使用 LLM 合并记忆项"""
        items_text = "\n".join([f"- {item.content}" for item in items])

        prompt = f"""Merge these related memory items into a single, concise statement:

{items_text}

Requirements:
1. Preserve all key information
2. Remove redundancy
3. Keep it under 100 words
4. Output only the merged statement, nothing else."""

        response = self.llm.invoke(prompt)
        return response.content.strip()

    def _get_recent_items(self, days: int) -> List['MemoryItem']:
        """获取最近的记忆项"""
        cutoff = datetime.utcnow() - timedelta(days=days)
        return [
            item for item in self.item_layer.items.values()
            if item.created_at > cutoff
        ]

    def _find_mergeable_groups(self, items: List['MemoryItem']) -> List[List['MemoryItem']]:
        """找到可合并的组"""
        groups = []
        used = set()

        for i, item1 in enumerate(items):
            if item1.id in used:
                continue

            group = [item1]
            used.add(item1.id)

            for item2 in items[i+1:]:
                if item2.id in used:
                    continue

                if self._calculate_similarity(item1.content, item2.content) > 0.7:
                    group.append(item2)
                    used.add(item2.id)

            if len(group) >= 2:
                groups.append(group)

        return groups

    def _find_similar_active_category(self, cat: str) -> Optional[str]:
        """找到相似的活跃类别"""
        usage = self.usage_pattern.accessed_categories

        # 简单实现: 返回最常用的类别
        if usage:
            return usage.most_common(1)[0][0]

        return None

    def _move_items_to_category(self, from_cat: str, to_cat: str) -> int:
        """移动记忆项到另一个类别"""
        moved = 0

        for item in self.item_layer.items.values():
            if item.category.value == from_cat:
                # 简单实现: 创建新类别
                item.category = MemoryCategory(to_cat)
                self.item_layer.store(item)
                moved += 1

        return moved

    def _merge_two_items(self, item1: 'MemoryItem', item2: 'MemoryItem') -> 'MemoryItem':
        """合并两个记忆项"""
        merged_content = f"{item1.content} {item2.content}"

        # 使用 LLM 优化合并
        if self._calculate_similarity(item1.content, item2.content) < 0.9:
            merged_content = self._llm_merge_items([item1, item2])

        return MemoryItem(
            id=f"merged_{datetime.utcnow().strftime('%Y%m%d%H%M%S')}",
            content=merged_content,
            category=item1.category,
            confidence=max(item1.confidence, item2.confidence),
            aggregated_from=[item1.id, item2.id]
        )


# ===== 调度器 =====

class EvolutionScheduler:
    """进化调度器 - 对标 memU EvolutionScheduler

    定期触发自我进化
    """

    def __init__(self, evolver: SelfEvolvingEngine):
        self.evolver = evolver
        self.last_evolution = None

    def should_evolve(self) -> bool:
        """判断是否应该触发进化"""
        if not self.last_evolution:
            return True

        # 每 24 小时或每 50 次查询进化一次
        time_elapsed = datetime.utcnow() - self.last_evolution
        return time_elapsed > timedelta(hours=24)

    def run_evolution(self) -> Dict:
        """运行进化并返回报告"""
        report = self.evolver.evolve()
        self.last_evolution = datetime.utcnow()
        return report
```

#### 任务 4.1: Dual-Mode 检索

**对标源码参考**:
- memU: `memu/core/dual_mode.py` - Fast Context vs Deep Reasoning

```python
# backend/src/agents/memory/proactive/dual_mode.py

from enum import Enum
from typing import List, Dict, Optional
import time

class RetrievalMode(Enum):
    """检索模式 - 对标 memU DualMode"""
    FAST_CONTEXT = "fast"    # 快速上下文 (BM25, 轻量)
    DEEP_REASONING = "deep"  # 深度推理 (LLM 参与)


class DualModeRetriever:
    """双模式检索器 - 对标 memU DualModeRetriever

    核心理念: 大多数查询使用 Fast Context，只有复杂查询才触发 Deep Reasoning
    """

    def __init__(
        self,
        hybrid_search,
        llm,
        fast_threshold: float = 0.7,
        deep_threshold: float = 0.3
    ):
        self.hybrid_search = hybrid_search
        self.llm = llm
        self.fast_threshold = fast_threshold
        self.deep_threshold = deep_threshold

    def retrieve(
        self,
        query: str,
        query_embedding: List[float],
        force_mode: RetrievalMode = None
    ) -> Dict:
        """检索 - 对标 memU retrieve()

        返回:
        {
            "mode": "fast" | "deep",
            "results": [...],
            "reasoning": "..."  # 仅 deep 模式
        }
        """

        if force_mode:
            mode = force_mode
        else:
            # 自动判断使用哪种模式
            mode = self._decide_mode(query, query_embedding)

        if mode == RetrievalMode.FAST_CONTEXT:
            return self._fast_context_retrieve(query, query_embedding)
        else:
            return self._deep_reasoning_retrieve(query, query_embedding)

    def _decide_mode(self, query: str, query_embedding: List[float]) -> RetrievalMode:
        """决定检索模式 - 对标 memU decideMode()"""

        # 1. Fast 模式: 高置信度结果
        fast_results = self.hybrid_search.search(
            query, query_embedding, top_k=3
        )

        if fast_results and fast_results[0].get("fused_score", 0) >= self.fast_threshold:
            return RetrievalMode.FAST_CONTEXT

        # 2. Deep 模式: 需要推理的低置信度查询
        if fast_results and fast_results[0].get("fused_score", 0) < self.deep_threshold:
            return RetrievalMode.DEEP_REASONING

        # 3. 模糊查询或复杂查询触发 Deep
        complex_indicators = [
            "why", "how", "explain", "reason",
            "relationship", "compare", "analyze"
        ]
        if any(ind in query.lower() for ind in complex_indicators):
            return RetrievalMode.DEEP_REASONING

        # 4. 默认 Fast
        return RetrievalMode.FAST_CONTEXT

    def _fast_context_retrieve(self, query: str, query_embedding: List[float]) -> Dict:
        """快速上下文检索 - 对标 memU fastRetrieve()"""

        start_time = time.time()

        results = self.hybrid_search.search(
            query, query_embedding, top_k=5, use_mmr=True
        )

        return {
            "mode": "fast",
            "results": results,
            "latency_ms": (time.time() - start_time) * 1000,
            "reasoning": "High confidence results from hybrid search"
        }

    def _deep_reasoning_retrieve(self, query: str, query_embedding: List[float]) -> Dict:
        """深度推理检索 - 对标 memU deepRetrieve()"""

        start_time = time.time()

        # 1. 先获取候选结果
        candidate_results = self.hybrid_search.search(
            query, query_embedding, top_k=10
        )

        # 2. LLM 参与重排序和推理
        candidate_texts = "\n".join([
            f"- {r['content']}" for r in candidate_results
        ])

        reasoning_prompt = f"""Given the user query: "{query}"

Candidate memories:
{candidate_texts}

Analyze each candidate and determine which are most relevant.
Consider:
1. Direct relevance to the query
2. Implicit connections
3. Temporal relevance (recent vs old)

Return the IDs of relevant memories in order of relevance, with your reasoning."""

        # 3. LLM 推理
        reasoning_response = self.llm.invoke(reasoning_prompt)

        # 4. 基于推理重新排序
        # ... 解析 LLM 响应，重新排序结果

        return {
            "mode": "deep",
            "results": candidate_results,
            "latency_ms": (time.time() - start_time) * 1000,
            "reasoning": reasoning_response.content
        }
```

---

## 四、数据结构设计

### 4.1 新的 Memory JSON 结构 (v2.0)

```json
{
  "version": "2.0",
  "lastUpdated": "2024-01-15T10:00:00Z",

  "legacy": {
    "user": {...},
    "history": {...},
    "facts": [...]
  },

  "resources": {
    "storage_path": "./memory/resources",
    "count": 150
  },

  "items": {
    "storage_path": "./memory/items",
    "count": 85,
    "by_category": {
      "preference": 20,
      "knowledge": 15,
      "context": 25,
      "behavior": 10,
      "goal": 8,
      "project": 7
    }
  },

  "categories": {
    "storage_path": "./memory/categories"
  },

  "metadata": {
    "total_accesses": 1250,
    "avg_confidence": 0.78,
    "last_compression": "2024-01-10T00:00:00Z"
  }
}
```

### 4.2 Memory Item 详细结构

```json
{
  "id": "item_abc123",
  "content": "User prefers Python for data analysis tasks",
  "category": "preference",
  "confidence": 0.9,

  "entities": [
    {"name": "Python", "type": "technology", "mentions": 5},
    {"name": "data analysis", "type": "task", "mentions": 3}
  ],

  "relations": [
    {"type": "prefers", "target": "Python", "confidence": 0.9},
    {"type": "used_for", "target": "data analysis", "confidence": 0.8}
  ],

  "source_resource_id": "conv_20240115_001",
  "created_at": "2024-01-15T10:00:00Z",
  "last_accessed": "2024-01-20T14:30:00Z",
  "access_count": 12,

  "aggregated_from": [],
  "merged_into": null
}
```

---

## 五、实施时间线

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           详细实施时间线                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Phase 1: 基础设施 (2周)                                                    │
│  ┌────────────────────────────────────────────────────────────────────┐   │
│  │ Week 1-2:                                                            │   │
│  │   • 1.1 向量嵌入支持 (3d)                                           │   │
│  │   • 1.2 SQLite向量存储 (2d)                                         │   │
│  │   • 1.3 BM25索引实现 (2d)                                           │   │
│  │   • 1.4 混合搜索融合 (3d)                                           │   │
│  └────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  Phase 2: 三层架构 (3周)                                                    │
│  ┌────────────────────────────────────────────────────────────────────┐   │
│  │ Week 3-5:                                                            │   │
│  │   • 2.1 Raw Resources Layer (3d)                                  │   │
│  │   • 2.2 Memory Items Layer (4d)                                    │   │
│  │   • 2.3 Category Layer (3d)                                       │   │
│  │   • 2.4 双向追溯链 (2d)                                             │   │
│  │   • 2.5 记忆压缩/合并 (3d)                                          │   │
│  └────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  Phase 3: Soul/Identity (2周)                                             │
│  ┌────────────────────────────────────────────────────────────────────┐   │
│  │ Week 6-7:                                                            │   │
│  │   • 3.1 Workspace文件拆分 (2d)                                      │   │
│  │   • 3.2 Identity级联 (2d)                                          │   │
│  │   • 3.3 USER.md支持 (2d)                                           │   │
│  │   • 3.4 HEARTBEAT.md (3d)                                          │   │
│  └────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  Phase 4: 主动记忆 (2周)                                                    │
│  ┌────────────────────────────────────────────────────────────────────┐   │
│  │ Week 8-9:                                                            │   │
│  │   • 4.1 Dual-Mode检索 (3d)                                          │   │
│  │   • 4.2 上下文预加载 (4d)                                           │   │
│  │   • 4.3 使用模式分析 (3d)                                           │   │
│  └────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  Phase 5: 优化与测试 (1周)                                                  │
│  ┌────────────────────────────────────────────────────────────────────┐   │
│  │ Week 10:                                                             │   │
│  │   • 性能优化                                                         │   │
│  │   • 集成测试                                                         │   │
│  │   • 文档完善                                                         │   │
│  └────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  总计: ~10周 (可并行推进)                                                   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 六、兼容性策略

### 6.1 渐进式迁移

```python
# 兼容性: 保留 v1.0 格式，新功能使用 v2.0 字段

class MemoryManager:
    """记忆管理器 - 支持 v1 → v2 渐进迁移"""

    def __init__(self):
        self.layers = {
            "resource": ResourceLayer(...),
            "item": ItemLayer(...),
            "category": CategoryLayer(...)
        }
        self.legacy_mode = True  # 兼容模式

    def get_memory_data(self) -> dict:
        """获取记忆数据 - 兼容 v1 和 v2"""

        # 返回 v2.0 结构
        data = {
            "version": "2.0",
            "items": [...],
            "categories": {...}
        }

        # 如果 legacy_mode=True，同时返回 v1.0 格式
        if self.legacy_mode:
            data["legacy"] = self._convert_to_v1_format()

        return data
```

### 6.2 回滚方案

```yaml
# 配置中支持回滚
memory:
  version: "2.0"
  fallback_to_v1: true  # 如果 v2 有问题，回滚到 v1
```

---

## 七、关键成功指标

| 指标 | 当前 | Phase 1 目标 | Phase 2 目标 | 最终目标 |
|------|------|--------------|--------------|----------|
| 检索召回率 | ~60% | 75% | 85% | 90% |
| 关系推理 | 无 | 无 | 基本 | 支持 |
| Token 效率 | 1x | 1x | 0.8x | 0.5x |
| 检索延迟 | N/A | <200ms | <100ms | <50ms |
| 记忆访问 | 手动 | 手动 | 半自动 | 全自动 |

---

## 八、风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 向量存储性能 | 检索慢 | 使用 sqlite-vec，本地优化 |
| LLM 调用成本 | 费用增加 | Dual-Mode，只在必要时用 Deep |
| 数据迁移丢失 | 数据丢失 | 渐进迁移，保持 v1 兼容 |
| 复杂度增加 | 维护困难 | 模块化设计，清晰接口 |

---

## 九、总结

本计划通过源码级对标以下优秀项目:

- **memU**: 三层记忆架构、主动记忆、Category 文件设计
- **OpenCLAW**: 混合搜索、Workspace 文件、Identity 级联

核心改进:
1. **混合搜索**: BM25 + Vector + MMR + 时间衰减
2. **三层架构**: Resource → Item → Category
3. **LLM 直读**: Category 文件可直接被 LLM 读取
4. **主动记忆**: Dual-Mode 检索，智能切换快速/深度模式
5. **Identity 级联**: Global → Agent → Workspace 三级覆盖

这个计划保持 Nion 现有的 LLM 驱动更新优势，同时引入向量检索、知识图谱等能力，形成一个更强大的记忆系统。

---

## 十、补充功能: 用户意图预测与智能链接

### 10.1 用户意图预测 (User Intention Prediction) - memU 对标

**功能说明**:
memU 的核心理念之一是 "Know what users need before they ask"——在用户提问之前就能预测其需求。

**核心功能**:
- 关键词快速匹配 + LLM 深度预测
- 基于时间模式的意图预测
- 基于历史行为的意图预测
- 主动建议机制

```python
class IntentionPredictor:
    """用户意图预测器 - 对标 memU IntentionPredictor"""

    def predict_intent(self, query: str, context: List[Dict]) -> Intention:
        """预测用户意图"""
        # 1. 快速匹配
        quick = self._quick_match(query)
        if quick.confidence > 0.8:
            return quick
        # 2. LLM 深度预测
        return self._deep_predict(query, context)

    def proactive_suggest(self) -> List[Intention]:
        """主动建议 - 基于时间/历史预测"""
        hour = datetime.utcnow().hour
        if 9 <= hour < 12:  # 早上
            return [Intention("plan", 0.6, {}, ["daily standup", "check todos"])]
        return []
```

### 10.2 智能记忆链接 (Intelligent Memory Linking) - memU 对标

**功能说明**:
记忆不是孤立的，而是相互关联的。智能链接让记忆形成知识图谱，支持关系推理。

**核心功能**:
- 基于实体的链接发现
- 基于语义相似度的链接
- LLM 深层关系推理
- 图遍历查询

```python
class MemoryLinker:
    """智能记忆链接器 - 对标 memU MemoryLinker"""

    def discover_links(self, item_id: str) -> List[MemoryLink]:
        """发现记忆链接"""
        # 1. 实体链接
        entity_links = self._discover_entity_links(item)
        # 2. 语义链接
        semantic_links = self._discover_semantic_links(item)
        # 3. LLM 深层链接
        llm_links = self._llm_discover_links(item)
        return links

    def get_linked_memories(self, item_id: str) -> List[Dict]:
        """获取关联记忆"""
        # 支持关系查询: related, causes, contradicts, supports, part_of
        pass

    def build_memory_graph(self, root_id: str, depth: int = 2) -> Dict:
        """构建记忆图"""
        # 支持图遍历查询
        pass
```

### 10.3 功能对照表

| memU 功能 | 本计划任务 | 优先级 |
|-----------|------------|--------|
| Proactive Memory | 4.2 上下文预加载 | P1 |
| User Intention Prediction | 4.5 用户意图预测 | P2 |
| Self-Evolving | 4.4 自我进化引擎 | P1 |
| Memory Linking | 4.6 智能记忆链接 | P2 |
| Auto-Categorization | 2.3 Category Layer | P0 |
| Memory Compaction | 4.4 自我进化 | P1 |

---

## 十一、memU 完整特性检查清单

以下是我们对 memU 特性的完整吸纳情况:

| # | memU 特性 | 是否吸纳 | 对应任务 |
|---|-----------|----------|----------|
| 1 | Three-Layer Architecture | ✅ | Phase 2 |
| 2 | Category Files (LLM Readable) | ✅ | Phase 2.3 |
| 3 | Hybrid Search (BM25+Vector) | ✅ | Phase 1 |
| 4 | MMR Re-ranking | ✅ | Phase 1.4 |
| 5 | Temporal Decay | ✅ | Phase 1.4 |
| 6 | Dual-Mode Retrieval | ✅ | Phase 4.1 |
| 7 | Proactive Context Loading | ✅ | Phase 4.2 |
| 8 | Usage Pattern Analysis | ✅ | Phase 4.3 |
| 9 | Self-Evolving | ✅ | Phase 4.4 |
| 10 | Auto-Categorization | ✅ | Phase 2.3 |
| 11 | Memory Compaction/Merge | ✅ | Phase 4.4 |
| 12 | User Intention Prediction | ✅ | Phase 4.5 |
| 13 | Intelligent Memory Linking | ✅ | Phase 4.6 |
| 14 | Identity Cascade (OpenCLAW) | ✅ | Phase 3.2 |
| 15 | Workspace Files (OpenCLAW) | ✅ | Phase 3.1 |
| 16 | HEARTBEAT Timer (OpenCLAW) | ✅ | Phase 3.4 |

**备注**:
- Multi-Modal Memory (多模态记忆) 未纳入: 当前为 Web 单人应用，非核心需求
- Multi-Tenant (多租户) 未纳入: 明确为单人应用场景
