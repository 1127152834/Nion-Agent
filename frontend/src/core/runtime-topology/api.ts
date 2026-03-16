import { apiFetch } from "@/core/api";

import type { RuntimeTopologyResponse } from "./types";

export async function loadRuntimeTopology(): Promise<RuntimeTopologyResponse> {
  return apiFetch<RuntimeTopologyResponse>("/api/runtime/topology");
}
