import { isElectron, isWeb, getPlatformType } from "./detector";
import { electronPlatform } from "./electron-api";
import { webPlatform } from "./web-api";

/**
 * 统一的平台 API（运行时动态解析）
 *
 * 注意：不要在模块初始化阶段静态绑定平台实现。
 * Electron 的 preload 注入可能晚于早期模块执行，静态绑定会导致
 * 运行时一直停留在 web 平台实现。
 */
function getRuntimePlatform() {
  return isElectron() ? electronPlatform : webPlatform;
}

export const platform = new Proxy({} as typeof electronPlatform, {
  get(_target, prop, _receiver) {
    const runtimePlatform = getRuntimePlatform() as Record<PropertyKey, unknown>;
    const value = runtimePlatform[prop];
    if (typeof value === "function") {
      return value.bind(runtimePlatform);
    }
    return value;
  },
});

export { isElectron, isWeb, getPlatformType };
