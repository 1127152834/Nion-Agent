import { useQuery } from "@tanstack/react-query";

import { apiFetch } from "@/core/api";

export interface RuntimeTopologyResponse {
  runtime_mode: "desktop" | "web";
  gateway_host: string;
  gateway_port: number;
  gateway_facade_path: string;
  langgraph_upstream: string;
  frontend_allowed_origins: string[];
  cors_allow_origin_regex: string;
  browser_should_use_gateway_facade: boolean;
}

export async function loadRuntimeTopology(): Promise<RuntimeTopologyResponse> {
  return apiFetch<RuntimeTopologyResponse>("/api/runtime/topology");
}

export function useRuntimeTopology() {
  return useQuery({
    queryKey: ["runtime-topology"],
    queryFn: loadRuntimeTopology,
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });
}
