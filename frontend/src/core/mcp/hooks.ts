import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  checkMcpPrerequisites,
  ensureNodeToolchain,
  getMcpMarketplaceServerDetail,
  listMcpMarketplaceServers,
  loadMCPConfig,
  probeMCPServer,
  updateMCPConfig,
} from "./api";
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

const mcpMarketplaceKeys = {
  all: ["mcpMarketplace"] as const,
  servers: () => [...mcpMarketplaceKeys.all, "servers"] as const,
  detail: (id: string) => [...mcpMarketplaceKeys.servers(), "detail", id] as const,
};

export function useMcpMarketplaceServers() {
  return useQuery({
    queryKey: mcpMarketplaceKeys.servers(),
    queryFn: listMcpMarketplaceServers,
  });
}

export function useMcpMarketplaceServerDetail(serverId: string | null) {
  return useQuery({
    queryKey: mcpMarketplaceKeys.detail(serverId ?? ""),
    queryFn: () => getMcpMarketplaceServerDetail(serverId ?? ""),
    enabled: Boolean(serverId),
  });
}

const mcpPrereqKeys = {
  all: ["mcpPrerequisites"] as const,
  detail: (commands: string[]) => [...mcpPrereqKeys.all, ...commands] as const,
};

export function useMcpPrerequisites(commands: string[], enabled: boolean) {
  return useQuery({
    queryKey: mcpPrereqKeys.detail(commands),
    queryFn: () => checkMcpPrerequisites(commands),
    enabled: enabled && commands.length > 0,
    retry: false,
    staleTime: 1000 * 30,
  });
}

export function useEnsureNodeToolchain() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => ensureNodeToolchain(),
    onSuccess: () => {
      // Refresh prerequisite checks so the UI unblocks install.
      void queryClient.invalidateQueries({ queryKey: ["mcpPrerequisites"] });
    },
  });
}
