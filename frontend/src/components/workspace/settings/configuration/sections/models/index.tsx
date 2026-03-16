"use client";

import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronsUpDownIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  EyeIcon,
  EyeOffIcon,
  PlusIcon,
  PlugZapIcon,
  SearchIcon,
  SparklesIcon,
  StarIcon,
  Trash2Icon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/core/i18n/hooks";
import {
  loadModelMetadata,
  loadProviderModels,
  testModelConnection,
} from "@/core/models/api";
import type { ProviderModelOption } from "@/core/models/types";
import { cn } from "@/lib/utils";

import { ConfirmActionDialog } from "../../../confirm-action-dialog";
import {
  asArray,
  asBoolean,
  asString,
  cloneConfig,
  type ConfigDraft,
} from "../../shared";
import { detectPresetId, getPresetById } from "./presets";
import type {
  ModelPanelView,
  ModelSettingsChildView,
  PendingDeleteAction,
  ProviderCatalogModel,
  ProviderDetailView,
  ProviderDraft,
  ProviderFeedback,
  ProviderPanelView,
  ProviderProtocol,
} from "./types";
import {
  MODEL_PROVIDERS_KEY,
  OPENAI_PROVIDER_PRESET,
  ANTHROPIC_PROVIDER_PRESET,
  UNASSIGNED_PROVIDER,
} from "./types";
import {
  asCatalogModels,
  asProviders,
  buildProviderSignature,
  createProviderDraft,
  defaultUseByProtocol,
  ensureUniqueId,
  formatLastTestTime,
  getProviderProtocol,
  isFieldBlank,
  mapProviderModelOptionToConfig,
  mergeModelMetadata,
  normalizeModelProviderConfig,
  normalizeProviderProtocol,
  parseNumberInput,
  protocolLabel,
  toSafeAlias,
} from "./utils";

export { normalizeModelProviderConfig } from "./utils";
export type { ModelSettingsChildView } from "./types";

export function ModelsSection({
  config,
  onChange,
  disabled,
  view = "providers",
  onViewChange,
}: {
  config: ConfigDraft;
  onChange: (next: ConfigDraft) => void;
  disabled?: boolean;
  view?: ModelSettingsChildView;
  onViewChange?: (nextView: ModelSettingsChildView) => void;
}) {
  const { locale, t } = useI18n();
  const settingsLike = t.settings as {
    configSections?: {
      models?: Record<string, string>;
    };
  };
  const m = settingsLike.configSections?.models ?? {};
  const preparedConfig = useMemo(
    () => normalizeModelProviderConfig(config),
    [config],
  );
  const providers = asProviders(preparedConfig);
  const models = asArray(preparedConfig.models);
  const providerNameTemplates = {
    defaultOpenaiProviderNameTemplate:
      m?.defaultOpenaiProviderNameTemplate ?? "OpenAI Compatible Provider {index}",
    defaultAnthropicProviderNameTemplate:
      m?.defaultAnthropicProviderNameTemplate ?? "Anthropic Compatible Provider {index}",
  };

  const [providerPanelView, setProviderPanelView] = useState<ProviderPanelView>(
    providers.length > 0 ? "list" : "create",
  );
  const [selectedProviderId, setSelectedProviderId] = useState(
    asString(providers[0]?.id).trim(),
  );
  const [createDraft, setCreateDraft] = useState<ProviderDraft>(() =>
    createProviderDraft("openai-compatible", 1, providerNameTemplates),
  );
  const [createFeedback, setCreateFeedback] = useState<ProviderFeedback | null>(null);
  const [createApiKeyVisible, setCreateApiKeyVisible] = useState(false);
  const [editApiKeyVisible, setEditApiKeyVisible] = useState(false);

  const [providerFeedback, setProviderFeedback] = useState<Record<string, ProviderFeedback>>({});
  const [testingProviderKey, setTestingProviderKey] = useState<string | null>(null);
  const [loadingCatalogProviderId, setLoadingCatalogProviderId] = useState<string | null>(null);

  const [providerDetailView, setProviderDetailView] = useState<ProviderDetailView>("details");
  const [modelAdvancedOpen, setModelAdvancedOpen] = useState<Record<number, boolean>>({});
  const [modelIdPickerOpen, setModelIdPickerOpen] = useState<Record<number, boolean>>({});
  const [modelIdSearch, setModelIdSearch] = useState<Record<number, string>>({});
  const [manualModelInputByIndex, setManualModelInputByIndex] = useState<Record<number, boolean>>({});
  const [modelPanelView, setModelPanelView] = useState<ModelPanelView>(
    "list",
  );
  const [selectedModelIndex, setSelectedModelIndex] = useState(0);
  const [providerModelDialogOpen, setProviderModelDialogOpen] = useState(false);

  const [catalogSelectedProviderId, setCatalogSelectedProviderId] = useState(
    asString(providers[0]?.id).trim(),
  );
  const [catalogSearch, setCatalogSearch] = useState("");
  const [catalogSelectedModelIds, setCatalogSelectedModelIds] = useState<string[]>([]);
  const [addingCatalogModels, setAddingCatalogModels] = useState(false);
  const [inspectingModelKey, setInspectingModelKey] = useState<string | null>(null);
  const [pendingDeleteAction, setPendingDeleteAction] =
    useState<PendingDeleteAction | null>(null);

  const copy = {
    providersTitle: m?.providersTitle ?? "Providers",
    providersSubtitle: m?.providersSubtitle ?? "Set up provider connections, then add models inside each provider.",
    createProvider: m?.createProvider ?? "New Provider",
    providerDetailTitle: m?.providerDetailTitle ?? "Provider Details",
    createDetailTitle: m?.createDetailTitle ?? "Create Provider",
    createDetailHint: m?.createDetailHint ?? "Only a few fields are required to connect.",
    providerName: m?.providerName ?? "Provider Name",
    providerNamePlaceholder: m?.providerNamePlaceholder ?? "e.g. OpenAI Production",
    providerProtocol: m?.providerProtocol ?? "Protocol",
    providerProtocolOpenAI: m?.providerProtocolOpenAI ?? "OpenAI Compatible",
    providerProtocolAnthropic: m?.providerProtocolAnthropic ?? "Anthropic Compatible",
    apiKey: m?.apiKey ?? "API Key / Env Var",
    apiBase: m?.apiBase ?? "API Base",
    apiBasePlaceholder: m?.apiBasePlaceholder ?? "e.g. https://api.openai.com/v1",
    apiBasePlaceholderAnthropic: m?.apiBasePlaceholderAnthropic ?? "e.g. https://api.anthropic.com or https://api.minimaxi.com/anthropic",
    showApiKey: m?.showApiKey ?? "Show API key",
    hideApiKey: m?.hideApiKey ?? "Hide API key",
    testConnection: m?.testConnection ?? "Test Connection",
    testingConnection: m?.testingConnection ?? "Testing...",
    fetchingCatalog: m?.fetchingCatalog ?? "Refreshing...",
    saveProvider: m?.saveProvider ?? "Save Provider",
    deleteProvider: m?.deleteProvider ?? "Delete Provider",
    remove: m?.remove ?? "Remove",
    confirmDeleteTitle: m?.confirmDeleteTitle ?? "Confirm Deletion",
    confirmDeleteAction: m?.confirmDeleteAction ?? "Delete",
    confirmDeleteProvider: m?.confirmDeleteProvider ?? "Delete provider \"{name}\"? Models under this provider will be re-bound or cleared.",
    confirmDeleteModel: m?.confirmDeleteModel ?? "Delete model \"{name}\"?",
    advanced: m?.advanced ?? "Advanced",
    backToProviderList: m?.backToProviderList ?? "Back to Providers",
    openProviderModels: m?.openProviderModels ?? "Model List",
    backToProviderDetail: m?.backToProviderDetail ?? "Back to provider details",
    openProvider: m?.openProvider ?? "Edit",
    statusConnected: m?.statusConnected ?? "Connected",
    statusFailed: m?.statusFailed ?? "Failed",
    statusUntested: m?.statusUntested ?? "Untested",
    lastTestedAt: m?.lastTestedAt ?? "Last tested",
    modelCount: m?.modelCount ?? "Models",
    noProvider: m?.noProvider ?? "No providers yet.",
    noProviderCtaTitle: m?.noProviderCtaTitle ?? "Create your first provider",
    noProviderCtaHint: m?.noProviderCtaHint ?? "Create a provider first, then add models.",
    goCreateProvider: m?.goCreateProvider ?? "Create Provider",
    modelsTitle: m?.modelsTitle ?? "Models",
    modelsSubtitle: m?.modelsSubtitle ?? "View models and set the default model only.",
    modelListTitle: m?.modelListTitle ?? "Model List",
    modelListSubtitle: m?.modelListSubtitle ?? "Set default model or remove models you no longer need.",
    createModel: m?.createModel ?? "New Model",
    createModelTitle: m?.createModelTitle ?? "Create Model",
    editModelTitle: m?.editModelTitle ?? "Model Details",
    backToModelList: m?.backToModelList ?? "Back to Models",
    noModelOnList: m?.noModelOnList ?? "No models yet. Add models in provider settings first.",
    openModel: m?.openModel ?? "Edit",
    capabilityReasoning: m?.capabilityReasoning ?? "Reasoning",
    capabilityVision: m?.capabilityVision ?? "Vision",
    capabilityVideo: m?.capabilityVideo ?? "Video",
    addFlowTitle: m?.addFlowTitle ?? "Add Models",
    addFlowHint: m?.addFlowHint ?? "Choose provider and input mode.",
    stepChooseProvider: m?.stepChooseProvider ?? "Step 1: Choose Provider",
    stepChooseSource: m?.stepChooseSource ?? "Step 2: Choose Source",
    stepAddAction: m?.stepAddAction ?? "Step 3: Add Model",
    stepChooseProviderHint: m?.stepChooseProviderHint ?? "Pick provider first and refresh its model list if needed.",
    stepChooseSourceHint: m?.stepChooseSourceHint ?? "Use catalog when available, otherwise switch to manual input.",
    stepAddActionHint: m?.stepAddActionHint ?? "Model metadata will be auto-detected after adding.",
    selectProviderFirstHint: m?.selectProviderFirstHint ?? "Please choose a provider first.",
    providerModelsTitle: m?.providerModelsTitle ?? "Provider Models",
    providerModelsSubtitle: m?.providerModelsSubtitle ?? "Add or remove models within this provider.",
    addProviderModel: m?.addProviderModel ?? "Add Model",
    addProviderModelDialogTitle: m?.addProviderModelDialogTitle ?? "Add Models",
    addProviderModelDialogDesc: m?.addProviderModelDialogDesc ?? "Search and select models; press Enter to add a custom model ID.",
    backToProviderModels: m?.backToProviderModels ?? "Back to models",
    noProviderModels: m?.noProviderModels ?? "No models in this provider.",
    usingProvider: m?.usingProvider ?? "Current Provider",
    selectProvider: m?.selectProvider ?? "Select Provider",
    searchModel: m?.searchModel ?? "Search models...",
    enterToAddModel: m?.enterToAddModel ?? "Press Enter to add custom model ID",
    quickAddLabel: m?.quickAddLabel ?? "Quick add",
    selected: m?.selected ?? "Selected",
    selectedModelsEmpty: m?.selectedModelsEmpty ?? "No selected models yet",
    manualAddedTag: m?.manualAddedTag ?? "Manual",
    addSelectedModels: m?.addSelectedModels ?? "Add Models",
    manualInput: m?.manualInput ?? "Manual Input",
    catalogInput: m?.catalogInput ?? "Catalog Select",
    adding: m?.adding ?? "Adding...",
    noCatalog: m?.noCatalog ?? "No catalog from provider. Type model ID and press Enter.",
    noModel: m?.noModel ?? "No models configured yet.",
    modelName: m?.modelName ?? "Display Name",
    modelNamePlaceholder: m?.modelNamePlaceholder ?? "e.g. GPT-4o Mini",
    modelId: m?.modelId ?? "Model ID",
    modelIdPlaceholder: m?.modelIdPlaceholder ?? "e.g. gpt-4o-mini",
    bindProvider: m?.bindProvider ?? "Provider",
    unassigned: m?.unassigned ?? "Unassigned",
    legacyImported: m?.legacyImported ?? "Legacy config",
    setDefault: m?.setDefault ?? "Set Default",
    default: m?.default ?? "Default",
    internalName: m?.internalName ?? "Internal Name",
    internalNamePlaceholder: m?.internalNamePlaceholder ?? "Auto-generated, editable",
    maxTokens: m?.maxTokens ?? "Max Output Tokens",
    contextWindow: m?.contextWindow ?? "Context Window",
    temperature: m?.temperature ?? "Temperature",
    supportsThinking: m?.supportsThinking ?? "Supports Reasoning",
    supportsVision: m?.supportsVision ?? "Supports Vision",
    supportsVideo: m?.supportsVideo ?? "Supports Video",
    expandDetails: m?.expandDetails ?? "Expand",
    collapseDetails: m?.collapseDetails ?? "Collapse",
    inspectModel: m?.inspectModel ?? "Check Params",
    inspectingModel: m?.inspectingModel ?? "Checking...",
    modelMissingRequired: m?.modelMissingRequired ?? "Missing required fields",
    duplicateModelName: m?.duplicateModelName ?? "Duplicate internal name",
    testSuccess: m?.testSuccess ?? "Connected",
    testFailed: m?.testFailed ?? "Connection failed",
    requireProviderForManualAdd: m?.requireProviderForManualAdd ?? "Please choose a provider first.",
    requireModelIdForManualAdd: m?.requireModelIdForManualAdd ?? "Please fill model ID first.",
    duplicateModelHint: m?.duplicateModelHint ?? "Model already exists.",
    metadataFilled: m?.metadataFilled ?? "Model parameters were auto-filled.",
    metadataNotFound: m?.metadataNotFound ?? "No models.dev match. No field changed.",
    inspectRequiresProvider: m?.inspectRequiresProvider ?? "Bind provider before checking.",
    inspectRequiresModelId: m?.inspectRequiresModelId ?? "Fill model ID before checking.",
    modelListCollapsedHint: m?.modelListCollapsedHint ?? "Model details are collapsed by default. Click Expand to edit.",
    quickActionsTitle: m?.quickActionsTitle ?? "Quick Actions",
    quickActionsHint: m?.quickActionsHint ?? "Common actions in one place.",
    cancel: m?.cancel ?? t.common.cancel,
    defaultOpenaiProviderNameTemplate: providerNameTemplates.defaultOpenaiProviderNameTemplate,
    defaultAnthropicProviderNameTemplate: providerNameTemplates.defaultAnthropicProviderNameTemplate,
    modelFallbackNameTemplate: m?.modelFallbackNameTemplate ?? "Model #{index}",
    addedModelsToastTemplate: m?.addedModelsToastTemplate ?? "{count} model(s) added.",
  };
  const protocolCopy = copy as {
    providerProtocolAnthropic: string;
    providerProtocolOpenAI: string;
  };

  const formatModelFallbackName = (index: number) =>
    copy.modelFallbackNameTemplate.replace("{index}", String(index + 1));

  const modelNameCount = useMemo(() => {
    const counter = new Map<string, number>();
    models.forEach((model) => {
      const name = asString(model.name).trim();
      if (!name) {
        return;
      }
      counter.set(name, (counter.get(name) ?? 0) + 1);
    });
    return counter;
  }, [models]);

  const providerById = useMemo(() => {
    const map = new Map<string, Record<string, unknown>>();
    providers.forEach((provider) => {
      const providerId = asString(provider.id).trim();
      if (!providerId) {
        return;
      }
      map.set(providerId, provider);
    });
    return map;
  }, [providers]);

  const providerOptions = useMemo(
    () =>
      providers
        .map((provider) => {
          const providerId = asString(provider.id).trim();
          if (!providerId) {
            return null;
          }
          return {
            id: providerId,
            name: asString(provider.name).trim() || providerId,
          };
        })
        .filter((item): item is { id: string; name: string } => item !== null),
    [providers],
  );

  const providerProtocolById = useMemo(() => {
    const map = new Map<string, ProviderProtocol>();
    providers.forEach((provider) => {
      const providerId = asString(provider.id).trim();
      if (!providerId) {
        return;
      }
      map.set(providerId, getProviderProtocol(provider));
    });
    return map;
  }, [providers]);

  const providerNameById = useMemo(() => {
    const map = new Map<string, string>();
    providers.forEach((provider) => {
      const providerId = asString(provider.id).trim();
      if (!providerId) {
        return;
      }
      map.set(providerId, asString(provider.name).trim() || providerId);
    });
    return map;
  }, [providers]);

  const configuredModelCountByProviderId = useMemo(() => {
    const map = new Map<string, number>();
    models.forEach((model) => {
      const providerId = asString(model.provider_id).trim();
      if (!providerId) {
        return;
      }
      map.set(providerId, (map.get(providerId) ?? 0) + 1);
    });
    return map;
  }, [models]);

  const providerCatalogMap = useMemo(() => {
    const map = new Map<string, ProviderCatalogModel[]>();
    providers.forEach((provider) => {
      const providerId = asString(provider.id).trim();
      if (!providerId) {
        return;
      }
      map.set(providerId, asCatalogModels(provider));
    });
    return map;
  }, [providers]);

  const selectedProviderIndex = useMemo(
    () => providers.findIndex((provider) => asString(provider.id).trim() === selectedProviderId),
    [providers, selectedProviderId],
  );

  const selectedProvider = selectedProviderIndex >= 0
    ? providers[selectedProviderIndex]
    : null;

  const activeCatalogProviderId =
    catalogSelectedProviderId.trim() !== ""
      ? catalogSelectedProviderId
      : (providerOptions[0]?.id ?? "");

  useEffect(() => {
    if (providers.length === 0) {
      setProviderPanelView("create");
      setSelectedProviderId("");
      return;
    }

    const providerExists = providers.some(
      (provider) => asString(provider.id).trim() === selectedProviderId,
    );
    if (!providerExists) {
      setSelectedProviderId(asString(providers[0]?.id).trim());
    }

    if (providerPanelView === "create" && selectedProviderId.trim() === "") {
      setProviderPanelView("list");
    }

    if (providerPanelView === "edit" && !providerExists) {
      setProviderPanelView("list");
    }
  }, [providerPanelView, providers, selectedProviderId]);

  useEffect(() => {
    const current = catalogSelectedProviderId.trim();
    if (current && providerById.has(current)) {
      return;
    }
    setCatalogSelectedProviderId(providerOptions[0]?.id ?? "");
  }, [catalogSelectedProviderId, providerById, providerOptions]);

  useEffect(() => {
    if (models.length === 0) {
      setModelPanelView("list");
      setSelectedModelIndex(0);
      return;
    }

    if (selectedModelIndex >= models.length) {
      setSelectedModelIndex(0);
    }

    if (modelPanelView === "edit" && selectedModelIndex >= models.length) {
      setModelPanelView("list");
    }
  }, [modelPanelView, models.length, selectedModelIndex]);

  useEffect(() => {
    setProviderDetailView("details");
    setProviderModelDialogOpen(false);
  }, [providerPanelView, selectedProviderId, view]);

  useEffect(() => {
    if (providerPanelView === "create") {
      setCreateApiKeyVisible(false);
      return;
    }
    setEditApiKeyVisible(false);
  }, [providerPanelView, selectedProviderId]);

  const updatePreparedConfig = (mutator: (next: ConfigDraft) => void) => {
    const next = cloneConfig(preparedConfig);
    mutator(next);
    onChange(next);
  };

  const updateProviderAt = (
    index: number,
    updater: (current: Record<string, unknown>) => Record<string, unknown>,
  ) => {
    updatePreparedConfig((next) => {
      const list = asProviders(next);
      const current = list[index] ?? {};
      list[index] = updater(current);
      next[MODEL_PROVIDERS_KEY] = list;
    });
  };

  const updateProviderById = (
    providerId: string,
    updater: (current: Record<string, unknown>) => Record<string, unknown>,
  ) => {
    const targetIndex = providers.findIndex(
      (provider) => asString(provider.id).trim() === providerId,
    );
    if (targetIndex < 0) {
      return;
    }
    updateProviderAt(targetIndex, updater);
  };

  const updateModelAt = (
    index: number,
    updater: (current: Record<string, unknown>) => Record<string, unknown>,
  ) => {
    updatePreparedConfig((next) => {
      const list = asArray(next.models);
      const current = list[index] ?? {};
      list[index] = updater(current);
      next.models = list;
    });
  };

  const updateOptionalNumberField = (index: number, key: string, raw: string) => {
    const parsed = parseNumberInput(raw);
    updateModelAt(index, (current) => {
      const nextModel = { ...current };
      if (parsed === undefined) {
        delete nextModel[key];
      } else {
        nextModel[key] = parsed;
      }
      return nextModel;
    });
  };

  const updateProviderProtocol = (index: number, protocol: ProviderProtocol) => {
    const preset = getPresetById(
      protocol === "anthropic-compatible"
        ? ANTHROPIC_PROVIDER_PRESET
        : OPENAI_PROVIDER_PRESET,
    );
    updateProviderAt(index, (current) => ({
      ...current,
      protocol,
      use: defaultUseByProtocol(protocol),
      preset_id: preset?.id ?? OPENAI_PROVIDER_PRESET,
      api_base:
        asString(current.api_base).trim() !== ""
          ? asString(current.api_base).trim()
          : (preset?.defaultApiBase ?? ""),
    }));
  };

  const removeProvider = (providerId: string) => {
    const fallbackProviderId = asString(
      providers.find((provider) => asString(provider.id).trim() !== providerId)?.id,
    ).trim();

    updatePreparedConfig((next) => {
      const currentProviders = asProviders(next).filter(
        (provider) => asString(provider.id).trim() !== providerId,
      );
      const fallbackProvider = currentProviders[0] ?? {};
      const fallbackProviderId = asString(fallbackProvider.id).trim();
      const fallbackProviderProtocol = fallbackProviderId
        ? getProviderProtocol(fallbackProvider)
        : undefined;
      const shouldClearProviderFields = currentProviders.length === 0;
      const currentModels = asArray(next.models).map((model) => {
        const modelProviderId = asString(model.provider_id).trim();
        if (!shouldClearProviderFields && modelProviderId !== providerId) {
          return model;
        }

        if (shouldClearProviderFields) {
          const nextModel: Record<string, unknown> = {
            ...model,
            provider_id: "",
            provider_protocol: "",
          };
          delete nextModel.use;
          delete nextModel.api_key;
          delete nextModel.api_base;
          return nextModel;
        }

        return {
          ...model,
          provider_id: fallbackProviderId,
          provider_protocol: fallbackProviderProtocol,
        };
      });
      next[MODEL_PROVIDERS_KEY] = currentProviders;
      next.models = currentModels;
    });

    setProviderFeedback((prev) => {
      const next = { ...prev };
      delete next[providerId];
      return next;
    });
    setProviderDetailView("details");
    setProviderModelDialogOpen(false);
    setProviderPanelView("list");
    setSelectedProviderId(fallbackProviderId);
  };

  const runProviderConnectionTest = async (
    input: {
      providerKey: string;
      providerId?: string;
      use: string;
      apiKey: string;
      apiBase: string;
      model?: string;
      protocol: ProviderProtocol;
    },
  ) => {
    setTestingProviderKey(input.providerKey);
    try {
      const result = await testModelConnection({
        use: input.use,
        model: input.model,
        api_key: input.apiKey,
        api_base: input.apiBase,
        provider_protocol: input.protocol,
      });

      const feedback: ProviderFeedback = {
        success: result.success,
        message: result.message,
        latencyMs: result.latency_ms ?? null,
        responsePreview: result.response_preview ?? null,
      };

      if (input.providerId) {
        setProviderFeedback((prev) => ({ ...prev, [input.providerId!]: feedback }));
        updateProviderById(input.providerId, (current) => ({
          ...current,
          last_test_status: result.success ? "success" : "failed",
          last_tested_at: new Date().toISOString(),
          last_test_message: result.message,
        }));
      } else {
        setCreateFeedback(feedback);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : copy.testFailed;
      const feedback: ProviderFeedback = {
        success: false,
        message,
      };
      if (input.providerId) {
        setProviderFeedback((prev) => ({ ...prev, [input.providerId!]: feedback }));
        updateProviderById(input.providerId, (current) => ({
          ...current,
          last_test_status: "failed",
          last_tested_at: new Date().toISOString(),
          last_test_message: message,
        }));
      } else {
        setCreateFeedback(feedback);
      }
    } finally {
      setTestingProviderKey((current) => (current === input.providerKey ? null : current));
    }
  };

  const handleFetchProviderModels = async (providerId: string) => {
    const providerIndex = providers.findIndex(
      (provider) => asString(provider.id).trim() === providerId,
    );
    if (providerIndex < 0) {
      return;
    }
    const provider = providers[providerIndex] ?? {};

    setLoadingCatalogProviderId(providerId);
    try {
      const result = await loadProviderModels({
        use: asString(provider.use).trim(),
        api_key: asString(provider.api_key).trim(),
        api_base: asString(provider.api_base).trim(),
        provider_protocol: getProviderProtocol(provider),
      });

      updateProviderAt(providerIndex, (current) => {
        return {
          ...current,
          catalog_models: result.models.map((model) => mapProviderModelOptionToConfig(model)),
          catalog_updated_at: new Date().toISOString(),
          catalog_provider_type: result.provider_type,
          catalog_message: result.message,
        };
      });

      setProviderFeedback((prev) => ({
        ...prev,
        [providerId]: {
          success: result.success,
          message: result.message,
        },
      }));

      setCatalogSelectedProviderId(providerId);
      setCatalogSelectedModelIds([]);
      setCatalogSearch("");
    } catch (err) {
      setProviderFeedback((prev) => ({
        ...prev,
        [providerId]: {
          success: false,
          message: err instanceof Error ? err.message : copy.testFailed,
        },
      }));
    } finally {
      setLoadingCatalogProviderId((current) => (
        current === providerId ? null : current
      ));
    }
  };

  const inspectModelMetadataWithProvider = async (
    provider: Record<string, unknown>,
    modelId: string,
    silent = false,
  ): Promise<ProviderModelOption | null> => {
    try {
      const result = await loadModelMetadata({
        model: modelId,
        use: asString(provider.use).trim(),
        api_base: asString(provider.api_base).trim(),
        provider_protocol: getProviderProtocol(provider),
      });

      if (!result.success || !result.found || !result.model) {
        if (!silent) {
          toast(result.message || copy.metadataNotFound);
        }
        return null;
      }

      return result.model;
    } catch (err) {
      if (!silent) {
        toast.error(err instanceof Error ? err.message : copy.metadataNotFound);
      }
      return null;
    }
  };

  const checkModelMetadataAt = async (index: number) => {
    const model = models[index] ?? {};
    const modelId = asString(model.model).trim();
    const providerId = asString(model.provider_id).trim();

    if (!providerId) {
      toast.error(copy.inspectRequiresProvider);
      return;
    }

    if (!modelId) {
      toast.error(copy.inspectRequiresModelId);
      return;
    }

    const provider = providerById.get(providerId);
    if (!provider) {
      toast.error(copy.inspectRequiresProvider);
      return;
    }

    const inspectKey = `${index}-${providerId}-${modelId}`;
    setInspectingModelKey(inspectKey);
    const metadata = await inspectModelMetadataWithProvider(provider, modelId, false);
    if (metadata) {
      updateModelAt(index, (current) => mergeModelMetadata(current, metadata));
      toast.success(copy.metadataFilled);
    }
    setInspectingModelKey((current) => (current === inspectKey ? null : current));
  };

  const toggleSelectedModelId = (modelId: string) => {
    const normalized = modelId.trim();
    if (!normalized) {
      return;
    }
    setCatalogSelectedModelIds((prev) => (
      prev.includes(normalized)
        ? prev.filter((id) => id !== normalized)
        : [...prev, normalized]
    ));
  };

  const addModelIdFromSearch = (providerId?: string) => {
    const typed = catalogSearch.trim();
    if (!typed) {
      return;
    }
    const effectiveProviderId = (providerId ?? activeCatalogProviderId).trim();
    const effectiveProvider = effectiveProviderId
      ? providerById.get(effectiveProviderId)
      : undefined;
    const catalogModels = effectiveProvider ? asCatalogModels(effectiveProvider) : [];
    const exactCatalogMatch = catalogModels.find(
      (item) => item.id.toLowerCase() === typed.toLowerCase(),
    );
    const resolvedId = exactCatalogMatch?.id ?? typed;

    setCatalogSelectedModelIds((prev) => {
      const exists = prev.some((id) => id.toLowerCase() === resolvedId.toLowerCase());
      if (exists) {
        return prev;
      }
      return [...prev, resolvedId];
    });
    setCatalogSearch("");
  };

  const addSelectedCatalogModels = async (
    targetProviderId?: string,
    onAdded?: () => void,
  ) => {
    const explicitProviderId = targetProviderId?.trim() ?? "";
    const providerId = explicitProviderId !== "" ? explicitProviderId : activeCatalogProviderId;
    if (!providerId || catalogSelectedModelIds.length === 0) {
      return;
    }

    const provider = providerById.get(providerId);
    if (!provider) {
      return;
    }

    const catalogModels = asCatalogModels(provider);
    const catalogById = new Map(catalogModels.map((item) => [item.id, item] as const));
    const selectedIds = [...new Set(catalogSelectedModelIds.map((id) => id.trim()).filter(Boolean))];
    if (selectedIds.length === 0) {
      return;
    }

    const selectedOptions: ProviderCatalogModel[] = selectedIds.map((id) => {
      const fromCatalog = catalogById.get(id);
      if (fromCatalog) {
        return fromCatalog;
      }
      return {
        id,
        name: id,
      };
    });

    const existingModelKeys = new Set(
      models.map((model) => `${asString(model.provider_id).trim()}::${asString(model.model).trim()}`),
    );
    const optionsToAdd = selectedOptions.filter(
      (item) => !existingModelKeys.has(`${providerId}::${item.id}`),
    );

    if (optionsToAdd.length === 0) {
      toast(copy.duplicateModelHint);
      return;
    }

    setAddingCatalogModels(true);
    try {
      const metadataEntries = await Promise.all(
        optionsToAdd.map(async (item) => {
          const metadata = await inspectModelMetadataWithProvider(provider, item.id, true);
          return [item.id, metadata] as const;
        }),
      );
      const metadataById = new Map(metadataEntries);

      updatePreparedConfig((next) => {
        const list = asArray(next.models);
        const usedNames = new Set(
          list
            .map((model) => asString(model.name).trim())
            .filter((name) => name.length > 0),
        );

        optionsToAdd.forEach((option, idx) => {
          const aliasBase = toSafeAlias(option.id, `model-${list.length + idx + 1}`);
          const internalName = ensureUniqueId(aliasBase, usedNames);
          const baseModel: Record<string, unknown> = {
            name: internalName,
            display_name: asString(option.name).trim() !== "" ? option.name : option.id,
            model: option.id,
            provider_id: providerId,
            provider_protocol: providerProtocolById.get(providerId) ?? "openai-compatible",
            supports_thinking:
              typeof option.supports_thinking === "boolean"
                ? option.supports_thinking
                : undefined,
            supports_vision:
              typeof option.supports_vision === "boolean"
                ? option.supports_vision
                : undefined,
            supports_video:
              typeof option.supports_video === "boolean"
                ? option.supports_video
                : undefined,
            max_tokens:
              typeof option.max_output_tokens === "number"
                ? option.max_output_tokens
                : undefined,
            context_window:
              typeof option.context_window === "number"
                ? option.context_window
                : undefined,
          };

          const metadata = metadataById.get(option.id);
          list.push(metadata ? mergeModelMetadata(baseModel, metadata) : baseModel);
        });

        next.models = list;
      });

      setCatalogSelectedModelIds([]);
      setCatalogSearch("");
      onAdded?.();
      toast.success(
        copy.addedModelsToastTemplate.replace("{count}", String(optionsToAdd.length)),
      );
    } finally {
      setAddingCatalogModels(false);
    }
  };

  const setDefaultModel = (index: number) => {
    if (index <= 0) {
      return;
    }
    updatePreparedConfig((next) => {
      const list = asArray(next.models);
      const [selected] = list.splice(index, 1);
      if (!selected) {
        return;
      }
      list.unshift(selected);
      next.models = list;
    });
  };

  const removeModel = (index: number) => {
    updatePreparedConfig((next) => {
      const list = asArray(next.models);
      list.splice(index, 1);
      next.models = list;
    });
  };

  const requestDeleteProvider = (providerId: string) => {
    const providerName = asString(
      providers.find((provider) => asString(provider.id).trim() === providerId)?.name,
    ).trim() || providerId;
    setPendingDeleteAction({
      kind: "provider",
      providerId,
      message: copy.confirmDeleteProvider.replace("{name}", providerName),
    });
  };

  const requestDeleteModel = (index: number, afterDelete?: () => void) => {
    const targetModel = models[index] ?? {};
    const modelName = asString(targetModel.display_name).trim()
      || asString(targetModel.model).trim()
      || asString(targetModel.name).trim()
      || formatModelFallbackName(index);
    setPendingDeleteAction({
      kind: "model",
      index,
      message: copy.confirmDeleteModel.replace("{name}", modelName),
      afterDelete,
    });
  };

  const handleConfirmDelete = () => {
    if (!pendingDeleteAction) {
      return;
    }

    if (pendingDeleteAction.kind === "provider") {
      removeProvider(pendingDeleteAction.providerId);
      setPendingDeleteAction(null);
      return;
    }

    removeModel(pendingDeleteAction.index);
    pendingDeleteAction.afterDelete?.();
    setPendingDeleteAction(null);
  };

  const applyCatalogOptionToModel = (
    index: number,
    option: ProviderCatalogModel,
  ) => {
    updateModelAt(index, (current) => {
      const nextModel: Record<string, unknown> = {
        ...current,
        model: option.id,
        name: asString(current.name).trim()
          ? current.name
          : toSafeAlias(option.id, `model-${index + 1}`),
      };
      if (!asString(current.display_name).trim()) {
        nextModel.display_name =
          asString(option.name).trim() !== "" ? option.name : option.id;
      }
      if (typeof option.supports_thinking === "boolean" && isFieldBlank(current.supports_thinking)) {
        nextModel.supports_thinking = option.supports_thinking;
      }
      if (typeof option.supports_vision === "boolean" && isFieldBlank(current.supports_vision)) {
        nextModel.supports_vision = option.supports_vision;
      }
      if (typeof option.supports_video === "boolean" && isFieldBlank(current.supports_video)) {
        nextModel.supports_video = option.supports_video;
      }
      if (
        typeof option.max_output_tokens === "number"
        && parseNumberInput(asString(current.max_tokens)) === undefined
      ) {
        nextModel.max_tokens = option.max_output_tokens;
      }
      if (
        typeof option.context_window === "number"
        && parseNumberInput(asString(current.context_window)) === undefined
      ) {
        nextModel.context_window = option.context_window;
      }
      return nextModel;
    });
  };

  const getProviderConnectionStatus = (provider: Record<string, unknown>, providerId: string) => {
    const sessionFeedback = providerFeedback[providerId];
    if (sessionFeedback) {
      return {
        success: sessionFeedback.success,
        label: sessionFeedback.success ? copy.statusConnected : copy.statusFailed,
      };
    }

    const raw = asString(provider.last_test_status).trim().toLowerCase();
    if (raw === "success") {
      return { success: true, label: copy.statusConnected };
    }
    if (raw === "failed") {
      return { success: false, label: copy.statusFailed };
    }
    return { success: null, label: copy.statusUntested };
  };

  const renderProviderList = () => (
    <section className="space-y-4 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-1">
          <div className="text-sm font-semibold">{copy.providersTitle}</div>
          <div className="text-muted-foreground text-xs">{copy.providersSubtitle}</div>
        </div>
        <Button
          size="sm"
          onClick={() => {
            setProviderPanelView("create");
            setCreateDraft(
              createProviderDraft("openai-compatible", providers.length + 1, providerNameTemplates),
            );
            setCreateFeedback(null);
          }}
          disabled={disabled}
        >
          <PlusIcon className="size-4" />
          {copy.createProvider}
        </Button>
      </div>

      {providers.length === 0 ? (
        <div className="text-muted-foreground rounded-md border border-dashed p-3 text-xs">
          {copy.noProvider}
        </div>
      ) : (
        <div
          className={cn(
            "grid gap-3 md:grid-cols-2",
            providers.length >= 3 && "xl:grid-cols-3",
          )}
        >
          {providers.map((provider) => {
            const providerId = asString(provider.id).trim();
            if (!providerId) {
              return null;
            }
            const providerName = asString(provider.name).trim() || providerId;
            const protocol = getProviderProtocol(provider);
            const isActive = providerPanelView === "edit" && selectedProviderId === providerId;
            const status = getProviderConnectionStatus(provider, providerId);
            const configuredCount = configuredModelCountByProviderId.get(providerId) ?? 0;

            return (
              <button
                key={providerId}
                type="button"
              onClick={() => {
                setProviderPanelView("edit");
                setSelectedProviderId(providerId);
              }}
                className={cn(
                  "group w-full rounded-xl border p-4 text-left transition-all duration-200 md:min-h-[176px]",
                  "bg-gradient-to-b from-background to-muted/20 hover:border-primary/40 hover:shadow-sm",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                  isActive && "border-primary/70 bg-primary/5 shadow-sm",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-base font-semibold leading-5">
                      {providerName}
                    </div>
                  </div>
                  <Badge
                    variant="secondary"
                    className="shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium"
                  >
                    {protocolLabel(protocol, protocolCopy)}
                  </Badge>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2.5">
                  <div className="rounded-md border bg-background/80 px-3 py-2">
                    <div className="text-muted-foreground text-[11px] leading-4">
                      {copy.modelCount}
                    </div>
                    <div className="mt-1 text-sm font-semibold leading-5 text-foreground">
                      {configuredCount}
                    </div>
                  </div>
                  <div className="rounded-md border bg-background/80 px-3 py-2">
                    <div className="text-muted-foreground text-[11px] leading-4">
                      {copy.lastTestedAt}
                    </div>
                    <div className="mt-1 truncate text-sm font-medium leading-5 text-foreground">
                      {formatLastTestTime(
                        asString(provider.last_tested_at),
                        locale,
                        copy.statusUntested,
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between gap-3">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
                      status.success === true && "border-emerald-200 bg-emerald-50 text-emerald-700",
                      status.success === false && "border-rose-200 bg-rose-50 text-rose-700",
                      status.success === null && "border-muted-foreground/20 bg-muted/30 text-muted-foreground",
                    )}
                  >
                    <span
                      className={cn(
                        "size-1.5 rounded-full",
                        status.success === true && "bg-emerald-600",
                        status.success === false && "bg-rose-600",
                        status.success === null && "bg-muted-foreground",
                      )}
                    />
                    {status.label}
                  </span>

                  <span className="text-muted-foreground group-hover:text-foreground inline-flex items-center gap-1 text-xs font-medium transition-colors">
                    {copy.openProvider}
                    <ArrowRightIcon className="size-3.5 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );

  const renderCreateProviderDetail = () => {
    const createKey = "__create_provider__";
    const isTesting = testingProviderKey === createKey;
    return (
      <section className="space-y-4 rounded-xl border bg-card p-4">
        {providers.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            className="w-fit"
            onClick={() => {
              setProviderPanelView("list");
              setCreateFeedback(null);
            }}
            disabled={disabled}
          >
            <ArrowLeftIcon className="size-4" />
            {copy.backToProviderList}
          </Button>
        )}

        <div className="space-y-1">
          <div className="text-sm font-semibold">{copy.createDetailTitle}</div>
          <div className="text-muted-foreground text-xs">
            {copy.createDetailHint}
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1.5">
            <div className="text-xs font-medium">{copy.providerName}</div>
            <Input
              value={createDraft.name}
              placeholder={copy.providerNamePlaceholder}
              onChange={(e) => setCreateDraft((current) => ({ ...current, name: e.target.value }))}
              disabled={disabled}
            />
          </div>

          <div className="space-y-1.5">
            <div className="text-xs font-medium">{copy.providerProtocol}</div>
            <Select
              value={createDraft.protocol}
              onValueChange={(value) => {
                const protocol = value as ProviderProtocol;
                const preset = getPresetById(
                  protocol === "anthropic-compatible"
                    ? ANTHROPIC_PROVIDER_PRESET
                    : OPENAI_PROVIDER_PRESET,
                );
                setCreateDraft((current) => ({
                  ...current,
                  protocol,
                  use: preset?.use ?? defaultUseByProtocol(protocol),
                  api_base: preset?.defaultApiBase ?? "",
                }));
                setCreateFeedback(null);
              }}
            >
              <SelectTrigger disabled={disabled} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="openai-compatible">{copy.providerProtocolOpenAI}</SelectItem>
                <SelectItem value="anthropic-compatible">{copy.providerProtocolAnthropic}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <div className="text-xs font-medium">{copy.apiKey}</div>
            <div className="relative">
              <Input
                type={createApiKeyVisible ? "text" : "password"}
                value={createDraft.api_key}
                onChange={(e) => setCreateDraft((current) => ({ ...current, api_key: e.target.value }))}
                placeholder={
                  createDraft.protocol === "anthropic-compatible"
                    ? "$ANTHROPIC_API_KEY"
                    : "$OPENAI_API_KEY"
                }
                className="pr-10"
                disabled={disabled}
              />
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                className="absolute top-1/2 right-1 -translate-y-1/2"
                onClick={() => setCreateApiKeyVisible((current) => !current)}
                aria-label={createApiKeyVisible ? copy.hideApiKey : copy.showApiKey}
                title={createApiKeyVisible ? copy.hideApiKey : copy.showApiKey}
                disabled={disabled}
              >
                {createApiKeyVisible ? (
                  <EyeOffIcon className="size-4" />
                ) : (
                  <EyeIcon className="size-4" />
                )}
              </Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="text-xs font-medium">{copy.apiBase}</div>
            <Input
              value={createDraft.api_base}
              onChange={(e) => setCreateDraft((current) => ({ ...current, api_base: e.target.value }))}
              placeholder={
                createDraft.protocol === "anthropic-compatible"
                  ? copy.apiBasePlaceholderAnthropic
                  : copy.apiBasePlaceholder
              }
              disabled={disabled}
            />
          </div>

        </div>

        {createFeedback && (
          <div
            className={cn(
              "rounded-md border px-3 py-2 text-xs",
              createFeedback.success
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-rose-200 bg-rose-50 text-rose-700",
            )}
          >
            <div className="flex items-center gap-1.5 font-medium">
              {createFeedback.success ? (
                <CircleCheckIcon className="size-3.5" />
              ) : (
                <CircleAlertIcon className="size-3.5" />
              )}
              {createFeedback.success ? copy.testSuccess : copy.testFailed}
              {typeof createFeedback.latencyMs === "number" && ` · ${createFeedback.latencyMs} ms`}
            </div>
            <div className="mt-1 break-all">{createFeedback.message}</div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              void runProviderConnectionTest({
                providerKey: createKey,
                use: createDraft.use,
                apiKey: createDraft.api_key,
                apiBase: createDraft.api_base,
                protocol: createDraft.protocol,
              });
            }}
            disabled={Boolean(disabled) || isTesting}
          >
            <PlugZapIcon className="size-4" />
            {isTesting ? copy.testingConnection : copy.testConnection}
          </Button>

          <Button
            size="sm"
            onClick={() => {
              const usedIds = new Set(
                providers
                  .map((provider) => asString(provider.id).trim())
                  .filter((id) => id.length > 0),
              );
              const baseId = toSafeAlias(
                createDraft.name.trim() || `provider-${providers.length + 1}`,
                `provider-${providers.length + 1}`,
              );
              const providerId = ensureUniqueId(baseId, usedIds);

              const preset = getPresetById(
                createDraft.protocol === "anthropic-compatible"
                  ? ANTHROPIC_PROVIDER_PRESET
                  : OPENAI_PROVIDER_PRESET,
              );

              updatePreparedConfig((next) => {
                const list = asProviders(next);
                list.push({
                  id: providerId,
                  name: createDraft.name.trim() || providerId,
                  preset_id: preset?.id ?? OPENAI_PROVIDER_PRESET,
                  protocol: createDraft.protocol,
                  use: createDraft.use.trim() || defaultUseByProtocol(createDraft.protocol),
                  api_key: createDraft.api_key.trim(),
                  api_base: createDraft.api_base.trim(),
                  catalog_models: [],
                  catalog_updated_at: "",
                  catalog_provider_type: "",
                  catalog_message: "",
                });
                next[MODEL_PROVIDERS_KEY] = list;
              });

              setProviderPanelView("edit");
              setSelectedProviderId(providerId);
              setCatalogSelectedProviderId(providerId);
              setCreateFeedback(null);
              setCreateDraft(
                createProviderDraft("openai-compatible", providers.length + 2, providerNameTemplates),
              );
            }}
            disabled={disabled}
          >
            {copy.saveProvider}
          </Button>
        </div>

      </section>
    );
  };

  const renderEditProviderDetail = () => {
    if (!selectedProvider || selectedProviderIndex < 0) {
      return (
        <section className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
          {copy.noProvider}
        </section>
      );
    }

    const providerId = asString(selectedProvider.id).trim();
    const providerName = asString(selectedProvider.name).trim() || providerId;
    const protocol = getProviderProtocol(selectedProvider);
    const feedback = providerFeedback[providerId];
    const isTesting = testingProviderKey === providerId;
    const providerModelEntries = models
      .map((model, index) => ({ model, index }))
      .filter(({ model }) => asString(model.provider_id).trim() === providerId);
    const openAddProviderModelDialog = () => {
      setCatalogSelectedProviderId(providerId);
      setCatalogSelectedModelIds([]);
      setCatalogSearch("");
      setProviderModelDialogOpen(true);
      void handleFetchProviderModels(providerId);
    };

    const renderProviderModelsLayer = () => (
      <section className="space-y-3 rounded-lg border bg-muted/10 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-muted-foreground text-xs">{copy.providerModelsSubtitle}</div>
          <Button
            size="sm"
            onClick={openAddProviderModelDialog}
            disabled={disabled}
          >
            <PlusIcon className="size-4" />
            {copy.addProviderModel}
          </Button>
        </div>

        {providerModelEntries.length === 0 ? (
          <div className="text-muted-foreground rounded-md border border-dashed bg-background/70 p-3 text-xs">
            {copy.noProviderModels}
          </div>
        ) : (
          <div className="space-y-2">
            {providerModelEntries.map(({ model, index }) => {
              const displayName = asString(model.display_name).trim()
                || asString(model.model).trim()
                || formatModelFallbackName(index);
              const modelId = asString(model.model).trim() || "-";
              const isDefaultModel = index === 0;
              return (
                <div
                  key={`${asString(model.name).trim() || modelId}-${index}`}
                  className="flex items-center justify-between gap-3 rounded-md border bg-background/70 px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{displayName}</div>
                    <div className="text-muted-foreground truncate text-xs">{modelId}</div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {isDefaultModel && (
                      <Badge
                        variant="secondary"
                        className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] text-amber-700"
                      >
                        {copy.default}
                      </Badge>
                    )}
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => {
                        requestDeleteModel(index);
                      }}
                      disabled={disabled}
                      aria-label={copy.remove}
                    >
                      <Trash2Icon className="size-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <Dialog
          open={providerModelDialogOpen}
          onOpenChange={setProviderModelDialogOpen}
        >
          <DialogContent className="max-w-3xl gap-0 p-0">
            <DialogHeader className="border-b px-6 pt-6 pb-4">
              <DialogTitle>{copy.addProviderModelDialogTitle}</DialogTitle>
              <DialogDescription>{copy.addProviderModelDialogDesc}</DialogDescription>
            </DialogHeader>
            <div className="max-h-[72vh] overflow-y-auto p-6">
              {renderAddModelFlow({
                lockedProviderId: providerId,
                onAdded: () => {
                  setProviderModelDialogOpen(false);
                },
              })}
            </div>
          </DialogContent>
        </Dialog>
      </section>
    );

    if (providerDetailView === "models") {
      return (
        <section className="space-y-4 rounded-xl border bg-card p-4">
          <Button
            size="sm"
            variant="ghost"
            className="w-fit"
            onClick={() => {
              setProviderDetailView("details");
              setProviderModelDialogOpen(false);
            }}
            disabled={disabled}
          >
            <ArrowLeftIcon className="size-4" />
            {copy.backToProviderDetail}
          </Button>

          <div className="flex items-center justify-between gap-2">
            <div className="space-y-1">
              <div className="text-sm font-semibold">{copy.providerModelsTitle}</div>
              <div className="text-muted-foreground text-xs">{providerName}</div>
            </div>
            <Badge variant="outline">{protocolLabel(protocol, protocolCopy)}</Badge>
          </div>

          {renderProviderModelsLayer()}
        </section>
      );
    }

    return (
      <section className="space-y-4 rounded-xl border bg-card p-4">
        <Button
          size="sm"
          variant="ghost"
          className="w-fit"
          onClick={() => {
            setProviderPanelView("list");
          }}
          disabled={disabled}
        >
          <ArrowLeftIcon className="size-4" />
          {copy.backToProviderList}
        </Button>

        <div className="flex items-center justify-between gap-2">
          <div className="space-y-1">
            <div className="text-sm font-semibold">{copy.providerDetailTitle}</div>
            <div className="text-muted-foreground text-xs">
              {providerName}
            </div>
          </div>
          <Badge variant="outline">{protocolLabel(protocol, protocolCopy)}</Badge>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1.5">
            <div className="text-xs font-medium">{copy.providerName}</div>
            <Input
              value={asString(selectedProvider.name)}
              placeholder={copy.providerNamePlaceholder}
              onChange={(e) => updateProviderAt(selectedProviderIndex, (current) => ({
                ...current,
                name: e.target.value,
              }))}
              disabled={disabled}
            />
          </div>

          <div className="space-y-1.5">
            <div className="text-xs font-medium">{copy.providerProtocol}</div>
            <Select
              value={protocol}
              onValueChange={(value) => updateProviderProtocol(selectedProviderIndex, value as ProviderProtocol)}
            >
              <SelectTrigger disabled={disabled} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="openai-compatible">{copy.providerProtocolOpenAI}</SelectItem>
                <SelectItem value="anthropic-compatible">{copy.providerProtocolAnthropic}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <div className="text-xs font-medium">{copy.apiKey}</div>
            <div className="relative">
              <Input
                type={editApiKeyVisible ? "text" : "password"}
                value={asString(selectedProvider.api_key)}
                onChange={(e) => updateProviderAt(selectedProviderIndex, (current) => ({
                  ...current,
                  api_key: e.target.value,
                }))}
                placeholder={
                  protocol === "anthropic-compatible"
                    ? "$ANTHROPIC_API_KEY"
                    : "$OPENAI_API_KEY"
                }
                className="pr-10"
                disabled={disabled}
              />
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                className="absolute top-1/2 right-1 -translate-y-1/2"
                onClick={() => setEditApiKeyVisible((current) => !current)}
                aria-label={editApiKeyVisible ? copy.hideApiKey : copy.showApiKey}
                title={editApiKeyVisible ? copy.hideApiKey : copy.showApiKey}
                disabled={disabled}
              >
                {editApiKeyVisible ? (
                  <EyeOffIcon className="size-4" />
                ) : (
                  <EyeIcon className="size-4" />
                )}
              </Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="text-xs font-medium">{copy.apiBase}</div>
            <Input
              value={asString(selectedProvider.api_base)}
              onChange={(e) => updateProviderAt(selectedProviderIndex, (current) => ({
                ...current,
                api_base: e.target.value,
              }))}
              placeholder={
                protocol === "anthropic-compatible"
                  ? copy.apiBasePlaceholderAnthropic
                  : copy.apiBasePlaceholder
              }
              disabled={disabled}
            />
          </div>
        </div>

        {feedback && (
          <div
            className={cn(
              "rounded-md border px-3 py-2 text-xs",
              feedback.success
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-rose-200 bg-rose-50 text-rose-700",
            )}
          >
            <div className="flex items-center gap-1.5 font-medium">
              {feedback.success ? (
                <CircleCheckIcon className="size-3.5" />
              ) : (
                <CircleAlertIcon className="size-3.5" />
              )}
              {feedback.success ? copy.testSuccess : copy.testFailed}
              {typeof feedback.latencyMs === "number" && ` · ${feedback.latencyMs} ms`}
            </div>
            <div className="mt-1 break-all">{feedback.message}</div>
            {feedback.responsePreview && (
              <div className="mt-1 line-clamp-2 text-[11px] opacity-90">
                {feedback.responsePreview}
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              void runProviderConnectionTest({
                providerKey: providerId,
                providerId,
                use: asString(selectedProvider.use).trim(),
                apiKey: asString(selectedProvider.api_key).trim(),
                apiBase: asString(selectedProvider.api_base).trim(),
                protocol,
              });
            }}
            disabled={Boolean(disabled) || isTesting}
          >
            <PlugZapIcon className="size-4" />
            {isTesting ? copy.testingConnection : copy.testConnection}
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setProviderDetailView("models");
              setProviderModelDialogOpen(false);
              setCatalogSelectedProviderId(providerId);
              setCatalogSelectedModelIds([]);
              setCatalogSearch("");
            }}
            disabled={disabled}
          >
            {copy.openProviderModels}
          </Button>

          <Button
            size="sm"
            variant="ghost"
            className="text-rose-600 hover:text-rose-600"
            onClick={() => requestDeleteProvider(providerId)}
            disabled={disabled}
          >
            <Trash2Icon className="size-4" />
            {copy.deleteProvider}
          </Button>
        </div>
      </section>
    );
  };

  const renderProviderSection = () => (
    <section className="space-y-4">
      {providerPanelView === "list" ? renderProviderList() : null}
      {providerPanelView === "create" ? renderCreateProviderDetail() : null}
      {providerPanelView === "edit" ? renderEditProviderDetail() : null}
    </section>
  );

  const renderAddModelFlow = (
    options?: {
      lockedProviderId?: string;
      onAdded?: () => void;
    },
  ) => {
    if (providerOptions.length === 0) {
      return (
        <div className="space-y-3 rounded-lg border border-dashed bg-muted/20 p-4">
          <div className="space-y-1">
            <div className="text-sm font-medium">{copy.noProviderCtaTitle}</div>
            <div className="text-muted-foreground text-xs">{copy.noProviderCtaHint}</div>
          </div>
          <div>
            <Button
              size="sm"
              onClick={() => {
                setProviderPanelView("create");
                onViewChange?.("providers");
              }}
              disabled={disabled}
            >
              <PlusIcon className="size-4" />
              {copy.goCreateProvider}
            </Button>
          </div>
        </div>
      );
    }

    const lockedProviderId = options?.lockedProviderId?.trim() ?? "";
    const isProviderLocked = lockedProviderId !== "";
    const targetProviderId = isProviderLocked ? lockedProviderId : activeCatalogProviderId;
    const activeProvider = providerById.get(targetProviderId);
    const targetCatalogModels = activeProvider ? asCatalogModels(activeProvider) : [];
    const filteredTargetCatalogModels = targetCatalogModels.filter((item) => {
      const q = catalogSearch.trim().toLowerCase();
      if (!q) {
        return true;
      }
      const composed = `${item.name ?? ""} ${item.id}`.toLowerCase();
      return composed.includes(q);
    });
    const hasActiveCatalogProvider = targetProviderId.trim() !== "";
    const hasCatalogForProvider = targetCatalogModels.length > 0;
    const activeProviderName = providerNameById.get(targetProviderId) ?? copy.unassigned;
    const typedModelId = catalogSearch.trim();
    const hasExactCatalogMatch = typedModelId !== ""
      && targetCatalogModels.some((item) => item.id.toLowerCase() === typedModelId.toLowerCase());
    const isTypedModelSelected = typedModelId !== ""
      && catalogSelectedModelIds.some((id) => id.toLowerCase() === typedModelId.toLowerCase());
    const showQuickAdd = hasActiveCatalogProvider && typedModelId !== "" && !hasExactCatalogMatch;
    const selectedManualModelIds = catalogSelectedModelIds.filter((selectedId) => (
      !targetCatalogModels.some((item) => item.id.toLowerCase() === selectedId.toLowerCase())
    ));

    return (
      <div className="space-y-4">
        {!isProviderLocked ? (
          <div className="space-y-1.5">
            <div className="text-sm font-medium">{copy.selectProvider}</div>
            <Select
              value={targetProviderId || UNASSIGNED_PROVIDER}
              onValueChange={(value) => {
                const nextProviderId = value === UNASSIGNED_PROVIDER ? "" : value;
                setCatalogSelectedProviderId(nextProviderId);
                setCatalogSelectedModelIds([]);
                setCatalogSearch("");
                if (nextProviderId) {
                  void handleFetchProviderModels(nextProviderId);
                }
              }}
            >
              <SelectTrigger
                disabled={Boolean(disabled) || providerOptions.length === 0}
                className="w-full"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNASSIGNED_PROVIDER}>{copy.unassigned}</SelectItem>
                {providerOptions.map((providerOption) => (
                  <SelectItem key={providerOption.id} value={providerOption.id}>
                    {providerOption.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Badge variant="outline" className="text-xs">
              {activeProviderName}
            </Badge>
            {loadingCatalogProviderId === targetProviderId ? (
              <span className="text-muted-foreground text-xs">{copy.fetchingCatalog}</span>
            ) : null}
          </div>
        )}

        {!hasActiveCatalogProvider ? (
          <div className="text-muted-foreground rounded-md border border-dashed bg-background/70 p-4 text-xs">
            {copy.selectProviderFirstHint}
          </div>
        ) : (
          <div className="space-y-3 rounded-lg border bg-background p-4">
            <div className="relative">
              <SearchIcon className="text-muted-foreground absolute top-2.5 left-2.5 size-4" />
              <Input
                value={catalogSearch}
                onChange={(e) => setCatalogSearch(e.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") {
                    return;
                  }
                  if (event.nativeEvent.isComposing) {
                    return;
                  }
                  event.preventDefault();
                  event.stopPropagation();
                  addModelIdFromSearch(targetProviderId);
                }}
                placeholder={copy.searchModel}
                className="pl-8"
                disabled={Boolean(disabled) || !targetProviderId}
              />
            </div>

            <div className="text-muted-foreground text-[11px]">
              {copy.enterToAddModel}
            </div>

            {!hasCatalogForProvider ? (
              <div className="text-muted-foreground rounded-md border border-dashed bg-muted/20 p-3 text-xs">
                {copy.noCatalog}
              </div>
            ) : null}

            <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border bg-background p-1.5">
              {selectedManualModelIds.map((modelId) => (
                <button
                  key={`manual-${modelId}`}
                  type="button"
                  className={cn(
                    "hover:bg-accent flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm",
                    "bg-accent/60",
                  )}
                  onClick={() => toggleSelectedModelId(modelId)}
                >
                  <div className="flex size-4 items-center justify-center rounded border">
                    <CheckIcon className="size-3" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{modelId}</div>
                    <div className="text-muted-foreground truncate text-[11px]">
                      {copy.manualAddedTag}
                    </div>
                  </div>
                </button>
              ))}

              {showQuickAdd && (
                <button
                  type="button"
                  className={cn(
                    "hover:bg-accent flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm",
                    isTypedModelSelected && "bg-accent",
                  )}
                  onClick={() => addModelIdFromSearch(targetProviderId)}
                  disabled={Boolean(disabled)}
                >
                  <div className="flex size-4 items-center justify-center rounded border">
                    <PlusIcon className="size-3" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate">
                      {copy.quickAddLabel}: {typedModelId}
                    </div>
                    <div className="text-muted-foreground truncate text-[11px]">
                      {typedModelId}
                    </div>
                  </div>
                </button>
              )}

              {filteredTargetCatalogModels.map((item) => {
                const selected = catalogSelectedModelIds.includes(item.id);
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={cn(
                      "hover:bg-accent flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm",
                      selected && "bg-accent",
                    )}
                    onClick={() => {
                      toggleSelectedModelId(item.id);
                    }}
                  >
                    <div className="flex size-4 items-center justify-center rounded border">
                      {selected ? <CheckIcon className="size-3" /> : null}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate">
                        {asString(item.name).trim() !== "" ? item.name : item.id}
                      </div>
                      <div className="text-muted-foreground truncate text-[11px]">
                        {item.id}
                      </div>
                    </div>
                  </button>
                );
              })}

              {!showQuickAdd
                && filteredTargetCatalogModels.length === 0
                && selectedManualModelIds.length === 0 ? (
                  <div className="text-muted-foreground px-2 py-3 text-xs">
                    {copy.selectedModelsEmpty}
                  </div>
                ) : null}
            </div>

            <div className="flex items-center justify-between gap-2">
              <div className="text-muted-foreground text-xs">
                {copy.selected}: {catalogSelectedModelIds.length}
              </div>
              <Button
                size="sm"
                onClick={() => {
                  void addSelectedCatalogModels(targetProviderId, options?.onAdded);
                }}
                disabled={Boolean(disabled) || catalogSelectedModelIds.length === 0 || addingCatalogModels}
              >
                <PlusIcon className="size-4" />
                {addingCatalogModels ? copy.adding : copy.addSelectedModels}
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderModelList = () => (
    <section className="space-y-4 rounded-xl border bg-card p-4">
      <div className="space-y-1">
        <div className="text-sm font-semibold">{copy.modelListTitle}</div>
        <div className="text-muted-foreground text-xs">{copy.modelListSubtitle}</div>
      </div>

      {models.length === 0 ? (
        <div className="text-muted-foreground rounded-md border border-dashed p-3 text-xs">
          {copy.noModelOnList}
        </div>
      ) : (
        <div className="space-y-2">
          {models.map((model, index) => {
            const displayName = asString(model.display_name).trim()
              || formatModelFallbackName(index);
            const boundProvider = asString(model.provider_id).trim();
            const boundProtocol = boundProvider
              ? providerProtocolById.get(boundProvider)
              : undefined;
            const isLegacyImported = !boundProvider && asString(model.use).trim() !== "";
            const providerName = providerNameById.get(boundProvider)
              ?? (isLegacyImported ? copy.legacyImported : copy.unassigned);

            return (
              <div
                key={`${asString(model.name).trim() || "model"}-${index}`}
                className={cn(
                  "flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2.5",
                  "bg-background/70",
                )}
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="truncate text-sm font-semibold">{displayName}</div>
                  <div className="text-muted-foreground flex items-center gap-2 text-xs">
                    <span>{providerName}</span>
                    <span>·</span>
                    <span>{boundProtocol ? protocolLabel(boundProtocol, protocolCopy) : copy.unassigned}</span>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {index === 0 ? (
                    <Badge
                      variant="secondary"
                      className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] text-amber-700"
                    >
                      {copy.default}
                    </Badge>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setDefaultModel(index);
                      }}
                      disabled={disabled}
                    >
                      {copy.setDefault}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                    onClick={() => {
                      requestDeleteModel(index);
                    }}
                    disabled={disabled}
                  >
                    <Trash2Icon className="size-4" />
                    {copy.remove}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );

  const renderCreateModelDetail = () => (
    <section className="space-y-4 rounded-xl border bg-card p-4">
      {models.length > 0 && (
        <Button
          size="sm"
          variant="ghost"
          className="w-fit"
          onClick={() => setModelPanelView("list")}
          disabled={disabled}
        >
          <ArrowLeftIcon className="size-4" />
          {copy.backToModelList}
        </Button>
      )}

      <div className="space-y-1">
        <div className="text-sm font-semibold">{copy.createModelTitle}</div>
      </div>

      {renderAddModelFlow()}
    </section>
  );

  const renderEditModelDetail = () => {
    if (models.length === 0) {
      return (
        <section className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
          {copy.noModelOnList}
        </section>
      );
    }

    const index = Math.min(selectedModelIndex, models.length - 1);
    const model = models[index] ?? {};
    const internalName = asString(model.name).trim();
    const boundProvider = asString(model.provider_id).trim();
    const boundProtocol = providerProtocolById.get(boundProvider);
    const boundCatalog = providerCatalogMap.get(boundProvider) ?? [];
    const hasCatalog = boundCatalog.length > 0;
    const modelIdSearchText = modelIdSearch[index]?.trim().toLowerCase() ?? "";
    const filteredBoundCatalog = boundCatalog.filter((item) => {
      if (!modelIdSearchText) {
        return true;
      }
      const composed = `${item.name ?? ""} ${item.id}`.toLowerCase();
      return composed.includes(modelIdSearchText);
    });

    const missingRequired = [
      asString(model.model).trim() ? null : copy.modelId,
      boundProvider ? null : copy.bindProvider,
    ].filter((item): item is string => Boolean(item));
    const duplicateName = internalName && (modelNameCount.get(internalName) ?? 0) > 1;
    const inspectKey = `${index}-${boundProvider}-${asString(model.model).trim()}`;
    const inspecting = inspectingModelKey === inspectKey;

    return (
      <section className="space-y-4 rounded-xl border bg-card p-4">
        <Button
          size="sm"
          variant="ghost"
          className="w-fit"
          onClick={() => setModelPanelView("list")}
          disabled={disabled}
        >
          <ArrowLeftIcon className="size-4" />
          {copy.backToModelList}
        </Button>

        <div className="flex items-center justify-between gap-2">
          <div className="space-y-1">
            <div className="text-sm font-semibold">{copy.editModelTitle}</div>
            <div className="text-muted-foreground text-xs">
              {asString(model.display_name).trim() || asString(model.model).trim() || internalName || "-"}
            </div>
          </div>
          {index === 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-700">
              <StarIcon className="size-3" />
              {copy.default}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">
            {copy.bindProvider}: {providerNameById.get(boundProvider) ?? copy.unassigned}
          </Badge>
          <Badge variant="outline">
            {copy.providerProtocol}: {boundProtocol ? protocolLabel(boundProtocol, protocolCopy) : copy.unassigned}
          </Badge>
        </div>

        <div className="space-y-2 rounded-lg border bg-muted/10 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-medium">{copy.quickActionsTitle}</div>
            <div className="text-muted-foreground text-xs">
              {copy.quickActionsHint}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                void checkModelMetadataAt(index);
              }}
              disabled={Boolean(disabled) || inspecting}
            >
              <SparklesIcon className="size-4" />
              {inspecting ? copy.inspectingModel : copy.inspectModel}
            </Button>

            {index > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setDefaultModel(index);
                  setSelectedModelIndex(0);
                }}
                disabled={disabled}
              >
                <StarIcon className="size-4" />
                {copy.setDefault}
              </Button>
            )}

            <Button
              size="sm"
              variant="outline"
              className="ml-auto border-rose-200 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
              onClick={() => {
                requestDeleteModel(index, () => {
                  setSelectedModelIndex(0);
                  setModelPanelView(models.length - 1 > 0 ? "list" : "create");
                });
              }}
              disabled={disabled}
            >
              <Trash2Icon className="size-4" />
              {copy.remove}
            </Button>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1.5">
            <div className="text-xs font-medium">{copy.modelName}</div>
            <Input
              value={asString(model.display_name)}
              placeholder={copy.modelNamePlaceholder}
              onChange={(e) =>
                updateModelAt(index, (current) => ({
                  ...current,
                  display_name: e.target.value,
                }))
              }
              disabled={disabled}
            />
          </div>
          <div className="space-y-1.5">
            <div className="text-xs font-medium">{copy.bindProvider}</div>
            <Select
              value={boundProvider || UNASSIGNED_PROVIDER}
              onValueChange={(value) => {
                const nextProviderId = value === UNASSIGNED_PROVIDER ? "" : value;
                updateModelAt(index, (current) => ({
                  ...current,
                  provider_id: nextProviderId,
                  provider_protocol: nextProviderId
                    ? (providerProtocolById.get(nextProviderId) ?? "openai-compatible")
                    : "",
                }));
              }}
            >
              <SelectTrigger
                disabled={Boolean(disabled) || providerOptions.length === 0}
                className="w-full"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNASSIGNED_PROVIDER}>{copy.unassigned}</SelectItem>
                {providerOptions.map((providerOption) => (
                  <SelectItem key={providerOption.id} value={providerOption.id}>
                    {providerOption.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <div className="text-xs font-medium">{copy.modelId}</div>
            {hasCatalog && (
              <Button
                size="sm"
                variant="ghost"
                className="h-auto px-1 py-0 text-xs"
                onClick={() =>
                  setManualModelInputByIndex((prev) => ({
                    ...prev,
                    [index]: !prev[index],
                  }))
                }
                disabled={disabled}
              >
                {manualModelInputByIndex[index]
                  ? copy.catalogInput
                  : copy.manualInput}
              </Button>
            )}
          </div>

          {!manualModelInputByIndex[index] && hasCatalog ? (
            <Collapsible
              open={Boolean(modelIdPickerOpen[index])}
              onOpenChange={(open) =>
                setModelIdPickerOpen((prev) => ({
                  ...prev,
                  [index]: open,
                }))
              }
            >
              <CollapsibleTrigger asChild>
                <Button
                  variant="outline"
                  className="w-full justify-between"
                  disabled={disabled}
                >
                  <span className="truncate">
                    {asString(model.model).trim() || copy.modelIdPlaceholder}
                  </span>
                  <ChevronsUpDownIcon className="text-muted-foreground size-4" />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-2 space-y-2 rounded-md border bg-background p-2">
                <div className="relative">
                  <SearchIcon className="text-muted-foreground absolute top-2.5 left-2.5 size-4" />
                  <Input
                    value={modelIdSearch[index] ?? ""}
                    onChange={(e) =>
                      setModelIdSearch((prev) => ({
                        ...prev,
                        [index]: e.target.value,
                      }))
                    }
                    placeholder={copy.searchModel}
                    className="pl-8"
                    disabled={disabled}
                  />
                </div>
                <div className="max-h-40 space-y-1 overflow-y-auto">
                  {filteredBoundCatalog.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={cn(
                        "hover:bg-accent flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                        asString(model.model).trim() === item.id && "bg-accent",
                      )}
                      onClick={() => {
                        applyCatalogOptionToModel(index, item);
                        setModelIdPickerOpen((prev) => ({
                          ...prev,
                          [index]: false,
                        }));
                        setModelIdSearch((prev) => ({
                          ...prev,
                          [index]: "",
                        }));
                      }}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate">
                          {asString(item.name).trim() !== "" ? item.name : item.id}
                        </div>
                        <div className="text-muted-foreground truncate text-[11px]">
                          {item.id}
                        </div>
                      </div>
                      {asString(model.model).trim() === item.id && (
                        <CheckIcon className="size-4" />
                      )}
                    </button>
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
          ) : (
            <Input
              value={asString(model.model)}
              placeholder={copy.modelIdPlaceholder}
              onChange={(e) => {
                const modelId = e.target.value;
                updateModelAt(index, (current) => ({
                  ...current,
                  model: modelId,
                  name: asString(current.name).trim()
                    ? current.name
                    : toSafeAlias(modelId, `model-${index + 1}`),
                }));
              }}
              disabled={disabled}
            />
          )}
        </div>

        <div className="grid gap-2 md:grid-cols-3">
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={asBoolean(model.supports_thinking)}
              onCheckedChange={(checked) =>
                updateModelAt(index, (current) => ({
                  ...current,
                  supports_thinking: checked,
                }))
              }
              disabled={disabled}
            />
            {copy.supportsThinking}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={asBoolean(model.supports_vision)}
              onCheckedChange={(checked) =>
                updateModelAt(index, (current) => ({
                  ...current,
                  supports_vision: checked,
                }))
              }
              disabled={disabled}
            />
            {copy.supportsVision}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={asBoolean(model.supports_video)}
              onCheckedChange={(checked) =>
                updateModelAt(index, (current) => ({
                  ...current,
                  supports_video: checked,
                }))
              }
              disabled={disabled}
            />
            {copy.supportsVideo}
          </label>
        </div>

        <Collapsible
          open={Boolean(modelAdvancedOpen[index])}
          onOpenChange={(open) =>
            setModelAdvancedOpen((prev) => ({
              ...prev,
              [index]: open,
            }))
          }
        >
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs"
            >
              <ChevronDownIcon
                className={cn(
                  "size-3.5 transition-transform",
                  modelAdvancedOpen[index] && "rotate-180",
                )}
              />
              {copy.advanced}
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-3">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className="space-y-1.5">
                <div className="text-xs font-medium">{copy.internalName}</div>
                <Input
                  value={asString(model.name)}
                  placeholder={copy.internalNamePlaceholder}
                  onChange={(e) =>
                    updateModelAt(index, (current) => ({
                      ...current,
                      name: toSafeAlias(e.target.value, `model-${index + 1}`),
                    }))
                  }
                  disabled={disabled}
                />
              </div>
              <div className="space-y-1.5">
                <div className="text-xs font-medium">{copy.maxTokens}</div>
                <Input
                  type="number"
                  placeholder="4096"
                  value={asString(model.max_tokens)}
                  onChange={(e) =>
                    updateOptionalNumberField(index, "max_tokens", e.target.value)
                  }
                  disabled={disabled}
                />
              </div>
              <div className="space-y-1.5">
                <div className="text-xs font-medium">{copy.contextWindow}</div>
                <Input
                  type="number"
                  placeholder="128000"
                  value={asString(model.context_window)}
                  onChange={(e) =>
                    updateOptionalNumberField(index, "context_window", e.target.value)
                  }
                  disabled={disabled}
                />
              </div>
              <div className="space-y-1.5">
                <div className="text-xs font-medium">{copy.temperature}</div>
                <Input
                  type="number"
                  step="0.1"
                  placeholder="0.7"
                  value={asString(model.temperature)}
                  onChange={(e) =>
                    updateOptionalNumberField(index, "temperature", e.target.value)
                  }
                  disabled={disabled}
                />
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {missingRequired.length > 0 && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            {copy.modelMissingRequired}: {missingRequired.join(", ")}
          </div>
        )}

        {duplicateName && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            {copy.duplicateModelName}: <span className="font-mono">{internalName}</span>
          </div>
        )}
      </section>
    );
  };

  const renderModelSection = () => (
    <section className="space-y-4">
      {modelPanelView === "list" ? renderModelList() : null}
      {modelPanelView === "create" ? renderCreateModelDetail() : null}
      {modelPanelView === "edit" ? renderEditModelDetail() : null}
    </section>
  );

  return (
    <div className="space-y-6">
      {view === "providers" ? renderProviderSection() : null}
      {view === "models" ? renderModelSection() : null}
      <ConfirmActionDialog
        open={pendingDeleteAction !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingDeleteAction(null);
          }
        }}
        title={copy.confirmDeleteTitle}
        description={pendingDeleteAction?.message ?? ""}
        cancelText={copy.cancel}
        confirmText={copy.confirmDeleteAction}
        onConfirm={handleConfirmDelete}
        confirmVariant="destructive"
      />
    </div>
  );
}
