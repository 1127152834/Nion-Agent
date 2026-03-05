import { env } from "@/env";

// 检测是否在 Electron 环境中
function isElectron(): boolean {
  return typeof window !== "undefined" && "electronAPI" in window;
}

export function getBackendBaseURL() {
  // Electron 模式：使用本地服务
  if (isElectron()) {
    return "http://localhost:8001";
  }

  if (env.NEXT_PUBLIC_BACKEND_BASE_URL) {
    return env.NEXT_PUBLIC_BACKEND_BASE_URL;
  } else {
    return "";
  }
}

export function getLangGraphBaseURL(isMock?: boolean) {
  // Electron 模式：使用本地服务
  if (isElectron()) {
    return "http://localhost:2024";
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
