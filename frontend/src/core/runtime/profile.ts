import { apiFetch } from "@/core/api";

export type ExecutionMode = "sandbox" | "host";

export interface RuntimeProfile {
  execution_mode: ExecutionMode;
  host_workdir: string | null;
  locked: boolean;
  updated_at?: string | null;
}

export async function fetchRuntimeProfile(threadId: string): Promise<RuntimeProfile> {
  return apiFetch<RuntimeProfile>(`/api/threads/${threadId}/runtime-profile`);
}

export async function updateRuntimeProfile(
  threadId: string,
  payload: {
    execution_mode: ExecutionMode;
    host_workdir?: string | null;
  },
): Promise<RuntimeProfile> {
  return apiFetch<RuntimeProfile>(`/api/threads/${threadId}/runtime-profile`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}
