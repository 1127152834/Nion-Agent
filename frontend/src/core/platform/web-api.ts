/**
 * Web 平台的 API 封装（提供兼容接口）
 */
type RuntimeStatus = Record<string, unknown>;
type RuntimeActionResult = Record<string, unknown>;
type StartupStageEvent = Record<string, unknown>;
type RuntimeProgressEvent = Record<string, unknown>;

export const webPlatform = {
  async pickHostFile(
    _options?: { title?: string; defaultPath?: string; kind?: "file" | "directory" },
  ): Promise<{ canceled: boolean; path: string | null }> {
    return { canceled: true, path: null };
  },

  async readHostFile(
    _payload: { path: string; encoding?: string },
  ): Promise<{ path: string; content: string; size: number; encoding: string }> {
    throw new Error("readHostFile not supported in web mode");
  },

  async writeHostFile(
    _payload: { path: string; content: string; append?: boolean; encoding?: string },
  ): Promise<{ path: string; size: number; append: boolean; encoding: string }> {
    throw new Error("writeHostFile not supported in web mode");
  },

  async invokeHostApp(
    _payload: { action: "open-external" | "show-item-in-folder" | "open-path"; target: string },
  ): Promise<{ success: boolean }> {
    throw new Error("invokeHostApp not supported in web mode");
  },

  async startWatchingHostDirectory(
    _payload: { path: string },
  ): Promise<{ watchId: string }> {
    throw new Error("startWatchingHostDirectory not supported in web mode");
  },

  async stopWatchingHostDirectory(
    _payload: { watchId: string },
  ): Promise<{ stopped: boolean }> {
    return { stopped: false };
  },

  onHostDirectoryChanged(
    _callback: (data: {
      watchId: string;
      type: "rename" | "change";
      path: string;
      rootPath: string;
      watchedPath: string;
      filename: string | null;
      timestamp: number;
    }) => void,
  ): () => void {
    return () => undefined;
  },

  async getAppVersion(): Promise<string> {
    return "web";
  },

  async getPlatform(): Promise<{ platform: string; arch: string; isPackaged: boolean }> {
    return {
      platform: "web",
      arch: "unknown",
      isPackaged: false
    };
  },

  async getPaths(): Promise<RuntimeActionResult | null> {
    return null;
  },

  async openExternal(url: string): Promise<void> {
    window.open(url, "_blank");
  },

  async showItemInFolder(_fullPath: string): Promise<void> {
    console.warn("showItemInFolder not supported in web mode");
  },

  onStartupStage(_callback: (data: StartupStageEvent) => void): void {
    // Web 模式不需要启动监听
  },

  async getRuntimeStatus(): Promise<RuntimeStatus> {
    throw new Error("getRuntimeStatus not supported in web mode");
  },

  async downloadRuntimeComponent(_componentName: string): Promise<RuntimeActionResult> {
    throw new Error("downloadRuntimeComponent not supported in web mode");
  },

  async retryRuntimeComponent(_componentName: string): Promise<RuntimeActionResult> {
    throw new Error("retryRuntimeComponent not supported in web mode");
  },

  async completeRuntimeOnboarding(): Promise<RuntimeActionResult> {
    throw new Error("completeRuntimeOnboarding not supported in web mode");
  },

  async skipRuntimeComponent(_componentName: string): Promise<RuntimeActionResult> {
    throw new Error("skipRuntimeComponent not supported in web mode");
  },

  onRuntimeDownloadProgress(_callback: (data: RuntimeProgressEvent) => void): void {
    // Web 模式不需要运行时下载监听
  },
};
