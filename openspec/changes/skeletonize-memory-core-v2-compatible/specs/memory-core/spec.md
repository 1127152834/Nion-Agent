## ADDED Requirements

### Requirement: 系统必须提供最小 Memory Core 骨架
系统 MUST 提供稳定的 `MemoryProvider`、`MemoryRuntime`、`MemoryRegistry` 抽象边界，供上层链路访问长期记忆能力，而不是继续直接依赖 V2 细节文件。

#### Scenario: 默认 provider 可被稳定解析
- **WHEN** 上层链路请求默认长期记忆 provider
- **THEN** 系统 MUST 返回一个可工作的默认 provider，并且该 provider 不依赖前端或外部配置界面

### Requirement: 默认 provider 必须兼容当前 V2 存储路线
系统 MUST 提供一个默认 `v2-compatible` provider，并通过兼容 runtime 继续使用当前 `memory.json` / `agents/{name}/memory.json` 路线。

#### Scenario: 默认 runtime 兼容读取现有 memory data
- **WHEN** 上层通过默认 provider 读取当前长期记忆
- **THEN** 系统 MUST 能兼容读取现有 memory data，并返回与当前接口兼容的数据结构

#### Scenario: 默认 runtime 兼容当前写回路径
- **WHEN** 上层通过默认 provider 发起长期记忆写回
- **THEN** 系统 MUST 继续通过当前兼容写回路径工作，而不得要求数据迁移或新存储格式

### Requirement: 读写链路必须通过 Memory Core 访问长期记忆
长期记忆注入、长期记忆写回和 memory 只读接口 MUST 开始通过 `Memory Core` 抽象访问长期记忆能力。

#### Scenario: Prompt 注入通过 provider 获取长期记忆
- **WHEN** 主智能体构建系统提示词并需要长期记忆上下文
- **THEN** 系统 MUST 通过默认 provider 获取注入内容，而不是直接依赖 V2 细节文件

#### Scenario: Memory write 通过 provider 发起兼容写回
- **WHEN** 中间件决定写入长期记忆
- **THEN** 系统 MUST 通过默认 provider 发起兼容写回，而不是直接依赖 `queue.py`

#### Scenario: Memory 只读接口通过 provider 读取数据
- **WHEN** Gateway 或 embedded client 请求长期记忆数据
- **THEN** 系统 MUST 通过默认 provider 读取 memory data，并保持当前响应格式兼容

### Requirement: Phase 1 会话读写策略必须在骨架化后继续生效
Phase 2 MUST 建立在 Phase 1 的 `session_mode`、`memory_read`、`memory_write` 契约之上，不能改变这些字段的语义。

#### Scenario: `memory_read=false` 仍禁止长期记忆注入
- **WHEN** 当前会话最终策略判定 `memory_read=false`
- **THEN** 默认 provider MUST 返回空注入内容，并且 prompt 中不得出现长期记忆块

#### Scenario: `memory_write=false` 仍禁止长期记忆写回
- **WHEN** 当前会话最终策略判定 `memory_write=false`
- **THEN** 默认 provider MUST 阻止长期记忆入队或写回，并保持当前长期记忆文件不变

#### Scenario: 嵌入式与调度入口继续遵守同一契约
- **WHEN** `NionClient` 或 scheduler workflow 通过默认 provider 访问长期记忆
- **THEN** 系统 MUST 继续遵守与 Web 聊天入口一致的 `session_mode` / `memory_read` / `memory_write` 语义
