# Nion-Agent 记忆系统 v2.0 补全实施方案

> 给 Codex 的完整执行文档
> 生成时间: 2026-03-06
> 状态: 待执行

---

## 📋 文档说明

**目标读者**: Codex（AI 代码助手）
**任务性质**: 补全 Memory v2 系统的缺失功能
**预计工时**: 4-6 天
**优先级**: P0（知识图谱提取）> P1（类型修复、自动提取）> P2（增强功能）

---

## 🎯 任务背景

### 项目概述

Nion-Agent 是一个基于 LangGraph 的 AI 超级代理系统，目前正在升级记忆系统到 v2.0 版本。v2.0 设计了三层记忆架构、混合检索、知识图谱等高级特性。

**设计文档位置**:
- `docs/MEMORY_SYSTEM_UPGRADE_PLAN.md` - 架构设计
- `docs/MEMORY_SYSTEM_CODEX_GUIDE.md` - 实现指南
- `docs/MEMORY_SYSTEM_IMPLEMENTATION_PLAN.md` - 原始计划

**实现代码位置**:
- `backend/src/agents/memory/` - 记忆系统主目录
- `backend/tests/test_memory_v2_*.py` - 测试文件

### 当前实现状态

经过详细分析，Memory v2 系统已完成 **90% 的基础设施**，但存在 **关键功能缺失**。

#### ✅ 已完成的模块

**Phase 1: 基础设施** (100%)
- `types.py` - 数据类型定义（MemoryCategory, Entity, Relation, MemoryItem, RawResource）
- `search/embeddings.py` - 向量嵌入（SentenceTransformer, OpenAI）
- `search/bm25.py` - BM25 检索算法
- `search/vector_store.py` - SQLite 向量存储
- `search/hybrid.py` - 混合检索（并行 BM25 + 向量，分数融合）

**Phase 2: 三层架构** (100%)
- `layers/resource.py` - 原始资源层（按月分区的 JSONL 存储）
- `layers/item.py` - 结构化记忆项层（混合检索集成）
- `layers/category.py` - 类别管理层（Markdown 渲染）

**Phase 3: 主动记忆** (100%)
- `proactive/dual_mode.py` - 双模式检索（Fast/Deep，LLM 重排序）
- `evolving/self_evolver.py` - 自我进化引擎（合并、压缩、陈旧处理）
- `proactive/patterns.py` - 使用模式分析
- `proactive/context_loader.py` - 上下文预加载

**Phase 4: Soul/Identity** (100%)
- `soul/workspace.py` - 工作区文件（SOUL, IDENTITY, USER, MEMORY, HEARTBEAT）
- `soul/identity_cascade.py` - 身份级联
- `soul/heartbeat.py` - 心跳管理器

**Phase 5: 集成** (100%)
- `memory.py` - MemoryManager（统一管理器）
- `config.py` - MemoryRuntimeConfig（运行时配置）
- 与 legacy 系统的兼容层

**额外功能** (100%)
- `intention/intention_predictor.py` - 意图预测（关键词匹配）
- `linking/memory_linker.py` - 记忆链接（相似度链接）
- `storage/manager.py` - 存储管理器

---

## 🔴 关键缺失功能

### P0: 知识图谱提取（阻塞性问题）

**问题描述**:
- `Entity` 和 `Relation` 类型已在 `types.py` 中定义
- `ItemLayer` 有 `entities` 和 `relations` 字段
- **但是**: 没有任何 LLM 驱动的提取逻辑
- 这些字段永远是空列表
- **知识图谱功能完全不可用**

**证据**:
```python
# backend/src/agents/memory/types.py:60-61
entities: list[Entity] = field(default_factory=list)  # 永远为空！
relations: list[Relation] = field(default_factory=list)  # 永远为空！

# backend/src/agents/memory/layers/item.py:132-136
entities = raw.get("entities")
if not isinstance(entities, list):
    entities = []  # 默认空列表，从不提取
```

**影响**:
- 无法追踪实体（人物、项目、工具、概念）
- 无法追踪关系（works_on, prefers, knows, manages）
- 记忆系统缺乏语义结构
- 设计文档中承诺的知识图谱功能不工作

**需要实现**:
1. 创建实体提取提示词模板
2. 创建关系提取提示词模板
3. 在 `ItemLayer` 中实现 `_extract_entities()` 方法
4. 在 `ItemLayer` 中实现 `_extract_relations()` 方法
5. 实现降级方案（无 LLM 时的关键词提取）
6. 集成到 `ItemLayer.store()` 方法
7. 更新 `MemoryManager` 传递 LLM 实例
8. 添加测试

---

### P1: 类型定义缺口

**问题描述**:
- `MemoryItem` 缺少 `source_resource_id` 字段（CODEX_GUIDE:81 提到）
- `MemoryItem` 缺少 `aggregated_from` 字段（CODEX_GUIDE:87 提到）
- **但是**: `aggregated_from` 已在 `self_evolver.py:191` 中使用
- 类型定义与实际使用不匹配

**证据**:
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
    # 缺失: source_resource_id
    # 缺失: aggregated_from

# backend/src/agents/memory/evolving/self_evolver.py:191
merged_item = {
    ...
    "aggregated_from": sorted(combined_source_ids),  # 使用了但类型中没有！
}
```

**影响**:
- 类型安全违规
- 无法追踪记忆项来自哪个原始资源
- 无法正确追踪合并历史

**需要实现**:
1. 在 `MemoryItem` 中添加 `source_resource_id: Optional[str] = None`
2. 在 `MemoryItem` 中添加 `aggregated_from: List[str] = field(default_factory=list)`
3. 更新 `ItemLayer._normalize_item()` 处理新字段
4. 更新测试

---

### P1: LLM 驱动的记忆项创建

**问题描述**:
- 当前实现只在 `ResourceLayer` 存储原始对话
- 没有自动提取结构化 `MemoryItem` 的逻辑
- 实体和关系从不被提取
- 仍在使用 legacy updater 进行记忆更新

**证据**:
```python
# backend/src/agents/memory/memory.py:407-426
def update_memory_from_conversation(...):
    # 只存储原始对话
    manager.store_conversation({...})

    # 没有提取结构化记忆项！
    # 没有提取实体和关系！

    # 仍然调用 legacy 更新器
    return manager.update_legacy_from_conversation(...)
```

**影响**:
- 记忆项必须手动创建
- 知识图谱永远不会被填充
- v2 系统未被充分利用

**需要实现**:
1. 创建记忆项提取提示词模板
2. 在 `MemoryManager` 中实现 `extract_and_store_items()` 方法
3. 更新 `update_memory_from_conversation()` 调用提取逻辑
4. 将记忆项链接到源资源
5. 添加测试

---

### P2: 增强功能（需验证/完善）

**需要验证的模块**:
1. **ContextPreloader** (`proactive/context_loader.py`) - 模块存在但实现未验证
2. **IdentityCascade** (`soul/identity_cascade.py`) - 模块存在但三级级联未验证
3. **HeartbeatScheduler** - 只有任务读取，没有实际的 cron 调度
4. **主代理集成** - 需验证 v2 系统是否被主代理使用

---

## 📝 实施计划

### Phase 1: 修复类型定义（1-2 小时）

**目标**: 使类型定义与实际使用对齐

**任务清单**:
- [ ] 在 `MemoryItem` 中添加 `source_resource_id` 字段
- [ ] 在 `MemoryItem` 中添加 `aggregated_from` 字段
- [ ] 更新 `ItemLayer._normalize_item()` 处理新字段
- [ ] 运行测试验证

**修改文件**:
- `backend/src/agents/memory/types.py`
- `backend/src/agents/memory/layers/item.py`

**验证命令**:
```bash
cd backend
pytest tests/test_memory_v2_phase1.py -v
```

---

### Phase 2: 知识图谱提取（1-2 天）⭐ 最高优先级

**目标**: 实现 LLM 驱动的实体和关系提取

**任务清单**:
- [ ] 创建实体提取提示词（`ENTITY_EXTRACTION_PROMPT`）
- [ ] 创建关系提取提示词（`RELATION_EXTRACTION_PROMPT`）
- [ ] 实现 `ItemLayer._extract_entities()` 方法
- [ ] 实现 `ItemLayer._extract_relations()` 方法
- [ ] 实现 `ItemLayer._fallback_entity_extraction()` 降级方案
- [ ] 修改 `ItemLayer.store()` 集成提取逻辑
- [ ] 更新 `MemoryManager.store_item()` 传递 LLM
- [ ] 创建测试文件 `test_memory_v2_knowledge_graph.py`
- [ ] 运行测试验证

**修改文件**:
- `backend/src/agents/memory/prompt.py` - 添加提示词
- `backend/src/agents/memory/layers/item.py` - 添加提取方法
- `backend/src/agents/memory/memory.py` - 传递 LLM
- `backend/tests/test_memory_v2_knowledge_graph.py` - 新建测试

**验证命令**:
```bash
cd backend
pytest tests/test_memory_v2_knowledge_graph.py -v
```

---

### Phase 3: LLM 驱动的记忆项创建（1 天）

**目标**: 从对话自动提取结构化记忆项

**任务清单**:
- [ ] 创建记忆项提取提示词（`MEMORY_ITEM_EXTRACTION_PROMPT`）
- [ ] 实现 `MemoryManager.extract_and_store_items()` 方法
- [ ] 更新 `update_memory_from_conversation()` 调用提取
- [ ] 链接记忆项到源资源（使用 `source_resource_id`）
- [ ] 创建测试文件 `test_memory_v2_extraction.py`
- [ ] 运行测试验证

**修改文件**:
- `backend/src/agents/memory/prompt.py` - 添加提示词
- `backend/src/agents/memory/memory.py` - 添加提取方法和更新流程
- `backend/tests/test_memory_v2_extraction.py` - 新建测试

**验证命令**:
```bash
cd backend
pytest tests/test_memory_v2_extraction.py -v
```

---

### Phase 4: 增强功能验证（1-2 天）

**任务清单**:
- [ ] 读取并验证 `proactive/context_loader.py` 实现
- [ ] 读取并验证 `soul/identity_cascade.py` 三级级联
- [ ] 实现 `HeartbeatScheduler` 类（实际调度）
- [ ] 添加调度器测试

**修改文件**:
- `backend/src/agents/memory/soul/heartbeat.py` - 添加调度器
- `backend/tests/test_memory_v2_heartbeat.py` - 新建测试

---

### Phase 5: 集成与测试（1 天）

**任务清单**:
- [ ] 验证 `MemoryMiddleware` 使用 v2 系统
- [ ] 运行完整测试套件
- [ ] 手动测试知识图谱功能
- [ ] 更新文档

**验证命令**:
```bash
cd backend

# 运行所有 memory v2 测试
pytest tests/test_memory_v2_*.py -v

# 检查覆盖率
pytest tests/test_memory_v2_*.py --cov=src/agents/memory --cov-report=html
```

**手动测试步骤**:
1. 启动系统
2. 进行包含实体和关系的对话（例如："我在用 Python 开发 Nion 项目"）
3. 检查记忆文件:
   - `backend/.nion/memory_v2/items.json` - 应包含 entities/relations
   - `backend/.nion/memory_v2/categories/*.md` - 应正确渲染
4. 查询记忆验证知识图谱工作

---

## ✅ 成功标准

### 知识图谱可用
- ✅ 对话自动提取实体
- ✅ 追踪实体间的关系
- ✅ 可以查询 "Alice 在做什么项目？"
- ✅ 可以查询 "团队偏好使用什么工具？"

### 记忆项自动创建
- ✅ 对话创建结构化 MemoryItem
- ✅ 记忆项有正确的类别
- ✅ 记忆项链接到源对话
- ✅ Legacy 系统仍然工作

### 所有测试通过
```bash
cd backend
pytest tests/test_memory_v2_*.py -v
# 所有测试应该通过
```

---

## 📚 重要参考

### 设计文档
- `docs/MEMORY_SYSTEM_UPGRADE_PLAN.md` - 完整架构设计
- `docs/MEMORY_SYSTEM_CODEX_GUIDE.md` - 实现指南（包含代码示例）
- `docs/MEMORY_SYSTEM_IMPLEMENTATION_PLAN.md` - 原始实施计划

### 核心实现文件
- `backend/src/agents/memory/types.py` - 数据类型
- `backend/src/agents/memory/layers/item.py` - 记忆项存储
- `backend/src/agents/memory/memory.py` - 管理器
- `backend/src/agents/memory/prompt.py` - 提示词模板

### 测试文件
- `backend/tests/test_memory_v2_phase*.py` - 阶段测试
- `backend/tests/test_memory_v2_layers_phase2.py` - 层测试

---

## ⚠️ 重要注意事项

1. **向后兼容**: 所有更改必须保持与 legacy 记忆系统的兼容性
2. **性能考虑**: 实体/关系提取会增加 LLM 调用，考虑批处理
3. **错误处理**: 提取失败不应破坏记忆存储
4. **测试优先**: 每个阶段必须有通过的测试才能进入下一阶段
5. **文档更新**: 完成后更新 `CLAUDE.md`

---

## 🚀 预计时间线

- **Phase 1**: 1-2 小时（快速胜利）
- **Phase 2**: 1-2 天（最复杂，最高价值）
- **Phase 3**: 1 天
- **Phase 4**: 1-2 天
- **Phase 5**: 1 天

**总计**: 4-6 天专注开发

---

## 📋 执行检查清单

### 开始前
- [ ] 阅读完整文档
- [ ] 阅读设计文档（MEMORY_SYSTEM_CODEX_GUIDE.md）
- [ ] 理解当前实现状态
- [ ] 理解缺失功能

### Phase 1
- [ ] 修改 types.py
- [ ] 修改 item.py
- [ ] 测试通过

### Phase 2
- [ ] 添加提示词到 prompt.py
- [ ] 实现提取方法到 item.py
- [ ] 更新 memory.py
- [ ] 创建测试
- [ ] 测试通过

### Phase 3
- [ ] 添加提示词到 prompt.py
- [ ] 实现提取方法到 memory.py
- [ ] 更新对话处理流程
- [ ] 创建测试
- [ ] 测试通过

### Phase 4
- [ ] 验证现有模块
- [ ] 实现缺失功能
- [ ] 测试通过

### Phase 5
- [ ] 集成验证
- [ ] 完整测试
- [ ] 手动测试
- [ ] 文档更新

---

## 📞 需要帮助？

如果在执行过程中遇到问题：
1. 检查设计文档中的代码示例
2. 查看现有测试文件了解预期行为
3. 参考 `docs/MEMORY_V2_补全方案_实施细节.md` 获取详细代码示例

---

**文档结束 - 开始执行！**
