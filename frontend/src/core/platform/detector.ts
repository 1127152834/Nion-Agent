/**
 * 检测当前运行环境
 */
export function isElectron(): boolean {
  // 检查是否在 Electron 环境中
  return typeof window !== "undefined" && "electronAPI" in window;
}

export function isWeb(): boolean {
  return !isElectron();
}

export type PlatformType = "electron" | "web";

export function getPlatformType(): PlatformType {
  return isElectron() ? "electron" : "web";
}

/**
 * 获取 Electron API（如果可用）
 */
export function getElectronAPI() {
  if (isElectron()) {
    return window.electronAPI;
  }
  return null;
}
