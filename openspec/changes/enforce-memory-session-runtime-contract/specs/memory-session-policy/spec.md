## ADDED Requirements

### Requirement: 后端必须统一解析线程记忆会话字段
后端运行时 MUST 统一解析 `session_mode`、`memory_read`、`memory_write`，并以单一策略结果驱动长期记忆读取与写入行为。

#### Scenario: 字段缺失时保持兼容默认值
- **WHEN** 线程状态和运行时上下文都没有提供 `session_mode`、`memory_read`、`memory_write`
- **THEN** 系统 MUST 将会话视为普通会话，并默认允许长期记忆读取和写入

#### Scenario: 状态字段优先于运行时上下文
- **WHEN** 线程状态与运行时上下文同时提供会话记忆字段且值不一致
- **THEN** 系统 MUST 以线程状态中的显式字段作为最终裁决来源

### Requirement: `temporary_chat` 必须默认可读不可写
当线程处于 `temporary_chat` 模式且没有显式覆盖字段时，系统 MUST 默认允许读取长期记忆，并禁止写入长期记忆。

#### Scenario: 临时会话默认读开写关
- **WHEN** 当前会话 `session_mode=temporary_chat` 且没有显式传入 `memory_read`、`memory_write`
- **THEN** 系统 MUST 允许长期记忆注入并禁止长期记忆写回

#### Scenario: 显式字段优先于临时会话默认值
- **WHEN** 当前会话 `session_mode=temporary_chat` 且显式传入 `memory_write=true`
- **THEN** 系统 MUST 以显式字段为准，并允许长期记忆写回

### Requirement: 禁读会话不得注入长期记忆
当最终策略判定 `memory_read=false` 时，系统 MUST 不向主智能体提示词注入任何长期记忆上下文。

#### Scenario: 显式禁读覆盖默认读行为
- **WHEN** 当前会话显式传入 `memory_read=false`
- **THEN** 系统 MUST 返回空的长期记忆注入内容，并且最终提示词中不得出现长期记忆块

### Requirement: 禁写会话不得触发长期记忆写回
当最终策略判定 `memory_write=false` 时，系统 MUST 在写回入口阻止长期记忆入队和落盘。

#### Scenario: 显式禁写阻止普通会话入队
- **WHEN** 当前普通会话显式传入 `memory_write=false`
- **THEN** 系统 MUST 跳过长期记忆入队逻辑，并且不得修改 `memory.json`

#### Scenario: 临时会话不得污染长期记忆
- **WHEN** 当前会话 `session_mode=temporary_chat` 且未显式覆盖写入开关
- **THEN** 系统 MUST 跳过长期记忆入队逻辑，并保持长期记忆文件不变

#### Scenario: 嵌入式客户端显式字段必须进入统一裁决
- **WHEN** `NionClient` 在 embedded 调用中显式传入 `session_mode`、`memory_read` 或 `memory_write`
- **THEN** 系统 MUST 将这些字段同时透传到 `config.configurable` 与运行时上下文，并让提示词注入与长期记忆写回共同遵守最终策略
