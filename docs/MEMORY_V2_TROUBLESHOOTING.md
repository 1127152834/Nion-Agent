# Memory v2.0 故障排查指南

> 版本: 2.0
> 更新时间: 2026-03-06

---

## 📋 概述

本文档提供 Memory v2.0 系统常见问题的诊断和解决方案。

---

## 🔧 常见问题

### 1. 向量模型加载失败

**症状**：
- 启动时报错：`Failed to load embedding model`
- 或：`ModuleNotFoundError: No module named 'sentence_transformers'`

**原因**：
- 缺少 sentence-transformers 依赖
- 模型名称错误
- 网络连接问题（首次下载模型）
- 磁盘空间不足

**解决方案**：

1. **安装依赖**：
```bash
pip install sentence-transformers
```

2. **检查模型名称**：
确保 `config.yaml` 中的模型名称正确：
```yaml
embedding:
  local:
    model: all-MiniLM-L6-v2  # 正确
    # model: all-minilm-l6-v2  # 错误（大小写）
```

3. **检查网络连接**：
首次使用会从 HuggingFace 下载模型（约 80MB），确保网络畅通。

4. **检查磁盘空间**：
模型缓存在 `~/.cache/torch/sentence_transformers/`，确保有足够空间。

5. **手动下载模型**：
```python
from sentence_transformers import SentenceTransformer
model = SentenceTransformer('all-MiniLM-L6-v2')
```

---

### 2. OpenAI API 错误

**症状**：
- `OpenAI API key not configured`
- `AuthenticationError: Incorrect API key`
- `RateLimitError: Rate limit exceeded`

**解决方案**：

1. **检查 API Key**：
```yaml
embedding:
  openai:
    api_key: $OPENAI_API_KEY  # 环境变量
    # 或
    api_key: sk-...            # 直接填写
```

2. **验证环境变量**：
```bash
echo $OPENAI_API_KEY
```

3. **检查 API Key 有效性**：
```bash
curl https://api.openai.com/v1/models \
  -H "Authorization: Bearer $OPENAI_API_KEY"
```

4. **处理速率限制**：
- 降低请求频率
- 升级 OpenAI 账户等级
- 使用本地模型替代

---

### 3. 搜索结果不准确

**症状**：
- 搜索返回不相关的结果
- 搜索结果为空
- 搜索结果顺序不合理

**原因**：
- 记忆数据不足
- 向量模型未正确加载
- 搜索权重配置不当
- 查询词过于宽泛

**解决方案**：

1. **检查记忆数据量**：
```python
from src.agents.memory import get_memory_manager

manager = get_memory_manager()
data = manager.get_memory_data()
print(f"记忆项数量: {len(data['items'])}")
```

建议至少有 20+ 条记忆项才能获得较好的搜索效果。

2. **检查向量模型状态**：
```python
# 测试向量生成
from src.agents.memory.search.embeddings import SentenceTransformerEmbedding

provider = SentenceTransformerEmbedding()
embedding = provider.embed("test")
print(f"向量维度: {len(embedding)}")  # 应该是 384
```

3. **调整搜索权重**：
```yaml
memory:
  vector_weight: 0.6  # 增加语义搜索权重
  bm25_weight: 0.4    # 降低关键词搜索权重
```

4. **使用更具体的查询**：
```python
# 不好：查询过于宽泛
results = manager.search("编程")

# 好：查询更具体
results = manager.search("我喜欢什么编程语言")
```

5. **强制使用 Deep Mode**：
```python
results = manager.search("为什么我喜欢 Python？", force_mode="deep")
```

---

### 4. 内存占用过高

**症状**：
- 系统内存占用持续增长
- 应用响应变慢
- 出现 `MemoryError`

**原因**：
- 记忆项过多
- 向量数据库过大
- 未正确关闭管理器
- 内存泄漏

**解决方案**：

1. **检查记忆项数量**：
```python
data = manager.get_memory_data()
print(f"记忆项数量: {len(data['items'])}")
print(f"资源数量: {len(data['resources'])}")
```

2. **运行进化清理**：
```python
report = manager.evolve()
print(f"清理的记忆项: {len([a for a in report['actions'] if a['type'] == 'merge'])}")
```

3. **手动清理陈旧记忆**：
```python
# 删除 90 天前的资源
from datetime import datetime, timedelta

cutoff = datetime.utcnow() - timedelta(days=90)
# 实现清理逻辑...
```

4. **正确关闭管理器**：
```python
manager = get_memory_manager()
try:
    # 使用 manager
    pass
finally:
    manager.close()  # 确保关闭
```

5. **调整配置**：
```yaml
memory:
  max_facts: 50                    # 降低最大事实数
  max_items_before_compress: 500  # 降低压缩阈值
```

---

### 5. 配置更改不生效

**症状**：
- 修改 `config.yaml` 后配置未生效
- 向量模型设置未更新
- 搜索权重未改变

**原因**：
- 未重启应用
- 配置文件路径错误
- 配置文件格式错误
- 缓存未清除

**解决方案**：

1. **重启应用**：
```bash
# 停止应用
make stop

# 启动应用
make dev
```

2. **或重载配置**：
```python
from src.agents.memory import reload_memory_manager

manager = reload_memory_manager()
```

3. **检查配置文件路径**：
```bash
# 配置文件应该在项目根目录
ls -la config.yaml

# 或检查环境变量
echo $NION_CONFIG_PATH
```

4. **验证 YAML 格式**：
```bash
# 使用 Python 验证
python -c "import yaml; yaml.safe_load(open('config.yaml'))"
```

5. **清除缓存**：
```bash
rm -rf backend/.nion/memory_v2/
```

---

### 6. 数据库锁定错误

**症状**：
- `database is locked`
- `OperationalError: database is locked`

**原因**：
- 多个进程同时访问数据库
- 数据库文件损坏
- 未正确关闭连接

**解决方案**：

1. **检查运行的进程**：
```bash
ps aux | grep python
```

2. **停止所有相关进程**：
```bash
pkill -f "python.*nion"
```

3. **检查数据库文件**：
```bash
ls -la backend/.nion/memory_v2/vectors.db
```

4. **重建数据库**（谨慎）：
```bash
# 备份
cp backend/.nion/memory_v2/vectors.db backend/.nion/memory_v2/vectors.db.bak

# 删除
rm backend/.nion/memory_v2/vectors.db

# 重启应用会自动重建
```

---

### 7. 搜索性能慢

**症状**：
- 搜索耗时超过 1 秒
- 应用响应缓慢
- CPU 占用高

**原因**：
- 记忆项过多
- 向量维度过高
- BM25 索引未优化
- 使用 Deep Mode

**解决方案**：

1. **测量搜索性能**：
```python
import time

start = time.time()
results = manager.search("Python", top_k=10)
print(f"搜索耗时: {time.time() - start:.2f}s")
```

2. **使用 Fast Mode**：
```python
results = manager.search("Python", force_mode="fast")
```

3. **减少返回结果数**：
```python
results = manager.search("Python", top_k=5)  # 而不是 top_k=20
```

4. **运行进化优化**：
```python
report = manager.evolve()
```

5. **使用更小的向量模型**：
```yaml
embedding:
  local:
    model: all-MiniLM-L6-v2  # 384 维，快
    # model: all-mpnet-base-v2  # 768 维，慢
```

---

### 8. 测试失败

**症状**：
- `pytest` 运行失败
- 测试超时
- 导入错误

**解决方案**：

1. **安装测试依赖**：
```bash
pip install pytest
```

2. **运行特定测试**：
```bash
# 运行单个测试文件
pytest tests/agents/memory/test_bm25.py -v

# 运行特定测试
pytest tests/agents/memory/test_bm25.py::test_bm25_search -v
```

3. **跳过慢速测试**：
```bash
pytest tests/agents/memory/ -m "not slow"
```

4. **查看详细错误**：
```bash
pytest tests/agents/memory/ -v --tb=long
```

5. **清理测试缓存**：
```bash
rm -rf .pytest_cache
pytest --cache-clear
```

---

## 🔍 诊断工具

### 1. 检查系统状态

```python
from src.agents.memory import get_memory_manager

manager = get_memory_manager()

# 获取记忆数据
data = manager.get_memory_data()

print("=== 系统状态 ===")
print(f"记忆版本: {data['version']}")
print(f"记忆项数量: {len(data['items'])}")
print(f"类别数量: {len(data['categories'])}")
print(f"资源数量: {len(data['resources'])}")

# 检查配置
print("\n=== 配置信息 ===")
print(f"配置: {manager.config}")
```

### 2. 测试向量生成

```python
from src.agents.memory.search.embeddings import SentenceTransformerEmbedding

try:
    provider = SentenceTransformerEmbedding()
    embedding = provider.embed("测试文本")
    print(f"✅ 向量生成成功，维度: {len(embedding)}")
except Exception as e:
    print(f"❌ 向量生成失败: {e}")
```

### 3. 测试搜索功能

```python
import time

manager = get_memory_manager()

# 添加测试数据
manager.store_item({
    "content": "测试记忆项",
    "category": "knowledge",
    "confidence": 0.9,
})

# 测试搜索
start = time.time()
results = manager.search("测试", top_k=5)
elapsed = time.time() - start

print(f"搜索模式: {results['mode']}")
print(f"结果数量: {len(results['results'])}")
print(f"搜索耗时: {elapsed:.2f}s")
```

### 4. 检查数据库

```bash
# 检查向量数据库大小
du -h backend/.nion/memory_v2/vectors.db

# 检查记忆文件大小
du -h backend/.nion/memory_v2/items.json

# 检查总大小
du -sh backend/.nion/memory_v2/
```

---

## 📊 性能基准

### 正常性能指标

| 操作 | 预期耗时 | 说明 |
|------|----------|------|
| 向量生成（单个） | < 100ms | 使用本地模型 |
| 搜索（Fast Mode） | < 200ms | 1000 条记忆 |
| 搜索（Deep Mode） | 1-2s | 包含 LLM 推理 |
| 存储记忆项 | < 50ms | 单个项 |
| 进化循环 | 5-10s | 1000 条记忆 |

### 性能测试

```python
import time

def benchmark_search(manager, query, iterations=10):
    times = []
    for _ in range(iterations):
        start = time.time()
        manager.search(query, top_k=5)
        times.append(time.time() - start)

    avg_time = sum(times) / len(times)
    print(f"平均搜索耗时: {avg_time:.3f}s")
    print(f"最快: {min(times):.3f}s")
    print(f"最慢: {max(times):.3f}s")

manager = get_memory_manager()
benchmark_search(manager, "Python")
```

---

## 🐛 调试技巧

### 1. 启用详细日志

```python
import logging

logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

# 现在所有操作都会输出详细日志
manager = get_memory_manager()
results = manager.search("Python")
```

### 2. 检查向量相似度

```python
from src.agents.memory.search.embeddings import SentenceTransformerEmbedding
import numpy as np

provider = SentenceTransformerEmbedding()

# 生成向量
vec1 = provider.embed("Python programming")
vec2 = provider.embed("JavaScript coding")
vec3 = provider.embed("Python development")

# 计算相似度
def cosine_similarity(v1, v2):
    return np.dot(v1, v2) / (np.linalg.norm(v1) * np.linalg.norm(v2))

print(f"Python vs JavaScript: {cosine_similarity(vec1, vec2):.3f}")
print(f"Python vs Python dev: {cosine_similarity(vec1, vec3):.3f}")
```

### 3. 分析搜索结果

```python
results = manager.search("Python", top_k=10)

print(f"检索模式: {results['mode']}")
print(f"结果数量: {len(results['results'])}")

for i, item in enumerate(results['results'], 1):
    print(f"\n{i}. {item.get('content', '')[:50]}...")
    print(f"   分数: {item.get('fused_score', 0):.3f}")
    print(f"   类别: {item.get('category', 'unknown')}")
    print(f"   访问次数: {item.get('access_count', 0)}")
```

---

## 🔗 相关资源

### 日志文件

- 应用日志：`backend/logs/app.log`
- 错误日志：`backend/logs/error.log`
- 内存日志：`backend/logs/memory.log`

### 数据文件

- 向量数据库：`backend/.nion/memory_v2/vectors.db`
- 记忆项：`backend/.nion/memory_v2/items.json`
- 类别文件：`backend/.nion/memory_v2/categories/*.md`
- 原始资源：`backend/.nion/memory_v2/resources/YYYY-MM/*.json`

### 配置文件

- 主配置：`config.yaml`
- 内存配置：`config.yaml` 中的 `memory` 和 `embedding` 节

---

## 📚 相关文档

- [用户使用指南](./MEMORY_V2_USER_GUIDE.md) - 快速开始和使用说明
- [API 参考文档](./MEMORY_V2_API_REFERENCE.md) - 详细的 API 说明
- [实施状态报告](./MEMORY_V2_FINAL_STATUS_REPORT.md) - 系统实施状态
- [补全计划](./MEMORY_V2_COMPLETION_PLAN.md) - 功能补全计划

---

## 🤝 获取帮助

如果以上方法都无法解决问题：

1. **查看日志文件**：`backend/logs/`
2. **搜索已知问题**：[GitHub Issues](https://github.com/your-repo/issues)
3. **提交新问题**：提供详细的错误信息和复现步骤
4. **社区讨论**：[GitHub Discussions](https://github.com/your-repo/discussions)

---

**文档结束**
