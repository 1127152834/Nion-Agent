/**
 * 检测当前运行环境
 */
export function isElectron(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  // preload 显式注入
  if ("electronAPI" in window && window.electronAPI !== undefined) {
    return true;
  }

  // 兜底：部分场景下 preload 注入晚于早期模块执行
  const userAgent = window.navigator?.userAgent?.toLowerCase() ?? "";
  return userAgent.includes("electron");
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
