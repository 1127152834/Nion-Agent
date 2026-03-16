import { app, BrowserWindow, dialog, ipcMain, nativeImage, shell } from "electron";
import type { OpenDialogOptions } from "electron";
import { existsSync, promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { resolveRuntimePaths, type DesktopRuntimePaths } from "./paths";
import { WorkspaceDirectoryWatcher } from "./workspace-directory-watcher";
import { DesktopProcessManager, type DesktopRuntimePorts } from "./process-manager";
import {
  RuntimeOptionalComponentsManager,
  type RuntimeDownloadProgress,
} from "./runtime-manager";
import {
  readDesktopRuntimePortsConfig,
  writeDesktopRuntimePortsConfig,
  type DesktopRuntimePortsConfig,
} from "./runtime-ports-config";
import { renderStartupLoadingHtml } from "./startup-screen";

let mainWindow: BrowserWindow | null = null;
let runtimePaths: DesktopRuntimePaths | null = null;
let processManager: DesktopProcessManager | null = null;
let runtimePorts: DesktopRuntimePorts | null = null;
let runtimeOptionalComponentsManager: RuntimeOptionalComponentsManager | null = null;
let startupInProgress = false;
let isShuttingDown = false;
let creatingMainWindow = false;
let runtimeRestartInProgress = false;
const workspaceWatchers = new Map<string, { watcher: WorkspaceDirectoryWatcher; senderId: number }>();

// 单实例锁
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

app.on("ready", async () => {
  try {
    applyAppIcon();
    runtimePaths = resolveRuntimePaths();
    runtimeOptionalComponentsManager = new RuntimeOptionalComponentsManager(runtimePaths);
    ensureMainWindow();

    const status = runtimeOptionalComponentsManager.getStatus();
    if (app.isPackaged && !status.coreReady) {
      await loadRuntimeBootstrap();
      return;
    }

    runtimePorts = await startupRuntime();
    // 导航已由 onFrontendHttpReady 回调提前完成，此处无需重复调用
  } catch (error) {
    console.error("Startup failed:", error);
    app.quit();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  applyAppIcon();
  ensureMainWindow();
  void loadMainWindowFrontend();
});

app.on("before-quit", async (event) => {
  if (isShuttingDown) return;

  event.preventDefault();
  isShuttingDown = true;

  try {
    await Promise.all([...workspaceWatchers.keys()].map((watchId) => stopWorkspaceWatcher(watchId)));
    if (processManager) {
      await processManager.shutdown();
    }
  } catch (error) {
    console.error("Shutdown error:", error);
  } finally {
    app.exit(0);
  }
});

async function startupRuntime(): Promise<DesktopRuntimePorts> {
  if (startupInProgress || !runtimePaths) {
    throw new Error("Startup already in progress or paths not initialized");
  }

  startupInProgress = true;

  try {
    processManager = new DesktopProcessManager(runtimePaths, {
      onStageStart: (stage) => {
        console.log(`[Startup] ${stage} started`);
        mainWindow?.webContents.send("startup:stage", { stage, status: "started" });
      },
      onStageSuccess: (stage) => {
        console.log(`[Startup] ${stage} succeeded`);
        mainWindow?.webContents.send("startup:stage", { stage, status: "success" });
      },
      onStageFailure: (stage, error) => {
        console.error(`[Startup] ${stage} failed:`, error);
        mainWindow?.webContents.send("startup:stage", { stage, status: "failed", error: String(error) });
      },
      onFrontendHttpReady: (ports) => {
        // 前端 HTTP 已就绪，立即导航（无需等待 workspace 健康检查）
        runtimePorts = ports;
        void loadMainWindowFrontend();
      },
    });

    const ports = await processManager.startup();
    console.log("[Startup] All services started:", ports);

    return ports;
  } finally {
    startupInProgress = false;
  }
}

function ensureRuntimePathsInitialized(): DesktopRuntimePaths {
  if (!runtimePaths) {
    throw new Error("Runtime paths not initialized");
  }
  return runtimePaths;
}

function readConfiguredRuntimePorts(): DesktopRuntimePortsConfig {
  const paths = ensureRuntimePathsInitialized();
  return readDesktopRuntimePortsConfig(paths);
}

async function restartRuntime(): Promise<DesktopRuntimePorts> {
  ensureRuntimePathsInitialized();
  if (startupInProgress) {
    throw new Error("Runtime startup is in progress");
  }
  if (runtimeRestartInProgress) {
    throw new Error("Runtime restart is already in progress");
  }

  runtimeRestartInProgress = true;
  try {
    if (processManager) {
      await processManager.shutdown();
      processManager = null;
    }

    const ports = await startupRuntime();
    runtimePorts = ports;

    await loadMainWindowFrontend();

    return ports;
  } finally {
    runtimeRestartInProgress = false;
  }
}

async function stopWorkspaceWatcher(watchId: string): Promise<boolean> {
  const existing = workspaceWatchers.get(watchId);
  if (!existing) {
    return false;
  }
  workspaceWatchers.delete(watchId);
  await existing.watcher.close();
  return true;
}

async function stopWorkspaceWatchersForSender(senderId: number): Promise<void> {
  const watchIds = [...workspaceWatchers.entries()]
    .filter(([, value]) => value.senderId === senderId)
    .map(([watchId]) => watchId);
  await Promise.all(watchIds.map((watchId) => stopWorkspaceWatcher(watchId)));
}

function resolveAppIconPngPath(): string | null {
  const candidates = [
    path.resolve(__dirname, "..", "build", "icons", "app-icon.png"),
    path.resolve(__dirname, "..", "..", "build", "icons", "app-icon.png"),
    path.join(process.resourcesPath, "build", "icons", "app-icon.png"),
  ];

  for (const iconPath of candidates) {
    if (existsSync(iconPath)) {
      return iconPath;
    }
  }

  return null;
}

function applyAppIcon(): void {
  const iconPath = resolveAppIconPngPath();
  if (!iconPath) {
    return;
  }

  const iconImage = nativeImage.createFromPath(iconPath);
  if (iconImage.isEmpty()) {
    return;
  }

  if (process.platform === "darwin" && app.dock) {
    app.dock.setIcon(iconImage);
  }
}

function createMainWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return;
  }

  if (creatingMainWindow) {
    return;
  }

  creatingMainWindow = true;
  const isMac = process.platform === "darwin";
  const iconPath = resolveAppIconPngPath();

  try {
    mainWindow = new BrowserWindow({
      width: 1400,
      height: 900,
      minWidth: 1000,
      minHeight: 600,
      title: "Nion",
      ...(iconPath && !isMac ? { icon: iconPath } : {}),
      ...(isMac
        ? {
            titleBarStyle: "hiddenInset" as const
          }
        : {}),
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    });

    if (runtimePorts) {
      // 运行时已就绪时直接加载前端应用。
      void mainWindow.loadURL(`http://localhost:${runtimePorts.frontendPort}`);
    } else {
      // 运行时尚未就绪时显示启动进度界面。
      void mainWindow.loadURL(
        `data:text/html;charset=utf-8,${encodeURIComponent(renderStartupLoadingHtml())}`
      );
    }

    // 开发模式打开 DevTools
    if (!app.isPackaged) {
      mainWindow.webContents.openDevTools();
    }

    // 处理外部链接
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url);
      return { action: "deny" };
    });

    const senderId = mainWindow.webContents.id;
    mainWindow.webContents.on("destroyed", () => {
      void stopWorkspaceWatchersForSender(senderId);
    });

    mainWindow.on("closed", () => {
      mainWindow = null;
    });
  } finally {
    creatingMainWindow = false;
  }
}

function ensureMainWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return;
  }
  createMainWindow();
}

function renderRuntimeBootstrapHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1, viewport-fit=cover"
    />
    <title>Nion 初始化运行时</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #0b1020;
        --card: rgba(255, 255, 255, 0.08);
        --stroke: rgba(255, 255, 255, 0.16);
        --text: rgba(255, 255, 255, 0.92);
        --muted: rgba(255, 255, 255, 0.72);
        --danger: #ff5a70;
        --accent: #7ae1ff;
        --accent2: #6dffb1;
      }

      html,
      body {
        height: 100%;
        margin: 0;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
          "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
        background: radial-gradient(1200px 700px at 20% 10%, rgba(122, 225, 255, 0.25), transparent 60%),
          radial-gradient(900px 600px at 80% 20%, rgba(109, 255, 177, 0.18), transparent 55%),
          radial-gradient(800px 500px at 40% 90%, rgba(255, 90, 112, 0.12), transparent 60%),
          var(--bg);
        color: var(--text);
      }

      .wrap {
        height: 100%;
        display: grid;
        place-items: center;
        padding: 28px 18px;
        box-sizing: border-box;
      }

      .card {
        width: min(840px, 100%);
        border: 1px solid var(--stroke);
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.10), rgba(255, 255, 255, 0.06));
        backdrop-filter: blur(12px);
        border-radius: 18px;
        padding: 22px 22px 18px;
        box-shadow: 0 22px 70px rgba(0, 0, 0, 0.35);
      }

      h1 {
        margin: 0 0 10px;
        font-weight: 800;
        letter-spacing: 0.2px;
        font-size: 22px;
      }

      p {
        margin: 0 0 14px;
        color: var(--muted);
        line-height: 1.55;
        font-size: 13px;
      }

      .row {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 12px;
        align-items: center;
        margin-top: 16px;
      }

      .meta {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px 14px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 12px;
        padding: 12px;
        background: rgba(0, 0, 0, 0.14);
      }

      .k {
        color: rgba(255, 255, 255, 0.58);
        font-size: 11px;
      }

      .v {
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
        font-size: 12px;
      }

      button {
        appearance: none;
        border: 1px solid rgba(255, 255, 255, 0.18);
        background: linear-gradient(180deg, rgba(122, 225, 255, 0.20), rgba(109, 255, 177, 0.18));
        color: var(--text);
        border-radius: 12px;
        padding: 10px 14px;
        font-weight: 700;
        cursor: pointer;
        min-width: 180px;
      }

      button[disabled] {
        opacity: 0.55;
        cursor: not-allowed;
      }

      .progress {
        margin-top: 12px;
        border-radius: 999px;
        height: 10px;
        background: rgba(255, 255, 255, 0.10);
        overflow: hidden;
        border: 1px solid rgba(255, 255, 255, 0.12);
      }

      .bar {
        height: 100%;
        width: 0%;
        background: linear-gradient(90deg, rgba(122, 225, 255, 0.9), rgba(109, 255, 177, 0.9));
      }

      .hint {
        margin-top: 10px;
        font-size: 12px;
        color: rgba(255, 255, 255, 0.72);
      }

      .err {
        margin-top: 10px;
        font-size: 12px;
        color: var(--danger);
        white-space: pre-wrap;
      }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="card">
        <h1>需要初始化运行时</h1>
        <p>
          当前安装包未内置运行时核心（Python + 后端 + 前端），需要下载并安装后才能启动。
          若你处于内网或无法访问外网环境，请使用完整离线包。
        </p>

        <div class="meta">
          <div>
            <div class="k">版本</div>
            <div class="v" id="ver">-</div>
          </div>
          <div>
            <div class="k">平台/架构</div>
            <div class="v" id="plat">-</div>
          </div>
          <div>
            <div class="k">运行时状态</div>
            <div class="v" id="status">-</div>
          </div>
          <div>
            <div class="k">下载进度</div>
            <div class="v" id="pct">-</div>
          </div>
        </div>

        <div class="row">
          <div>
            <div class="progress" aria-label="download progress">
              <div class="bar" id="bar"></div>
            </div>
            <div class="hint" id="hint">准备就绪</div>
            <div class="err" id="err"></div>
          </div>
          <button id="btn">安装并启动</button>
        </div>
      </div>
    </div>

    <script>
      const $ = (id) => document.getElementById(id);
      const btn = $("btn");
      const err = $("err");
      const bar = $("bar");
      const pct = $("pct");
      const hint = $("hint");

      function setBusy(busy) {
        btn.disabled = busy;
        btn.textContent = busy ? "安装中..." : "安装并启动";
      }

      function setProgress(progress) {
        const value = Math.max(0, Math.min(1, Number(progress) || 0));
        bar.style.width = String(Math.round(value * 100)) + "%";
        pct.textContent = String(Math.round(value * 100)) + "%";
      }

      async function refreshStatus() {
        const version = await window.electronAPI.getAppVersion();
        const platform = await window.electronAPI.getPlatform();
        $("ver").textContent = version;
        $("plat").textContent = platform.platform + "/" + platform.arch;
        const status = await window.electronAPI.getRuntimeStatus();
        $("status").textContent = status.coreReady ? "coreReady" : "missing";
      }

      window.electronAPI.onRuntimeDownloadProgress((data) => {
        if (!data || data.name !== "runtime-core") return;
        setProgress(data.progress);
        const received = (data.receivedBytes || 0) / 1024 / 1024;
        const total = (data.totalBytes || 0) / 1024 / 1024;
        hint.textContent = total > 0
          ? ("已下载 " + received.toFixed(1) + "MB / " + total.toFixed(1) + "MB")
          : ("已下载 " + received.toFixed(1) + "MB");
      });

      btn.addEventListener("click", async () => {
        err.textContent = "";
        setBusy(true);
        hint.textContent = "开始安装运行时...";
        setProgress(0);

        try {
          await window.electronAPI.installRuntimeCore();
        } catch (e) {
          err.textContent = String(e && e.message ? e.message : e);
          hint.textContent = "安装失败";
          setBusy(false);
        }
      });

      refreshStatus().catch((e) => {
        err.textContent = String(e && e.message ? e.message : e);
      });
    </script>
  </body>
</html>`;
}

async function loadRuntimeBootstrap(): Promise<void> {
  ensureMainWindow();
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  const html = renderRuntimeBootstrapHtml();
  await mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

async function loadMainWindowFrontend(): Promise<void> {
  if (!runtimePorts || !mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  const frontendOrigin = `http://localhost:${runtimePorts.frontendPort}`;
  const currentUrl = mainWindow.webContents.getURL();

  // App activate is triggered when switching back to Nion on macOS.
  // If we're already on the same frontend origin, keep current route and avoid reloading.
  let targetUrl = frontendOrigin;
  if (currentUrl) {
    try {
      const current = new URL(currentUrl);
      if (current.origin === frontendOrigin) {
        return;
      }
      if (
        (current.protocol === "http:" || current.protocol === "https:")
        && (current.pathname !== "/" || current.search.length > 0 || current.hash.length > 0)
      ) {
        targetUrl = `${frontendOrigin}${current.pathname}${current.search}${current.hash}`;
      }
    } catch {
      if (currentUrl === frontendOrigin) {
        return;
      }
    }
  }

  try {
    await mainWindow.loadURL(targetUrl);
  } catch (error) {
    console.error(`[Runtime] Failed to load frontend URL ${targetUrl}:`, error);
  }
}

function getRuntimeOptionalManager(): RuntimeOptionalComponentsManager {
  if (!runtimePaths) {
    throw new Error("Runtime paths not initialized");
  }
  if (!runtimeOptionalComponentsManager) {
    runtimeOptionalComponentsManager = new RuntimeOptionalComponentsManager(runtimePaths);
  }
  return runtimeOptionalComponentsManager;
}

function emitRuntimeDownloadProgress(progress: RuntimeDownloadProgress): void {
  mainWindow?.webContents.send("runtime:download-progress", progress);
}

// IPC 处理程序
ipcMain.handle("desktop:get-app-version", () => {
  return app.getVersion();
});

ipcMain.handle("desktop:get-platform", () => {
  return {
    platform: process.platform,
    arch: process.arch,
    isPackaged: app.isPackaged
  };
});

ipcMain.handle("desktop:get-paths", () => {
  return runtimePaths;
});

ipcMain.handle("desktop:get-runtime-status", () => {
  return getRuntimeOptionalManager().getStatus();
});

ipcMain.handle("desktop:install-runtime-core", async () => {
  const manager = getRuntimeOptionalManager();
  const current = manager.getStatus();
  if (!current.coreReady) {
    await manager.downloadCoreBundle(emitRuntimeDownloadProgress);
  }

  runtimePaths = resolveRuntimePaths();
  runtimeOptionalComponentsManager = new RuntimeOptionalComponentsManager(ensureRuntimePathsInitialized());

  runtimePorts = await startupRuntime();
  await loadMainWindowFrontend();

  return getRuntimeOptionalManager().getStatus();
});

ipcMain.handle("desktop:get-runtime-ports", () => {
  const configured = readConfiguredRuntimePorts();
  return {
    ...configured,
    active: runtimePorts,
  };
});

ipcMain.handle(
  "desktop:update-runtime-ports",
  async (_, payload: Partial<DesktopRuntimePorts>) => {
    const previous = readConfiguredRuntimePorts();
    const updated = writeDesktopRuntimePortsConfig(ensureRuntimePathsInitialized(), payload);

    try {
      const active = await restartRuntime();
      return {
        ...updated,
        active,
      };
    } catch (error) {
      console.error("[Runtime] Failed to restart after runtime port update:", error);
      try {
        writeDesktopRuntimePortsConfig(ensureRuntimePathsInitialized(), previous.ports);
        await restartRuntime();
      } catch (rollbackError) {
        console.error("[Runtime] Failed to rollback runtime ports:", rollbackError);
      }
      throw error;
    }
  },
);

ipcMain.handle("desktop:download-runtime-component", async (_, componentName: string) => {
  return getRuntimeOptionalManager().downloadOptionalComponent(
    componentName,
    emitRuntimeDownloadProgress,
  );
});

ipcMain.handle("desktop:retry-runtime-component", async (_, componentName: string) => {
  return getRuntimeOptionalManager().retryOptionalComponent(
    componentName,
    emitRuntimeDownloadProgress,
  );
});

ipcMain.handle("desktop:complete-runtime-onboarding", () => {
  return getRuntimeOptionalManager().markOnboardingCompleted();
});

ipcMain.handle("desktop:skip-runtime-component", (_, componentName: string) => {
  return getRuntimeOptionalManager().markComponentSkipped(componentName);
});

ipcMain.handle("desktop:open-external", async (_, url: string) => {
  await shell.openExternal(url);
});

ipcMain.handle("desktop:show-item-in-folder", async (_, fullPath: string) => {
  shell.showItemInFolder(fullPath);
});

ipcMain.handle(
  "desktop:host-fs:pick",
  async (_, options?: { title?: string; defaultPath?: string; kind?: "file" | "directory" }) => {
    const kind = options?.kind === "directory" ? "directory" : "file";
    const properties: OpenDialogOptions["properties"] = kind === "directory" ? ["openDirectory"] : ["openFile"];
    const dialogOptions: OpenDialogOptions = {
      title: options?.title ?? (kind === "directory" ? "选择目录" : "选择要导入的文件"),
      defaultPath: options?.defaultPath,
      properties,
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true, path: null };
    }
    return { canceled: false, path: result.filePaths[0] };
  },
);

ipcMain.handle(
  "desktop:host-fs:read",
  async (
    _,
    payload: { path: string; encoding?: BufferEncoding },
  ) => {
    const targetPath = payload?.path;
    if (!targetPath || typeof targetPath !== "string") {
      throw new Error("Invalid path");
    }
    const encoding = (payload.encoding ?? "utf-8") as BufferEncoding;
    const content = await fs.readFile(targetPath, { encoding });
    const stat = await fs.stat(targetPath);
    return {
      path: targetPath,
      content,
      size: stat.size,
      encoding,
    };
  },
);

ipcMain.handle(
  "desktop:host-fs:write",
  async (
    _,
    payload: { path: string; content: string; append?: boolean; encoding?: BufferEncoding },
  ) => {
    const targetPath = payload?.path;
    if (!targetPath || typeof targetPath !== "string") {
      throw new Error("Invalid path");
    }
    if (typeof payload.content !== "string") {
      throw new Error("Invalid content");
    }
    const append = Boolean(payload.append);
    const encoding = (payload.encoding ?? "utf-8") as BufferEncoding;
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    if (append) {
      await fs.appendFile(targetPath, payload.content, { encoding });
    } else {
      await fs.writeFile(targetPath, payload.content, { encoding });
    }
    const stat = await fs.stat(targetPath);
    return {
      path: targetPath,
      size: stat.size,
      append,
      encoding,
    };
  },
);

ipcMain.handle(
  "desktop:host-fs:watch-start",
  async (event, payload: { path: string }) => {
    const targetPath = payload?.path;
    if (!targetPath || typeof targetPath !== "string") {
      throw new Error("Invalid watch path");
    }

    const resolvedPath = path.resolve(targetPath);
    const stat = await fs.stat(resolvedPath);
    if (!stat.isDirectory()) {
      throw new Error(`Watch path is not a directory: ${resolvedPath}`);
    }

    const watchId = randomUUID();
    const watcher = new WorkspaceDirectoryWatcher({
      rootPath: resolvedPath,
      onChange(change) {
        if (event.sender.isDestroyed()) {
          return;
        }
        event.sender.send("desktop:host-fs:watch:event", {
          watchId,
          ...change,
        });
      },
    });

    await watcher.start();
    workspaceWatchers.set(watchId, {
      watcher,
      senderId: event.sender.id,
    });

    return { watchId };
  },
);

ipcMain.handle(
  "desktop:host-fs:watch-stop",
  async (event, payload: { watchId: string }) => {
    const watchId = payload?.watchId;
    if (!watchId || typeof watchId !== "string") {
      throw new Error("Invalid watch id");
    }

    const existing = workspaceWatchers.get(watchId);
    if (!existing || existing.senderId !== event.sender.id) {
      return { stopped: false };
    }

    await stopWorkspaceWatcher(watchId);
    return { stopped: true };
  },
);

ipcMain.handle(
  "desktop:host-app:invoke",
  async (
    _,
    payload: { action: "open-external" | "show-item-in-folder" | "open-path"; target: string },
  ) => {
    if (!payload || typeof payload.target !== "string") {
      throw new Error("Invalid invoke payload");
    }
    if (payload.action === "open-external") {
      await shell.openExternal(payload.target);
      return { success: true };
    }
    if (payload.action === "show-item-in-folder") {
      shell.showItemInFolder(payload.target);
      return { success: true };
    }
    if (payload.action === "open-path") {
      const errorMessage = await shell.openPath(payload.target);
      if (errorMessage) {
        throw new Error(errorMessage);
      }
      return { success: true };
    }
    throw new Error(`Unsupported host app action: ${String((payload as { action?: string }).action)}`);
  },
);
