"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
// 暴露安全的 API 给渲染进程
electron_1.contextBridge.exposeInMainWorld("electronAPI", {
    // 平台信息
    getAppVersion: () => electron_1.ipcRenderer.invoke("desktop:get-app-version"),
    getPlatform: () => electron_1.ipcRenderer.invoke("desktop:get-platform"),
    getPaths: () => electron_1.ipcRenderer.invoke("desktop:get-paths"),
    // 系统操作
    openExternal: (url) => electron_1.ipcRenderer.invoke("desktop:open-external", url),
    showItemInFolder: (fullPath) => electron_1.ipcRenderer.invoke("desktop:show-item-in-folder", fullPath),
    // 启动事件监听
    onStartupStage: (callback) => {
        electron_1.ipcRenderer.on("startup:stage", (_, data) => callback(data));
    }
});
