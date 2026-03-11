import { getElectronAPI } from "./detector";

type RuntimePathsPayload = Record<string, string> | null;
type StartupStagePayload = {
  stage: string;
  status: "started" | "success" | "failed";
  error?: string;
};
type RuntimeComponentStatus = {
  name: string;
  description: string;
  assetName: string;
  status: "not_downloaded" | "downloading" | "downloaded" | "failed" | "skipped";
  error?: string;
};
type RuntimeStatusPayload = {
  coreReady: boolean;
  onboardingCompleted: boolean;
  version: string;
  platform: string;
  arch: string;
  optionalComponents: RuntimeComponentStatus[];
};
type RuntimeDownloadProgressPayload = {
  name: string;
  progress: number;
};

/**
 * Electron platform API wrapper.
 */
export const electronPlatform = {
  async pickHostFile(
    options?: { title?: string; defaultPath?: string; kind?: "file" | "directory" },
  ): Promise<{ canceled: boolean; path: string | null }> {
    const api = getElectronAPI();
    if (!api) throw new Error("Not in Electron environment");
    return api.pickHostFile(options);
  },

  async readHostFile(payload: {
    path: string;
    encoding?: string;
  }): Promise<{ path: string; content: string; size: number; encoding: string }> {
    const api = getElectronAPI();
    if (!api) throw new Error("Not in Electron environment");
    return api.readHostFile(payload);
  },

  async writeHostFile(payload: {
    path: string;
    content: string;
    append?: boolean;
    encoding?: string;
  }): Promise<{ path: string; size: number; append: boolean; encoding: string }> {
    const api = getElectronAPI();
    if (!api) throw new Error("Not in Electron environment");
    return api.writeHostFile(payload);
  },

  async invokeHostApp(payload: {
    action: "open-external" | "show-item-in-folder" | "open-path";
    target: string;
  }): Promise<{ success: boolean }> {
    const api = getElectronAPI();
    if (!api) throw new Error("Not in Electron environment");
    return api.invokeHostApp(payload);
  },

  async startWatchingHostDirectory(payload: { path: string }): Promise<{ watchId: string }> {
    const api = getElectronAPI();
    if (!api) throw new Error("Not in Electron environment");
    return api.startWatchingHostDirectory(payload);
  },

  async stopWatchingHostDirectory(payload: { watchId: string }): Promise<{ stopped: boolean }> {
    const api = getElectronAPI();
    if (!api) throw new Error("Not in Electron environment");
    return api.stopWatchingHostDirectory(payload);
  },

  onHostDirectoryChanged(
    callback: (data: {
      watchId: string;
      type: "rename" | "change";
      path: string;
      rootPath: string;
      watchedPath: string;
      filename: string | null;
      timestamp: number;
    }) => void,
  ): () => void {
    const api = getElectronAPI();
    if (!api) throw new Error("Not in Electron environment");
    return api.onHostDirectoryChanged(callback);
  },

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

  async getPaths(): Promise<RuntimePathsPayload> {
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

  onStartupStage(callback: (data: StartupStagePayload) => void): void {
    const api = getElectronAPI();
    if (!api) throw new Error("Not in Electron environment");
    api.onStartupStage(callback);
  },

  async getRuntimeStatus(): Promise<RuntimeStatusPayload> {
    const api = getElectronAPI();
    if (!api) throw new Error("Not in Electron environment");
    return api.getRuntimeStatus();
  },

  async downloadRuntimeComponent(componentName: string): Promise<unknown> {
    const api = getElectronAPI();
    if (!api) throw new Error("Not in Electron environment");
    return api.downloadRuntimeComponent(componentName);
  },

  async retryRuntimeComponent(componentName: string): Promise<unknown> {
    const api = getElectronAPI();
    if (!api) throw new Error("Not in Electron environment");
    return api.retryRuntimeComponent(componentName);
  },

  async completeRuntimeOnboarding(): Promise<unknown> {
    const api = getElectronAPI();
    if (!api) throw new Error("Not in Electron environment");
    return api.completeRuntimeOnboarding();
  },

  async skipRuntimeComponent(componentName: string): Promise<unknown> {
    const api = getElectronAPI();
    if (!api) throw new Error("Not in Electron environment");
    return api.skipRuntimeComponent(componentName);
  },

  onRuntimeDownloadProgress(callback: (data: RuntimeDownloadProgressPayload) => void): void {
    const api = getElectronAPI();
    if (!api) throw new Error("Not in Electron environment");
    api.onRuntimeDownloadProgress(callback);
  },
};
