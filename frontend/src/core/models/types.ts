export interface Model {
  id: string;
  name: string;
  display_name: string;
  description?: string | null;
  supports_thinking?: boolean;
  supports_reasoning_effort?: boolean;
  supports_vision?: boolean;
  supports_video?: boolean;
}

export interface ModelConnectionTestRequest {
  use: string;
  model?: string | null;
  api_key?: string | null;
  api_base?: string | null;
  provider_protocol?: "auto" | "openai-compatible" | "anthropic-compatible";
  timeout_seconds?: number;
  probe_message?: string;
}

export interface ModelConnectionTestResponse {
  success: boolean;
  message: string;
  latency_ms?: number | null;
  response_preview?: string | null;
}

export interface ProviderModelOption {
  id: string;
  name?: string | null;
  supports_thinking?: boolean | null;
  supports_vision?: boolean | null;
  supports_video?: boolean | null;
  context_window?: number | null;
  max_output_tokens?: number | null;
  source?: string;
}

export interface ProviderModelsRequest {
  use: string;
  api_key?: string | null;
  api_base?: string | null;
  provider_protocol?: "auto" | "openai-compatible" | "anthropic-compatible";
  timeout_seconds?: number;
}

export interface ProviderModelsResponse {
  success: boolean;
  message: string;
  provider_type: string;
  models: ProviderModelOption[];
}

export interface ModelMetadataRequest {
  model: string;
  use?: string;
  api_base?: string | null;
  provider_protocol?: "auto" | "openai-compatible" | "anthropic-compatible";
  timeout_seconds?: number;
}

export interface ModelMetadataResponse {
  success: boolean;
  found: boolean;
  message: string;
  model: ProviderModelOption | null;
}
