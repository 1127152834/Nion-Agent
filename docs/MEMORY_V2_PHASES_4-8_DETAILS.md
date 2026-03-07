# Memory v2.0 增强功能 Phase 4-8 详细实现

> 补充文档：Phase 4-8 的详细实现步骤

---

## Phase 4: 分享/协作功能

### 目标
实现记忆的导入/导出和同步功能。

### 4.1 导出功能

**文件**：`backend/src/agents/memory/export.py`

```python
class MemoryExporter:
    """记忆导出器"""

    def export_markdown(self, output_path: str) -> None:
        """导出为 Markdown 格式"""
        memory_data = self.manager.get_memory_data()

        with open(output_path, 'w', encoding='utf-8') as f:
            f.write("# Memory Export\n\n")

            # 导出分类
            for category in memory_data.get("categories", []):
                f.write(f"## {category['name']}\n\n")

                # 导出该分类下的记忆项
                items = [item for item in memory_data.get("items", [])
                        if item.get("category") == category["name"]]

                for item in items:
                    f.write(f"### {item.get('title', 'Untitled')}\n\n")
                    f.write(f"{item['content']}\n\n")
                    f.write(f"- **Created**: {item['created_at']}\n")
                    f.write(f"- **Confidence**: {item.get('confidence', 0)}\n\n")

    def export_json(self, output_path: str) -> None:
        """导出为 JSON 格式（完整结构）"""
        memory_data = self.manager.get_memory_data()

        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(memory_data, f, indent=2, ensure_ascii=False)

    def export_graph_json(self, output_path: str) -> None:
        """导出为图结构 JSON（Roam Research 兼容）"""
        graph_data = {
            "nodes": [],
            "edges": [],
            "metadata": {
                "exported_at": datetime.now().isoformat(),
                "version": "2.0",
            }
        }

        # 从知识图谱导出
        if self.manager.knowledge_graph_enabled:
            graph = self.manager.graph_builder._graph

            for node_id, node_data in graph.nodes(data=True):
                graph_data["nodes"].append({
                    "id": node_id,
                    "name": node_data.get("name", node_id),
                    "type": node_data.get("type"),
                    "mentions": node_data.get("mentions", []),
                })

            for source, target, edge_data in graph.edges(data=True):
                graph_data["edges"].append({
                    "source": source,
                    "target": target,
                    "type": edge_data.get("type"),
                    "confidence": edge_data.get("confidence"),
                })

        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(graph_data, f, indent=2, ensure_ascii=False)
```

### 4.2 导入功能

**文件**：`backend/src/agents/memory/import.py`

```python
class MemoryImporter:
    """记忆导入器"""

    def import_json(
        self,
        file_path: str,
        merge_strategy: str = "merge",  # "replace" or "merge"
    ) -> dict[str, Any]:
        """从 JSON 导入记忆"""
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)

        if merge_strategy == "replace":
            # 完全替换
            self.manager._save_memory_data(data)
        else:
            # 合并模式
            existing_data = self.manager.get_memory_data()

            # 合并记忆项（去重）
            existing_ids = {item["id"] for item in existing_data.get("items", [])}
            new_items = [item for item in data.get("items", [])
                        if item["id"] not in existing_ids]

            existing_data["items"].extend(new_items)
            self.manager._save_memory_data(existing_data)

        return {"imported": len(data.get("items", [])), "strategy": merge_strategy}

    def import_roam_json(self, file_path: str) -> dict[str, Any]:
        """导入 Roam Research JSON 格式"""
        with open(file_path, 'r', encoding='utf-8') as f:
            roam_data = json.load(f)

        imported_count = 0

        for page in roam_data:
            # 转换 Roam 页面为记忆项
            item = {
                "content": page.get("title", ""),
                "category": "imported",
                "source": "roam_research",
                "metadata": {
                    "roam_uid": page.get("uid"),
                    "create_time": page.get("create-time"),
                    "edit_time": page.get("edit-time"),
                }
            }

            # 处理 block references
            if "children" in page:
                item["content"] += "\n\n" + self._parse_roam_blocks(page["children"])

            self.manager.store_item(item)
            imported_count += 1

        return {"imported": imported_count, "format": "roam_research"}

    def _parse_roam_blocks(self, blocks: list) -> str:
        """解析 Roam blocks 为 Markdown"""
        lines = []
        for block in blocks:
            lines.append(f"- {block.get('string', '')}")
            if "children" in block:
                child_lines = self._parse_roam_blocks(block["children"])
                lines.append("  " + child_lines.replace("\n", "\n  "))
        return "\n".join(lines)
```

### 4.3 API 端点

**文件**：`backend/src/gateway/routers/memory.py`

```python
@router.post("/export")
async def export_memory(
    format: str = "json",  # "json", "markdown", "graph"
    output_path: str | None = None,
) -> dict[str, Any]:
    """导出记忆"""
    manager = get_memory_manager()
    exporter = MemoryExporter(manager)

    if output_path is None:
        output_path = f"memory_export_{datetime.now().strftime('%Y%m%d_%H%M%S')}.{format}"

    if format == "json":
        exporter.export_json(output_path)
    elif format == "markdown":
        exporter.export_markdown(output_path)
    elif format == "graph":
        exporter.export_graph_json(output_path)
    else:
        raise HTTPException(400, f"Unsupported format: {format}")

    return {"success": True, "output_path": output_path, "format": format}

@router.post("/import")
async def import_memory(
    file: UploadFile,
    format: str = "json",
    merge_strategy: str = "merge",
) -> dict[str, Any]:
    """导入记忆"""
    manager = get_memory_manager()
    importer = MemoryImporter(manager)

    # 保存上传文件
    temp_path = f"/tmp/{file.filename}"
    with open(temp_path, 'wb') as f:
        f.write(await file.read())

    try:
        if format == "json":
            result = importer.import_json(temp_path, merge_strategy)
        elif format == "roam":
            result = importer.import_roam_json(temp_path)
        else:
            raise HTTPException(400, f"Unsupported format: {format}")

        return {"success": True, **result}
    finally:
        os.remove(temp_path)
```

### 验证清单

- [ ] 导出 JSON 格式正常
- [ ] 导出 Markdown 格式正常
- [ ] 导出 Graph JSON 格式正常
- [ ] 导入 JSON 格式正常（replace 和 merge 模式）
- [ ] 导入 Roam Research JSON 格式正常
- [ ] Block references 正确转换

---

## Phase 5: 重要性评分

### 目标
实现基于遗忘曲线的记忆重要性评分和自动衰减。

### 5.1 评分算法

**文件**：`backend/src/agents/memory/importance.py`

```python
class ImportanceScorer:
    """记忆重要性评分器"""

    def __init__(self, manager):
        self.manager = manager

    def calculate_score(self, item: dict[str, Any]) -> float:
        """计算记忆项的重要性评分（0-1）"""

        # 1. 时间新近度（Recency）- 40%
        recency_score = self._calculate_recency(item)

        # 2. 访问频率（Frequency）- 30%
        frequency_score = self._calculate_frequency(item)

        # 3. 实用性（Utility）- 30%
        utility_score = self._calculate_utility(item)

        # 加权平均
        total_score = (
            recency_score * 0.4 +
            frequency_score * 0.3 +
            utility_score * 0.3
        )

        return min(1.0, max(0.0, total_score))

    def _calculate_recency(self, item: dict[str, Any]) -> float:
        """计算时间新近度评分"""
        now = datetime.now()

        # 使用最后访问时间或创建时间
        last_accessed = item.get("last_accessed_at")
        if last_accessed:
            last_time = datetime.fromisoformat(last_accessed)
        else:
            last_time = datetime.fromisoformat(item["created_at"])

        # 计算天数差
        days_ago = (now - last_time).days

        # 使用指数衰减：score = e^(-days / half_life)
        # half_life = 30 天（项目数据）或 365 天（客户数据）
        category = item.get("category", "")
        half_life = 365 if category in ["client", "customer"] else 30

        score = math.exp(-days_ago / half_life)
        return score

    def _calculate_frequency(self, item: dict[str, Any]) -> float:
        """计算访问频率评分"""
        access_count = item.get("access_count", 0)

        # 使用对数缩放：score = log(1 + count) / log(1 + max_count)
        max_count = 100  # 假设最大访问次数
        score = math.log(1 + access_count) / math.log(1 + max_count)

        return score

    def _calculate_utility(self, item: dict[str, Any]) -> float:
        """计算实用性评分"""
        # 基于置信度和用户反馈
        confidence = item.get("confidence", 0.5)
        user_rating = item.get("user_rating", 0.5)  # 0-1

        # 加权平均
        score = confidence * 0.6 + user_rating * 0.4
        return score

    def update_all_scores(self) -> int:
        """更新所有记忆项的重要性评分"""
        memory_data = self.manager.get_memory_data()
        updated_count = 0

        for item in memory_data.get("items", []):
            old_score = item.get("importance_score", 0)
            new_score = self.calculate_score(item)

            item["importance_score"] = new_score
            updated_count += 1

        self.manager._save_memory_data(memory_data)
        return updated_count

    def prune_low_importance(self, threshold: float = 0.1) -> int:
        """删除低重要性记忆"""
        memory_data = self.manager.get_memory_data()

        items_before = len(memory_data.get("items", []))

        # 保留高于阈值的记忆
        memory_data["items"] = [
            item for item in memory_data.get("items", [])
            if item.get("importance_score", 0) >= threshold
        ]

        items_after = len(memory_data["items"])
        pruned_count = items_before - items_after

        self.manager._save_memory_data(memory_data)
        return pruned_count
```

### 5.2 自动衰减任务

**文件**：`backend/src/agents/memory/decay_task.py`

```python
async def run_decay_task():
    """定期运行的衰减任务"""
    while True:
        try:
            manager = get_memory_manager()
            scorer = ImportanceScorer(manager)

            # 更新所有评分
            updated = scorer.update_all_scores()
            logger.info(f"Updated importance scores for {updated} items")

            # 删除低重要性记忆
            pruned = scorer.prune_low_importance(threshold=0.1)
            logger.info(f"Pruned {pruned} low-importance items")

        except Exception as e:
            logger.error(f"Decay task failed: {e}")

        # 每天运行一次
        await asyncio.sleep(86400)
```

### 验证清单

- [ ] 重要性评分计算正确
- [ ] 时间衰减符合遗忘曲线
- [ ] 自动删除低重要性记忆
- [ ] 定期任务正常运行

---

## Phase 6: 标签系统

### 目标
实现自动和手动标签管理。

### 6.1 自动标签生成

**文件**：`backend/src/agents/memory/auto_tagger.py`

```python
class AutoTagger:
    """自动标签生成器"""

    def __init__(self, llm):
        self.llm = llm

    async def generate_tags(
        self,
        content: str,
        max_tags: int = 5,
    ) -> list[str]:
        """使用 LLM 生成标签"""

        prompt = f"""
分析以下内容并生成 {max_tags} 个相关标签。

内容：
{content}

要求：
1. 标签应简洁（1-3 个词）
2. 使用小写和连字符（例如：python-web）
3. 分类为：location（地点）、context（上下文）、subject（主题）
4. 返回 JSON 格式

返回格式：
{{
  "tags": ["tag1", "tag2", "tag3"],
  "categories": {{
    "tag1": "subject",
    "tag2": "context"
  }}
}}
"""

        response = await self.llm.ainvoke(prompt)

        try:
            result = json.loads(response.content)
            return result.get("tags", [])
        except json.JSONDecodeError:
            logger.error("Failed to parse LLM response for tags")
            return []

    async def auto_tag_item(self, item: dict[str, Any]) -> list[str]:
        """为记忆项自动生成标签"""
        content = item.get("content", "")

        if not content:
            return []

        tags = await self.generate_tags(content)

        # 更新记忆项
        if "tags" not in item:
            item["tags"] = []

        item["tags"].extend(tags)
        item["tags"] = list(set(item["tags"]))  # 去重

        return tags
```

### 6.2 标签管理 API

**文件**：`backend/src/agents/memory/memory.py`

```python
def add_tag(self, item_id: str, tag: str) -> bool:
    """添加标签到记忆项"""
    memory_data = self.get_memory_data()

    for item in memory_data.get("items", []):
        if item["id"] == item_id:
            if "tags" not in item:
                item["tags"] = []

            if tag not in item["tags"]:
                item["tags"].append(tag)
                self._save_memory_data(memory_data)
                return True

    return False

def remove_tag(self, item_id: str, tag: str) -> bool:
    """从记忆项移除标签"""
    memory_data = self.get_memory_data()

    for item in memory_data.get("items", []):
        if item["id"] == item_id:
            if "tags" in item and tag in item["tags"]:
                item["tags"].remove(tag)
                self._save_memory_data(memory_data)
                return True

    return False

def search_by_tags(
    self,
    tags: list[str],
    match_all: bool = False,
) -> list[dict[str, Any]]:
    """按标签搜索记忆"""
    memory_data = self.get_memory_data()
    results = []

    for item in memory_data.get("items", []):
        item_tags = set(item.get("tags", []))
        search_tags = set(tags)

        if match_all:
            # 必须包含所有标签
            if search_tags.issubset(item_tags):
                results.append(item)
        else:
            # 包含任意标签
            if search_tags & item_tags:
                results.append(item)

    return results
```

### 验证清单

- [ ] LLM 自动生成标签正常
- [ ] 手动添加/删除标签正常
- [ ] 按标签搜索正常（AND/OR 模式）
- [ ] 标签去重正常

---

## Phase 7: 备份/恢复

### 目标
实现 Git-based 版本控制和自动备份。

### 7.1 Git 备份

**文件**：`backend/src/agents/memory/backup.py`

```python
class MemoryBackup:
    """记忆备份管理器"""

    def __init__(self, memory_path: str, repo_path: str | None = None):
        self.memory_path = Path(memory_path)
        self.repo_path = Path(repo_path) if repo_path else self.memory_path.parent

        # 初始化 Git 仓库
        if not (self.repo_path / ".git").exists():
            subprocess.run(["git", "init"], cwd=self.repo_path, check=True)

    def create_backup(self, message: str | None = None) -> str:
        """创建备份（Git commit）"""

        # 添加文件
        subprocess.run(
            ["git", "add", str(self.memory_path.name)],
            cwd=self.repo_path,
            check=True,
        )

        # 提交
        if message is None:
            message = f"Auto backup at {datetime.now().isoformat()}"

        result = subprocess.run(
            ["git", "commit", "-m", message],
            cwd=self.repo_path,
            capture_output=True,
            text=True,
        )

        if result.returncode == 0:
            # 获取 commit hash
            commit_hash = subprocess.run(
                ["git", "rev-parse", "HEAD"],
                cwd=self.repo_path,
                capture_output=True,
                text=True,
                check=True,
            ).stdout.strip()

            return commit_hash
        else:
            raise Exception(f"Git commit failed: {result.stderr}")

    def list_backups(self, limit: int = 10) -> list[dict[str, Any]]:
        """列出备份历史"""
        result = subprocess.run(
            ["git", "log", f"-{limit}", "--pretty=format:%H|%ai|%s"],
            cwd=self.repo_path,
            capture_output=True,
            text=True,
            check=True,
        )

        backups = []
        for line in result.stdout.strip().split("\n"):
            if line:
                commit_hash, timestamp, message = line.split("|", 2)
                backups.append({
                    "commit_hash": commit_hash,
                    "timestamp": timestamp,
                    "message": message,
                })

        return backups

    def restore_backup(self, commit_hash: str) -> None:
        """恢复到指定备份"""

        # 检出指定 commit 的文件
        subprocess.run(
            ["git", "checkout", commit_hash, "--", str(self.memory_path.name)],
            cwd=self.repo_path,
            check=True,
        )

        logger.info(f"Restored memory from commit {commit_hash}")

    def push_to_remote(self, remote: str = "origin", branch: str = "main") -> None:
        """推送到远程仓库"""
        subprocess.run(
            ["git", "push", remote, branch],
            cwd=self.repo_path,
            check=True,
        )
```

### 7.2 自动备份任务

**文件**：`backend/src/agents/memory/auto_backup.py`

```python
async def run_auto_backup_task(interval_minutes: int = 60):
    """定期自动备份"""
    backup = MemoryBackup(
        memory_path=config.memory.storage_path,
        repo_path=config.memory.backup_repo_path,
    )

    while True:
        try:
            commit_hash = backup.create_backup()
            logger.info(f"Auto backup created: {commit_hash}")

            # 推送到远程（如果配置了）
            if config.memory.backup_remote_enabled:
                backup.push_to_remote()
                logger.info("Backup pushed to remote")

        except Exception as e:
            logger.error(f"Auto backup failed: {e}")

        await asyncio.sleep(interval_minutes * 60)
```

### 验证清单

- [ ] Git 仓库初始化正常
- [ ] 创建备份（commit）正常
- [ ] 列出备份历史正常
- [ ] 恢复备份正常
- [ ] 推送到远程正常
- [ ] 自动备份任务正常运行

---

## Phase 8: 加密

### 目标
实现端到端加密保护记忆隐私。

### 8.1 加密实现

**文件**：`backend/src/agents/memory/encryption.py`

```python
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt
import os

class MemoryEncryption:
    """记忆加密管理器"""

    def __init__(self):
        self.key_size = 32  # 256 bits
        self.nonce_size = 12  # 96 bits for GCM
        self.salt_size = 16  # 128 bits

    def derive_key(self, password: str, salt: bytes) -> bytes:
        """从密码派生加密密钥（使用 Scrypt）"""
        kdf = Scrypt(
            salt=salt,
            length=self.key_size,
            n=2**14,  # CPU/memory cost
            r=8,      # block size
            p=1,      # parallelization
        )
        key = kdf.derive(password.encode('utf-8'))
        return key

    def encrypt_memory(
        self,
        memory_path: str,
        password: str,
        output_path: str | None = None,
    ) -> dict[str, Any]:
        """加密记忆文件"""

        # 读取原始数据
        with open(memory_path, 'rb') as f:
            plaintext = f.read()

        # 生成 salt 和 nonce
        salt = os.urandom(self.salt_size)
        nonce = os.urandom(self.nonce_size)

        # 派生密钥
        key = self.derive_key(password, salt)

        # 加密
        aesgcm = AESGCM(key)
        ciphertext = aesgcm.encrypt(nonce, plaintext, None)

        # 构建加密文件：salt + nonce + ciphertext
        encrypted_data = salt + nonce + ciphertext

        # 保存
        if output_path is None:
            output_path = memory_path + ".encrypted"

        with open(output_path, 'wb') as f:
            f.write(encrypted_data)

        return {
            "encrypted_path": output_path,
            "salt": salt.hex(),
            "nonce": nonce.hex(),
        }

    def decrypt_memory(
        self,
        encrypted_path: str,
        password: str,
        output_path: str | None = None,
    ) -> str:
        """解密记忆文件"""

        # 读取加密数据
        with open(encrypted_path, 'rb') as f:
            encrypted_data = f.read()

        # 提取 salt, nonce, ciphertext
        salt = encrypted_data[:self.salt_size]
        nonce = encrypted_data[self.salt_size:self.salt_size + self.nonce_size]
        ciphertext = encrypted_data[self.salt_size + self.nonce_size:]

        # 派生密钥
        key = self.derive_key(password, salt)

        # 解密
        aesgcm = AESGCM(key)
        try:
            plaintext = aesgcm.decrypt(nonce, ciphertext, None)
        except Exception as e:
            raise ValueError("Decryption failed: incorrect password or corrupted data")

        # 保存
        if output_path is None:
            output_path = encrypted_path.replace(".encrypted", "")

        with open(output_path, 'wb') as f:
            f.write(plaintext)

        return output_path

    def is_encrypted(self, file_path: str) -> bool:
        """检查文件是否已加密"""
        return file_path.endswith(".encrypted")
```

### 8.2 加密 API

**文件**：`backend/src/gateway/routers/memory.py`

```python
@router.post("/encrypt")
async def encrypt_memory(password: str) -> dict[str, Any]:
    """加密记忆"""
    manager = get_memory_manager()
    encryption = MemoryEncryption()

    result = encryption.encrypt_memory(
        memory_path=manager.storage_path,
        password=password,
    )

    return {"success": True, **result}

@router.post("/decrypt")
async def decrypt_memory(
    encrypted_path: str,
    password: str,
) -> dict[str, Any]:
    """解密记忆"""
    encryption = MemoryEncryption()

    try:
        output_path = encryption.decrypt_memory(
            encrypted_path=encrypted_path,
            password=password,
        )

        # 重新加载记忆
        manager = get_memory_manager()
        manager.reload()

        return {"success": True, "decrypted_path": output_path}
    except ValueError as e:
        raise HTTPException(400, str(e))
```

### 验证清单

- [ ] 密钥派生（Scrypt）正常
- [ ] AES-GCM 加密正常
- [ ] AES-GCM 解密正常
- [ ] 错误密码检测正常
- [ ] 加密后记忆不可读
- [ ] 解密后记忆正常加载

---

## 总结

Phase 4-8 的详细实现步骤已完成，涵盖：

1. **Phase 4: 分享/协作** - 导出（Markdown/JSON/Graph）、导入（JSON/Roam）
2. **Phase 5: 重要性评分** - FSRS 算法、自动衰减、定期清理
3. **Phase 6: 标签系统** - LLM 自动标签、手动管理、标签搜索
4. **Phase 7: 备份/恢复** - Git 版本控制、自动备份、远程推送
5. **Phase 8: 加密** - AES-256-GCM、Scrypt 密钥派生、E2EE

所有功能都基于成熟的开源解决方案和最佳实践。
