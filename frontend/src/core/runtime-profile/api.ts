import { getBackendBaseURL } from "@/core/config";

export type ExecutionMode = "sandbox" | "host";

export interface RuntimeProfile {
  execution_mode: ExecutionMode;
  host_workdir: string | null;
  locked: boolean;
  updated_at?: string | null;
}

export async function fetchRuntimeProfile(threadId: string): Promise<RuntimeProfile> {
  const response = await fetch(
    `${getBackendBaseURL()}/api/threads/${threadId}/runtime-profile`,
  );
  if (!response.ok) {
    let detail = "";
    try {
      const payload = (await response.json()) as { detail?: unknown; message?: unknown };
      if (typeof payload.detail === "string") {
        detail = payload.detail;
      } else if (typeof payload.message === "string") {
        detail = payload.message;
      }
    } catch {
      // ignore json parse failures
    }
    throw new Error(detail || `Failed to fetch runtime profile (${response.status})`);
  }
  return (await response.json()) as RuntimeProfile;
}

export async function updateRuntimeProfile(
  threadId: string,
  payload: {
    execution_mode: ExecutionMode;
    host_workdir?: string | null;
  },
): Promise<RuntimeProfile> {
  const response = await fetch(
    `${getBackendBaseURL()}/api/threads/${threadId}/runtime-profile`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );
  if (!response.ok) {
    let detail = "";
    try {
      const payload = (await response.json()) as { detail?: unknown; message?: unknown };
      if (typeof payload.detail === "string") {
        detail = payload.detail;
      } else if (typeof payload.message === "string") {
        detail = payload.message;
      }
    } catch {
      // ignore json parse failures
    }
    throw new Error(detail || `Failed to update runtime profile (${response.status})`);
  }
  return (await response.json()) as RuntimeProfile;
}
