# Memory v2.0 用户指南

> 版本: 2.0
> 更新时间: 2026-03-06

---

## 📖 简介

Memory v2.0 是 Nion-Agent 的新一代记忆系统，提供：
- **混合搜索**：结合 BM25 和向量搜索，提供更准确的记忆检索
- **三层架构**：原始资源 → 结构化记忆项 → 类别组织
- **主动记忆**：双模式检索（Fast/Deep），智能选择最佳检索策略
- **自我进化**：自动优化记忆结构，合并相似项，清理陈旧记忆

---

## 🚀 快速开始

### 1. 配置向量模型

Memory v2.0 需要向量嵌入模型来支持语义搜索。

#### 方式 1: 使用本地模型（推荐）

1. 安装依赖：
```bash
pip install sentence-transformers
```

2. 在设置页面配置：
   - 打开 **设置 → 向量模型**
   - 选择 **本地模型 (sentence-transformers)**
   - 选择模型：`all-MiniLM-L6-v2`（默认，约 80MB）
   - 选择设备：`cpu`（或 `cuda`/`mps` 如果有 GPU）
   - 点击 **测试** 验证配置
   - 点击 **保存配置**

3. 重启应用使配置生效

#### 方式 2: 使用 OpenAI API

1. 在设置页面配置：
   - 打开 **设置 → 向量模型**
   - 选择 **OpenAI API**
   - 选择模型：`text-embedding-3-small`
   - 输入 API Key：`sk-...` 或 `$OPENAI_API_KEY`
   - 点击 **测试** 验证配置
   - 点击 **保存配置**

2. 重启应用使配置生效

### 2. 使用记忆系统

记忆系统会自动学习你的对话内容：

- ✅ **自动提取**：从对话中提取事实和知识
- ✅ **自动分类**：将记忆分类到不同类别（偏好、知识、上下文等）
- ✅ **自动关联**：建立记忆之间的关联

**无需手动操作**，只需正常对话即可。

### 3. 搜索记忆

使用自然语言搜索记忆：

```python
from src.agents.memory import get_memory_manager

manager = get_memory_manager()
results = manager.search("我喜欢什么编程语言？", top_k=5)

print(f"检索模式: {results['mode']}")  # fast 或 deep
for item in results['results']:
    print(f"- {item['content']}")
```

---

## 🎯 核心功能

### 混合搜索

Memory v2.0 结合了两种搜索算法：

1. **BM25 搜索**：基于关键词匹配，快速准确
2. **向量搜索**：基于语义相似度，理解含义

两种搜索结果会自动融合，提供最佳检索效果。

**配置权重**（在 `config.yaml` 中）：
```yaml
memory:
  vector_weight: 0.5  # 向量搜索权重
  bm25_weight: 0.5    # BM25 搜索权重
```

### Dual-Mode 检索

系统会自动选择最佳检索模式：

- **Fast Mode**：快速简单搜索，适合明确的查询
  - 直接使用混合搜索
  - 响应速度快（< 100ms）
  - 适合：事实查询、简单问题

- **Deep Mode**：LLM 参与推理，适合复杂查询
  - LLM 参与结果重排序
  - 响应速度较慢（1-2s）
  - 适合：复杂推理、关系查询、"为什么"类问题

**触发条件**：
- 查询包含：`why`, `how`, `explain`, `reason`, `relationship`, `compare`, `analyze`
- 或者 Fast Mode 结果置信度低

**手动指定模式**：
```python
# 强制使用 Fast Mode
results = manager.search("Python", force_mode="fast")

# 强制使用 Deep Mode
results = manager.search("为什么我喜欢 Python？", force_mode="deep")
```

### 自我进化

系统会自动优化记忆：

1. **合并相似记忆**：减少冗余
2. **清理陈旧记忆**：删除过时信息
3. **优化类别结构**：重新组织记忆

**手动触发进化**：
```python
report = manager.evolve()
print(f"执行的操作: {report['actions']}")
print(f"性能指标: {report['metrics']}")
```

**自动进化**：系统会在以下情况自动触发进化：
- 记忆项数量超过阈值（默认 1000）
- 冗余率过高（默认 > 30%）
- 定期维护（每周一次）

---

## ⚙️ 配置选项

在 `config.yaml` 中配置记忆系统：

```yaml
memory:
  enabled: true                      # 启用记忆系统
  storage_path: memory.json          # 存储路径
  debounce_seconds: 30               # 更新延迟（秒）
  model_name: null                   # LLM 模型（null = 使用默认）
  max_facts: 100                     # 最大事实数量
  fact_confidence_threshold: 0.7     # 事实置信度阈值
  injection_enabled: true            # 启用记忆注入
  max_injection_tokens: 2000         # 最大注入 token 数

embedding:
  enabled: true                      # 启用向量嵌入
  provider: local                    # local | openai | custom

  local:
    model: all-MiniLM-L6-v2         # 本地模型
    device: cpu                      # cpu | cuda | mps

  openai:
    model: text-embedding-3-small   # OpenAI 模型
    api_key: $OPENAI_API_KEY        # API Key
    dimension: 1536                  # 向量维度

  custom:
    model: ""                        # 自定义模型
    api_base: ""                     # API 端点
    api_key: ""                      # API Key
    dimension: 1536                  # 向量维度
```

---

## 📊 记忆类别

Memory v2.0 将记忆分为以下类别：

| 类别 | 说明 | 示例 |
|------|------|------|
| **preference** | 用户偏好 | "用户喜欢 Python" |
| **knowledge** | 知识事实 | "Python 是一种编程语言" |
| **context** | 上下文信息 | "用户正在开发 Web 应用" |
| **behavior** | 行为模式 | "用户通常在早上编程" |
| **goal** | 目标计划 | "用户计划学习 React" |
| **project** | 项目信息 | "用户正在开发 Nion-Agent" |

---

## 🔍 高级用法

### 查看记忆数据

```python
data = manager.get_memory_data()

print(f"记忆版本: {data['version']}")
print(f"记忆项数量: {len(data['items'])}")
print(f"类别数量: {len(data['categories'])}")
```

### 存储自定义记忆

```python
# 存储原始对话
manager.store_conversation({
    "id": "conv_001",
    "type": "conversation",
    "content": "User: Hello\nAI: Hi!",
    "metadata": {"thread_id": "thread_123"},
})

# 存储结构化记忆项
manager.store_item({
    "content": "用户喜欢 Python 编程",
    "category": "preference",
    "confidence": 0.9,
})
```

### 重载记忆管理器

配置更改后，重载管理器以应用新配置：

```python
from src.agents.memory import reload_memory_manager

manager = reload_memory_manager()
```

---

## 💡 最佳实践

### 1. 选择合适的向量模型

- **本地模型**：
  - ✅ 优点：离线可用，无 API 费用，隐私保护
  - ❌ 缺点：首次下载较慢，占用磁盘空间
  - 推荐：个人使用、隐私敏感场景

- **OpenAI API**：
  - ✅ 优点：质量高，无需下载，支持多语言
  - ❌ 缺点：需要 API 费用，需要网络连接
  - 推荐：团队使用、高质量要求场景

### 2. 优化搜索性能

- 使用具体的查询词，避免过于宽泛
- 对于简单查询，使用 Fast Mode
- 对于复杂推理，使用 Deep Mode
- 定期运行 `evolve()` 清理冗余记忆

### 3. 管理记忆数量

- 设置合理的 `max_facts` 限制（默认 100）
- 定期检查记忆数量：`len(manager.get_memory_data()['items'])`
- 使用 `evolve()` 自动清理陈旧记忆

### 4. 监控系统性能

```python
# 测试搜索性能
import time

start = time.time()
results = manager.search("Python", top_k=10)
print(f"搜索耗时: {time.time() - start:.2f}s")

# 查看进化报告
report = manager.evolve()
print(f"记忆效率: {report['metrics']['memory_efficiency']}")
print(f"检索准确率: {report['metrics']['retrieval_accuracy']}")
```

---

## 🐛 常见问题

### Q: 向量模型加载失败

**症状**：启动时报错 "Failed to load embedding model"

**解决方案**：
1. 检查是否安装了 `sentence-transformers`：
   ```bash
   pip install sentence-transformers
   ```
2. 检查模型名称是否正确
3. 检查网络连接（首次使用会下载模型）
4. 查看日志文件获取详细错误信息

### Q: 搜索结果不准确

**症状**：搜索返回不相关的结果

**解决方案**：
1. 检查向量模型是否正确加载
2. 调整混合搜索权重（`vector_weight` 和 `bm25_weight`）
3. 增加记忆项数量（系统需要足够的数据才能准确检索）
4. 使用更具体的查询词

### Q: 内存占用过高

**症状**：系统内存占用持续增长

**解决方案**：
1. 运行 `evolve()` 清理陈旧记忆
2. 调整 `max_items_before_compress` 配置
3. 定期运行自我进化
4. 检查是否有内存泄漏（查看日志）

### Q: 配置更改不生效

**症状**：修改 `config.yaml` 后配置未生效

**解决方案**：
1. 重启应用
2. 或者使用 `reload_memory_manager()` 重载配置
3. 检查配置文件路径是否正确
4. 检查配置文件格式是否正确（YAML 语法）

---

## 📚 相关文档

- [API 参考文档](./MEMORY_V2_API_REFERENCE.md) - 详细的 API 说明
- [故障排查指南](./MEMORY_V2_TROUBLESHOOTING.md) - 常见问题解决方案
- [实施状态报告](./MEMORY_V2_FINAL_STATUS_REPORT.md) - 系统实施状态
- [补全计划](./MEMORY_V2_COMPLETION_PLAN.md) - 功能补全计划

---

## 🤝 获取帮助

如果遇到问题：
1. 查看 [故障排查指南](./MEMORY_V2_TROUBLESHOOTING.md)
2. 查看日志文件：`backend/logs/`
3. 提交 Issue：[GitHub Issues](https://github.com/your-repo/issues)

---

**文档结束**
