import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  approvePairRequest,
  createPairingCode,
  getChannelRuntimeStatus,
  getChannelConfig,
  listAuthorizedUsers,
  listPairRequests,
  rejectPairRequest,
  revokeAuthorizedUser,
  testChannelConnection,
  updateAuthorizedUserSessionOverride,
  upsertChannelConfig,
} from "./api";
import type {
  ChannelAuthorizedUserSessionOverridePayload,
  ChannelConfigUpsertPayload,
  ChannelConnectionTestPayload,
  ChannelPairRequestDecisionPayload,
  ChannelPlatform,
} from "./types";

function channelQueryKeys(platform: ChannelPlatform) {
  return {
    config: ["channels", platform, "config"] as const,
    runtime: ["channels", platform, "runtime"] as const,
    pending: ["channels", platform, "pair-requests", "pending"] as const,
    approved: ["channels", platform, "pair-requests", "approved"] as const,
    users: ["channels", platform, "authorized-users"] as const,
  };
}

export function useChannelConfig(platform: ChannelPlatform) {
  return useQuery({
    queryKey: channelQueryKeys(platform).config,
    queryFn: () => getChannelConfig(platform),
  });
}

export function useUpsertChannelConfig(platform: ChannelPlatform) {
  const queryClient = useQueryClient();
  const keys = channelQueryKeys(platform);
  return useMutation({
    mutationFn: (payload: ChannelConfigUpsertPayload) =>
      upsertChannelConfig(platform, payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.config });
      void queryClient.invalidateQueries({ queryKey: keys.runtime });
    },
  });
}

export function useTestChannelConnection(platform: ChannelPlatform) {
  return useMutation({
    mutationFn: (payload: ChannelConnectionTestPayload) =>
      testChannelConnection(platform, payload),
  });
}

export function useChannelRuntimeStatus(
  platform: ChannelPlatform,
  options?: { enabled?: boolean },
) {
  const enabled = options?.enabled ?? true;
  return useQuery({
    queryKey: channelQueryKeys(platform).runtime,
    queryFn: () => getChannelRuntimeStatus(platform),
    enabled,
  });
}

type ChannelListQueryOptions = {
  enabled?: boolean;
};

export function useCreatePairingCode(platform: ChannelPlatform) {
  return useMutation({
    mutationFn: (ttlMinutes: number) => createPairingCode(platform, ttlMinutes),
  });
}

export function usePendingPairRequests(
  platform: ChannelPlatform,
  options?: ChannelListQueryOptions,
) {
  const enabled = options?.enabled ?? true;
  return useQuery({
    queryKey: channelQueryKeys(platform).pending,
    queryFn: () => listPairRequests(platform, "pending"),
    enabled,
  });
}

export function useApprovePairRequest(platform: ChannelPlatform) {
  const queryClient = useQueryClient();
  const keys = channelQueryKeys(platform);
  return useMutation({
    mutationFn: ({
      requestId,
      payload,
    }: {
      requestId: number;
      payload: ChannelPairRequestDecisionPayload;
    }) => approvePairRequest(platform, requestId, payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.pending });
      void queryClient.invalidateQueries({ queryKey: keys.approved });
      void queryClient.invalidateQueries({ queryKey: keys.users });
    },
  });
}

export function useRejectPairRequest(platform: ChannelPlatform) {
  const queryClient = useQueryClient();
  const keys = channelQueryKeys(platform);
  return useMutation({
    mutationFn: ({
      requestId,
      payload,
    }: {
      requestId: number;
      payload: ChannelPairRequestDecisionPayload;
    }) => rejectPairRequest(platform, requestId, payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.pending });
      void queryClient.invalidateQueries({ queryKey: keys.approved });
    },
  });
}

export function useAuthorizedUsers(
  platform: ChannelPlatform,
  options?: ChannelListQueryOptions,
) {
  const enabled = options?.enabled ?? true;
  return useQuery({
    queryKey: channelQueryKeys(platform).users,
    queryFn: () => listAuthorizedUsers(platform, true),
    enabled,
  });
}

export function useRevokeAuthorizedUser(platform: ChannelPlatform) {
  const queryClient = useQueryClient();
  const keys = channelQueryKeys(platform);
  return useMutation({
    mutationFn: (userId: number) =>
      revokeAuthorizedUser(platform, userId, { handled_by: "ui" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.users });
    },
  });
}

export function useUpdateAuthorizedUserSessionOverride(platform: ChannelPlatform) {
  const queryClient = useQueryClient();
  const keys = channelQueryKeys(platform);
  return useMutation({
    mutationFn: ({
      userId,
      payload,
    }: {
      userId: number;
      payload: ChannelAuthorizedUserSessionOverridePayload;
    }) => updateAuthorizedUserSessionOverride(platform, userId, payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.users });
    },
  });
}
