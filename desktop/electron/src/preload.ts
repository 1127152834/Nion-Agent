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

  // 主机能力（受控）
  pickHostFile: (options?: { title?: string; defaultPath?: string; kind?: "file" | "directory" }) =>
    ipcRenderer.invoke("desktop:host-fs:pick", options),
  readHostFile: (payload: { path: string; encoding?: BufferEncoding }) =>
    ipcRenderer.invoke("desktop:host-fs:read", payload),
  writeHostFile: (payload: { path: string; content: string; append?: boolean; encoding?: BufferEncoding }) =>
    ipcRenderer.invoke("desktop:host-fs:write", payload),
  startWatchingHostDirectory: (payload: { path: string }) =>
    ipcRenderer.invoke("desktop:host-fs:watch-start", payload),
  stopWatchingHostDirectory: (payload: { watchId: string }) =>
    ipcRenderer.invoke("desktop:host-fs:watch-stop", payload),
  onHostDirectoryChanged: (callback: (data: any) => void) => {
    const listener = (_event: unknown, data: any) => callback(data);
    ipcRenderer.on("desktop:host-fs:watch:event", listener);
    return () => {
      ipcRenderer.removeListener("desktop:host-fs:watch:event", listener);
    };
  },
  invokeHostApp: (payload: { action: "open-external" | "show-item-in-folder" | "open-path"; target: string }) =>
    ipcRenderer.invoke("desktop:host-app:invoke", payload),
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
  pickHostFile: (options?: { title?: string; defaultPath?: string; kind?: "file" | "directory" }) => Promise<{ canceled: boolean; path: string | null }>;
  readHostFile: (payload: { path: string; encoding?: BufferEncoding }) => Promise<{ path: string; content: string; size: number; encoding: BufferEncoding }>;
  writeHostFile: (payload: { path: string; content: string; append?: boolean; encoding?: BufferEncoding }) => Promise<{ path: string; size: number; append: boolean; encoding: BufferEncoding }>;
  startWatchingHostDirectory: (payload: { path: string }) => Promise<{ watchId: string }>;
  stopWatchingHostDirectory: (payload: { watchId: string }) => Promise<{ stopped: boolean }>;
  onHostDirectoryChanged: (callback: (data: {
    watchId: string;
    type: "rename" | "change";
    path: string;
    rootPath: string;
    watchedPath: string;
    filename: string | null;
    timestamp: number;
  }) => void) => () => void;
  invokeHostApp: (payload: { action: "open-external" | "show-item-in-folder" | "open-path"; target: string }) => Promise<{ success: boolean }>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
