import { isElectron } from "@/core/platform";
import { env } from "@/env";

export function getBackendBaseURL() {
  // Electron 模式：优先使用环境变量，其次回退到同源代理入口
  if (isElectron()) {
    return env.NEXT_PUBLIC_BACKEND_BASE_URL ?? "http://localhost:2026";
  }

  if (env.NEXT_PUBLIC_BACKEND_BASE_URL) {
    return env.NEXT_PUBLIC_BACKEND_BASE_URL;
  } else {
    return "";
  }
}

export function getLangGraphBaseURL(isMock?: boolean) {
  // Electron 模式：优先使用环境变量，其次回退到同源代理入口
  if (isElectron()) {
    return env.NEXT_PUBLIC_LANGGRAPH_BASE_URL ?? "http://localhost:2026/api/langgraph";
  }

  if (env.NEXT_PUBLIC_LANGGRAPH_BASE_URL) {
    return env.NEXT_PUBLIC_LANGGRAPH_BASE_URL;
  } else if (isMock) {
    if (typeof window !== "undefined") {
      return `${window.location.origin}/mock/api`;
    }
    return "http://localhost:3000/mock/api";
  } else {
    // LangGraph SDK requires a full URL, construct it from current origin
    if (typeof window !== "undefined") {
      return `${window.location.origin}/api/langgraph`;
    }
    // Fallback for SSR
    return "http://localhost:2026/api/langgraph";
  }
}
