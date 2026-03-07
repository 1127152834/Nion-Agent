# Memory v2.0 增强功能实现计划

> **创建时间**: 2026-03-07
> **基于**: 成熟开源项目深度调研
> **重点**: 记忆可视化（知识图谱 + 记忆图谱）

---

## 📋 概述

本计划基于对成熟开源项目的深入调研，为 Memory v2.0 系统设计增强功能实现路线。所有技术选择都来自经过验证的开源解决方案，避免从头设计。

### 核心目标

1. **记忆可视化**（最高优先级）- 美观、交互式的知识图谱和记忆图谱
2. **时间线记忆** - 时间范围查询和时间轴可视化
3. **冲突检测** - 自动识别和解决矛盾信息
4. **分享/协作** - 导入/导出和同步功能
5. **重要性评分** - 基于遗忘曲线的记忆优先级
6. **标签系统** - 自动和手动标签管理
7. **备份/恢复** - Git-based 版本控制
8. **加密** - 端到端加密保护隐私

### 当前系统状态

- ✅ Memory v2.0 核心功能 100% 完成
- ✅ 三层架构（Resource → Item → Category）
- ✅ 混合搜索（BM25 + Vector）
- ✅ 知识图谱基础（NER + 关系抽取 + networkx）
- ⚠️ 缺少可视化界面
- ⚠️ 缺少时间线功能
- ⚠️ 缺少冲突检测
- ⚠️ 缺少分享/协作功能

---

## Phase 0: 研究成果总结

### 已完成的调研

#### 1. 知识图谱可视化库对比

| 库 | 适用场景 | 优势 | 劣势 |
|---|---------|------|------|
| **Sigma.js** | 大规模图谱（1万-5万节点） | WebGL 渲染，性能最佳，支持 Graphology | 需要编写 shader，学习曲线陡 |
| **React Flow** | 编辑型图谱，流程图 | React 原生，组件化，可访问性好 | 不含布局引擎，需外部集成 |
| **Cytoscape.js** | 中等规模分析图谱 | 算法丰富，布局多样，CSS-like 样式 | 大规模性能差，需预计算位置 |
| **vis.js** | 中小规模动态图谱 | 内置聚类，Canvas 渲染 | 大规模性能受限，无 HTML 节点 |
| **D3.js** | 定制化可视化 | 完全控制，灵活性最高 | 需手动管理 React 集成 |

**推荐方案**：
- **主可视化**：Sigma.js + Graphology（大规模，性能优先）
- **编辑模式**：React Flow（节点编辑，关系管理）
- **参考实现**：Obsidian Graph View（Pixi.js + 自定义物理引擎）

#### 2. 时间线记忆系统

**核心模式**（来自 Rewind AI, Notion, Obsidian）：
- **持久化时间戳记录** - 每个记忆项带 `created_at`, `updated_at`, `accessed_at`
- **时间范围查询** - SQL/Dataview 风格的时间过滤
- **可视化时间轴** - 可缩放的时间线（分钟→年）
- **时间模式分析** - 按小时/日/周/月聚合

**推荐实现**：
- 后端：SQLite 时间索引 + 时间范围查询 API
- 前端：Notion-style Timeline View（拖拽、缩放、过滤）
- 插件：Obsidian Chronos 风格的侧边栏时间线

#### 3. 冲突检测系统

**核心架构**（来自 Mem0）：
1. **相似度检索** - 向量搜索找到 top-k 相似记忆
2. **LLM 判断** - 将候选记忆 + 新记忆送入 LLM，返回 ADD/UPDATE/MERGE/ARCHIVE
3. **自动归档** - 被替代的记忆标记为 `superseded`，保留审计轨迹

**推荐实现**：
- 使用现有的 `hybrid_search` 找相似记忆（cosine > 0.85）
- 添加 `ConflictResolver` 类，调用 LLM 判断
- 实现 `archive_item()` 方法，保留历史版本

#### 4. 分享/协作功能

**导出格式**（来自 Obsidian, Roam Research）：
- **Markdown** - 人类可读，Git 友好
- **JSON** - 完整结构，包含元数据
- **Graph JSON** - 节点+边的图结构

**推荐实现**：
- `export_memory(format='markdown'|'json'|'graph')` API
- `import_memory(file_path, merge_strategy='replace'|'merge')` API
- 支持 Roam Research JSON 格式（block references）

#### 5. 重要性评分算法

**核心算法**（来自 Anki, SuperMemo）：
- **FSRS (Free Spaced Repetition Scheduler)** - Anki 最新算法
- **SM-2** - SuperMemo 经典算法
- **遗忘曲线** - Ebbinghaus 模型

**推荐实现**：
- 为每个记忆项添加 `importance_score` (0-1)
- 计算公式：`score = recency * 0.4 + frequency * 0.3 + utility * 0.3`
- 自动衰减：30 天后项目数据衰减，365 天后客户数据衰减

#### 6. 标签系统

**自动标签**（来自 Obsidian AI Note Tagger）：
- 使用 LLM 分析内容，提取关键词
- 支持本地 LLM（Ollama）和云端 API
- 分类标签：`#location`, `#context`, `#subject`

**推荐实现**：
- `auto_tag(content)` - 调用 LLM 生成标签
- `add_tag(item_id, tag)` / `remove_tag(item_id, tag)` - 手动管理
- 标签搜索：`search(query, tags=['python', 'web'])`

#### 7. 备份/恢复

**Git-based 方案**（来自 Obsidian Git）：
- 自动提交：每 N 分钟或每次更新后
- GitHub Actions：定时备份到远程仓库
- 版本恢复：`git checkout <commit>` 恢复历史版本

**推荐实现**：
- `backup_memory()` - 创建 Git commit
- `restore_memory(commit_hash)` - 恢复到指定版本
- `list_backups()` - 列出所有备份点

#### 8. 加密

**E2EE 方案**（来自 Obsidian Sync, Standard Notes）：
- **AES-256-GCM** - 对称加密
- **Scrypt** - 密钥派生（密码 → 加密密钥）
- **HMAC** - 消息认证码，防篡改

**推荐实现**：
- `encrypt_memory(password)` - 加密整个 memory.json
- `decrypt_memory(password)` - 解密并加载
- 加密元数据：`salt`, `iv`, `auth_tag`

---

## Phase 1: 知识图谱可视化（最高优先级）

### 目标

创建美观、交互式的知识图谱可视化界面，支持：
- 节点聚类和展开/折叠
- 实时搜索和过滤
- 力导向布局和手动调整
- 节点详情查看和编辑

### 技术选择

**前端可视化**：
- **主库**：Sigma.js v3 + Graphology
- **布局算法**：ForceAtlas2（力导向）
- **渲染**：WebGL（支持 5 万节点）
- **React 集成**：`@react-sigma/core`

**后端 API**：
- `GET /api/memory/graph` - 获取图数据（节点+边）
- `GET /api/memory/graph/subgraph?entity=<name>&depth=2` - 获取子图
- `GET /api/memory/graph/stats` - 图统计信息

### 实现步骤

#### 1.1 后端：图数据导出 API

**文件**：`backend/src/gateway/routers/memory.py`

```python
@router.get("/graph")
async def get_memory_graph(
    depth: int = 2,
    min_confidence: float = 0.7,
) -> dict[str, Any]:
    """获取知识图谱数据（Sigma.js 格式）"""
    manager = get_memory_manager()

    if not manager.knowledge_graph_enabled:
        raise HTTPException(400, "Knowledge graph not enabled")

    # 从 graph_builder 获取图数据
    graph = manager.graph_builder._graph

    # 转换为 Sigma.js 格式
    nodes = []
    edges = []

    for node_id, node_data in graph.nodes(data=True):
        nodes.append({
            "id": node_id,
            "label": node_data.get("name", node_id),
            "type": node_data.get("type", "unknown"),
            "size": len(node_data.get("mentions", [])),
            "x": random.random(),  # 初始位置（ForceAtlas2 会重新计算）
            "y": random.random(),
            "color": get_color_by_type(node_data.get("type")),
        })

    for source, target, edge_data in graph.edges(data=True):
        edges.append({
            "id": f"{source}-{target}",
            "source": source,
            "target": target,
            "label": edge_data.get("type", "related"),
            "size": edge_data.get("confidence", 0.5) * 5,
        })

    return {
        "nodes": nodes,
        "edges": edges,
        "stats": {
            "num_nodes": len(nodes),
            "num_edges": len(edges),
        },
    }
```

**文档引用**：
- Sigma.js 数据格式：https://www.sigmajs.org/docs/quickstart/
- Graphology API：https://graphology.github.io/

#### 1.2 前端：Sigma.js 图谱组件

**文件**：`frontend/src/components/workspace/memory/knowledge-graph.tsx`

```typescript
import { SigmaContainer, useLoadGraph, useRegisterEvents } from "@react-sigma/core";
import { useEffect } from "react";
import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";

export function KnowledgeGraph() {
  const loadGraph = useLoadGraph();
  const registerEvents = useRegisterEvents();

  useEffect(() => {
    // 加载图数据
    fetch("/api/memory/graph")
      .then((res) => res.json())
      .then((data) => {
        const graph = new Graph();

        // 添加节点和边
        data.nodes.forEach((node) => graph.addNode(node.id, node));
        data.edges.forEach((edge) => graph.addEdge(edge.source, edge.target, edge));

        // 应用 ForceAtlas2 布局
        forceAtlas2.assign(graph, {
          iterations: 50,
          settings: {
            gravity: 1,
            scalingRatio: 10,
          },
        });

        loadGraph(graph);
      });
  }, [loadGraph]);

  // 注册交互事件
  useEffect(() => {
    registerEvents({
      clickNode: (event) => {
        console.log("Clicked node:", event.node);
        // 显示节点详情
      },
      enterNode: (event) => {
        // 高亮相邻节点
      },
      leaveNode: () => {
        // 取消高亮
      },
    });
  }, [registerEvents]);

  return (
    <SigmaContainer
      style={{ height: "600px", width: "100%" }}
      settings={{
        renderEdgeLabels: true,
        defaultNodeColor: "#999",
        defaultEdgeColor: "#ccc",
      }}
    />
  );
}
```

**文档引用**：
- React Sigma 快速开始：https://www.sigmajs.org/docs/quickstart/
- ForceAtlas2 布局：https://github.com/graphology/graphology-layout-forceatlas2

#### 1.3 前端：图谱控制面板

**文件**：`frontend/src/components/workspace/memory/graph-controls.tsx`

```typescript
export function GraphControls() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [layoutRunning, setLayoutRunning] = useState(false);

  return (
    <div className="flex gap-4 p-4 border-b">
      {/* 搜索框 */}
      <Input
        placeholder="搜索节点..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
      />

      {/* 类型过滤 */}
      <Select
        multiple
        value={selectedTypes}
        onChange={setSelectedTypes}
      >
        <option value="person">人物</option>
        <option value="location">地点</option>
        <option value="organization">组织</option>
        <option value="misc">其他</option>
      </Select>

      {/* 布局控制 */}
      <Button
        onClick={() => setLayoutRunning(!layoutRunning)}
      >
        {layoutRunning ? "停止布局" : "运行布局"}
      </Button>

      {/* 导出 */}
      <Button onClick={exportGraph}>
        导出图谱
      </Button>
    </div>
  );
}
```

### 验证清单

- [ ] 后端 API 返回正确的 Sigma.js 格式数据
- [ ] 前端成功渲染图谱（节点+边）
- [ ] ForceAtlas2 布局正常工作
- [ ] 节点点击显示详情
- [ ] 搜索和过滤功能正常
- [ ] 支持 5000+ 节点流畅渲染（60fps）
- [ ] 导出功能正常（PNG/SVG/JSON）

### 反模式防护

❌ **不要**：
- 使用 D3.js SVG 渲染大规模图谱（性能差）
- 在前端计算复杂布局（应在后端或 Web Worker）
- 一次性加载所有节点（应支持分页/懒加载）
- 忽略可访问性（需支持键盘导航）

✅ **要**：
- 使用 WebGL 渲染（Sigma.js）
- 实现节点聚类和展开/折叠
- 支持增量更新（不重新渲染整个图）
- 提供多种布局算法选择

---

## Phase 2: 记忆时间线

### 目标

实现时间范围查询和时间轴可视化，支持：
- 按时间范围过滤记忆
- 时间轴可视化（Notion-style）
- 时间模式分析

### 技术选择

**后端**：
- SQLite 时间索引
- 时间范围查询 API

**前端**：
- Notion-style Timeline View
- 参考 Obsidian Chronos 插件

### 实现步骤

#### 2.1 后端：时间索引和查询

**文件**：`backend/src/agents/memory/layers/item.py`

```python
def search_by_time_range(
    self,
    start_time: datetime,
    end_time: datetime,
    category: str | None = None,
) -> list[dict[str, Any]]:
    """按时间范围搜索记忆"""
    results = []

    for item in self.items:
        created_at = datetime.fromisoformat(item["created_at"])

        if start_time <= created_at <= end_time:
            if category is None or item.get("category") == category:
                results.append(item)

    # 按时间排序
    results.sort(key=lambda x: x["created_at"], reverse=True)

    return results
```

#### 2.2 前端：时间线组件

**文件**：`frontend/src/components/workspace/memory/timeline.tsx`

```typescript
export function MemoryTimeline() {
  const [timeRange, setTimeRange] = useState<[Date, Date]>([
    subDays(new Date(), 30),
    new Date(),
  ]);

  const { data: memories } = useQuery({
    queryKey: ["memory", "timeline", timeRange],
    queryFn: () => fetchMemoriesByTimeRange(timeRange[0], timeRange[1]),
  });

  return (
    <div className="space-y-4">
      {/* 时间范围选择器 */}
      <DateRangePicker
        value={timeRange}
        onChange={setTimeRange}
      />

      {/* 时间轴 */}
      <div className="relative">
        {memories?.map((memory) => (
          <TimelineItem
            key={memory.id}
            memory={memory}
            position={calculatePosition(memory.created_at, timeRange)}
          />
        ))}
      </div>
    </div>
  );
}
```

### 验证清单

- [ ] 时间范围查询 API 正常工作
- [ ] 时间轴正确显示记忆项
- [ ] 支持拖拽调整时间范围
- [ ] 支持缩放（天/周/月/年）
- [ ] 时间模式分析正常

### 反模式防护

❌ **不要**：
- 在前端过滤大量数据（应在后端）
- 使用字符串比较时间（应用 Date 对象）

✅ **要**：
- 使用 SQLite 时间索引
- 支持多种时间粒度
- 实现时间模式分析

---

## Phase 3: 冲突检测

### 目标

自动检测和解决矛盾信息。

### 实现步骤

#### 3.1 后端：冲突检测器

**文件**：`backend/src/agents/memory/conflict_resolver.py`

```python
class ConflictResolver:
    """记忆冲突检测和解决"""

    def __init__(self, memory_manager, llm):
        self.memory_manager = memory_manager
        self.llm = llm

    async def check_conflicts(
        self,
        new_item: dict[str, Any],
        similarity_threshold: float = 0.85,
    ) -> dict[str, Any]:
        """检查新记忆是否与现有记忆冲突"""

        # 1. 相似度检索
        similar_items = self.memory_manager.search(
            new_item["content"],
            top_k=5,
        )

        # 过滤高相似度项
        candidates = [
            item for item in similar_items["results"]
            if item["score"] >= similarity_threshold
        ]

        if not candidates:
            return {"action": "ADD", "item": new_item}

        # 2. LLM 判断
        prompt = self._build_conflict_prompt(new_item, candidates)
        response = await self.llm.ainvoke(prompt)

        # 解析 LLM 响应
        action = self._parse_action(response.content)

        return action

    def _build_conflict_prompt(
        self,
        new_item: dict[str, Any],
        candidates: list[dict[str, Any]],
    ) -> str:
        """构建冲突检测 prompt"""
        return f"""
你是一个记忆冲突检测器。请分析新记忆是否与现有记忆冲突。

新记忆：
{new_item["content"]}

现有记忆：
{json.dumps(candidates, indent=2, ensure_ascii=False)}

请返回以下操作之一：
- ADD: 新记忆与现有记忆不冲突，直接添加
- UPDATE: 新记忆是现有记忆的更新版本，替换旧记忆
- MERGE: 新记忆与现有记忆部分重叠，合并两者
- ARCHIVE: 新记忆与现有记忆矛盾，归档旧记忆

返回 JSON 格式：
{{
  "action": "ADD|UPDATE|MERGE|ARCHIVE",
  "target_id": "如果是 UPDATE/MERGE/ARCHIVE，指定目标记忆 ID",
  "reason": "操作原因"
}}
"""
```

### 验证清单

- [ ] 相似度检索正常工作
- [ ] LLM 正确判断冲突类型
- [ ] 自动归档被替代的记忆
- [ ] 保留审计轨迹

### 反模式防护

❌ **不要**：
- 直接删除冲突记忆（应归档）
- 忽略用户确认（高置信度冲突应提示）

✅ **要**：
- 保留历史版本
- 提供冲突解决建议
- 支持手动解决

---

## Phase 4-8: 其他增强功能

### Phase 4: 分享/协作
- 导出：Markdown, JSON, Graph JSON
- 导入：支持 Roam Research 格式
- 同步：Git-based 或 WebDAV

### Phase 5: 重要性评分
- FSRS 算法实现
- 自动衰减机制
- 优先级排序

### Phase 6: 标签系统
- 自动标签（LLM）
- 手动标签管理
- 标签搜索和过滤

### Phase 7: 备份/恢复
- Git 自动提交
- GitHub Actions 定时备份
- 版本恢复

### Phase 8: 加密
- AES-256-GCM 加密
- Scrypt 密钥派生
- E2EE 同步

---

## Phase 9: 验证和测试

### 集成测试

**文件**：`backend/tests/agents/memory/test_enhancements.py`

```python
def test_knowledge_graph_visualization():
    """测试知识图谱可视化"""
    manager = get_memory_manager()

    # 存储测试数据
    manager.store_item({
        "content": "用户喜欢使用 Python 开发 Web 应用",
        "category": "preference",
    })

    # 获取图数据
    graph_data = manager.get_graph_data()

    assert "nodes" in graph_data
    assert "edges" in graph_data
    assert len(graph_data["nodes"]) > 0

def test_timeline_query():
    """测试时间线查询"""
    manager = get_memory_manager()

    # 时间范围查询
    results = manager.search_by_time_range(
        start_time=datetime.now() - timedelta(days=7),
        end_time=datetime.now(),
    )

    assert isinstance(results, list)
    assert all("created_at" in item for item in results)

def test_conflict_detection():
    """测试冲突检测"""
    resolver = ConflictResolver(manager, llm)

    # 添加冲突记忆
    result = await resolver.check_conflicts({
        "content": "用户不喜欢 Python",
        "category": "preference",
    })

    assert result["action"] in ["ADD", "UPDATE", "MERGE", "ARCHIVE"]
```

### 性能测试

- 图谱渲染：5000 节点 @ 60fps
- 时间线查询：< 100ms
- 冲突检测：< 500ms
- 导出/导入：< 2s

---

## 📚 参考资源

### 可视化
- Sigma.js 文档：https://www.sigmajs.org/docs/
- React Flow 文档：https://reactflow.dev/
- Obsidian Graph View 讨论：https://forum.obsidian.md/t/understanding-the-graph-view-core/41020

### 时间线
- Notion Timeline：https://www.notion.com/help/timelines
- Obsidian Chronos：https://www.xda-developers.com/obsidian-daily-notes-timeline-plugin/

### 冲突检测
- Mem0 架构：https://arxiv.org/html/2504.19413v1
- LLM 矛盾检测：https://medium.com/@mbonsign/improving-large-language-models-handling-of-contradictions

### 分享/协作
- Obsidian Sync：https://help.obsidian.md/import/roam
- Roam JSON 格式：https://forum.obsidian.md/t/roam-json-export-obsidian-markdown

### 重要性评分
- Anki FSRS：https://faqs.ankiweb.net/what-spaced-repetition-algorithm
- SuperMemo 方法：https://www.supermemo.com/en/supermemo-method

### 标签系统
- Obsidian AI Tagger：https://www.obsidianstats.com/plugins/ai-note-tagger

### 备份/恢复
- Obsidian Git：https://github.com/denolehov/obsidian-git
- GitHub Actions 备份：https://nexus.zteo.com/posts/notion-backups-and-obsidian/

### 加密
- Obsidian E2EE：https://obsidian.md/blog/verify-obsidian-sync-encryption/
- Standard Notes E2EE：https://standardnotes.com/knowledge/2/what-is-end-to-end-encryption

---

## 🎯 实施优先级

1. **Phase 1: 知识图谱可视化**（2 周）- 最高优先级，用户最关心
2. **Phase 2: 记忆时间线**（1 周）
3. **Phase 3: 冲突检测**（1 周）
4. **Phase 4: 分享/协作**（3 天）
5. **Phase 5: 重要性评分**（3 天）
6. **Phase 6: 标签系统**（3 天）
7. **Phase 7: 备份/恢复**（2 天）
8. **Phase 8: 加密**（3 天）
9. **Phase 9: 验证和测试**（1 周）

**总计**：约 6-7 周

---

## ✅ 下一步行动

1. 阅读本计划，确认技术选择
2. 开始 Phase 1: 安装 Sigma.js 和 Graphology
3. 实现后端图数据导出 API
4. 创建前端图谱组件
5. 测试和优化性能

---

**计划结束**
