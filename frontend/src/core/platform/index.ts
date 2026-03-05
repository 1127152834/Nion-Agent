import { isElectron, isWeb, getPlatformType } from "./detector";
import { electronPlatform } from "./electron-api";
import { webPlatform } from "./web-api";

/**
 * 统一的平台 API
 * 自动根据运行环境选择正确的实现
 */
export const platform = isElectron() ? electronPlatform : webPlatform;

export { isElectron, isWeb, getPlatformType };
