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
    runtimePorts = await startupRuntime();
    ensureMainWindow();
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
      }
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

    if (mainWindow && !mainWindow.isDestroyed()) {
      await mainWindow.loadURL(`http://localhost:${ports.frontendPort}`);
    }

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

    const frontendPort = runtimePorts?.frontendPort ?? 3000;

    // 加载前端应用
    mainWindow.loadURL(`http://localhost:${frontendPort}`);

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
