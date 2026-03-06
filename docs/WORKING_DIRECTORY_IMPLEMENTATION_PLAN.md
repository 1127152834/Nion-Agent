# 工作目录（Working Directory）功能 - 实施方案

## 一、项目背景

### 1.1 功能概述

为 Nion-Agent 添加"工作目录"功能，允许用户在对话中关联一个本地文件系统目录，然后可以直接基于该目录中的文档（Excel、PDF、Markdown 等）进行提问，无需每次手动上传文件。

### 1.2 核心价值

- **免上传**: 用户预先配置工作目录，对话中直接使用
- **目录理解**: Agent 能理解目录结构，知道有哪些文件可用
- **安全访问**: 严格的路径验证，防止目录穿越攻击

---

## 二、现有代码库分析

### 2.1 项目结构

```
Nion-Agent/
├── backend/
│   ├── src/
│   │   ├── agents/
│   │   │   └── thread_state.py       # 线程状态定义
│   │   ├── gateway/
│   │   │   ├── app.py                # FastAPI 应用
│   │   │   ├── routers/              # API 路由
│   │   │   │   ├── uploads.py        # 文件上传路由（参考）
│   │   │   │   └── ...
│   │   │   └── schemas/              # Pydantic 模型
│   │   ├── services/                 # 业务服务
│   │   │   └── ...
│   │   ├── sandbox/
│   │   │   └── tools.py              # 沙盒工具（参考）
│   │   └── tools/
│   │       └── builtins/             # 内置工具
│   └── tests/
├── frontend/
│   └── src/
│       ├── app/
│       ├── components/
│       │   └── workspace/
│       │       └── settings/
│       │           ├── settings-dialog.tsx   # 设置对话框
│       │           └── *.tsx                 # 各设置页面
│       └── core/
│           ├── threads/                 # 线程相关
│           ├── uploads/                 # 文件上传（参考）
│           ├── memory/                 # 记忆系统
│           └── i18n/locales/          # 国际化
```

### 2.2 关键依赖

| 组件 | 说明 |
|------|------|
| `ThreadState` | 定义对话状态，包含 `thread_data`、`sandbox` 等 |
| `Paths` | 管理应用数据目录，支持虚拟路径映射 |
| `Sandbox tools` | 提供 `read_file`、`ls` 等文件操作工具 |
| `markitdown` | 用于转换 PDF/Excel/Word 为文本 |

---

## 三、实施任务清单

### 3.1 后端任务

| # | 文件 | 操作 | 说明 |
|---|------|------|------|
| 1 | `backend/src/agents/thread_state.py` | 修改 | 添加 `working_directory` 字段 |
| 2 | `backend/src/services/working_directory.py` | 新建 | 工作目录服务（索引生成、路径验证） |
| 3 | `backend/src/gateway/schemas/working_directory.py` | 新建 | Pydantic 数据模型 |
| 4 | `backend/src/gateway/routers/working_directory.py` | 新建 | API 路由 |
| 5 | `backend/src/gateway/app.py` | 修改 | 注册新路由 |
| 6 | `backend/src/tools/workspace_tools.py` | 新建 | Agent 工具（read_workspace_file, list_workspace_directory） |
| 7 | `backend/src/tools/__init__.py` | 修改 | 导出新工具 |

### 3.2 前端任务

| # | 文件 | 操作 | 说明 |
|---|------|------|------|
| 1 | `frontend/src/core/working-directory/types.ts` | 新建 | TypeScript 类型定义 |
| 2 | `frontend/src/core/working-directory/api.ts` | 新建 | API 调用 |
| 3 | `frontend/src/core/working-directory/hooks.ts` | 新建 | React Query Hooks |
| 4 | `frontend/src/core/working-directory/index.ts` | 新建 | 模块导出 |
| 5 | `frontend/src/components/workspace/settings/working-directory-settings-page.tsx` | 新建 | 设置页面 |
| 6 | `frontend/src/components/workspace/settings/settings-dialog.tsx` | 修改 | 添加入口 |
| 7 | `frontend/src/core/i18n/locales/zh-CN.ts` | 修改 | 添加中文文本 |
| 8 | `frontend/src/core/i18n/locales/en-US.ts` | 修改 | 添加英文文本 |

---

## 四、详细实施步骤

### 步骤 1: 修改后端 ThreadState

**文件**: `backend/src/agents/thread_state.py`

```python
# 在文件末尾添加以下内容

class WorkingDirectoryState(TypedDict):
    """工作目录状态"""
    path: str  # 用户配置的本地目录绝对路径
    alias: str | None  # 可选的别名
    enabled: bool  # 是否启用
    last_synced_at: str | None  # 最后同步时间
    index_version: int | None  # 索引版本

# 修改 ThreadState 类，添加 working_directory 字段
class ThreadState(AgentState):
    sandbox: NotRequired[SandboxState | None]
    thread_data: NotRequired[ThreadDataState | None]
    title: NotRequired[str | None]
    artifacts: Annotated[list[str], merge_artifacts]
    todos: NotRequired[list | None]
    uploaded_files: NotRequired[list[dict] | None]
    viewed_images: Annotated[dict[str, ViewedImageData], merge_viewed_images]

    # 新增字段
    working_directory: NotRequired[WorkingDirectoryState | None]
```

---

### 步骤 2: 创建工作目录服务

**文件**: `backend/src/services/working_directory.py`

**完整代码**:

```python
"""Working Directory Service - 工作目录服务"""

import os
from datetime import datetime, UTC
from pathlib import Path
from typing import TypedDict

# 支持的文件类型分类
FILE_CATEGORIES = {
    "document": {".pdf", ".docx", ".doc", ".md", ".txt", ".rtf", ".odt"},
    "spreadsheet": {".xlsx", ".xls", ".csv", ".ods"},
    "code": {".py", ".js", ".ts", ".jsx", ".tsx", ".go", ".rs", ".java", ".c", ".cpp", ".h", ".css", ".html", ".json", ".yaml", ".yml", ".toml"},
    "image": {".png", ".jpg", ".jpeg", ".gif", ".bmp", ".svg", ".webp"},
    "data": {".json", ".xml", ".yaml", ".yml", ".toml", ".sql"},
    "archive": {".zip", ".tar", ".gz", ".7z", ".rar"},
}


class FileIndexEntry(TypedDict):
    relative_path: str
    name: str
    extension: str
    size: int
    modified_at: str
    category: str


class DirectoryIndexEntry(TypedDict):
    relative_path: str
    name: str
    subdir_count: int
    file_count: int
    modified_at: str


class WorkingDirectoryIndex(TypedDict):
    path: str
    files: list[FileIndexEntry]
    directories: list[DirectoryIndexEntry]
    generated_at: str
    version: int


def get_file_category(extension: str) -> str:
    """根据扩展名获取文件分类"""
    ext = extension.lower()
    for category, extensions in FILE_CATEGORIES.items():
        if ext in extensions:
            return category
    return "other"


class WorkingDirectoryService:
    """工作目录服务"""

    MAX_INDEX_FILES = 10000
    MAX_FILE_SIZE = 100 * 1024 * 1024  # 100MB
    MAX_DEPTH = 10

    # 排除的目录
    EXCLUDED_DIRS = {"__pycache__", "node_modules", ".git", ".svn", ".hg"}

    def validate_path(self, path: str) -> tuple[bool, str]:
        """验证路径安全性"""
        try:
            abs_path = os.path.abspath(os.path.expanduser(path))

            if not os.path.exists(abs_path):
                return False, f"路径不存在: {path}"

            if not os.path.isdir(abs_path):
                return False, f"路径不是目录: {path}"

            if not os.access(abs_path, os.R_OK):
                return False, f"无读取权限: {path}"

            return True, ""

        except Exception as e:
            return False, f"路径验证失败: {str(e)}"

    def is_path_safe(self, working_dir: str, target_path: str) -> bool:
        """检查目标路径是否在工作目录内"""
        try:
            working_abs = os.path.abspath(working_dir)
            target_abs = os.path.abspath(target_path)
            common = os.path.commonpath([working_abs, target_abs])
            return common == working_abs
        except ValueError:
            return False

    def generate_index(self, directory: str) -> WorkingDirectoryIndex:
        """生成目录索引"""
        files: list[FileIndexEntry] = []
        directories: list[DirectoryIndexEntry] = []

        def scan_directory(dir_path: str, depth: int, parent_rel_path: str = ""):
            if depth > self.MAX_DEPTH or len(files) >= self.MAX_INDEX_FILES:
                return

            try:
                entries = os.listdir(dir_path)
            except PermissionError:
                return

            for entry in entries:
                if len(files) >= self.MAX_INDEX_FILES:
                    break

                if entry in self.EXCLUDED_DIRS or entry.startswith("."):
                    continue

                entry_path = os.path.join(dir_path, entry)
                rel_path = os.path.join(parent_rel_path, entry) if parent_rel_path else entry

                if os.path.isfile(entry_path):
                    try:
                        stat = os.stat(entry_path)
                        _, ext = os.path.splitext(entry)

                        files.append(FileIndexEntry(
                            relative_path=rel_path,
                            name=entry,
                            extension=ext.lower(),
                            size=stat.st_size,
                            modified_at=datetime.fromtimestamp(stat.st_mtime, UTC).isoformat(),
                            category=get_file_category(ext),
                        ))
                    except OSError:
                        continue

                elif os.path.isdir(entry_path):
                    try:
                        subdir_count = 0
                        file_count = 0
                        stat = os.stat(entry_path)

                        try:
                            sub_entries = os.listdir(entry_path)
                            for se in sub_entries[:100]:
                                se_path = os.path.join(entry_path, se)
                                if os.path.isdir(se_path):
                                    subdir_count += 1
                                elif os.path.isfile(se_path):
                                    file_count += 1
                        except PermissionError:
                            pass

                        directories.append(DirectoryIndexEntry(
                            relative_path=rel_path,
                            name=entry,
                            subdir_count=subdir_count,
                            file_count=file_count,
                            modified_at=datetime.fromtimestamp(stat.st_mtime, UTC).isoformat(),
                        ))

                        scan_directory(entry_path, depth + 1, rel_path)

                    except OSError:
                        continue

        scan_directory(directory)

        return WorkingDirectoryIndex(
            path=directory,
            files=files,
            directories=directories,
            generated_at=datetime.now(UTC).isoformat(),
            version=1,
        )

    def read_workspace_file(self, working_dir: str, file_path: str, max_size: int = 10 * 1024 * 1024) -> tuple[bool, str, bytes | None]:
        """安全读取工作目录下的文件"""
        if not os.path.isabs(file_path):
            file_path = os.path.join(working_dir, file_path)

        if not self.is_path_safe(working_dir, file_path):
            return False, "路径不在工作目录内", None

        if not os.path.exists(file_path):
            return False, f"文件不存在: {file_path}", None

        if not os.path.isfile(file_path):
            return False, f"不是文件: {file_path}", None

        try:
            file_size = os.path.getsize(file_path)
            if file_size > max_size:
                return False, f"文件过大 ({file_size} bytes)", None
        except OSError as e:
            return False, f"无法获取文件大小: {e}", None

        try:
            with open(file_path, "rb") as f:
                content = f.read()
            return True, "", content
        except Exception as e:
            return False, f"读取失败: {e}", None


# 全局实例
working_directory_service = WorkingDirectoryService()
```

---

### 步骤 3: 创建 Pydantic 数据模型

**文件**: `backend/src/gateway/schemas/working_directory.py`

```python
"""Working Directory Schemas - 工作目录数据模型"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class WorkingDirectoryConfig(BaseModel):
    """工作目录配置"""
    path: str = Field(..., description="目录绝对路径")
    alias: str | None = Field(default=None, description="目录别名")
    enabled: bool = Field(default=True, description="是否启用")


class WorkingDirectoryConfigResponse(BaseModel):
    """工作目录配置响应"""
    path: str
    alias: str | None = None
    enabled: bool
    last_synced_at: str | None = None
    index_version: int | None = None


class WorkingDirectoryValidateRequest(BaseModel):
    """工作目录验证请求"""
    path: str = Field(..., description="要验证的路径")


class WorkingDirectoryValidateResponse(BaseModel):
    """工作目录验证响应"""
    valid: bool
    message: str
    stats: dict | None = None


class FileIndexEntry(BaseModel):
    """文件索引条目"""
    relative_path: str
    name: str
    extension: str
    size: int
    modified_at: str
    category: str


class DirectoryIndexEntry(BaseModel):
    """目录索引条目"""
    relative_path: str
    name: str
    subdir_count: int
    file_count: int
    modified_at: str


class WorkingDirectoryIndexResponse(BaseModel):
    """工作目录索引响应"""
    path: str
    files: list[FileIndexEntry]
    directories: list[DirectoryIndexEntry]
    generated_at: str
    version: int
```

---

### 步骤 4: 创建 API 路由

**文件**: `backend/src/gateway/routers/working_directory.py`

```python
"""Working Directory Router - 工作目录 API"""

import logging
from datetime import datetime, UTC

from fastapi import APIRouter, HTTPException

from src.gateway.schemas.working_directory import (
    FileIndexEntry,
    DirectoryIndexEntry,
    WorkingDirectoryConfig,
    WorkingDirectoryConfigResponse,
    WorkingDirectoryIndexResponse,
    WorkingDirectoryValidateRequest,
    WorkingDirectoryValidateResponse,
)
from src.services.working_directory import working_directory_service

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/threads/{thread_id}/working-directory",
    tags=["working-directory"],
)

# 内存存储（生产环境可替换为数据库）
# key: thread_id, value: WorkingDirectoryConfig
_thread_working_directories: dict[str, dict] = {}

# 索引缓存
# key: thread_id, value: WorkingDirectoryIndex
_index_cache: dict[str, dict] = {}


@router.get("", response_model=WorkingDirectoryConfigResponse)
async def get_working_directory(thread_id: str) -> WorkingDirectoryConfigResponse:
    """获取工作目录配置"""
    config = _thread_working_directories.get(thread_id)
    if not config:
        return WorkingDirectoryConfigResponse(
            path="",
            enabled=False,
        )
    return WorkingDirectoryConfigResponse(**config)


@router.put("", response_model=WorkingDirectoryConfigResponse)
async def set_working_directory(
    thread_id: str,
    config: WorkingDirectoryConfig,
) -> WorkingDirectoryConfigResponse:
    """设置工作目录"""
    # 验证路径
    valid, message = working_directory_service.validate_path(config.path)
    if not valid:
        raise HTTPException(status_code=400, detail=message)

    # 生成索引
    index = working_directory_service.generate_index(config.path)

    # 保存配置
    now = datetime.now(UTC).isoformat()
    config_data = {
        "path": config.path,
        "alias": config.alias,
        "enabled": config.enabled,
        "last_synced_at": now,
        "index_version": index["version"],
    }
    _thread_working_directories[thread_id] = config_data

    # 缓存索引
    _index_cache[thread_id] = index

    logger.info(f"Working directory set for thread {thread_id}: {config.path}")

    return WorkingDirectoryConfigResponse(**config_data)


@router.post("/validate", response_model=WorkingDirectoryValidateResponse)
async def validate_working_directory(
    thread_id: str,
    request: WorkingDirectoryValidateRequest,
) -> WorkingDirectoryValidateResponse:
    """验证路径有效性"""
    valid, message = working_directory_service.validate_path(request.path)

    if not valid:
        return WorkingDirectoryValidateResponse(
            valid=False,
            message=message,
        )

    # 生成快速统计
    index = working_directory_service.generate_index(request.path)

    return WorkingDirectoryValidateResponse(
        valid=True,
        message="路径有效",
        stats={
            "total_files": len(index["files"]),
            "total_directories": len(index["directories"]),
            "readable": True,
        },
    )


@router.post("/refresh", response_model=WorkingDirectoryConfigResponse)
async def refresh_working_directory_index(thread_id: str) -> WorkingDirectoryConfigResponse:
    """刷新工作目录索引"""
    config = _thread_working_directories.get(thread_id)
    if not config or not config.get("enabled"):
        raise HTTPException(status_code=404, detail="No working directory configured")

    # 重新生成索引
    index = working_directory_service.generate_index(config["path"])

    now = datetime.now(UTC).isoformat()
    config["last_synced_at"] = now
    config["index_version"] = index["version"]

    # 更新缓存
    _index_cache[thread_id] = index

    return WorkingDirectoryConfigResponse(**config)


@router.get("/index", response_model=WorkingDirectoryIndexResponse)
async def get_working_directory_index(thread_id: str) -> WorkingDirectoryIndexResponse:
    """获取工作目录索引"""
    # 先尝试从缓存获取
    cached_index = _index_cache.get(thread_id)
    if cached_index:
        return WorkingDirectoryIndexResponse(**cached_index)

    # 检查是否配置了工作目录
    config = _thread_working_directories.get(thread_id)
    if not config or not config.get("enabled"):
        raise HTTPException(status_code=404, detail="No working directory configured")

    # 生成索引
    index = working_directory_service.generate_index(config["path"])
    _index_cache[thread_id] = index

    return WorkingDirectoryIndexResponse(**index)
```

---

### 步骤 5: 注册路由

**文件**: `backend/src/gateway/app.py`

**修改内容**:

1. 在 import 中添加 `working_directory`:
```python
from src.gateway.routers import agents, artifacts, config, mcp, memory, models, rss, skills, uploads, working_directory
```

2. 在 `create_app()` 函数中添加路由:
```python
# Working Directory API
app.include_router(working_directory.router)
```

3. 在 openapi_tags 中添加:
```python
{
    "name": "working-directory",
    "description": "Working directory management for file access",
},
```

---

### 步骤 6: 创建 Agent 工具

**文件**: `backend/src/tools/workspace_tools.py`

```python
"""Workspace Tools - 工作目录工具"""

import os
from langchain.tools import ToolRuntime, tool

from src.agents.thread_state import ThreadState
from src.services.working_directory import working_directory_service


def get_working_directory_from_state(state: ThreadState | None) -> str | None:
    """从状态中获取工作目录路径"""
    if state is None:
        return None
    wd = state.get("working_directory")
    if wd is None:
        return None
    if not wd.get("enabled"):
        return None
    return wd.get("path")


@tool("read_workspace_file", parse_docstring=True)
def read_workspace_file_tool(
    runtime: ToolRuntime,
    description: str,
    path: str,
    encoding: str = "utf-8",
) -> str:
    """Read a file from the working directory.

    This tool can only access files within the configured working directory.

    Args:
        description: Explain why you are reading this file in short words.
        path: The path to the file, relative to the working directory or absolute path.
        encoding: Text encoding (default: utf-8). Use "binary" for binary files.
    """
    state = runtime.state
    working_dir = get_working_directory_from_state(state)

    if working_dir is None:
        return "Error: No working directory configured for this conversation"

    success, error_msg, content = working_directory_service.read_workspace_file(
        working_dir, path
    )

    if not success:
        return f"Error: {error_msg}"

    if content is None:
        return "Error: No content"

    if encoding == "binary":
        size = len(content)
        return f"[Binary file: {path}, {size} bytes]"

    try:
        return content.decode(encoding)
    except UnicodeDecodeError:
        return f"Error: File cannot be decoded as {encoding}. Use encoding='binary'."


@tool("list_workspace_directory", parse_docstring=True)
def list_workspace_directory_tool(
    runtime: ToolRuntime,
    description: str,
    path: str = "",
    include_hidden: bool = False,
) -> str:
    """List files and directories in the working directory.

    Args:
        description: Explain why you are listing this directory in short words.
        path: The directory path relative to the working directory (empty = root).
        include_hidden: Whether to include hidden files (starting with .).
    """
    state = runtime.state
    working_dir = get_working_directory_from_state(state)

    if working_dir is None:
        return "Error: No working directory configured for this conversation"

    if path:
        target_path = os.path.join(working_dir, path)
    else:
        target_path = working_dir

    if not working_directory_service.is_path_safe(working_dir, target_path):
        return "Error: Path is outside the working directory"

    if not os.path.exists(target_path):
        return f"Error: Directory does not exist: {path}"

    if not os.path.isdir(target_path):
        return f"Error: Not a directory: {path}"

    try:
        entries = os.listdir(target_path)

        if not include_hidden:
            entries = [e for e in entries if not e.startswith(".")]

        dirs = []
        files = []
        for entry in sorted(entries):
            entry_path = os.path.join(target_path, entry)
            if os.path.isdir(entry_path):
                dirs.append(entry + "/")
            else:
                size = os.path.getsize(entry_path)
                files.append(f"{entry} ({_format_size(size)})")

        result = []
        if dirs:
            result.append("Directories:")
            result.extend(dirs)
        if files:
            if dirs:
                result.append("")
            result.append("Files:")
            result.extend(files)

        return "\n".join(result) if result else "(empty)"

    except PermissionError:
        return "Error: Permission denied"
    except Exception as e:
        return f"Error: {e}"


def _format_size(size: int) -> str:
    """格式化文件大小"""
    for unit in ["B", "KB", "MB", "GB"]:
        if size < 1024:
            return f"{size}{unit}"
        size /= 1024
    return f"{size:.1f}TB"
```

---

### 步骤 7: 导出工具

**文件**: `backend/src/tools/__init__.py`

添加导出:
```python
from src.tools.workspace_tools import read_workspace_file_tool, list_workspace_directory_tool

__all__ = [
    # ... existing exports
    "read_workspace_file_tool",
    "list_workspace_directory_tool",
]
```

**注意**: 还需要在 `get_available_tools()` 函数中添加工具。找到 `src/tools/tools.py` 并添加:
```python
from src.tools.workspace_tools import read_workspace_file_tool, list_workspace_directory_tool

# 在 get_available_tools 函数中添加
tools.extend([
    read_workspace_file_tool,
    list_workspace_directory_tool,
])
```

---

### 步骤 8: 前端类型定义

**文件**: `frontend/src/core/working-directory/types.ts`

```typescript
export interface WorkingDirectoryConfig {
  path: string;
  alias?: string;
  enabled: boolean;
  last_synced_at?: string;
  index_version?: number;
}

export interface FileIndexEntry {
  relative_path: string;
  name: string;
  extension: string;
  size: number;
  modified_at: string;
  category: string;
}

export interface DirectoryIndexEntry {
  relative_path: string;
  name: string;
  subdir_count: number;
  file_count: number;
  modified_at: string;
}

export interface WorkingDirectoryIndex {
  path: string;
  files: FileIndexEntry[];
  directories: DirectoryIndexEntry[];
  generated_at: string;
  version: number;
}

export interface WorkingDirectoryValidateRequest {
  path: string;
}

export interface WorkingDirectoryValidateResponse {
  valid: boolean;
  message: string;
  stats?: {
    total_files: number;
    total_directories: number;
    readable: boolean;
  };
}
```

---

### 步骤 9: 前端 API

**文件**: `frontend/src/core/working-directory/api.ts`

```typescript
import type {
  WorkingDirectoryConfig,
  WorkingDirectoryIndex,
  WorkingDirectoryValidateRequest,
  WorkingDirectoryValidateResponse,
} from "./types";

const BASE_URL = "";

export async function getWorkingDirectory(
  threadId: string
): Promise<WorkingDirectoryConfig> {
  const res = await fetch(`${BASE_URL}/api/threads/${threadId}/working-directory`);
  if (!res.ok) {
    throw new Error("Failed to fetch working directory");
  }
  return res.json();
}

export async function setWorkingDirectory(
  threadId: string,
  config: WorkingDirectoryConfig
): Promise<WorkingDirectoryConfig> {
  const res = await fetch(`${BASE_URL}/api/threads/${threadId}/working-directory`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
  if (!res.ok) {
    throw new Error("Failed to set working directory");
  }
  return res.json();
}

export async function validateWorkingDirectory(
  threadId: string,
  request: WorkingDirectoryValidateRequest
): Promise<WorkingDirectoryValidateResponse> {
  const res = await fetch(
    `${BASE_URL}/api/threads/${threadId}/working-directory/validate`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    }
  );
  if (!res.ok) {
    throw new Error("Failed to validate working directory");
  }
  return res.json();
}

export async function refreshWorkingDirectoryIndex(
  threadId: string
): Promise<WorkingDirectoryConfig> {
  const res = await fetch(
    `${BASE_URL}/api/threads/${threadId}/working-directory/refresh`,
    { method: "POST" }
  );
  if (!res.ok) {
    throw new Error("Failed to refresh working directory index");
  }
  return res.json();
}

export async function getWorkingDirectoryIndex(
  threadId: string
): Promise<WorkingDirectoryIndex> {
  const res = await fetch(
    `${BASE_URL}/api/threads/${threadId}/working-directory/index`
  );
  if (!res.ok) {
    throw new Error("Failed to fetch working directory index");
  }
  return res.json();
}
```

---

### 步骤 10: 前端 Hooks

**文件**: `frontend/src/core/working-directory/hooks.ts`

```typescript
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getWorkingDirectory,
  setWorkingDirectory,
  refreshWorkingDirectoryIndex,
  getWorkingDirectoryIndex,
  validateWorkingDirectory,
} from "./api";
import type { WorkingDirectoryConfig } from "./types";

export function useWorkingDirectory(threadId: string) {
  return useQuery({
    queryKey: ["working-directory", threadId],
    queryFn: () => getWorkingDirectory(threadId),
    enabled: !!threadId,
  });
}

export function useSetWorkingDirectory(threadId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (config: WorkingDirectoryConfig) =>
      setWorkingDirectory(threadId, config),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["working-directory", threadId],
      });
      queryClient.invalidateQueries({
        queryKey: ["working-directory-index", threadId],
      });
    },
  });
}

export function useValidateWorkingDirectory(threadId: string) {
  return useMutation({
    mutationFn: (path: string) =>
      validateWorkingDirectory(threadId, { path }),
  });
}

export function useRefreshWorkingDirectoryIndex(threadId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => refreshWorkingDirectoryIndex(threadId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["working-directory-index", threadId],
      });
    },
  });
}

export function useWorkingDirectoryIndex(threadId: string) {
  return useQuery({
    queryKey: ["working-directory-index", threadId],
    queryFn: () => getWorkingDirectoryIndex(threadId),
    enabled: !!threadId,
  });
}
```

---

### 步骤 11: 前端模块导出

**文件**: `frontend/src/core/working-directory/index.ts`

```typescript
export * from "./types";
export * from "./api";
export * from "./hooks";
```

---

### 步骤 12: 前端设置页面

**文件**: `frontend/src/components/workspace/settings/working-directory-settings-page.tsx`

```typescript
"use client";

import { useState } from "react";
import { FolderOpen, RefreshCw, AlertCircle, CheckCircle2 } from "lucide-react";

import { useI18n } from "@/core/i18n/hooks";
import {
  useWorkingDirectory,
  useSetWorkingDirectory,
  useRefreshWorkingDirectoryIndex,
  useValidateWorkingDirectory,
  useWorkingDirectoryIndex,
} from "@/core/working-directory/hooks";

import { SettingsSection } from "./settings-section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function WorkingDirectorySettingsPage({ threadId }: { threadId: string }) {
  const { t } = useI18n();
  const { data: workingDir, isLoading } = useWorkingDirectory(threadId);
  const { data: index } = useWorkingDirectoryIndex(threadId);
  const setWorkingDirectory = useSetWorkingDirectory(threadId);
  const refreshIndex = useRefreshWorkingDirectoryIndex(threadId);
  const validateDir = useValidateWorkingDirectory(threadId);

  const [path, setPath] = useState(workingDir?.path || "");
  const [alias, setAlias] = useState(workingDir?.alias || "");
  const [enabled, setEnabled] = useState(workingDir?.enabled ?? true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleValidate = async () => {
    setError(null);
    setSuccess(null);
    try {
      const result = await validateDir.mutateAsync(path);
      if (result.valid) {
        setSuccess(result.message || "路径有效");
      } else {
        setError(result.message);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "验证失败");
    }
  };

  const handleSave = async () => {
    setError(null);
    setSuccess(null);
    try {
      await setWorkingDirectory.mutateAsync({
        path,
        alias,
        enabled,
      });
      setSuccess("保存成功");
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    }
  };

  const handleRefresh = async () => {
    try {
      await refreshIndex.mutateAsync();
      setSuccess("索引已刷新");
    } catch (err) {
      setError(err instanceof Error ? err.message : "刷新失败");
    }
  };

  if (isLoading) {
    return (
      <SettingsSection title="工作目录" description="配置工作目录以直接访问本地文件">
        <div className="text-muted-foreground">加载中...</div>
      </SettingsSection>
    );
  }

  return (
    <SettingsSection title="工作目录" description="配置工作目录以直接访问本地文件">
      <div className="space-y-4">
        {/* 目录路径 */}
        <div>
          <label className="text-sm font-medium">目录路径</label>
          <div className="mt-1 flex gap-2">
            <Input
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="/Users/username/Documents/项目"
              className="flex-1"
            />
            <Button type="button" variant="outline" onClick={handleValidate}>
              验证
            </Button>
          </div>
        </div>

        {/* 别名 */}
        <div>
          <label className="text-sm font-medium">别名（可选）</label>
          <Input
            value={alias}
            onChange={(e) => setAlias(e.target.value)}
            placeholder="项目资料"
            className="mt-1"
          />
        </div>

        {/* 启用开关 */}
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="enabled"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          <label htmlFor="enabled" className="text-sm font-medium">
            启用工作目录
          </label>
        </div>

        {/* 操作按钮 */}
        <div className="flex gap-2">
          <Button onClick={handleSave} disabled={setWorkingDirectory.isPending}>
            {setWorkingDirectory.isPending ? "保存中..." : "保存"}
          </Button>
          {workingDir?.path && (
            <Button
              variant="outline"
              onClick={handleRefresh}
              disabled={refreshIndex.isPending}
            >
              <RefreshCw
                className={`mr-2 h-4 w-4 ${refreshIndex.isPending ? "animate-spin" : ""}`}
              />
              刷新索引
            </Button>
          )}
        </div>

        {/* 消息提示 */}
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {success && (
          <Alert className="bg-green-50">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <AlertDescription>{success}</AlertDescription>
          </Alert>
        )}

        {/* 索引预览 */}
        {index && enabled && (
          <Card className="mt-4">
            <CardHeader>
              <CardTitle className="text-sm">索引预览</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="flex gap-2">
                  <Badge variant="secondary">
                    {index.directories.length} 目录
                  </Badge>
                  <Badge variant="secondary">{index.files.length} 文件</Badge>
                </div>
                {index.files.length > 0 && (
                  <div className="text-sm text-muted-foreground">
                    最近文件: {index.files[0]?.name}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </SettingsSection>
  );
}
```

---

### 步骤 13: 修改设置对话框

**文件**: `frontend/src/components/workspace/settings/settings-dialog.tsx`

**修改内容**:

1. 添加导入:
```typescript
import { FolderOpenIcon } from "lucide-react";
import { WorkingDirectorySettingsPage } from "./working-directory-settings-page";
```

2. 添加类型:
```typescript
type SettingsSection =
  | "appearance"
  | "models"
  | "memory"
  | "tools"
  | "skills"
  | "sandbox"
  | "notification"
  | "about"
  | "working-directory";  // 新增
```

3. 添加导航项:
```typescript
{
  id: "working-directory",
  label: "工作目录",
  icon: FolderOpenIcon,
},
```

4. 添加入口:
```typescript
{activeSection === "working-directory" && (
  <WorkingDirectorySettingsPage threadId={/* 需要从上下文获取 */} />
)}
```

**注意**: 需要从上下文获取 `threadId`。查看现有页面如何获取:
```typescript
// 参考 memory-settings-page.tsx，可能需要通过 URL 或上下文获取
```

---

### 步骤 14: 添加国际化文本

**文件**: `frontend/src/core/i18n/locales/zh-CN.ts`

在 `settings` 对象中添加:
```typescript
workingDirectory: {
  title: "工作目录",
  description: "配置工作目录以直接访问本地文件",
  form: {
    path: "目录路径",
    alias: "别名",
    enabled: "启用工作目录",
  },
  validate: "验证",
  save: "保存",
  refresh: "刷新索引",
  refreshIndex: "刷新索引",
  indexPreview: "索引预览",
  directories: "目录",
  files: "文件",
  recentFiles: "最近文件",
  noWorkingDirectory: "未配置工作目录",
},
```

**文件**: `frontend/src/core/i18n/locales/en-US.ts`

同样添加英文翻译:
```typescript
workingDirectory: {
  title: "Working Directory",
  description: "Configure a working directory for direct file access",
  // ...
},
```

---

## 五、验证步骤

### 5.1 后端验证

```bash
# 1. 启动后端
cd backend && make dev

# 2. 测试 API
# 验证路径
curl -X POST http://localhost:8001/api/threads/test-thread/working-directory/validate \
  -H "Content-Type: application/json" \
  -d '{"path": "/Users/zhangtiancheng/Documents"}'

# 设置工作目录
curl -X PUT http://localhost:8001/api/threads/test-thread/working-directory \
  -H "Content-Type: application/json" \
  -d '{"path": "/Users/zhangtiancheng/Documents", "enabled": true}'

# 获取索引
curl http://localhost:8001/api/threads/test-thread/working-directory/index
```

### 5.2 前端验证

```bash
# 1. 启动前端
cd frontend && pnpm dev

# 2. 访问设置页面
# http://localhost:3000/workspace/chats/{thread_id}

# 3. 打开设置对话框，应该能看到"工作目录"选项
```

### 5.3 功能验证

1. 配置一个包含文档的目录
2. 在对话中提问："列出工作目录的文件"
3. 提问："读取 xxx 文件"

---

## 六、注意事项

### 6.1 安全考虑

- 路径验证确保用户只能访问授权的目录
- 文件大小限制防止内存溢出
- 排除系统目录（`__pycache__`, `node_modules` 等）

### 6.2 生产环境优化

- 当前使用内存存储，生产环境应使用数据库
- 索引可以缓存更长时间
- 添加文件变化监听实现增量更新

### 6.3 兼容性

- 当前仅支持本地文件系统
- 远程文件（如 SMB/NFS）需要额外适配
