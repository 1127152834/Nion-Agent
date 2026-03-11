/**
 * Detect current runtime environment.
 */
export function isElectron(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  // Explicitly injected by preload.
  if ("electronAPI" in window && window.electronAPI !== undefined) {
    return true;
  }

  // Fallback for cases where preload arrives after early module execution.
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
 * Get Electron API when available.
 */
export function getElectronAPI() {
  if (isElectron()) {
    return window.electronAPI;
  }
  return null;
}
