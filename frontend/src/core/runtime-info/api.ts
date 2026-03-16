import { apiFetch } from "@/core/api";

import type { RuntimeInfoResponse } from "./types";

export async function loadRuntimeInfo(): Promise<RuntimeInfoResponse> {
  return apiFetch<RuntimeInfoResponse>("/api/runtime/info");
}
