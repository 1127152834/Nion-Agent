# 一念 Nion

一念之间，万事即达。你的专属 AI 智能助手，懂你所想，为你而行。  
耗费繁琐操作，只需一个念头，工作与生活，皆可轻松托付。

一念 Nion 是一个面向真实任务执行的 AI 智能体系统。它将多智能体编排、工具调用、沙箱执行、上下文存储（Context-Store）和可扩展技能整合在同一套运行时中，帮助你把“想法”快速落地为可执行结果。

---

## 核心能力

- 多智能体协作：主智能体可按任务拆解并调度子智能体并行执行
- 沙箱与文件系统：支持安全执行命令、读写文件、产物沉淀与回溯
- 技能系统：支持按需加载技能（SKILL）与工具扩展（含 MCP）
- 配置中心：运行时可视化配置，配置持久化到本地 SQLite
- 上传与产物链路：文件上传、解析、产物访问与下载能力完整闭环
- 上下文存储：支持 workspace/thread 级上下文沉淀与召回
- 临时会话保护：`temporary_chat` 默认允许读取长期记忆但禁止写回，避免污染长期记忆文件
- 嵌入式会话契约：`NionClient` 与 scheduler workflow 也支持 `session_mode` / `memory_read` / `memory_write`，与 Web 聊天入口保持一致

---

## 快速开始

### 1) 准备环境

- Node.js 22+
- pnpm
- uv
- nginx

可先运行：

```bash
make check
```

### 2) 初始化配置

```bash
cp .env.example .env
cp frontend/.env.example frontend/.env
```

运行时配置由应用内“配置中心”统一管理并持久化到 SQLite（默认路径 `backend/.nion/config.db`）。

可选（自定义数据库位置）：

```bash
export NION_CONFIG_DB_PATH=/path/to/config.db
```

### 3) 安装依赖

```bash
make install
```

### 4) 启动开发环境

```bash
make dev
```

启动后访问：

- 应用入口：`http://localhost:2026`
- Gateway API：`http://localhost:2026/api/*`
- LangGraph：`http://localhost:2026/api/langgraph/*`

### 5)（可选）清理旧 memory 历史数据

```bash
# 默认 dry-run，仅预览将被清理的路径
scripts/cleanup-legacy-memory-data.sh --app-data-dir ~/.localnion

# 确认后执行实际清理（不会触碰 openviking 数据）
scripts/cleanup-legacy-memory-data.sh --app-data-dir ~/.localnion --execute --yes
```

---

## Docker 开发模式

```bash
make docker-init
make docker-start
```

访问：`http://localhost:2026`

---

## 项目结构

```text
.
├── backend/        # FastAPI Gateway + LangGraph + 配置/沙箱/上下文存储能力
├── frontend/       # Next.js 前端工作台
├── docker/         # Nginx、开发容器与沙箱相关配置
├── scripts/        # 开发与运维脚本
├── skills/         # 内置与扩展技能目录
└── docs/           # 架构、接口与实施文档
```

---

## 桌面端路线

当前版本将以 Electron 作为桌面端优先路线，目标是实现“安装即用”的前后端一体桌面体验：

- 内置后端运行时
- 本地 SQLite 持久化
- 用户目录统一数据管理
- 沙箱与文件路径在桌面端可控、可诊断、可恢复

---

## v0.10 发布说明

`v0.10` 为项目基础版本，完成了核心骨架与关键能力闭环：

- 初始化前后端工程与统一开发流程
- 完成 AI 工作台基础界面与会话链路
- 落地配置中心（SQLite 持久化）
- 完成文件上传、产物访问、技能管理与工具调用基础能力
- 建立沙箱执行与线程级文件目录管理机制

---

## 许可证

本项目采用 [MIT License](./LICENSE)。
