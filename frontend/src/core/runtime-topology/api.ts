import { getBackendBaseURL } from "@/core/config";

import type { RuntimeTopologyResponse } from "./types";

export async function loadRuntimeTopology(): Promise<RuntimeTopologyResponse> {
  const response = await fetch(`${getBackendBaseURL()}/api/runtime/topology`);
  if (!response.ok) {
    throw new Error(`Failed to load runtime topology (${response.status})`);
  }
  return (await response.json()) as RuntimeTopologyResponse;
}
