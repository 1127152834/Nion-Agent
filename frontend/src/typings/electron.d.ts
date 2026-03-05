interface ElectronAPI {
  getAppVersion: () => Promise<string>;
  getPlatform: () => Promise<{ platform: string; arch: string; isPackaged: boolean }>;
  getPaths: () => Promise<any>;
  openExternal: (url: string) => Promise<void>;
  showItemInFolder: (fullPath: string) => Promise<void>;
  onStartupStage: (callback: (data: any) => void) => void;
}

interface Window {
  electronAPI?: ElectronAPI;
}
