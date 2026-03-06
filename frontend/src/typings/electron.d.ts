interface ElectronAPI {
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

interface Window {
  electronAPI?: ElectronAPI;
}
