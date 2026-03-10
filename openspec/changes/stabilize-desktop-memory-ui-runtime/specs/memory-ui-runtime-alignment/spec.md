## ADDED Requirements

### Requirement: 桌面端记忆设置页必须读取 `/api/memory`
桌面端当前记忆设置页 MUST 继续通过 `/api/memory` 读取长期记忆数据，而不是依赖未实现的 memory 扩展接口。

#### Scenario: 打开记忆设置页时读取当前记忆数据
- **WHEN** 用户在桌面工作区打开“设置 → 记忆”
- **THEN** 系统 MUST 调用 `/api/memory`
- **AND** 系统 MUST 能展示当前已有 summary 与 facts

### Requirement: 开发态 Electron 启动后不得静默暴露过期前端产物
开发态 Electron MUST 在启动前端前清理安全范围内的临时构建产物，并避免继续复用过期 bundle。

#### Scenario: 开发态启动前存在旧 dev 构建缓存
- **WHEN** Electron 以开发态启动且前端目录下存在 `.next/dev` 或 `.next/cache`
- **THEN** 系统 MUST 在启动前端前清理这些临时产物
- **AND** 系统 MUST 不触碰源码目录、用户数据或打包产物

### Requirement: 前端工作区主路由编译失败时启动流程必须显式失败
桌面端 MUST 在前端启动后验证主工作区真实落点是否可用，并在明显编译阻塞时显式失败，而不是继续提供旧页面行为。

#### Scenario: 工作区主路由不可用
- **WHEN** 前端启动后 `/workspace/chats/new` 返回 404 或 5xx
- **THEN** 系统 MUST 将桌面启动判定为失败

#### Scenario: 本次启动产生明显前端编译阻塞
- **WHEN** 本次启动新增的前端日志片段包含明显编译阻塞错误
- **THEN** 系统 MUST 将桌面启动判定为失败
- **AND** 系统 MUST 输出可诊断的错误提示

### Requirement: 热修后不得改变现有记忆读写策略
本次桌面运行时热修 MUST 不改变普通会话、`temporary_chat` 与显式 `memory_*` 的既有语义。

#### Scenario: 普通会话仍可读写长期记忆
- **WHEN** 用户在普通会话中进行长期记忆相关交互
- **THEN** 系统 MUST 继续允许长期记忆读取与写入

#### Scenario: `temporary_chat` 仍默认读开写关
- **WHEN** 当前会话 `session_mode=temporary_chat` 且没有显式覆盖字段
- **THEN** 系统 MUST 继续表现为 `memory_read=true` 且 `memory_write=false`
