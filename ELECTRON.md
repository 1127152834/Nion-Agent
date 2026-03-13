# Electron 桌面端使用指南

本项目支持 Web 和 Electron 桌面端双模式运行。

## 快速开始

### 安装依赖

```bash
cd desktop/electron
pnpm install
```

### 启动 Electron 应用

```bash
pnpm run dev  # 开发模式
```

Electron 应用会自动：
- 启动 LangGraph 服务（端口 2024）
- 启动 Gateway API（端口 8001）
- 启动 Frontend（端口 3000）
- 打开应用窗口

其中业务 HTTP 链路固定为 `Renderer -> Gateway -> LangGraph`，不经过 Nginx；宿主文件系统、目录监听、外链打开等能力继续通过 IPC 暴露。

### 构建安装包

```bash
pnpm run dist  # 构建“完整离线包”（包含离线 runtime-core 资产，体积较大）

# 或构建“slim 包”（不包含离线 runtime-core 资产，首次启动需要联网下载并安装）
pnpm run dist:slim
```

> 说明：
> - 完整离线包用于内网/离线环境；slim 包用于对体积敏感、可联网初始化的场景。
> - macOS 的完整离线包必须按架构分别构建（arm64/x64），避免把某一架构的 Python native 依赖打进另一架构的安装包。

## 数据目录

Electron 和 Web 模式共享数据目录：`~/.nion`

可通过环境变量 `NION_HOME` 自定义：
```bash
NION_HOME=/custom/path pnpm run dev
```

## 日志

日志位置：`~/.nion/logs/desktop/`
- `langgraph.log` - LangGraph 服务日志
- `gateway.log` - Gateway API 日志
- `frontend.log` - Frontend 日志

## 验证安装

```bash
# 验证 Electron 模式
bash scripts/verify-electron.sh

# 验证 Web 模式
bash scripts/verify-web.sh
```

## 架构说明

### 核心组件

- **主进程** (`desktop/electron/src/main.ts`) - 窗口管理、生命周期
- **进程管理器** (`desktop/electron/src/process-manager.ts`) - 后端服务管理
- **预加载脚本** (`desktop/electron/src/preload.ts`) - IPC 通信桥接
- **前端平台适配** (`frontend/src/core/platform/`) - 环境检测和 API 适配

### 服务管理

Electron 自动管理以下服务：
1. LangGraph 服务 - AI 代理运行时
2. Gateway API - REST API 网关
3. Frontend - Next.js 前端

所有服务在应用启动时自动启动，关闭时自动停止。

开发态使用 `pnpm run dev` 启动前端；打包态改为启动随安装包分发的 standalone `server.js`，不再依赖本机 `pnpm` 或开发服务器。

### 环境检测

前端代码自动检测运行环境：
- Electron 模式：窗口加载 `http://localhost:3000`，业务 HTTP 统一访问 `http://localhost:8001`，LangGraph 通过 Gateway 门面 `/api/langgraph` 暴露
- Web 模式：可通过 `2026` 统一入口或 `3000 -> 8001` 直连开发，浏览器均应只感知 Gateway

## 高级功能

### 运行时打包

完整离线包会把运行时核心以单个压缩包形式内置到安装包中（`runtime/assets/runtime-core.tar.gz`），首次启动会解压到 `~/.nion/runtime/core` 并使用该运行时启动服务。

为避免把开发机运行时状态带进去，打包流程会在产物生成前进行清理（例如 `core/backend/.nion`、`core/backend/.langgraph_api` 等）。

如果你要为 slim 包准备可下载的运行时核心资产（runtime-core）：

```bash
cd desktop/runtime
./prepare-runtime-core.sh
./create-runtime-core-asset.sh
```

生成的资产名为 `nion-runtime-core-{platform}-{arch}-v{version}.tar.gz`（含 `core/` + `manifest.json`），用于桌面端首次启动下载并安装。

slim 包下载源默认从 GitHub Releases 获取（见 `desktop/electron/package.json` 的 `nionRuntimeDownload` 配置），优先按 tag `v{version}` 查找，找不到则回退 latest。

### 自动更新

配置 GitHub releases 自动更新（`desktop/electron/package.json`）：
```json
{
  "nionAutoUpdate": {
    "enabled": true,
    "owner": "your-org",
    "repo": "your-repo",
    "checkIntervalMinutes": 240
  }
}
```

### 启动诊断

启动指标记录在 `~/.nion/startup-metrics.json`，包含：
- 每个启动阶段的耗时
- 失败信息和错误分类
- 重试次数

## 开发调试

### 主进程调试
```bash
electron --inspect=5858 dist/main.js
```

### 渲染进程调试
开发模式自动打开 Chrome DevTools

### 查看日志
```bash
tail -f ~/.nion/logs/desktop/*.log
```

## 故障排除

### 端口冲突
确保端口 2024、8001、3000 未被占用：
```bash
lsof -i :2024 -i :8001 -i :3000
```

### 依赖缺失
确保已安装 uv 和 pnpm：
```bash
# 安装 uv
curl -LsSf https://astral.sh/uv/install.sh | sh

# 安装 pnpm
npm install -g pnpm
```

### 进程残留
检查并清理残留进程：
```bash
ps aux | grep -E "langgraph|uvicorn|next" | grep -v grep
```

## 与 Web 模式对比

| 特性 | Electron 模式 | Web 模式 |
|------|--------------|----------|
| 启动方式 | `pnpm run dev` | `make dev` |
| 服务管理 | 自动 | 手动 |
| 数据目录 | `~/.nion` | `~/.nion` |
| 端口 | 固定（2024/8001/3000） | 可配置 |
| 业务 HTTP 边界 | Gateway 统一门面 | Gateway 统一门面 |
| Nginx | 不使用 | 统一 Web 入口 |
| 分发方式 | 安装包 | Docker/本地部署 |

## 参考资料

- [计划文档](/.claude/plans/wondrous-plotting-zebra.md) - 完整的迁移计划
- [验证脚本](scripts/verify-electron.sh) - Electron 验证
- [验证脚本](scripts/verify-web.sh) - Web 验证
