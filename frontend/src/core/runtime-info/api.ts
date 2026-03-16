import { getBackendBaseURL } from "@/core/config";

import type { RuntimeInfoResponse } from "./types";

export async function loadRuntimeInfo(): Promise<RuntimeInfoResponse> {
  const response = await fetch(`${getBackendBaseURL()}/api/runtime/info`);
  if (!response.ok) {
    throw new Error(`Failed to load runtime info (${response.status})`);
  }
  return (await response.json()) as RuntimeInfoResponse;
}

