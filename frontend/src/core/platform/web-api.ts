/**
 * Web 平台的 API 封装（提供兼容接口）
 */
export const webPlatform = {
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

  async getPaths(): Promise<any> {
    return null;
  },

  async openExternal(url: string): Promise<void> {
    window.open(url, "_blank");
  },

  async showItemInFolder(fullPath: string): Promise<void> {
    console.warn("showItemInFolder not supported in web mode");
  },

  onStartupStage(callback: (data: any) => void): void {
    // Web 模式不需要启动监听
  }
};
