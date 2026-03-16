export const MODEL_PROVIDERS_KEY = "model_providers";
export const OPENAI_PROVIDER_PRESET = "openai-compatible";
export const ANTHROPIC_PROVIDER_PRESET = "anthropic-compatible";
export const UNASSIGNED_PROVIDER = "__unassigned_provider__";

export type ModelSettingsChildView = "providers" | "models";
export type ProviderProtocol = "openai-compatible" | "anthropic-compatible";

export type ProviderPreset = {
  id: string;
  label: string;
  use?: string;
  protocol: ProviderProtocol;
  defaultApiBase?: string;
  apiKeyHint?: string;
  defaultTestModel?: string;
};

export type ProviderFeedback = {
  success: boolean;
  message: string;
  latencyMs?: number | null;
  responsePreview?: string | null;
};

export type ProviderCatalogModel = {
  id: string;
  name?: string;
  supports_thinking?: boolean | null;
  supports_vision?: boolean | null;
  supports_video?: boolean | null;
  context_window?: number | null;
  max_output_tokens?: number | null;
  source?: string;
};

export type PendingDeleteAction =
  | {
      kind: "provider";
      providerId: string;
      message: string;
    }
  | {
      kind: "model";
      index: number;
      message: string;
      afterDelete?: () => void;
    };

export type ProviderPanelView = "list" | "create" | "edit";
export type ModelPanelView = "list" | "create" | "edit";
export type ProviderDetailView = "details" | "models";

export type ProviderDraft = {
  name: string;
  protocol: ProviderProtocol;
  api_key: string;
  api_base: string;
  use: string;
};
