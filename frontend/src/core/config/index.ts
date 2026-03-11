import { isElectron } from "@/core/platform";
import { env } from "@/env";

export function getBackendBaseURL() {
  // Electron mode: prefer env var, then fallback to local desktop gateway.
  if (isElectron()) {
    return env.NEXT_PUBLIC_BACKEND_BASE_URL ?? "http://localhost:2026";
  }

  // Web mode: prefer env var, then fallback to local backend port.
  if (env.NEXT_PUBLIC_BACKEND_BASE_URL) {
    return env.NEXT_PUBLIC_BACKEND_BASE_URL;
  } else {
    // Default local backend port for development.
    return "http://localhost:8001";
  }
}

export function getLangGraphBaseURL(isMock?: boolean) {
  if (env.NEXT_PUBLIC_LANGGRAPH_BASE_URL) {
    return env.NEXT_PUBLIC_LANGGRAPH_BASE_URL;
  }

  if (isMock) {
    if (typeof window !== "undefined") {
      return `${window.location.origin}/mock/api`;
    }
    return "http://localhost:3000/mock/api";
  }

  return `${getBackendBaseURL().replace(/\/$/, "")}/api/langgraph`;
}
