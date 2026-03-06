import { contextBridge, ipcRenderer } from "electron";

// 暴露安全的 API 给渲染进程
contextBridge.exposeInMainWorld("electronAPI", {
  // 平台信息
  getAppVersion: () => ipcRenderer.invoke("desktop:get-app-version"),
  getPlatform: () => ipcRenderer.invoke("desktop:get-platform"),
  getPaths: () => ipcRenderer.invoke("desktop:get-paths"),

  // 系统操作
  openExternal: (url: string) => ipcRenderer.invoke("desktop:open-external", url),
  showItemInFolder: (fullPath: string) => ipcRenderer.invoke("desktop:show-item-in-folder", fullPath),

  // 启动事件监听
  onStartupStage: (callback: (data: any) => void) => {
    ipcRenderer.on("startup:stage", (_, data) => callback(data));
  },

  // 运行时组件状态与下载
  getRuntimeStatus: () => ipcRenderer.invoke("desktop:get-runtime-status"),
  downloadRuntimeComponent: (componentName: string) =>
    ipcRenderer.invoke("desktop:download-runtime-component", componentName),
  retryRuntimeComponent: (componentName: string) =>
    ipcRenderer.invoke("desktop:retry-runtime-component", componentName),
  completeRuntimeOnboarding: () => ipcRenderer.invoke("desktop:complete-runtime-onboarding"),
  skipRuntimeComponent: (componentName: string) =>
    ipcRenderer.invoke("desktop:skip-runtime-component", componentName),
  onRuntimeDownloadProgress: (callback: (data: any) => void) => {
    ipcRenderer.on("runtime:download-progress", (_, data) => callback(data));
  },
});

// TypeScript 类型定义
export interface ElectronAPI {
  getAppVersion: () => Promise<string>;
  getPlatform: () => Promise<{ platform: string; arch: string; isPackaged: boolean }>;
  getPaths: () => Promise<any>;
  openExternal: (url: string) => Promise<void>;
  showItemInFolder: (fullPath: string) => Promise<void>;
  onStartupStage: (callback: (data: any) => void) => void;
  getRuntimeStatus: () => Promise<any>;
  downloadRuntimeComponent: (componentName: string) => Promise<any>;
  retryRuntimeComponent: (componentName: string) => Promise<any>;
  completeRuntimeOnboarding: () => Promise<any>;
  skipRuntimeComponent: (componentName: string) => Promise<any>;
  onRuntimeDownloadProgress: (callback: (data: any) => void) => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
