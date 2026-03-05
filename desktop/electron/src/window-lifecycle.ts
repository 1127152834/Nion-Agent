import { BrowserWindow } from "electron";

export class WindowLifecycleManager {
  private window: BrowserWindow | null = null;

  setWindow(window: BrowserWindow): void {
    this.window = window;
  }

  showWindow(): void {
    if (this.window) {
      this.window.show();
      if (this.window.isMinimized()) {
        this.window.restore();
      }
      this.window.focus();
    }
  }

  hideWindow(): void {
    if (this.window) {
      this.window.hide();
    }
  }

  closeWindow(): void {
    if (this.window) {
      this.window.close();
      this.window = null;
    }
  }

  isWindowVisible(): boolean {
    return this.window?.isVisible() || false;
  }

  sendToWindow(channel: string, ...args: any[]): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send(channel, ...args);
    }
  }
}
