import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  checkCliPrerequisites,
  discoverClis,
  ensureCliPipxToolchain,
  ensureCliUvToolchain,
  getCliMarketplaceToolDetail,
  getCliInstallJobStatus,
  installCliTool,
  listCliMarketplaceTools,
  loadCLIConfig,
  probeCliTool,
  startCliInstallJob,
  setCliEnabled,
  uninstallCliTool,
  updateCLIConfig,
} from "./api";
import type { CLIConfig } from "./types";

const cliConfigKeys = {
  all: ["cliConfig"] as const,
};

export function useCLIConfig() {
  const { data, isLoading, error } = useQuery({
    queryKey: cliConfigKeys.all,
    queryFn: () => loadCLIConfig(),
  });
  return { config: data, isLoading, error };
}

export function useUpdateCLIConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CLIConfig) => updateCLIConfig(payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: cliConfigKeys.all });
    },
  });
}

const cliMarketplaceKeys = {
  all: ["cliMarketplace"] as const,
  tools: () => [...cliMarketplaceKeys.all, "tools"] as const,
  detail: (id: string) => [...cliMarketplaceKeys.tools(), "detail", id] as const,
};

export function useCliMarketplaceTools() {
  return useQuery({
    queryKey: cliMarketplaceKeys.tools(),
    queryFn: listCliMarketplaceTools,
  });
}

export function useCliMarketplaceToolDetail(toolId: string | null) {
  return useQuery({
    queryKey: cliMarketplaceKeys.detail(toolId ?? ""),
    queryFn: () => getCliMarketplaceToolDetail(toolId ?? ""),
    enabled: Boolean(toolId),
  });
}

export function useInstallCliTool() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (toolId: string) => installCliTool(toolId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: cliConfigKeys.all });
      void queryClient.invalidateQueries({ queryKey: cliMarketplaceKeys.all });
    },
  });
}

const cliInstallJobKeys = {
  all: ["cliInstallJobs"] as const,
  detail: (jobId: string) => [...cliInstallJobKeys.all, jobId] as const,
};

export function useStartCliInstallJob() {
  return useMutation({
    mutationFn: async (toolId: string) => startCliInstallJob(toolId),
  });
}

export function useCliInstallJobStatus(jobId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: cliInstallJobKeys.detail(jobId ?? ""),
    queryFn: () => getCliInstallJobStatus(jobId ?? ""),
    enabled: enabled && Boolean(jobId),
    retry: false,
    staleTime: 0,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (!status) {
        return 800;
      }
      if (status === "pending" || status === "running") {
        return 800;
      }
      return false;
    },
  });
}

export function useUninstallCliTool() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ toolId, keepConfig }: { toolId: string; keepConfig: boolean }) => uninstallCliTool(toolId, keepConfig),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: cliConfigKeys.all });
      void queryClient.invalidateQueries({ queryKey: cliMarketplaceKeys.all });
    },
  });
}

const cliProbeKeys = {
  all: ["cliProbe"] as const,
  detail: (toolId: string) => [...cliProbeKeys.all, toolId] as const,
};

export function useCliProbe(toolId: string, enabled: boolean) {
  return useQuery({
    queryKey: cliProbeKeys.detail(toolId),
    queryFn: () => probeCliTool(toolId),
    enabled,
    retry: false,
    staleTime: 1000 * 15,
  });
}

export function useSetCliEnabled() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      toolId,
      enabled,
      confirmationToken,
    }: {
      toolId: string;
      enabled: boolean;
      confirmationToken?: string | null;
    }) => setCliEnabled(toolId, enabled, confirmationToken),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: cliConfigKeys.all });
      void queryClient.invalidateQueries({ queryKey: cliProbeKeys.all });
    },
  });
}

const cliDiscoverKeys = {
  all: ["cliDiscover"] as const,
  detail: (mode: "whitelist" | "full") => [...cliDiscoverKeys.all, mode] as const,
};

export function useCliDiscover(mode: "whitelist" | "full", enabled: boolean) {
  return useQuery({
    queryKey: cliDiscoverKeys.detail(mode),
    queryFn: () => discoverClis(mode),
    enabled,
    retry: false,
    staleTime: 1000 * 15,
  });
}

const cliPrereqKeys = {
  all: ["cliPrerequisites"] as const,
  detail: (commands: string[]) => [...cliPrereqKeys.all, ...commands] as const,
};

export function useCliPrerequisites(commands: string[], enabled: boolean) {
  return useQuery({
    queryKey: cliPrereqKeys.detail(commands),
    queryFn: () => checkCliPrerequisites(commands),
    enabled: enabled && commands.length > 0,
    retry: false,
    staleTime: 1000 * 30,
  });
}

export function useEnsureCliUvToolchain() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => ensureCliUvToolchain(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: cliPrereqKeys.all });
    },
  });
}

export function useEnsureCliPipxToolchain() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => ensureCliPipxToolchain(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: cliPrereqKeys.all });
    },
  });
}
