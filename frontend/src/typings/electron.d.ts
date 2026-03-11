interface HostDirectoryWatchEvent {
  watchId: string;
  type: "rename" | "change";
  path: string;
  rootPath: string;
  watchedPath: string;
  filename: string | null;
  timestamp: number;
}

type RuntimePathsPayload = Record<string, string>;

interface StartupStagePayload {
  stage: string;
  status: "started" | "success" | "failed";
  error?: string;
}

interface RuntimeComponentStatusPayload {
  name: string;
  description: string;
  assetName: string;
  status: "not_downloaded" | "downloading" | "downloaded" | "failed" | "skipped";
  error?: string;
}

interface RuntimeStatusPayload {
  coreReady: boolean;
  onboardingCompleted: boolean;
  version: string;
  platform: string;
  arch: string;
  optionalComponents: RuntimeComponentStatusPayload[];
}

interface RuntimeDownloadProgressPayload {
  name: string;
  progress: number;
}

interface RuntimePortsPayload {
  frontendPort: number;
  gatewayPort: number;
  langgraphPort: number;
}

interface ElectronAPI {
  pickHostFile: (options?: { title?: string; defaultPath?: string; kind?: "file" | "directory" }) => Promise<{ canceled: boolean; path: string | null }>;
  readHostFile: (payload: { path: string; encoding?: string }) => Promise<{ path: string; content: string; size: number; encoding: string }>;
  writeHostFile: (payload: { path: string; content: string; append?: boolean; encoding?: string }) => Promise<{ path: string; size: number; append: boolean; encoding: string }>;
  invokeHostApp: (payload: { action: "open-external" | "show-item-in-folder" | "open-path"; target: string }) => Promise<{ success: boolean }>;
  startWatchingHostDirectory: (payload: { path: string }) => Promise<{ watchId: string }>;
  stopWatchingHostDirectory: (payload: { watchId: string }) => Promise<{ stopped: boolean }>;
  onHostDirectoryChanged: (callback: (event: HostDirectoryWatchEvent) => void) => () => void;
  getAppVersion: () => Promise<string>;
  getPlatform: () => Promise<{ platform: string; arch: string; isPackaged: boolean }>;
  getPaths: () => Promise<RuntimePathsPayload | null>;
  openExternal: (url: string) => Promise<void>;
  showItemInFolder: (fullPath: string) => Promise<void>;
  onStartupStage: (callback: (data: StartupStagePayload) => void) => void;
  getRuntimeStatus: () => Promise<RuntimeStatusPayload>;
  getRuntimePorts: () => Promise<{
    version: string | null;
    ports: RuntimePortsPayload;
    active: RuntimePortsPayload | null;
  }>;
  updateRuntimePorts: (ports: RuntimePortsPayload) => Promise<{
    version: string | null;
    ports: RuntimePortsPayload;
    active: RuntimePortsPayload;
  }>;
  downloadRuntimeComponent: (componentName: string) => Promise<unknown>;
  retryRuntimeComponent: (componentName: string) => Promise<unknown>;
  completeRuntimeOnboarding: () => Promise<unknown>;
  skipRuntimeComponent: (componentName: string) => Promise<unknown>;
  onRuntimeDownloadProgress: (callback: (data: RuntimeDownloadProgressPayload) => void) => void;
}

interface Window {
  electronAPI?: ElectronAPI;
}
