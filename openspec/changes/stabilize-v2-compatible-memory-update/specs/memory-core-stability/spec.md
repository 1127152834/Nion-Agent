## ADDED Requirements

### Requirement: 兼容 updater 必须能接受常见非严格 JSON 输出
系统 MUST 为 `v2-compatible` 记忆更新路径提供稳健的解析回退链，以接受模型返回的常见非严格 JSON 输出，而不是仅依赖一次裸 `json.loads(...)`。

#### Scenario: 模型返回 fenced JSON
- **WHEN** 模型返回被 ```json / ``` 包裹的对象文本
- **THEN** 系统 MUST 去除 fence 后继续解析，并成功得到更新对象

#### Scenario: 模型返回带说明前后缀的对象文本
- **WHEN** 模型返回前面有解释语句、正文中含单个 JSON 对象的文本
- **THEN** 系统 MUST 提取首个完整对象块并继续解析

#### Scenario: 模型返回 YAML 或近似 JSON 对象
- **WHEN** 模型返回可被 YAML 解析为对象的近似 JSON 文本
- **THEN** 系统 MUST 在 JSON 解析失败后尝试兼容解析，并成功得到更新对象

### Requirement: 解析失败时系统必须保留已有长期记忆并输出可诊断日志
系统 MUST 在兼容解析彻底失败时保留已有长期记忆文件，并输出包含足够诊断信息的日志。

#### Scenario: 模型返回完全不可解析文本
- **WHEN** 模型返回无法被任何兼容解析路径识别的文本
- **THEN** 系统 MUST 不覆盖现有 `memory.json`
- **AND** 系统 MUST 输出可定位到 `thread_id`、模型名和响应片段的失败日志

### Requirement: 已保存的高置信 facts 必须能进入默认注入上下文
系统 MUST 在保持现有 summary 注入逻辑不变的前提下，为已持久化的高置信 facts 提供最小可感知注入能力。

#### Scenario: 用户显式陈述偏好并成功写入 facts
- **WHEN** 用户偏好已成功持久化为高置信 facts
- **THEN** 系统 MUST 在后续默认注入上下文中包含这些 facts 的最小摘要区块

### Requirement: Phase 1 的读写策略在热修后必须继续生效
本次热修 MUST 建立在 Phase 1 的 `session_mode`、`memory_read`、`memory_write` 契约之上，不改变其行为。

#### Scenario: `memory_read=false` 时 facts 不注入
- **WHEN** 会话最终策略为 `memory_read=false`
- **THEN** 系统 MUST 不注入 summary，也 MUST 不注入 facts

#### Scenario: `memory_write=false` 时不入队
- **WHEN** 会话最终策略为 `memory_write=false`
- **THEN** 系统 MUST 不触发长期记忆入队或写回

#### Scenario: `temporary_chat` 仍默认读开写关
- **WHEN** 会话为 `temporary_chat` 且没有显式覆盖字段
- **THEN** 系统 MUST 继续表现为 `memory_read=true` 且 `memory_write=false`
