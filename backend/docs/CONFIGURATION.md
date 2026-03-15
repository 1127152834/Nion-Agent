# Configuration Guide

Nion 的运行时配置以 **Config Store（SQLite）** 为真源，通常通过前端的“页面设置”写入，并由 Gateway 的 Config Center API 持久化。

> 重要: `config.yaml` **不是**长期运行时真源。它仅用于首次启动时的“导入/迁移”或在 Store 尚未初始化时的兜底读取（见本文末尾的 Legacy 说明）。

## Source Of Truth

1. **Config Store (SQLite)**: 存放核心运行配置（models/tools/sandbox/title/suggestions/summarization/subagents/memory/skills 等）。
2. **extensions_config.json (可选)**: 存放扩展配置（MCP servers、skills/clis state）。该文件支持通过 API 更新并触发 MCP 工具重载。

## How To Edit

### UI (Recommended)

通过前端设置页面编辑配置。典型入口包含：
- Models / Tools / Sandbox / Checkpointer / Title / Suggestions / Summarization / Subagents / Memory / Skills
- Advanced YAML: 直接编辑“Config Store 中存储的 YAML payload”

### API (Automation / Debug)

Gateway 暴露 Config Center API（用于 UI 与自动化工具）：
- `GET /api/config` 获取当前配置、版本号与存储路径
- `PUT /api/config` 提交更新（基于 version 的乐观锁）
- `POST /api/config/validate` 仅校验不保存
- `GET /api/config/runtime-status` 查看运行时加载版本与存储版本是否一致

## Storage Location & Env Vars

Config Store 的 `config.db` 路径解析优先级如下：
1. `NION_CONFIG_DB_PATH`（显式指定 config.db 路径）
2. `NION_HOME` + `/config.db`
3. 默认: `$HOME/.nion/config.db`

Extensions 配置文件路径解析优先级如下：
1. `NION_EXTENSIONS_CONFIG_PATH`
2. 当前目录或父目录下的 `extensions_config.json`（兼容 `mcp_config.json`）

常用环境变量（示例，不限于此）：
- `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `DEEPSEEK_API_KEY` 等模型密钥
- `TAVILY_API_KEY` 等工具密钥
- `NION_HOME` 运行时数据根目录（threads、checkpoints、config.db、security 状态等）
- `NION_CONFIG_DB_PATH` 指定 Config Store DB
- `NION_EXTENSIONS_CONFIG_PATH` 指定 extensions config 文件

## Config Payload (YAML Shape)

Config Store 中存储的是一个字典 payload。UI 的 “Advanced YAML” 会以 YAML 形式展示/编辑该 payload。下面仅展示常见字段形状（示例不代表完整 schema）：

### Models

```yaml
models:
  - name: gpt-4
    display_name: GPT-4
    use: langchain_openai:ChatOpenAI
    model: gpt-4
    api_key: $OPENAI_API_KEY
    max_tokens: 4096
    temperature: 0.7
```

### Tools / Tool Groups

```yaml
tool_groups:
  - name: web
  - name: file:read
  - name: file:write
  - name: bash

tools:
  - name: web_search
    group: web
    use: src.community.web_search.tools:web_search_tool
    provider: auto
    max_results: 5
```

### Sandbox

```yaml
sandbox:
  use: src.sandbox.local:LocalSandboxProvider
```

### Skills

```yaml
skills:
  path: ../skills
  container_path: /mnt/skills
```

### Title

```yaml
title:
  enabled: true
  max_words: 6
  max_chars: 60
  model_name: null
```

## Env Placeholder Resolution

Config payload 支持使用 `$ENV_VAR` 形式的占位符。运行时会解析为真实环境变量值。

注意:
- 如果某些占位符属于“当前运行路径必需”的字段且环境变量缺失，会被视为错误（阻止保存或启动）。
- 如果属于非必需路径，可能会以 warning 形式提示（允许保存）。

## Legacy YAML Import (config.yaml)

当 Config Store 尚未初始化时，Nion 可能会尝试从 `config.yaml` 导入/迁移配置到 SQLite；之后以 SQLite 为真源。

相关环境变量：
- `NION_CONFIG_PATH`：显式指定 legacy YAML 文件路径（仅用于导入/兜底）

最佳实践：
- 把 `config.example.yaml` 作为参考模板，不要把 `config.yaml` 当作日常运行时配置来源。
- 不要提交任何包含敏感信息的配置文件；密钥使用环境变量注入。
