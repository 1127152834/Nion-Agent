# Memory v2 Completion Plan

> Implementation plan for completing missing Memory v2 features
> Generated: 2026-03-06
> Status: Ready for execution

---

## 📊 Implementation Status

### ✅ **Completed (90% of infrastructure)**

**Phase 1: Infrastructure** ✅
- Types definition (MemoryCategory, Entity, Relation, MemoryItem, RawResource)
- Embedding support (SentenceTransformer, OpenAI)
- BM25 search algorithm
- Vector store (SQLite-based)
- Hybrid search (parallel BM25 + vector with score fusion)

**Phase 2: Three-Layer Architecture** ✅
- ResourceLayer: Month-partitioned JSONL storage
- ItemLayer: Structured items with hybrid search
- CategoryLayer: Category management with markdown rendering

**Phase 3: Proactive Memory** ✅
- DualModeRetriever: Fast/Deep modes with LLM reranking
- SelfEvolvingEngine: Merge, compression, staleness handling
- UsagePatternAnalyzer: Query and category tracking
- ContextPreloader: Exists (needs verification)

**Phase 4: Soul/Identity** ✅
- WorkspaceFiles: SOUL, IDENTITY, USER, MEMORY, HEARTBEAT
- IdentityCascade: Exists (needs verification)
- HeartbeatManager: Basic task reading

**Phase 5: Integration** ✅
- MemoryManager: Comprehensive integration
- MemoryRuntimeConfig: All configuration fields
- Legacy compatibility layer

---

## ❌ **Critical Missing Features**

### 🔴 **P0: Knowledge Graph Extraction (BLOCKING)**

**Problem:**
- Entity and Relation types exist in `types.py`
- ItemLayer has `entities` and `relations` fields
- **BUT**: No LLM-based extraction logic exists
- These fields are always empty lists
- Knowledge graph feature is completely non-functional

**Evidence:**
- `backend/src/agents/memory/types.py:60-61` - Fields defined but never populated
- `backend/src/agents/memory/layers/item.py:132-136` - Entities/relations default to empty lists
- No extraction prompt templates exist
- No LLM invocation for entity/relation extraction

**Impact:**
- Knowledge graph feature advertised in design docs is not working
- Cannot track entities (people, projects, tools, concepts)
- Cannot track relationships (works_on, prefers, knows, manages)
- Memory system lacks semantic structure

---

### 🟡 **P1: Type Definition Gaps**

**Problem:**
- `MemoryItem` missing `source_resource_id` field (mentioned in CODEX_GUIDE:81)
- `MemoryItem` missing `aggregated_from` field (mentioned in CODEX_GUIDE:87)
- **BUT**: `aggregated_from` is already used in `self_evolver.py:191`
- Type definition doesn't match actual usage

**Evidence:**
```python
# backend/src/agents/memory/types.py:52-65
@dataclass
class MemoryItem:
    id: str = field(default_factory=lambda: f"item_{uuid.uuid4().hex[:8]}")
    content: str = ""
    category: MemoryCategory = MemoryCategory.CONTEXT
    confidence: float = 0.5
    entities: list[Entity] = field(default_factory=list)
    relations: list[Relation] = field(default_factory=list)
    created_at: datetime = field(default_factory=datetime.utcnow)
    last_accessed: datetime = field(default_factory=datetime.utcnow)
    access_count: int = 0
    # MISSING: source_resource_id
    # MISSING: aggregated_from
```

```python
# backend/src/agents/memory/evolving/self_evolver.py:191
merged_item = {
    ...
    "aggregated_from": sorted(combined_source_ids),  # Used but not in type!
}
```

**Impact:**
- Type safety violations
- Cannot track which raw resource a memory item came from
- Cannot track merge history properly

---

### 🟡 **P1: LLM-Driven Memory Item Creation**

**Problem:**
- Current implementation only stores raw conversations in ResourceLayer
- No automatic extraction of structured MemoryItems from conversations
- Entities and relations never extracted
- Legacy updater still used for memory updates

**Evidence:**
- `backend/src/agents/memory/memory.py:407-426` - Only stores raw conversation
- No LLM-based extraction in the update flow
- Design docs mention extracting facts with entities/relations

**Impact:**
- Memory items must be manually created
- Knowledge graph never populated
- v2 system not fully utilized

---

### 🟢 **P2: Enhanced Features**

**Missing/Incomplete:**
1. **Context Preloading** - Module exists but implementation not verified
2. **Identity Cascade** - Module exists but three-level cascade not verified
3. **Heartbeat Scheduling** - No actual cron-like scheduling, just task reading
4. **Integration Verification** - Need to verify v2 is used by main agent

---

## 🎯 Phased Completion Plan

### **Phase 1: Fix Type Definitions** (1-2 hours)

**Goal:** Align type definitions with actual usage

**Tasks:**
1. Add `source_resource_id: Optional[str] = None` to MemoryItem
2. Add `aggregated_from: List[str] = field(default_factory=list)` to MemoryItem
3. Update ItemLayer normalization to handle new fields
4. Update tests to verify new fields

**Files to modify:**
- `backend/src/agents/memory/types.py`
- `backend/src/agents/memory/layers/item.py` (normalization logic)

**Verification:**
```bash
cd backend
pytest tests/test_memory_v2_phase1.py -v
```

---

### **Phase 2: Knowledge Graph Extraction** (1-2 days)

**Goal:** Implement LLM-based entity and relation extraction

#### **Step 2.1: Create Extraction Prompts**

**File:** `backend/src/agents/memory/prompt.py`

Add extraction prompts:
```python
ENTITY_EXTRACTION_PROMPT = """Extract entities from the following text.

Text: {text}

Identify:
- People (names, roles)
- Projects (project names, codebases)
- Tools (technologies, frameworks, libraries)
- Concepts (technical concepts, methodologies)

Return JSON array:
[
  {{"name": "entity_name", "type": "person|project|tool|concept", "mentions": 1}}
]
"""

RELATION_EXTRACTION_PROMPT = """Extract relationships between entities.

Text: {text}
Entities: {entities}

Identify relationships like:
- works_on (person works on project)
- prefers (person prefers tool)
- knows (person knows concept)
- manages (person manages project)
- uses (project uses tool)

Return JSON array:
[
  {{"type": "relation_type", "target": "entity_name", "confidence": 0.0-1.0}}
]
"""
```

#### **Step 2.2: Add Extraction Logic to ItemLayer**

**File:** `backend/src/agents/memory/layers/item.py`

Add methods:
```python
def _extract_entities(self, text: str, llm: Any = None) -> list[dict]:
    """Extract entities using LLM or fallback to keyword matching."""
    if llm is None or not hasattr(llm, "invoke"):
        return self._fallback_entity_extraction(text)

    prompt = ENTITY_EXTRACTION_PROMPT.format(text=text)
    response = llm.invoke(prompt)
    content = str(getattr(response, "content", response))

    try:
        return json.loads(content)
    except json.JSONDecodeError:
        return self._fallback_entity_extraction(text)

def _extract_relations(self, text: str, entities: list[dict], llm: Any = None) -> list[dict]:
    """Extract relations between entities using LLM."""
    if not entities or llm is None or not hasattr(llm, "invoke"):
        return []

    entity_names = [e.get("name") for e in entities]
    prompt = RELATION_EXTRACTION_PROMPT.format(
        text=text,
        entities=", ".join(entity_names)
    )
    response = llm.invoke(prompt)
    content = str(getattr(response, "content", response))

    try:
        return json.loads(content)
    except json.JSONDecodeError:
        return []

def _fallback_entity_extraction(self, text: str) -> list[dict]:
    """Simple keyword-based entity extraction as fallback."""
    entities = []

    # Extract capitalized words as potential entities
    words = text.split()
    for word in words:
        if word and word[0].isupper() and len(word) > 2:
            entities.append({
                "name": word,
                "type": "concept",
                "mentions": 1
            })

    return entities[:10]  # Limit to 10 entities
```

#### **Step 2.3: Integrate Extraction into Store Method**

Modify `ItemLayer.store()` to extract entities/relations:
```python
def store(self, item: dict[str, Any] | Any, llm: Any = None) -> dict[str, Any]:
    """Store one structured memory item and its embedding."""
    normalized = self._normalize_item(item)

    # Extract entities and relations if not provided
    if not normalized.get("entities"):
        normalized["entities"] = self._extract_entities(
            normalized["content"],
            llm=llm
        )

    if not normalized.get("relations") and normalized.get("entities"):
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

#### **Step 2.4: Update MemoryManager Integration**

**File:** `backend/src/agents/memory/memory.py`

Pass LLM to ItemLayer.store():
```python
def store_item(self, item: dict[str, Any] | Any) -> dict[str, Any]:
    """Store one memory item and sync to category layer."""
    stored = self.item_layer.store(item, llm=self.llm)  # Pass LLM
    self.category_layer.add_item(stored)
    return stored
```

#### **Step 2.5: Add Tests**

**File:** `backend/tests/test_memory_v2_knowledge_graph.py`

```python
def test_entity_extraction():
    """Test entity extraction from memory content."""
    item = {
        "content": "John works on the Nion project using Python and React",
        "category": "context"
    }

    stored = item_layer.store(item, llm=mock_llm)

    assert len(stored["entities"]) > 0
    entity_names = [e["name"] for e in stored["entities"]]
    assert "John" in entity_names or "Nion" in entity_names

def test_relation_extraction():
    """Test relation extraction between entities."""
    item = {
        "content": "Alice manages the Backend project",
        "category": "project"
    }

    stored = item_layer.store(item, llm=mock_llm)

    assert len(stored["relations"]) > 0
    relation_types = [r["type"] for r in stored["relations"]]
    assert "manages" in relation_types or "works_on" in relation_types
```

**Verification:**
```bash
cd backend
pytest tests/test_memory_v2_knowledge_graph.py -v
```

---

### **Phase 3: LLM-Driven Memory Item Creation** (1 day)

**Goal:** Automatically extract structured MemoryItems from conversations

#### **Step 3.1: Create Memory Item Extraction Prompt**

**File:** `backend/src/agents/memory/prompt.py`

```python
MEMORY_ITEM_EXTRACTION_PROMPT = """Extract structured memory items from this conversation.

Conversation:
{conversation}

Extract discrete facts, preferences, knowledge, behaviors, goals, or project information.

For each memory item, provide:
- content: The fact or information (1-2 sentences)
- category: preference|knowledge|context|behavior|goal|project
- confidence: 0.0-1.0 (how confident you are this is accurate)
- entities: List of entities mentioned (people, projects, tools, concepts)
- relations: List of relationships between entities

Return JSON array:
[
  {{
    "content": "User prefers using TypeScript for frontend development",
    "category": "preference",
    "confidence": 0.9,
    "entities": [{{"name": "TypeScript", "type": "tool", "mentions": 1}}],
    "relations": [{{"type": "prefers", "target": "TypeScript", "confidence": 0.9}}]
  }}
]

Return only valid JSON, no additional text.
"""
```

#### **Step 3.2: Add Extraction Method to MemoryManager**

**File:** `backend/src/agents/memory/memory.py`

```python
def extract_and_store_items(
    self,
    conversation_text: str,
    resource_id: str | None = None,
) -> list[dict[str, Any]]:
    """Extract structured memory items from conversation using LLM."""
    if not self.llm or not hasattr(self.llm, "invoke"):
        return []

    prompt = MEMORY_ITEM_EXTRACTION_PROMPT.format(
        conversation=conversation_text
    )

    try:
        response = self.llm.invoke(prompt)
        content = str(getattr(response, "content", response))

        # Extract JSON from response
        import re
        json_match = re.search(r'\[.*\]', content, re.DOTALL)
        if not json_match:
            return []

        items = json.loads(json_match.group(0))

        stored_items = []
        for item in items:
            if resource_id:
                item["source_resource_id"] = resource_id
            stored = self.store_item(item)
            stored_items.append(stored)

        return stored_items

    except Exception as e:
        # Log error but don't fail
        return []
```

#### **Step 3.3: Update Conversation Storage**

Modify `update_memory_from_conversation()` to extract items:

```python
def update_memory_from_conversation(
    messages: list[Any],
    thread_id: str | None = None,
    agent_name: str | None = None,
) -> bool:
    """Update memory through v2 manager path."""
    from src.agents.memory.prompt import format_conversation_for_update

    manager = get_memory_manager(agent_name=agent_name)
    conversation_text = format_conversation_for_update(messages)

    if conversation_text:
        # Store raw resource
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

        # Extract and store structured items
        manager.extract_and_store_items(
            conversation_text,
            resource_id=resource.get("id")
        )

    # Also update legacy system
    return manager.update_legacy_from_conversation(
        messages=messages,
        thread_id=thread_id,
        agent_name=agent_name,
    )
```

**Verification:**
```bash
cd backend
pytest tests/test_memory_v2_extraction.py -v
```

---

### **Phase 4: Enhanced Features** (1-2 days)

#### **Step 4.1: Verify Context Preloading**

**File:** `backend/src/agents/memory/proactive/context_loader.py`

Read and verify implementation. If incomplete, implement:
- Preload relevant memories based on user patterns
- Cache frequently accessed items
- Predict next likely queries

#### **Step 4.2: Verify Identity Cascade**

**File:** `backend/src/agents/memory/soul/identity_cascade.py`

Read and verify three-level cascade:
1. Global config (system-wide defaults)
2. Agent config (per-agent overrides)
3. Workspace (per-workspace overrides)

#### **Step 4.3: Implement Heartbeat Scheduling**

**File:** `backend/src/agents/memory/soul/heartbeat.py`

Add actual scheduling:
```python
import schedule
import threading

class HeartbeatScheduler:
    """Schedule and execute heartbeat tasks."""

    def __init__(self, heartbeat_manager: HeartbeatManager):
        self.manager = heartbeat_manager
        self.running = False
        self.thread = None

    def start(self, schedule_str: str = "daily"):
        """Start the scheduler."""
        self.running = True

        if schedule_str == "daily":
            schedule.every().day.at("00:00").do(self._run_tasks)
        elif schedule_str == "hourly":
            schedule.every().hour.do(self._run_tasks)

        self.thread = threading.Thread(target=self._run_loop, daemon=True)
        self.thread.start()

    def stop(self):
        """Stop the scheduler."""
        self.running = False
        if self.thread:
            self.thread.join(timeout=5)

    def _run_loop(self):
        """Run the schedule loop."""
        while self.running:
            schedule.run_pending()
            time.sleep(60)

    def _run_tasks(self):
        """Execute all heartbeat tasks."""
        def executor(task_name: str):
            # Execute task logic here
            return {"status": "completed", "task": task_name}

        return self.manager.run_once(executor)
```

---

### **Phase 5: Integration & Testing** (1 day)

#### **Step 5.1: Verify Main Agent Integration**

Check if MemoryMiddleware uses v2 system:
- `backend/src/agents/middlewares/memory_middleware.py`
- Verify it calls `update_memory_from_conversation()`
- Verify memory injection uses v2 data

#### **Step 5.2: Run Full Test Suite**

```bash
cd backend

# Run all memory v2 tests
pytest tests/test_memory_v2_*.py -v

# Run integration tests
pytest tests/test_memory_integration.py -v

# Check coverage
pytest tests/test_memory_v2_*.py --cov=src/agents/memory --cov-report=html
```

#### **Step 5.3: Manual Testing**

1. Start the system
2. Have a conversation mentioning entities and relationships
3. Check memory files:
   - `backend/.nion/memory_v2/items.json` - Should have entities/relations
   - `backend/.nion/memory_v2/categories/*.md` - Should render properly
4. Query memory and verify knowledge graph works

---

## 📋 Completion Checklist

### Phase 1: Type Definitions
- [ ] Add `source_resource_id` to MemoryItem
- [ ] Add `aggregated_from` to MemoryItem
- [ ] Update ItemLayer normalization
- [ ] Tests pass

### Phase 2: Knowledge Graph
- [ ] Create entity extraction prompt
- [ ] Create relation extraction prompt
- [ ] Implement `_extract_entities()` in ItemLayer
- [ ] Implement `_extract_relations()` in ItemLayer
- [ ] Implement fallback extraction
- [ ] Integrate into `store()` method
- [ ] Update MemoryManager to pass LLM
- [ ] Add knowledge graph tests
- [ ] Tests pass

### Phase 3: Memory Item Creation
- [ ] Create memory item extraction prompt
- [ ] Implement `extract_and_store_items()` in MemoryManager
- [ ] Update `update_memory_from_conversation()`
- [ ] Link items to source resources
- [ ] Add extraction tests
- [ ] Tests pass

### Phase 4: Enhanced Features
- [ ] Verify ContextPreloader implementation
- [ ] Verify IdentityCascade implementation
- [ ] Implement HeartbeatScheduler
- [ ] Add scheduler tests

### Phase 5: Integration
- [ ] Verify MemoryMiddleware integration
- [ ] Run full test suite
- [ ] Manual testing
- [ ] Update documentation

---

## 🎯 Success Criteria

**Knowledge Graph Working:**
- Conversations automatically extract entities
- Relationships between entities are tracked
- Can query "What projects does Alice work on?"
- Can query "What tools does the team prefer?"

**Memory Items Auto-Created:**
- Conversations create structured MemoryItems
- Items have proper categories
- Items linked to source conversations
- Legacy system still works

**All Tests Pass:**
```bash
cd backend
pytest tests/test_memory_v2_*.py -v
# All tests should pass
```

---

## 📚 Reference Files

**Design Documents:**
- `docs/MEMORY_SYSTEM_UPGRADE_PLAN.md` - Architecture overview
- `docs/MEMORY_SYSTEM_CODEX_GUIDE.md` - Implementation guide
- `docs/MEMORY_SYSTEM_IMPLEMENTATION_PLAN.md` - Original plan

**Implementation Files:**
- `backend/src/agents/memory/types.py` - Data types
- `backend/src/agents/memory/layers/item.py` - Item storage
- `backend/src/agents/memory/memory.py` - Manager
- `backend/src/agents/memory/prompt.py` - Prompts

**Test Files:**
- `backend/tests/test_memory_v2_phase*.py` - Phase tests
- `backend/tests/test_memory_v2_layers_phase2.py` - Layer tests

---

## ⚠️ Important Notes

1. **Backward Compatibility:** All changes must maintain compatibility with legacy memory system
2. **Performance:** Entity/relation extraction adds LLM calls - consider batching
3. **Error Handling:** Extraction failures should not break memory storage
4. **Testing:** Each phase must have passing tests before moving to next phase
5. **Documentation:** Update CLAUDE.md after completion

---

## 🚀 Estimated Timeline

- **Phase 1:** 1-2 hours
- **Phase 2:** 1-2 days (most complex)
- **Phase 3:** 1 day
- **Phase 4:** 1-2 days
- **Phase 5:** 1 day

**Total:** 4-6 days of focused development

---

## 📝 Next Steps

1. Review this plan with the team
2. Start with Phase 1 (quick win)
3. Tackle Phase 2 (knowledge graph) - highest value
4. Complete remaining phases
5. Update documentation and announce completion
