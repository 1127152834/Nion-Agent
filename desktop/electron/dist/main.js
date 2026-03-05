"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const node_path_1 = __importDefault(require("node:path"));
const paths_1 = require("./paths");
const process_manager_1 = require("./process-manager");
let mainWindow = null;
let runtimePaths = null;
let processManager = null;
let startupInProgress = false;
let isShuttingDown = false;
// 单实例锁
const gotTheLock = electron_1.app.requestSingleInstanceLock();
if (!gotTheLock) {
    electron_1.app.quit();
}
else {
    electron_1.app.on("second-instance", () => {
        if (mainWindow) {
            if (mainWindow.isMinimized())
                mainWindow.restore();
            mainWindow.focus();
        }
    });
}
electron_1.app.on("ready", async () => {
    try {
        runtimePaths = (0, paths_1.resolveRuntimePaths)();
        await startupRuntime();
        createMainWindow();
    }
    catch (error) {
        console.error("Startup failed:", error);
        electron_1.app.quit();
    }
});
electron_1.app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        electron_1.app.quit();
    }
});
electron_1.app.on("activate", () => {
    if (electron_1.BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
    }
});
electron_1.app.on("before-quit", async (event) => {
    if (isShuttingDown)
        return;
    event.preventDefault();
    isShuttingDown = true;
    try {
        if (processManager) {
            await processManager.shutdown();
        }
    }
    catch (error) {
        console.error("Shutdown error:", error);
    }
    finally {
        electron_1.app.exit(0);
    }
});
async function startupRuntime() {
    if (startupInProgress || !runtimePaths) {
        throw new Error("Startup already in progress or paths not initialized");
    }
    startupInProgress = true;
    try {
        processManager = new process_manager_1.DesktopProcessManager(runtimePaths, {
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
    }
    finally {
        startupInProgress = false;
    }
}
function createMainWindow() {
    mainWindow = new electron_1.BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 1000,
        minHeight: 600,
        title: "Nion",
        webPreferences: {
            preload: node_path_1.default.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false
        }
    });
    // 加载前端应用
    mainWindow.loadURL("http://localhost:3000");
    // 开发模式打开 DevTools
    if (!electron_1.app.isPackaged) {
        mainWindow.webContents.openDevTools();
    }
    // 处理外部链接
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        electron_1.shell.openExternal(url);
        return { action: "deny" };
    });
    mainWindow.on("closed", () => {
        mainWindow = null;
    });
}
// IPC 处理程序
electron_1.ipcMain.handle("desktop:get-app-version", () => {
    return electron_1.app.getVersion();
});
electron_1.ipcMain.handle("desktop:get-platform", () => {
    return {
        platform: process.platform,
        arch: process.arch,
        isPackaged: electron_1.app.isPackaged
    };
});
electron_1.ipcMain.handle("desktop:get-paths", () => {
    return runtimePaths;
});
electron_1.ipcMain.handle("desktop:open-external", async (_, url) => {
    await electron_1.shell.openExternal(url);
});
electron_1.ipcMain.handle("desktop:show-item-in-folder", async (_, fullPath) => {
    electron_1.shell.showItemInFolder(fullPath);
});
