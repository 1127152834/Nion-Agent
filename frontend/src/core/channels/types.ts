export type ChannelPlatform = "lark" | "dingtalk" | "telegram";
export type ChannelMode = "webhook" | "stream";

export interface ChannelConfig {
  platform: ChannelPlatform;
  enabled: boolean;
  mode: ChannelMode;
  credentials: Record<string, string>;
  default_workspace_id: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface ChannelConfigUpsertPayload {
  enabled: boolean;
  mode: ChannelMode;
  credentials: Record<string, string>;
  default_workspace_id?: string | null;
}

export interface ChannelConnectionTestPayload {
  credentials: Record<string, string>;
  timeout_seconds?: number;
}

export interface ChannelConnectionTestResult {
  platform: ChannelPlatform;
  success: boolean;
  message: string;
  latency_ms: number | null;
}

export interface ChannelRuntimeStatus {
  platform: ChannelPlatform;
  enabled: boolean;
  mode: ChannelMode;
  proxy_mode: string | null;
  stream_health: string | null;
  running: boolean;
  connected: boolean;
  active_users: number;
  reconnect_count: number;
  started_at: string | null;
  last_ws_connected_at: string | null;
  last_ws_disconnected_at: string | null;
  last_event_at: string | null;
  last_error: string | null;
  last_error_code: string | null;
  last_error_at: string | null;
  last_delivery_path: string | null;
  last_render_mode: string | null;
  last_fallback_reason: string | null;
  last_stream_chunk_at: string | null;
  last_media_attempted_count: number;
  last_media_sent_count: number;
  last_media_failed_count: number;
  last_media_fallback_reason: string | null;
  updated_at: string | null;
}

export interface ChannelPairingCode {
  id: number;
  platform: ChannelPlatform;
  code: string;
  expires_at: string;
  consumed_at: string | null;
  created_at: string;
}

export interface ChannelPairRequest {
  id: number;
  platform: ChannelPlatform;
  code: string;
  external_user_id: string;
  external_user_name: string | null;
  chat_id: string;
  conversation_type: string | null;
  source_event_id: string | null;
  status: "pending" | "approved" | "rejected";
  note: string | null;
  created_at: string;
  handled_at: string | null;
  handled_by: string | null;
}

export interface ChannelPairRequestDecisionPayload {
  handled_by?: string;
  note?: string;
  workspace_id?: string;
}

export interface ChannelAuthorizedUser {
  id: number;
  platform: ChannelPlatform;
  external_user_id: string;
  external_user_name: string | null;
  chat_id: string | null;
  conversation_type: string | null;
  workspace_id: string | null;
  granted_at: string;
  revoked_at: string | null;
  source_request_id: number | null;
}

export interface ChannelAuthorizedUserRevokePayload {
  handled_by?: string;
}

export interface ChannelAuthorizedUserRevokeResult {
  revoked: boolean;
}
