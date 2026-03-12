# 配置迁移计划：从 config.yaml 到页面配置

## 目标

将 config.yaml 的所有配置项迁移到页面配置系统，最终完全移除对 config.yaml 的依赖。

## 当前状态分析

### 当前项目（Nion-Agent）

**配置存储方式：**
- `config.yaml` - 主应用配置（模型、工具、沙箱等）
- `extensions_config.json` - 扩展配置（MCP 服务器、技能状态）

**已实现的页面配置：**
- ✅ 技能管理（启用/禁用、安装）
- ✅ 内存查看（只读）
- ✅ 工具管理

**未实现的页面配置：**
- ❌ 模型配置编辑（仅列表显示）
- ❌ MCP 服务器配置编辑（API 存在但无 UI）
- ❌ 沙箱配置编辑
- ❌ 工具配置编辑
- ❌ 内存配置编辑
- ❌ 总结配置编辑
- ❌ 标题生成配置编辑
- ❌ 子代理配置编辑
- ❌ 环境变量管理

### 旧项目（Nion_old）参考实现

**配置存储方式：**
- SQLite 数据库（`config.db`）- 主配置
- `extensions_config.json` - 扩展配置

**已实现的完整功能：**
- ✅ 模型配置（CRUD、连接测试、供应商模型列表）
- ✅ 工具配置
- ✅ 沙箱配置
- ✅ 内存配置
- ✅ 总结配置
- ✅ 标题生成配置
- ✅ 子代理配置
- ✅ 环境变量管理
- ✅ 配置验证
- ✅ 版本控制（乐观锁）

## 迁移策略

### 阶段 1：后端基础设施（第 1-2 天）

#### 1.1 配置存储层
- [ ] 创建 `backend/src/config/config_store.py`
  - 实现 SQLite 配置存储
  - 表结构：`app_config_state (id, version, config_json)`
  - 支持乐观锁（版本控制）
  - 迁移自：`Nion_old/backend/src/config/config_store.py`

- [ ] 创建 `backend/src/config/config_repository.py`
  - 实现配置读写接口
  - 配置验证逻辑
  - 环境变量解析
  - 迁移自：`Nion_old/backend/src/config/config_repository.py`

#### 1.2 配置 API 路由
- [ ] 扩展 `backend/src/gateway/routers/config.py`（新建）
  - `GET /api/config` - 读取完整配置
  - `GET /api/config/schema` - 获取配置 schema
  - `POST /api/config/validate` - 验证配置
  - `PUT /api/config` - 更新配置
  - 迁移自：`Nion_old/backend/src/gateway/routers/config.py`

- [ ] 扩展 `backend/src/gateway/routers/models.py`
  - `POST /api/models/test-connection` - 测试模型连接
  - `POST /api/models/provider-models` - 获取供应商模型列表
  - 迁移自：`Nion_old/backend/src/gateway/routers/models.py`

- [ ] 扩展 `backend/src/gateway/routers/mcp.py`
  - `POST /api/mcp/probe` - 探测 MCP 服务器
  - 迁移自：`Nion_old/backend/src/gateway/routers/mcp.py`

#### 1.3 配置迁移工具
- [ ] 创建 `backend/src/config/migration.py`
  - 从 config.yaml 迁移到 SQLite 的工具
  - 支持首次启动自动迁移
  - 支持手动迁移命令

### 阶段 2：前端配置中心（第 3-5 天）

#### 2.1 配置中心核心
- [ ] 创建 `frontend/src/core/config-center/`
  - `api.ts` - 配置 API 调用
  - `hooks.ts` - React hooks（useConfigCenter, useConfigEditor）
  - `types.ts` - TypeScript 类型定义
  - 迁移自：`Nion_old/frontend/src/core/config-center/`

#### 2.2 配置编辑器基础组件
- [ ] 创建 `frontend/src/components/workspace/settings/use-config-editor.ts`
  - 配置编辑状态管理
  - 脏检查（dirty checking）
  - 保存/丢弃逻辑
  - 迁移自：`Nion_old/frontend/src/components/workspace/settings/use-config-editor.ts`

- [ ] 创建 `frontend/src/components/workspace/settings/configuration/`
  - `config-save-bar.tsx` - 保存栏组件
  - `config-section.tsx` - 配置部分容器
  - `config-field.tsx` - 配置字段组件

#### 2.3 配置界面组件
- [ ] 创建 `frontend/src/components/workspace/settings/configuration/sections/`
  - `models-section.tsx` - 模型配置
  - `tools-section.tsx` - 工具配置
  - `sandbox-section.tsx` - 沙箱配置
  - `memory-section.tsx` - 内存配置
  - `summarization-section.tsx` - 总结配置
  - `title-section.tsx` - 标题生成配置
  - `subagents-section.tsx` - 子代理配置
  - `environment-variables-section.tsx` - 环境变量配置
  - 迁移自：`Nion_old/frontend/src/components/workspace/settings/configuration/sections/`

### 阶段 3：配置集成和测试（第 6-7 天）

#### 3.1 配置加载逻辑更新
- [ ] 更新 `backend/src/config/app_config.py`
  - 优先从 SQLite 加载配置
  - 如果 SQLite 不存在，从 config.yaml 加载并自动迁移
  - 保持向后兼容

#### 3.2 配置热重载
- [ ] 实现配置更新后的热重载机制
  - 更新 LangGraph Server 配置重载逻辑
  - 更新 Gateway API 配置重载逻辑
  - 清除相关缓存

#### 3.3 测试
- [ ] 单元测试
  - 配置存储测试
  - 配置验证测试
  - 配置迁移测试

- [ ] 集成测试
  - 配置读写流程测试
  - 配置热重载测试
  - 版本冲突测试

- [ ] E2E 测试
  - 前端配置编辑流程测试
  - 配置保存和加载测试

### 阶段 4：文档和清理（第 8 天）

#### 4.1 文档更新
- [ ] 更新 `README.md`
  - 移除 config.yaml 配置说明
  - 添加页面配置说明

- [ ] 更新 `backend/docs/CONFIGURATION.md`
  - 更新配置方式说明
  - 添加配置迁移指南

- [ ] 更新 `backend/CLAUDE.md`
  - 更新配置系统架构说明

#### 4.2 清理工作
- [ ] 标记 config.yaml 为可选
  - 添加弃用警告
  - 保留向后兼容性（可选）

- [ ] 清理示例文件
  - 更新 `config.example.yaml`（标记为已弃用）
  - 添加配置迁移说明

## 技术细节

### 配置存储结构

**SQLite 表结构：**
```sql
CREATE TABLE app_config_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    version INTEGER NOT NULL DEFAULT 1,
    config_json TEXT NOT NULL
);
```

**配置 JSON 结构：**
```yaml
models:
  - name: string
    display_name: string
    use: string
    model: string
    api_key: string
    max_tokens: int
    temperature: float
    supports_thinking: bool
    supports_vision: bool
    supports_reasoning_effort: bool
    when_thinking_enabled: dict

tools:
  - name: string
    group: string
    use: string
    [additional fields]

tool_groups:
  - name: string

sandbox:
  use: string
  [additional fields]

skills:
  path: string
  container_path: string

title:
  enabled: bool
  max_words: int
  max_chars: int
  model_name: string | null

summarization:
  enabled: bool
  model_name: string | null
  trigger: list
  keep: dict
  trim_tokens_to_summarize: int | null
  summary_prompt: string | null

memory:
  enabled: bool
  storage_path: string
  debounce_seconds: int
  model_name: string | null
  max_facts: int
  fact_confidence_threshold: float
  injection_enabled: bool
  max_injection_tokens: int

subagents:
  timeout_seconds: int
  agents: dict

runtime_env:
  [key: string]: string
```

### 配置验证

**验证流程：**
1. Pydantic 模型验证
2. 环境变量解析（`$VAR_NAME` 格式）
3. 运行时环境变量验证
4. 返回详细的验证错误列表

**验证错误格式：**
```typescript
{
  path: string[];
  message: string;
  type: string;
}
```

### 版本控制

**乐观锁机制：**
1. 读取配置时返回当前版本号
2. 更新配置时提交版本号
3. 如果版本号不匹配，返回冲突错误
4. 前端提示用户重新加载配置

### 环境变量支持

**解析规则：**
- 配置值中的 `$VAR_NAME` 会被解析为环境变量
- 支持嵌套解析
- 如果环境变量不存在，保持原值

**禁止的环境变量前缀：**
- `NEXT_PUBLIC_*` - 前端环境变量
- `BETTER_AUTH_*` - 认证相关环境变量

## 迁移路径

### 首次启动流程

```
1. 检查 SQLite 数据库是否存在
   ↓ 不存在
2. 检查 config.yaml 是否存在
   ↓ 存在
3. 从 config.yaml 加载配置
   ↓
4. 验证配置
   ↓
5. 保存到 SQLite 数据库
   ↓
6. 标记迁移完成
```

### 配置更新流程

```
前端编辑配置
  ↓
PUT /api/config (带版本号)
  ↓
后端验证配置
  ↓
检查版本冲突
  ↓
保存到 SQLite
  ↓
触发配置重载
  ↓
返回新版本号
```

## 风险和注意事项

### 风险

1. **配置迁移失败**
   - 缓解：提供详细的错误信息和回滚机制
   - 保留 config.yaml 作为备份

2. **版本冲突**
   - 缓解：使用乐观锁机制
   - 提示用户重新加载配置

3. **配置验证失败**
   - 缓解：提供详细的验证错误信息
   - 支持部分保存（如果可能）

4. **热重载失败**
   - 缓解：提供手动重启选项
   - 记录详细的错误日志

### 注意事项

1. **向后兼容性**
   - 保留对 config.yaml 的支持（可选）
   - 提供迁移工具和文档

2. **数据安全**
   - 敏感信息（API 密钥）使用环境变量
   - 不在前端显示完整的 API 密钥

3. **性能**
   - 配置缓存机制
   - 避免频繁的数据库读写

4. **用户体验**
   - 提供清晰的配置界面
   - 实时验证和错误提示
   - 保存前确认

## 成功标准

1. ✅ 所有 config.yaml 配置项都可以在页面中编辑
2. ✅ 配置更新后立即生效（热重载）
3. ✅ 配置验证完整且准确
4. ✅ 支持版本控制和冲突检测
5. ✅ 提供配置迁移工具和文档
6. ✅ 所有测试通过
7. ✅ 文档更新完整

## 时间估算

- 阶段 1：后端基础设施 - 2 天
- 阶段 2：前端配置中心 - 3 天
- 阶段 3：配置集成和测试 - 2 天
- 阶段 4：文档和清理 - 1 天

**总计：8 天**

## 下一步行动

1. 创建功能分支：`feature/config-migration`
2. 开始阶段 1：后端基础设施
3. 逐步实现各个阶段
4. 持续测试和验证
5. 完成后合并到主分支
