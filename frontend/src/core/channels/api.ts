import { getBackendBaseURL } from "@/core/config";

import type {
  ChannelAuthorizedUser,
  ChannelAuthorizedUserRevokePayload,
  ChannelAuthorizedUserRevokeResult,
  ChannelConfig,
  ChannelConfigUpsertPayload,
  ChannelConnectionTestPayload,
  ChannelConnectionTestResult,
  ChannelRuntimeStatus,
  ChannelPairingCode,
  ChannelPairRequest,
  ChannelPairRequestDecisionPayload,
  ChannelPlatform,
} from "./types";

async function parseError(response: Response, fallback: string): Promise<string> {
  const statusLabel = `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`;
  const detail = await response.text();
  if (!detail) {
    return `${fallback}: ${statusLabel}`;
  }
  try {
    const parsed = JSON.parse(detail) as { detail?: unknown };
    if (parsed && typeof parsed === "object" && parsed.detail !== undefined) {
      if (typeof parsed.detail === "string") {
        return `${statusLabel}: ${parsed.detail}`;
      }
      return `${statusLabel}: ${JSON.stringify(parsed.detail)}`;
    }
  } catch {
    // Ignore non-JSON body.
  }
  return `${statusLabel}: ${detail}`;
}

async function requestJSON<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
  fallback = "Request failed",
): Promise<T> {
  const response = await fetch(input, init);
  if (!response.ok) {
    throw new Error(await parseError(response, fallback));
  }
  return (await response.json()) as T;
}

export function getChannelConfig(platform: ChannelPlatform) {
  return requestJSON<ChannelConfig>(
    `${getBackendBaseURL()}/api/channels/${platform}/config`,
    undefined,
    "Failed to load channel config",
  );
}

export function upsertChannelConfig(platform: ChannelPlatform, payload: ChannelConfigUpsertPayload) {
  return requestJSON<ChannelConfig>(
    `${getBackendBaseURL()}/api/channels/${platform}/config`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "Failed to save channel config",
  );
}

export function testChannelConnection(platform: ChannelPlatform, payload: ChannelConnectionTestPayload) {
  return requestJSON<ChannelConnectionTestResult>(
    `${getBackendBaseURL()}/api/channels/${platform}/test`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "Failed to test channel connection",
  );
}

export function getChannelRuntimeStatus(platform: ChannelPlatform) {
  return fetch(`${getBackendBaseURL()}/api/channels/${platform}/runtime`)
    .then(async (response) => {
      if (response.ok) {
        return (await response.json()) as ChannelRuntimeStatus;
      }

      // Compatibility fallback for older backends without runtime endpoint.
      if (response.status === 404) {
        const config = await getChannelConfig(platform);
        return {
          platform,
          enabled: Boolean(config.enabled),
          mode: config.mode ?? "webhook",
          proxy_mode: platform === "dingtalk" ? (config.credentials.proxy_mode ?? "auto") : null,
          stream_health: "down",
          running: false,
          connected: false,
          active_users: 0,
          reconnect_count: 0,
          started_at: null,
          last_ws_connected_at: null,
          last_ws_disconnected_at: null,
          last_event_at: null,
          last_error: null,
          last_error_code: null,
          last_error_at: null,
          last_delivery_path: null,
          last_render_mode: null,
          last_fallback_reason: null,
          last_stream_chunk_at: null,
          last_media_attempted_count: 0,
          last_media_sent_count: 0,
          last_media_failed_count: 0,
          last_media_fallback_reason: null,
          updated_at: null,
        } satisfies ChannelRuntimeStatus;
      }

      throw new Error(await parseError(response, "Failed to load channel runtime status"));
    });
}

export function createPairingCode(platform: ChannelPlatform, ttlMinutes = 10) {
  return requestJSON<ChannelPairingCode>(
    `${getBackendBaseURL()}/api/channels/${platform}/pairing-code`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ttl_minutes: ttlMinutes }),
    },
    "Failed to create pairing code",
  );
}

export function listPairRequests(platform: ChannelPlatform, status?: "pending" | "approved" | "rejected") {
  const search = new URLSearchParams();
  if (status) {
    search.set("status", status);
  }
  const qs = search.toString();
  return requestJSON<ChannelPairRequest[]>(
    `${getBackendBaseURL()}/api/channels/${platform}/pair-requests${qs ? `?${qs}` : ""}`,
    undefined,
    "Failed to load pair requests",
  );
}

export function approvePairRequest(
  platform: ChannelPlatform,
  requestId: number,
  payload: ChannelPairRequestDecisionPayload,
) {
  return requestJSON<ChannelPairRequest>(
    `${getBackendBaseURL()}/api/channels/${platform}/pair-requests/${requestId}/approve`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "Failed to approve pair request",
  );
}

export function rejectPairRequest(
  platform: ChannelPlatform,
  requestId: number,
  payload: ChannelPairRequestDecisionPayload,
) {
  return requestJSON<ChannelPairRequest>(
    `${getBackendBaseURL()}/api/channels/${platform}/pair-requests/${requestId}/reject`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "Failed to reject pair request",
  );
}

export function listAuthorizedUsers(platform: ChannelPlatform, activeOnly = true) {
  const search = new URLSearchParams();
  search.set("active_only", activeOnly ? "true" : "false");
  return requestJSON<ChannelAuthorizedUser[]>(
    `${getBackendBaseURL()}/api/channels/${platform}/authorized-users?${search.toString()}`,
    undefined,
    "Failed to load authorized users",
  );
}

export function revokeAuthorizedUser(
  platform: ChannelPlatform,
  userId: number,
  payload: ChannelAuthorizedUserRevokePayload,
) {
  return requestJSON<ChannelAuthorizedUserRevokeResult>(
    `${getBackendBaseURL()}/api/channels/${platform}/authorized-users/${userId}/revoke`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "Failed to revoke authorized user",
  );
}
