import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { loadMCPConfig, probeMCPServer, updateMCPConfig } from "./api";
import type { MCPConfig } from "./types";

export function useMCPConfig() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["mcpConfig"],
    queryFn: () => loadMCPConfig(),
  });
  return { config: data, isLoading, error };
}

export function useEnableMCPServer() {
  const queryClient = useQueryClient();
  const { config } = useMCPConfig();
  return useMutation({
    mutationFn: async ({
      serverName,
      enabled,
    }: {
      serverName: string;
      enabled: boolean;
    }) => {
      if (!config) {
        throw new Error("MCP config not found");
      }
      if (!config.mcp_servers[serverName]) {
        throw new Error(`MCP server ${serverName} not found`);
      }
      await updateMCPConfig({
        mcp_servers: {
          ...config.mcp_servers,
          [serverName]: {
            ...config.mcp_servers[serverName],
            enabled,
          },
        },
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["mcpConfig"] });
    },
  });
}

export function useUpdateMCPConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: MCPConfig) => updateMCPConfig(payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["mcpConfig"] });
    },
  });
}

export function useMCPServerProbe(serverName: string, enabled: boolean) {
  return useQuery({
    queryKey: ["mcpServerProbe", serverName, enabled],
    queryFn: () => probeMCPServer(serverName),
    enabled,
    retry: false,
    staleTime: 1000 * 30,
  });
}
