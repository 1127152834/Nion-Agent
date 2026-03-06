import { app, BrowserWindow, ipcMain, shell } from "electron";
import path from "node:path";
import { resolveRuntimePaths, type DesktopRuntimePaths } from "./paths";
import { DesktopProcessManager, type DesktopRuntimePorts } from "./process-manager";

let mainWindow: BrowserWindow | null = null;
let runtimePaths: DesktopRuntimePaths | null = null;
let processManager: DesktopProcessManager | null = null;
let runtimePorts: DesktopRuntimePorts | null = null;
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
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    title: "Nion",
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

ipcMain.handle("desktop:open-external", async (_, url: string) => {
  await shell.openExternal(url);
});

ipcMain.handle("desktop:show-item-in-folder", async (_, fullPath: string) => {
  shell.showItemInFolder(fullPath);
});
