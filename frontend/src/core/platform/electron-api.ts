import { getElectronAPI } from "./detector";

/**
 * Electron 平台的 API 封装
 */
export const electronPlatform = {
  async getAppVersion(): Promise<string> {
    const api = getElectronAPI();
    if (!api) throw new Error("Not in Electron environment");
    return api.getAppVersion();
  },

  async getPlatform(): Promise<{ platform: string; arch: string; isPackaged: boolean }> {
    const api = getElectronAPI();
    if (!api) throw new Error("Not in Electron environment");
    return api.getPlatform();
  },

  async getPaths(): Promise<any> {
    const api = getElectronAPI();
    if (!api) throw new Error("Not in Electron environment");
    return api.getPaths();
  },

  async openExternal(url: string): Promise<void> {
    const api = getElectronAPI();
    if (!api) throw new Error("Not in Electron environment");
    return api.openExternal(url);
  },

  async showItemInFolder(fullPath: string): Promise<void> {
    const api = getElectronAPI();
    if (!api) throw new Error("Not in Electron environment");
    return api.showItemInFolder(fullPath);
  },

  onStartupStage(callback: (data: any) => void): void {
    const api = getElectronAPI();
    if (!api) throw new Error("Not in Electron environment");
    api.onStartupStage(callback);
  },

  async getRuntimeStatus(): Promise<any> {
    const api = getElectronAPI();
    if (!api) throw new Error("Not in Electron environment");
    return api.getRuntimeStatus();
  },

  async downloadRuntimeComponent(componentName: string): Promise<any> {
    const api = getElectronAPI();
    if (!api) throw new Error("Not in Electron environment");
    return api.downloadRuntimeComponent(componentName);
  },

  async retryRuntimeComponent(componentName: string): Promise<any> {
    const api = getElectronAPI();
    if (!api) throw new Error("Not in Electron environment");
    return api.retryRuntimeComponent(componentName);
  },

  async completeRuntimeOnboarding(): Promise<any> {
    const api = getElectronAPI();
    if (!api) throw new Error("Not in Electron environment");
    return api.completeRuntimeOnboarding();
  },

  async skipRuntimeComponent(componentName: string): Promise<any> {
    const api = getElectronAPI();
    if (!api) throw new Error("Not in Electron environment");
    return api.skipRuntimeComponent(componentName);
  },

  onRuntimeDownloadProgress(callback: (data: any) => void): void {
    const api = getElectronAPI();
    if (!api) throw new Error("Not in Electron environment");
    api.onRuntimeDownloadProgress(callback);
  },
};
