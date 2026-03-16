import type { ProviderModelOption } from "@/core/models/types";

import {
  asArray,
  asString,
  cloneConfig,
  type ConfigDraft,
} from "../../shared";
import { detectPresetId, getPresetById } from "./presets";
import type {
  ProviderCatalogModel,
  ProviderDraft,
  ProviderProtocol,
} from "./types";
import {
  MODEL_PROVIDERS_KEY,
  OPENAI_PROVIDER_PRESET,
  ANTHROPIC_PROVIDER_PRESET,
} from "./types";

export function defaultUseByProtocol(protocol: ProviderProtocol): string {
  return protocol === "anthropic-compatible"
    ? "langchain_anthropic:ChatAnthropic"
    : "langchain_openai:ChatOpenAI";
}

export function inferProtocolFromUse(use: string): ProviderProtocol {
  const normalized = use.trim().toLowerCase();
  return normalized.includes("anthropic")
    ? "anthropic-compatible"
    : "openai-compatible";
}

export function normalizeProviderProtocol(value: string): ProviderProtocol {
  const normalized = value.trim().toLowerCase();
  if (normalized === "anthropic" || normalized === "anthropic-compatible") {
    return "anthropic-compatible";
  }
  return "openai-compatible";
}

export function protocolLabel(
  protocol: ProviderProtocol,
  labels: { providerProtocolAnthropic: string; providerProtocolOpenAI: string },
): string {
  if (protocol === "anthropic-compatible") {
    return labels.providerProtocolAnthropic;
  }
  return labels.providerProtocolOpenAI;
}

export function parseNumberInput(value: string): number | undefined {
  if (!value.trim()) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function toSafeAlias(value: string, fallbackPrefix: string): string {
  const alias = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return alias || fallbackPrefix;
}

export function buildProviderSignature(record: Record<string, unknown>): string {
  return [
    asString(record.use).trim(),
    asString(record.api_base).trim(),
    asString(record.api_key).trim(),
  ].join("|||");
}

export function asProviders(config: ConfigDraft): Record<string, unknown>[] {
  return asArray(config[MODEL_PROVIDERS_KEY]);
}

export function ensureUniqueId(baseId: string, used: Set<string>): string {
  if (!used.has(baseId)) {
    used.add(baseId);
    return baseId;
  }
  let cursor = 2;
  while (used.has(`${baseId}-${cursor}`)) {
    cursor += 1;
  }
  const unique = `${baseId}-${cursor}`;
  used.add(unique);
  return unique;
}

export function inferProviderLabelFromUse(use: string, index: number): string {
  const preset = getPresetById(detectPresetId(use));
  return preset?.label ?? `Provider ${index + 1}`;
}

export function normalizeCatalogModel(item: Record<string, unknown>): ProviderCatalogModel {
  const contextWindow = parseNumberInput(asString(item.context_window));
  const maxOutputTokens = parseNumberInput(asString(item.max_output_tokens));
  return {
    id: asString(item.id).trim(),
    name: asString(item.name).trim() || undefined,
    supports_thinking:
      typeof item.supports_thinking === "boolean"
        ? item.supports_thinking
        : null,
    supports_vision:
      typeof item.supports_vision === "boolean"
        ? item.supports_vision
        : null,
    supports_video:
      typeof item.supports_video === "boolean"
        ? item.supports_video
        : null,
    context_window: contextWindow ?? null,
    max_output_tokens: maxOutputTokens ?? null,
    source: asString(item.source).trim() || undefined,
  };
}

export function asCatalogModels(provider: Record<string, unknown>): ProviderCatalogModel[] {
  return asArray(provider.catalog_models)
    .map((item) => normalizeCatalogModel(item))
    .filter((item) => item.id.length > 0);
}

export function getProviderProtocol(provider: Record<string, unknown>): ProviderProtocol {
  const providerUse = asString(provider.use).trim();
  return normalizeProviderProtocol(
    asString(provider.protocol).trim()
    || inferProtocolFromUse(providerUse),
  );
}

function normalizeProviderList(
  rawProviders: Record<string, unknown>[],
): Record<string, unknown>[] {
  const usedIds = new Set<string>();

  return rawProviders.map((provider, index) => {
    const rawUse = asString(provider.use).trim();
    const rawApiBase = asString(provider.api_base).trim();
    const detectedPresetId = detectPresetId(rawUse, rawApiBase);
    const presetId = asString(provider.preset_id).trim() || detectedPresetId;
    const preset = getPresetById(presetId) ?? getPresetById(OPENAI_PROVIDER_PRESET);
    const explicitProtocol = asString(provider.protocol).trim();
    const providerProtocol = normalizeProviderProtocol(
      explicitProtocol !== ""
        ? explicitProtocol
        : (preset?.protocol ?? inferProtocolFromUse(rawUse)),
    );

    const providerUse =
      rawUse.length > 0
        ? rawUse
        : (preset?.use ?? defaultUseByProtocol(providerProtocol));

    const providerId = ensureUniqueId(
      toSafeAlias(
        asString(provider.id).trim()
          || asString(provider.name).trim()
          || `provider-${index + 1}`,
        `provider-${index + 1}`,
      ),
      usedIds,
    );

    const defaultApiBase = preset?.defaultApiBase ?? "";
    const providerApiBase = rawApiBase || defaultApiBase;
    const hasExplicitNameField = Object.prototype.hasOwnProperty.call(provider, "name");
    const providerName = hasExplicitNameField
      ? asString(provider.name)
      : inferProviderLabelFromUse(providerUse, index);

    const catalogModels = asCatalogModels(provider);

    return {
      ...provider,
      id: providerId,
      name: providerName,
      preset_id: presetId,
      protocol: providerProtocol,
      use: providerUse,
      api_key: asString(provider.api_key),
      api_base: providerApiBase,
      test_model: asString(provider.test_model).trim(),
      catalog_models: catalogModels.map((item) => ({
        id: item.id,
        name: item.name ?? "",
        supports_thinking: item.supports_thinking,
        supports_vision: item.supports_vision,
        supports_video: item.supports_video,
        context_window: item.context_window,
        max_output_tokens: item.max_output_tokens,
        source: item.source ?? "",
      })),
      catalog_updated_at: asString(provider.catalog_updated_at),
      catalog_provider_type: asString(provider.catalog_provider_type),
      catalog_message: asString(provider.catalog_message),
    };
  });
}

function deriveProvidersFromModels(
  models: Record<string, unknown>[],
): Record<string, unknown>[] {
  const signatureToProvider = new Map<string, Record<string, unknown>>();
  const usedIds = new Set<string>();

  models.forEach((model, index) => {
    const signature = buildProviderSignature(model);
    const use = asString(model.use).trim();
    if (!use || signatureToProvider.has(signature)) {
      return;
    }

    const presetId = detectPresetId(use, asString(model.api_base).trim());
    const preset = getPresetById(presetId);
    const baseId = toSafeAlias(
      asString(model.provider_id).trim()
        || asString(model.name).trim()
        || `provider-${index + 1}`,
      `provider-${index + 1}`,
    );

    const providerId = ensureUniqueId(baseId, usedIds);
    signatureToProvider.set(signature, {
      id: providerId,
      name: inferProviderLabelFromUse(use, signatureToProvider.size),
      preset_id: presetId,
      protocol: inferProtocolFromUse(use),
      use,
      api_key: asString(model.api_key),
      api_base:
        asString(model.api_base).trim().length > 0
          ? asString(model.api_base).trim()
          : (preset?.defaultApiBase ?? ""),
      test_model: "",
      catalog_models: [],
      catalog_updated_at: "",
      catalog_provider_type: "",
      catalog_message: "",
    });
  });

  return [...signatureToProvider.values()];
}

export function normalizeModelProviderConfig(config: ConfigDraft): ConfigDraft {
  const next = cloneConfig(config);
  const rawModels = asArray(next.models);
  const initialProviders = asProviders(next);

  const providersFromConfig =
    initialProviders.length > 0
      ? normalizeProviderList(initialProviders)
      : normalizeProviderList(deriveProvidersFromModels(rawModels));

  const providerById = new Map<string, Record<string, unknown>>();
  const signatureToProviderId = new Map<string, string>();
  providersFromConfig.forEach((provider) => {
    const providerId = asString(provider.id).trim();
    if (!providerId) {
      return;
    }
    providerById.set(providerId, provider);
    signatureToProviderId.set(buildProviderSignature(provider), providerId);
  });

  const normalizedModels = rawModels.map((model, index) => {
    let providerId = asString(model.provider_id).trim();
    if (!providerId || !providerById.has(providerId)) {
      providerId = signatureToProviderId.get(buildProviderSignature(model)) ?? "";
    }

    const selectedProvider = providerId ? providerById.get(providerId) : undefined;
    const normalizedName = toSafeAlias(
      asString(model.name).trim()
        || asString(model.model).trim()
        || `model-${index + 1}`,
      `model-${index + 1}`,
    );
    const normalizedModel: Record<string, unknown> = {
      ...model,
      name: normalizedName,
      provider_id: providerId,
    };

    if (selectedProvider) {
      const providerUse = asString(selectedProvider.use).trim();
      const providerApiKey = asString(selectedProvider.api_key);
      const providerApiBase = asString(selectedProvider.api_base).trim();
      const providerProtocol = normalizeProviderProtocol(
        asString(selectedProvider.protocol).trim()
        || inferProtocolFromUse(providerUse),
      );
      normalizedModel.use = providerUse;
      normalizedModel.api_key = providerApiKey;
      normalizedModel.provider_protocol = providerProtocol;
      if (providerApiBase) {
        normalizedModel.api_base = providerApiBase;
      } else {
        delete normalizedModel.api_base;
      }
    }

    return normalizedModel;
  });

  const normalizedProviders = providersFromConfig.map((provider) => ({
    ...provider,
    test_model: asString(provider.test_model).trim(),
  }));

  next[MODEL_PROVIDERS_KEY] = normalizedProviders;
  next.models = normalizedModels;
  return next;
}

export function mapProviderModelOptionToConfig(
  model: ProviderModelOption,
): Record<string, unknown> {
  return {
    id: model.id,
    name: model.name ?? "",
    supports_thinking:
      typeof model.supports_thinking === "boolean"
        ? model.supports_thinking
        : null,
    supports_vision:
      typeof model.supports_vision === "boolean"
        ? model.supports_vision
        : null,
    supports_video:
      typeof model.supports_video === "boolean"
        ? model.supports_video
        : null,
    context_window:
      typeof model.context_window === "number" ? model.context_window : null,
    max_output_tokens:
      typeof model.max_output_tokens === "number"
        ? model.max_output_tokens
        : null,
    source: model.source ?? "",
  };
}

export function createProviderDraft(
  protocol: ProviderProtocol,
  providerIndex: number,
  labels: {
    defaultAnthropicProviderNameTemplate: string;
    defaultOpenaiProviderNameTemplate: string;
  },
): ProviderDraft {
  const preset = getPresetById(
    protocol === "anthropic-compatible"
      ? ANTHROPIC_PROVIDER_PRESET
      : OPENAI_PROVIDER_PRESET,
  );
  const template = protocol === "anthropic-compatible"
    ? labels.defaultAnthropicProviderNameTemplate
    : labels.defaultOpenaiProviderNameTemplate;
  const defaultName = template.replace("{index}", String(providerIndex));

  return {
    name: defaultName,
    protocol,
    api_key: "",
    api_base: preset?.defaultApiBase ?? "",
    use: preset?.use ?? defaultUseByProtocol(protocol),
  };
}

export function formatLastTestTime(
  raw: string,
  locale: string,
  notTestedLabel: string,
): string {
  const value = raw.trim();
  if (!value) {
    return notTestedLabel;
  }
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return value;
  }
  return new Date(timestamp).toLocaleString(locale);
}

export function isFieldBlank(value: unknown): boolean {
  if (value === undefined || value === null) {
    return true;
  }
  if (typeof value === "string") {
    return value.trim() === "";
  }
  return false;
}

export function mergeModelMetadata(
  current: Record<string, unknown>,
  metadata: ProviderModelOption,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...current };

  if (
    typeof metadata.supports_thinking === "boolean"
    && isFieldBlank(current.supports_thinking)
  ) {
    next.supports_thinking = metadata.supports_thinking;
  }

  if (
    typeof metadata.supports_vision === "boolean"
    && isFieldBlank(current.supports_vision)
  ) {
    next.supports_vision = metadata.supports_vision;
  }

  if (
    typeof metadata.supports_video === "boolean"
    && isFieldBlank(current.supports_video)
  ) {
    next.supports_video = metadata.supports_video;
  }

  if (
    typeof metadata.max_output_tokens === "number"
    && parseNumberInput(asString(current.max_tokens)) === undefined
  ) {
    next.max_tokens = metadata.max_output_tokens;
  }

  if (
    typeof metadata.context_window === "number"
    && parseNumberInput(asString(current.context_window)) === undefined
  ) {
    next.context_window = metadata.context_window;
  }

  if (isFieldBlank(current.display_name) && asString(metadata.name).trim() !== "") {
    next.display_name = metadata.name;
  }

  return next;
}
