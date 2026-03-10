import { useQuery } from "@tanstack/react-query";

import { loadRuntimeTopology } from "./api";

export function useRuntimeTopology() {
  return useQuery({
    queryKey: ["runtime-topology"],
    queryFn: loadRuntimeTopology,
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });
}
