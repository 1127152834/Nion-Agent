import { app, BrowserWindow, ipcMain, shell } from "electron";
import path from "node:path";
import { resolveRuntimePaths, type DesktopRuntimePaths } from "./paths";
import { DesktopProcessManager, type DesktopRuntimePorts } from "./process-manager";
import { RuntimeOptionalComponentsManager } from "./runtime-manager";

let mainWindow: BrowserWindow | null = null;
let runtimePaths: DesktopRuntimePaths | null = null;
let processManager: DesktopProcessManager | null = null;
let runtimePorts: DesktopRuntimePorts | null = null;
let runtimeManager: RuntimeOptionalComponentsManager | null = null;
let startupInProgress = false;
let isShuttingDown = false;

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
    runtimePaths = resolveRuntimePaths();
    runtimeManager = new RuntimeOptionalComponentsManager(runtimePaths);
    runtimePorts = await startupRuntime();
    createMainWindow();
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
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});

app.on("before-quit", async (event) => {
  if (isShuttingDown) return;

  event.preventDefault();
  isShuttingDown = true;

  try {
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

function createMainWindow(): void {
  const isMac = process.platform === "darwin";
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    title: "Nion",
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

  const proxyPort = runtimePorts?.proxyPort ?? 2026;

  // 始终走同源代理入口，避免跨域问题
  mainWindow.loadURL(`http://localhost:${proxyPort}`);

  // 开发模式打开 DevTools
  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools();
  }

  // 处理外部链接
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
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
  if (!runtimeManager) {
    throw new Error("Runtime manager is not initialized");
  }
  return runtimeManager.getStatus();
});

ipcMain.handle("desktop:download-runtime-component", async (_, componentName: string) => {
  if (!runtimeManager) {
    throw new Error("Runtime manager is not initialized");
  }

  return runtimeManager.downloadOptionalComponent(componentName, (progress) => {
    mainWindow?.webContents.send("runtime:download-progress", progress);
  });
});

ipcMain.handle("desktop:retry-runtime-component", async (_, componentName: string) => {
  if (!runtimeManager) {
    throw new Error("Runtime manager is not initialized");
  }

  return runtimeManager.retryOptionalComponent(componentName, (progress) => {
    mainWindow?.webContents.send("runtime:download-progress", progress);
  });
});

ipcMain.handle("desktop:complete-runtime-onboarding", () => {
  if (!runtimeManager) {
    throw new Error("Runtime manager is not initialized");
  }
  return runtimeManager.markOnboardingCompleted();
});

ipcMain.handle("desktop:skip-runtime-component", (_, componentName: string) => {
  if (!runtimeManager) {
    throw new Error("Runtime manager is not initialized");
  }
  return runtimeManager.markComponentSkipped(componentName);
});

ipcMain.handle("desktop:open-external", async (_, url: string) => {
  await shell.openExternal(url);
});

ipcMain.handle("desktop:show-item-in-folder", async (_, fullPath: string) => {
  shell.showItemInFolder(fullPath);
});
