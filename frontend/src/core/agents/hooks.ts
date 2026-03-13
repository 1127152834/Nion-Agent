import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  createAgent,
  deleteAgentAvatar,
  deleteDefaultAgentAvatar,
  deleteAgent,
  getDefaultAgentConfig,
  getAgent,
  listAgents,
  uploadAgentAvatar,
  uploadDefaultAgentAvatar,
  updateAgent,
  updateDefaultAgentConfig,
} from "./api";
import type {
  CreateAgentRequest,
  UpdateAgentRequest,
  UpdateDefaultAgentConfigRequest,
} from "./types";

export function useAgents() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["agents"],
    queryFn: () => listAgents(),
  });
  return { agents: data ?? [], isLoading, error };
}

export function useAgent(name: string | null | undefined) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["agents", name],
    queryFn: () => getAgent(name!),
    enabled: !!name,
  });
  return { agent: data ?? null, isLoading, error };
}

export function useCreateAgent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: CreateAgentRequest) => createAgent(request),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["agents"] });
    },
  });
}

export function useUpdateAgent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      name,
      request,
    }: {
      name: string;
      request: UpdateAgentRequest;
    }) => updateAgent(name, request),
    onSuccess: (_data, { name }) => {
      void queryClient.invalidateQueries({ queryKey: ["agents"] });
      void queryClient.invalidateQueries({ queryKey: ["agents", name] });
    },
  });
}

export function useDeleteAgent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => deleteAgent(name),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["agents"] });
    },
  });
}

export function useDefaultAgentConfig() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["agents", "default-config"],
    queryFn: () => getDefaultAgentConfig(),
  });
  return { config: data ?? null, isLoading, error };
}

export function useUpdateDefaultAgentConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: UpdateDefaultAgentConfigRequest) =>
      updateDefaultAgentConfig(request),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["agents", "default-config"] });
      void queryClient.invalidateQueries({ queryKey: ["agents"] });
    },
  });
}

export function useUploadAgentAvatar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ name, file }: { name: string; file: File }) => uploadAgentAvatar(name, file),
    onSuccess: (_data, { name }) => {
      void queryClient.invalidateQueries({ queryKey: ["agents"] });
      void queryClient.invalidateQueries({ queryKey: ["agents", name] });
      void queryClient.invalidateQueries({ queryKey: ["agents", "default-config"] });
    },
  });
}

export function useDeleteAgentAvatar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => deleteAgentAvatar(name),
    onSuccess: (_data, name) => {
      void queryClient.invalidateQueries({ queryKey: ["agents"] });
      void queryClient.invalidateQueries({ queryKey: ["agents", name] });
      void queryClient.invalidateQueries({ queryKey: ["agents", "default-config"] });
    },
  });
}

export function useUploadDefaultAgentAvatar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => uploadDefaultAgentAvatar(file),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["agents"] });
      void queryClient.invalidateQueries({ queryKey: ["agents", "default-config"] });
    },
  });
}

export function useDeleteDefaultAgentAvatar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => deleteDefaultAgentAvatar(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["agents"] });
      void queryClient.invalidateQueries({ queryKey: ["agents", "default-config"] });
    },
  });
}
