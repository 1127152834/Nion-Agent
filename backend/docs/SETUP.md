# Setup Guide

面向本地开发与自托管环境的快速启动说明。

> Nion 的运行时配置以 **Config Store（SQLite）** 为真源，通过前端“配置中心”（或 `GET/PUT /api/config`）读写。不要把仓库内的 YAML 文件当作长期运行时配置入口。

## 1) 准备环境

推荐从仓库根目录按统一脚手架启动（见根目录 `README.md`）：

```bash
make check
make install
make dev
```

## 2) 设置密钥（环境变量）

模型与工具密钥通常通过环境变量注入，例如：

```bash
export OPENAI_API_KEY="your-key-here"
export ANTHROPIC_API_KEY="your-key-here"
```

## 3) 在配置中心完成运行时配置

1. 启动后打开 Web/Electron 工作台。
2. 进入“配置中心 / Settings”，完成 Models、Tools、Sandbox 等配置。
3. 如需自动化或调试，可使用 Config Center API：
   - `GET /api/config`
   - `PUT /api/config`
   - `POST /api/config/validate`
   - `GET /api/config/runtime-status`

Config Store 默认存储在：
- `$HOME/.nion/config.db`

可通过环境变量覆盖：
- `NION_CONFIG_DB_PATH=/path/to/config.db`
- `NION_HOME=/path/to/nion-home`（会使用 `/path/to/nion-home/config.db`）

## 4) 容器沙箱（可选）

如果启用容器沙箱（`sandbox.use` 指向 `AioSandboxProvider`），建议在首次使用前预拉取镜像以避免“首次执行卡住无反馈”的体验。具体见：
- `./APPLE_CONTAINER.md`

## See Also

- [Configuration Guide](./CONFIGURATION.md)
- [Architecture](./ARCHITECTURE.md)
