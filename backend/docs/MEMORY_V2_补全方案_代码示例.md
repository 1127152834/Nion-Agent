# Memory v2 补全方案 - 关键代码示例

> 配合主文档使用的代码实施参考
> 生成时间: 2026-03-06

---

## Phase 1: 修复类型定义

### 修改 `backend/src/agents/memory/types.py`

在 `MemoryItem` 类中添加缺失字段：

```python
@dataclass
class MemoryItem:
    """Structured memory item used for retrieval."""

    id: str = field(default_factory=lambda: f"item_{uuid.uuid4().hex[:8]}")
    content: str = ""
    category: MemoryCategory = MemoryCategory.CONTEXT
    confidence: float = 0.5
    entities: list[Entity] = field(default_factory=list)
    relations: list[Relation] = field(default_factory=list)

    # 新增字段
    source_resource_id: str | None = None  # 链接到原始资源
    aggregated_from: list[str] = field(default_factory=list)  # 合并历史

    created_at: datetime = field(default_factory=datetime.utcnow)
    last_accessed: datetime = field(default_factory=datetime.utcnow)
    access_count: int = 0
```

### 修改 `backend/src/agents/memory/layers/item.py`

更新 `_normalize_item()` 方法处理新字段：

```python
def _normalize_item(self, item: dict[str, Any] | Any) -> dict[str, Any]:
    # ... 现有代码 ...

    # 处理新字段
    source_resource_id = raw.get("source_resource_id")
    aggregated_from = raw.get("aggregated_from")
    if not isinstance(aggregated_from, list):
        aggregated_from = []

    return {
        "id": str(raw.get("id") or f"item_{uuid.uuid4().hex[:8]}"),
        "content": str(raw.get("content", "")),
        "category": self._normalize_category(raw.get("category")),
        "confidence": float(raw.get("confidence", 0.5)),
        "entities": entities,
        "relations": relations,
        "source_resource_id": str(source_resource_id) if source_resource_id else None,
        "aggregated_from": [str(x) for x in aggregated_from],
        "created_at": created_at.isoformat(),
        "last_accessed": last_accessed.isoformat(),
        "access_count": int(raw.get("access_count", 0)),
    }
```

---

## Phase 2: 知识图谱提取

### 1. 添加提示词到 `backend/src/agents/memory/prompt.py`

```python
ENTITY_EXTRACTION_PROMPT = """从以下文本中提取实体。

文本: {text}

识别以下类型的实体:
- 人物 (person): 姓名、角色
- 项目 (project): 项目名称、代码库
- 工具 (tool): 技术、框架、库
- 概念 (concept): 技术概念、方法论

返回 JSON 数组:
[
  {{"name": "实体名称", "type": "person|project|tool|concept", "mentions": 1}}
]

只返回 JSON，不要其他文字。
"""

RELATION_EXTRACTION_PROMPT = """从文本中提取实体间的关系。

文本: {text}
已识别实体: {entities}

识别以下类型的关系:
- works_on: 人物在做某项目
- prefers: 人物偏好某工具
- knows: 人物了解某概念
- manages: 人物管理某项目
- uses: 项目使用某工具

返回 JSON 数组:
[
  {{"type": "关系类型", "target": "目标实体名", "confidence": 0.9}}
]

只返回 JSON，不要其他文字。
"""
```

### 2. 在 `backend/src/agents/memory/layers/item.py` 添加提取方法

在 `ItemLayer` 类中添加：

```python
def _extract_entities(self, text: str, llm: Any = None) -> list[dict]:
    """使用 LLM 提取实体，失败时降级到关键词匹配。"""
    if llm is None or not hasattr(llm, "invoke"):
        return self._fallback_entity_extraction(text)

    try:
        from src.agents.memory.prompt import ENTITY_EXTRACTION_PROMPT

        prompt = ENTITY_EXTRACTION_PROMPT.format(text=text)
        response = llm.invoke(prompt)
        content = str(getattr(response, "content", response))

        # 提取 JSON
        import re
        json_match = re.search(r'\[.*\]', content, re.DOTALL)
        if json_match:
            return json.loads(json_match.group(0))

        return self._fallback_entity_extraction(text)
    except Exception:
        return self._fallback_entity_extraction(text)

def _extract_relations(self, text: str, entities: list[dict], llm: Any = None) -> list[dict]:
    """使用 LLM 提取关系。"""
    if not entities or llm is None or not hasattr(llm, "invoke"):
        return []

    try:
        from src.agents.memory.prompt import RELATION_EXTRACTION_PROMPT

        entity_names = [e.get("name") for e in entities]
        prompt = RELATION_EXTRACTION_PROMPT.format(
            text=text,
            entities=", ".join(entity_names)
        )
        response = llm.invoke(prompt)
        content = str(getattr(response, "content", response))

        # 提取 JSON
        import re
        json_match = re.search(r'\[.*\]', content, re.DOTALL)
        if json_match:
            return json.loads(json_match.group(0))

        return []
    except Exception:
        return []

def _fallback_entity_extraction(self, text: str) -> list[dict]:
    """简单的关键词实体提取作为降级方案。"""
    entities = []
    words = text.split()

    for word in words:
        # 提取首字母大写的词作为潜在实体
        if word and len(word) > 2 and word[0].isupper():
            # 清理标点
            clean_word = word.strip('.,!?;:()[]{}')
            if clean_word:
                entities.append({
                    "name": clean_word,
                    "type": "concept",
                    "mentions": 1
                })

    # 去重并限制数量
    seen = set()
    unique_entities = []
    for e in entities:
        if e["name"] not in seen:
            seen.add(e["name"])
            unique_entities.append(e)

    return unique_entities[:10]
```

### 3. 修改 `store()` 方法集成提取

在 `ItemLayer` 类中修改 `store()` 方法：

```python
def store(self, item: dict[str, Any] | Any, llm: Any = None) -> dict[str, Any]:
    """存储记忆项并提取实体/关系。"""
    normalized = self._normalize_item(item)

    # 如果没有提供实体，自动提取
    if not normalized.get("entities"):
        normalized["entities"] = self._extract_entities(
            normalized["content"],
            llm=llm
        )

    # 如果有实体但没有关系，提取关系
    if normalized.get("entities") and not normalized.get("relations"):
        normalized["relations"] = self._extract_relations(
            normalized["content"],
            normalized["entities"],
            llm=llm
        )

    embedding = self._embed_text(normalized["content"])

    with self._lock:
        self._items[normalized["id"]] = normalized
        self._vector_store.add_vector(
            id=normalized["id"],
            content=normalized["content"],
            embedding=embedding,
            category=normalized["category"],
            metadata={
                "confidence": normalized["confidence"],
                "entities": normalized["entities"],
                "relations": normalized["relations"],
            },
        )
        self._save_items()
        self._rebuild_bm25_index()

    return normalized
```

### 4. 更新 `backend/src/agents/memory/memory.py`

修改 `MemoryManager.store_item()` 传递 LLM：

```python
def store_item(self, item: dict[str, Any] | Any) -> dict[str, Any]:
    """存储记忆项并同步到类别层。"""
    stored = self.item_layer.store(item, llm=self.llm)  # 传递 LLM
    self.category_layer.add_item(stored)
    return stored
```

---

## Phase 3: LLM 驱动的记忆项创建

### 1. 添加提示词到 `backend/src/agents/memory/prompt.py`

```python
MEMORY_ITEM_EXTRACTION_PROMPT = """从对话中提取结构化记忆项。

对话内容:
{conversation}

提取离散的事实、偏好、知识、行为、目标或项目信息。

每个记忆项包含:
- content: 事实或信息（1-2句话）
- category: preference|knowledge|context|behavior|goal|project
- confidence: 0.0-1.0（准确度信心）
- entities: 提到的实体列表
- relations: 实体间的关系列表

返回 JSON 数组:
[
  {{
    "content": "用户偏好使用 TypeScript 进行前端开发",
    "category": "preference",
    "confidence": 0.9,
    "entities": [{{"name": "TypeScript", "type": "tool", "mentions": 1}}],
    "relations": [{{"type": "prefers", "target": "TypeScript", "confidence": 0.9}}]
  }}
]

只返回有效 JSON，不要其他文字。
"""
```

### 2. 在 `backend/src/agents/memory/memory.py` 添加提取方法

在 `MemoryManager` 类中添加：

```python
def extract_and_store_items(
    self,
    conversation_text: str,
    resource_id: str | None = None,
) -> list[dict[str, Any]]:
    """从对话中提取并存储结构化记忆项。"""
    if not self.llm or not hasattr(self.llm, "invoke"):
        return []

    try:
        from src.agents.memory.prompt import MEMORY_ITEM_EXTRACTION_PROMPT

        prompt = MEMORY_ITEM_EXTRACTION_PROMPT.format(
            conversation=conversation_text
        )

        response = self.llm.invoke(prompt)
        content = str(getattr(response, "content", response))

        # 提取 JSON
        import re
        json_match = re.search(r'\[.*\]', content, re.DOTALL)
        if not json_match:
            return []

        items = json.loads(json_match.group(0))

        stored_items = []
        for item in items:
            # 链接到源资源
            if resource_id:
                item["source_resource_id"] = resource_id

            stored = self.store_item(item)
            stored_items.append(stored)

        return stored_items

    except Exception as e:
        # 记录错误但不中断
        return []
```

### 3. 更新对话处理流程

修改 `update_memory_from_conversation()` 函数：

```python
def update_memory_from_conversation(
    messages: list[Any],
    thread_id: str | None = None,
    agent_name: str | None = None,
) -> bool:
    """通过 v2 管理器路径更新记忆。"""
    from src.agents.memory.prompt import format_conversation_for_update

    manager = get_memory_manager(agent_name=agent_name)
    conversation_text = format_conversation_for_update(messages)

    if conversation_text:
        # 1. 存储原始资源
        resource = manager.store_conversation(
            {
                "id": f"conv_{thread_id or 'global'}_{datetime.now(UTC).strftime('%Y%m%d%H%M%S%f')}",
                "type": "conversation",
                "content": conversation_text,
                "metadata": {
                    "thread_id": thread_id,
                    "message_count": len(messages),
                    "agent_name": agent_name,
                },
            }
        )

        # 2. 提取并存储结构化记忆项（新增）
        manager.extract_and_store_items(
            conversation_text,
            resource_id=resource.get("id")
        )

    # 3. 同时更新 legacy 系统
    return manager.update_legacy_from_conversation(
        messages=messages,
        thread_id=thread_id,
        agent_name=agent_name,
    )
```

---

## Phase 4: 心跳调度器

### 在 `backend/src/agents/memory/soul/heartbeat.py` 添加调度器

```python
import schedule
import threading
import time

class HeartbeatScheduler:
    """调度并执行心跳任务。"""

    def __init__(self, heartbeat_manager: HeartbeatManager):
        self.manager = heartbeat_manager
        self.running = False
        self.thread = None

    def start(self, schedule_str: str = "daily"):
        """启动调度器。"""
        self.running = True

        # 配置调度
        if schedule_str == "daily":
            schedule.every().day.at("00:00").do(self._run_tasks)
        elif schedule_str == "hourly":
            schedule.every().hour.do(self._run_tasks)
        elif schedule_str.startswith("every_"):
            # 例如: "every_30_minutes"
            parts = schedule_str.split("_")
            if len(parts) == 3:
                interval = int(parts[1])
                unit = parts[2]
                if unit == "minutes":
                    schedule.every(interval).minutes.do(self._run_tasks)
                elif unit == "hours":
                    schedule.every(interval).hours.do(self._run_tasks)

        # 启动后台线程
        self.thread = threading.Thread(target=self._run_loop, daemon=True)
        self.thread.start()

    def stop(self):
        """停止调度器。"""
        self.running = False
        if self.thread:
            self.thread.join(timeout=5)

    def _run_loop(self):
        """运行调度循环。"""
        while self.running:
            schedule.run_pending()
            time.sleep(60)  # 每分钟检查一次

    def _run_tasks(self):
        """执行所有心跳任务。"""
        def executor(task_name: str):
            # 这里可以实现具体的任务执行逻辑
            # 例如: 触发记忆进化、生成摘要等
            return {"status": "completed", "task": task_name}

        return self.manager.run_once(executor)

__all__ = ["HeartbeatTask", "HeartbeatManager", "HeartbeatScheduler"]
```

---

## 测试示例

### 创建 `backend/tests/test_memory_v2_knowledge_graph.py`

```python
"""测试知识图谱提取功能。"""
import pytest
from src.agents.memory.layers.item import ItemLayer
from src.agents.memory.types import MemoryItem

class MockLLM:
    """模拟 LLM 用于测试。"""
    def invoke(self, prompt: str):
        if "实体" in prompt or "entity" in prompt.lower():
            return type('obj', (object,), {
                'content': '[{"name": "John", "type": "person", "mentions": 1}, {"name": "Nion", "type": "project", "mentions": 1}]'
            })()
        elif "关系" in prompt or "relation" in prompt.lower():
            return type('obj', (object,), {
                'content': '[{"type": "works_on", "target": "Nion", "confidence": 0.9}]'
            })()
        return type('obj', (object,), {'content': '[]'})()

def test_entity_extraction():
    """测试实体提取。"""
    item_layer = ItemLayer()
    mock_llm = MockLLM()

    item = {
        "content": "John works on the Nion project using Python",
        "category": "context"
    }

    stored = item_layer.store(item, llm=mock_llm)

    assert len(stored["entities"]) > 0
    entity_names = [e["name"] for e in stored["entities"]]
    assert "John" in entity_names or "Nion" in entity_names

def test_relation_extraction():
    """测试关系提取。"""
    item_layer = ItemLayer()
    mock_llm = MockLLM()

    item = {
        "content": "Alice manages the Backend project",
        "category": "project"
    }

    stored = item_layer.store(item, llm=mock_llm)

    assert len(stored["relations"]) > 0
    relation_types = [r["type"] for r in stored["relations"]]
    assert any(rt in ["manages", "works_on"] for rt in relation_types)

def test_fallback_extraction():
    """测试降级提取（无 LLM）。"""
    item_layer = ItemLayer()

    item = {
        "content": "Python is a programming language used in DataScience",
        "category": "knowledge"
    }

    stored = item_layer.store(item, llm=None)

    # 应该使用降级方案提取首字母大写的词
    assert len(stored["entities"]) > 0
```

---

## 验证步骤

### Phase 1 验证
```bash
cd backend
pytest tests/test_memory_v2_phase1.py -v
```

### Phase 2 验证
```bash
cd backend
pytest tests/test_memory_v2_knowledge_graph.py -v
```

### Phase 3 验证
```bash
cd backend
pytest tests/test_memory_v2_extraction.py -v
```

### 完整测试
```bash
cd backend
pytest tests/test_memory_v2_*.py -v --cov=src/agents/memory
```

### 手动验证知识图谱
```python
# 在 Python REPL 中
from src.agents.memory.memory import get_memory_manager

manager = get_memory_manager()

# 存储一个包含实体的记忆项
item = manager.store_item({
    "content": "张三正在使用 React 开发前端项目",
    "category": "context"
})

print("Entities:", item["entities"])
print("Relations:", item["relations"])

# 检查文件
import json
with open("backend/.nion/memory_v2/items.json") as f:
    items = json.load(f)
    print(json.dumps(items[0], indent=2, ensure_ascii=False))
```

---

## 常见问题

### Q: LLM 提取失败怎么办？
A: 代码已实现降级方案，会自动使用关键词匹配提取实体。

### Q: 如何调试提取结果？
A: 在 `_extract_entities()` 和 `_extract_relations()` 中添加日志：
```python
import logging
logger = logging.getLogger(__name__)
logger.info(f"Extracted entities: {entities}")
```

### Q: 如何调整提取的实体数量？
A: 修改 `_fallback_entity_extraction()` 中的 `[:10]` 限制。

### Q: 如何验证知识图谱是否工作？
A: 检查 `backend/.nion/memory_v2/items.json`，确认 `entities` 和 `relations` 字段不为空。

---

**代码示例文档结束**
