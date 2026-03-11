import { isElectron, isWeb, getPlatformType } from "./detector";
import { electronPlatform } from "./electron-api";
import { webPlatform } from "./web-api";

/**
 * Unified platform API with runtime resolution.
 *
 * Do not statically bind platform implementations during module initialization.
 * Electron preload injection may arrive after early module execution, and static
 * binding can lock the runtime to web implementation.
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
