import { isElectron } from "@/core/platform";
import { env } from "@/env";

let hasWarnedLangGraphBaseURL = false;

function warnLangGraphBaseURLOnce(message: string) {
  if (hasWarnedLangGraphBaseURL) {
    return;
  }
  hasWarnedLangGraphBaseURL = true;
  console.warn(message);
}

function normalizeBaseURL(value: string) {
  return value.trim().replace(/\/$/, "");
}

function normalizeLangGraphBaseURL(raw: string) {
  const normalized = normalizeBaseURL(raw);
  if (!normalized) {
    return normalized;
  }

  // Common misconfiguration: setting NEXT_PUBLIC_LANGGRAPH_BASE_URL to the gateway base `/api`
  // instead of the proxy prefix `/api/langgraph`. This makes the SDK call `/api/threads/*` and
  // gets 404 from the gateway (the correct path is `/api/langgraph/threads/*`).
  //
  // Example (wrong):  http://localhost:8001/api
  // Example (correct): http://localhost:8001/api/langgraph
  if (normalized.endsWith("/api") && !normalized.endsWith("/api/langgraph")) {
    const corrected = `${normalized}/langgraph`;
    warnLangGraphBaseURLOnce(
      `[LangGraph] Detected misconfigured NEXT_PUBLIC_LANGGRAPH_BASE_URL (${normalized}). ` +
        `Auto-corrected to ${corrected}.`,
    );
    return corrected;
  }

  return normalized;
}

export function getBackendBaseURL() {
  // Electron mode: prefer env var, then fallback to local desktop gateway.
  if (isElectron()) {
    return env.NEXT_PUBLIC_BACKEND_BASE_URL
      ? normalizeBaseURL(env.NEXT_PUBLIC_BACKEND_BASE_URL)
      : "http://localhost:2026";
  }

  // Web mode: prefer env var, then fallback to local backend port.
  if (env.NEXT_PUBLIC_BACKEND_BASE_URL) {
    return normalizeBaseURL(env.NEXT_PUBLIC_BACKEND_BASE_URL);
  } else {
    // Default local backend port for development.
    return "http://localhost:8001";
  }
}

export function getLangGraphBaseURL(isMock?: boolean) {
  if (env.NEXT_PUBLIC_LANGGRAPH_BASE_URL) {
    return normalizeLangGraphBaseURL(env.NEXT_PUBLIC_LANGGRAPH_BASE_URL);
  }

  if (isMock) {
    if (typeof window !== "undefined") {
      return `${window.location.origin}/mock/api`;
    }
    return "http://localhost:3000/mock/api";
  }

  return `${getBackendBaseURL()}/api/langgraph`;
}
