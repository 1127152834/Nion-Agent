import type { ProviderPreset, ProviderProtocol } from "./types";
import {
  OPENAI_PROVIDER_PRESET,
  ANTHROPIC_PROVIDER_PRESET,
} from "./types";

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: OPENAI_PROVIDER_PRESET,
    label: "OpenAI",
    use: "langchain_openai:ChatOpenAI",
    protocol: "openai-compatible",
    apiKeyHint: "$OPENAI_API_KEY",
    defaultApiBase: "https://api.openai.com/v1",
    defaultTestModel: "gpt-4o-mini",
  },
  {
    id: ANTHROPIC_PROVIDER_PRESET,
    label: "Anthropic",
    use: "langchain_anthropic:ChatAnthropic",
    protocol: "anthropic-compatible",
    apiKeyHint: "$ANTHROPIC_API_KEY",
    defaultApiBase: "https://api.anthropic.com",
    defaultTestModel: "claude-3-5-sonnet-latest",
  },
];

export function getPresetById(presetId: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((preset) => preset.id === presetId);
}

export function detectPresetId(use: string, apiBase?: string): string {
  const useLower = use.trim().toLowerCase();
  const apiBaseLower = (apiBase ?? "").trim().toLowerCase();
  if (apiBaseLower.includes("anthropic")) {
    return ANTHROPIC_PROVIDER_PRESET;
  }
  if (useLower.includes("anthropic")) {
    return ANTHROPIC_PROVIDER_PRESET;
  }
  return OPENAI_PROVIDER_PRESET;
}
