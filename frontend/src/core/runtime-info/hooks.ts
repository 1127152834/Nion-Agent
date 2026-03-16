import { useQuery } from "@tanstack/react-query";

import { loadRuntimeInfo } from "./api";

export function useRuntimeInfo() {
  return useQuery({
    queryKey: ["runtime-info"],
    queryFn: loadRuntimeInfo,
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });
}

