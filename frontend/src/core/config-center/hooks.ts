/**
 * Configuration Center Hooks
 *
 * React hooks for configuration management.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { loadConfig, loadConfigSchema, updateConfig, validateConfig } from "./api";
import type {
  ConfigUpdateRequest,
  ConfigUpdateResponse,
  ConfigValidateRequest,
  ConfigValidateResponse,
} from "./types";

export function useConfigCenter({ enabled = true }: { enabled?: boolean } = {}) {
  const configQuery = useQuery({
    queryKey: ["configCenter", "config"],
    queryFn: () => loadConfig(),
    enabled,
  });

  const schemaQuery = useQuery({
    queryKey: ["configCenter", "schema"],
    queryFn: () => loadConfigSchema(),
    enabled,
  });

  return {
    configData: configQuery.data ?? null,
    schemaData: schemaQuery.data ?? null,
    isLoading: configQuery.isLoading || schemaQuery.isLoading,
    error: configQuery.error ?? schemaQuery.error ?? null,
    refetchConfig: configQuery.refetch,
  };
}

export function useValidateConfig() {
  return useMutation<ConfigValidateResponse, Error, ConfigValidateRequest>({
    mutationFn: (payload) => validateConfig(payload),
  });
}

export function useUpdateConfig() {
  const queryClient = useQueryClient();

  return useMutation<ConfigUpdateResponse, Error, ConfigUpdateRequest>({
    mutationFn: (payload) => updateConfig(payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["configCenter"] });
      void queryClient.invalidateQueries({ queryKey: ["models"] });
    },
  });
}
