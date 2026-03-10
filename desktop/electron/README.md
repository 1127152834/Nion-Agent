# Electron Desktop

## App Icons

桌面图标与网页品牌图统一来自 `frontend/public/images/nion-logo-v2.png`。

### 生成图标

在 `desktop/electron` 目录执行：

```bash
pnpm run icons:generate
```

该命令会生成并更新以下文件：

- `build/icon.png`
- `build/icon.ico`
- `build/icon.icns`
- `build/icons/app-icon.png`
- `build/icons/app.iconset/*`
- `build/icons/app-icon.icns`

### 打包

```bash
pnpm run dist
```

`dist` 会先自动执行 `icons:generate`，再继续 Electron 打包。

### 本地无签名出包（macOS）

如果只是本机验证图标、Dock、Finder 或安装包，不需要正式签名，建议执行：

```bash
pnpm run dist:unsigned
```

它会显式传入 `--config.mac.identity=null`，避开本机证书/临时签名导致的打包波动。

## macOS 图标缓存说明

如果仓库里的图标资源已经更新，但 Dock、Finder 或应用切换器里仍显示旧图标，通常是 macOS 图标缓存未刷新。验证时请优先：

1. 使用全新打包产物替换旧 `.app`
2. 退出 Dock 中旧应用实例
3. 必要时清理 Launch Services / Dock 图标缓存后重新登录或重启 Dock

不要只根据仓库中的静态图标文件判断最终桌面图标是否已生效。
