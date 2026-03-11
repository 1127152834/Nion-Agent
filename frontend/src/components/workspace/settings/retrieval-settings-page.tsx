"use client";

import {
  ChevronDownIcon,
  DownloadIcon,
  EyeIcon,
  EyeOffIcon,
  Loader2Icon,
  RefreshCwIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/core/i18n/hooks";
import {
  loadRetrievalModelsStatus,
  RetrievalApiError,
  setActiveRetrievalModel,
  setActiveRetrievalPack,
  testRetrievalProviderConnection,
  testRetrievalEmbedding,
  testRetrievalRerank,
  downloadRetrievalModelWithProgress,
  importRetrievalModel,
  removeRetrievalModel,
  deleteRetrievalPack,
  type RetrievalFamily,
  type RetrievalPackId,
  type RetrievalOperationResponse,
} from "@/core/retrieval-models/api";

import { ConfigValidationErrors } from "./config-validation-errors";
import { ConfigSaveBar } from "./configuration/config-save-bar";
import { asBoolean, asObject, asString, cloneConfig } from "./configuration/shared";
import { ConfirmActionDialog } from "./confirm-action-dialog";
import { SettingsSection } from "./settings-section";
import { useConfigEditor } from "./use-config-editor";

type DesktopBridge = {
  listRetrievalModels?: () => Promise<unknown>;
  downloadRetrievalModel?: (modelId: string) => Promise<{ success?: boolean; message?: string }>;
  cancelRetrievalModel?: (modelId: string) => Promise<{ success?: boolean; message?: string }>;
  removeRetrievalModel?: (modelId: string) => Promise<{ success?: boolean; message?: string }>;
  importRetrievalModel?: (modelId: string) => Promise<{ success?: boolean; message?: string }>;
  onRetrievalModelDownloadProgress?: (callback: (payload: unknown) => void) => (() => void) | void;
};

type RetrievalModelItem = {
  model_id: string;
  family: RetrievalFamily;
  display_name: string;
  approx_size_bytes: number;
  license?: string;
  locale?: string;
  installed: boolean;
  is_active?: boolean;
  is_configured_active?: boolean;
};

type RetrievalPackItem = {
  pack_id: RetrievalPackId;
  display_name: string;
  locale?: string;
  approx_size_bytes: number;
  installed: boolean;
  installed_count: number;
  total_count: number;
  status: "not_installed" | "partial" | "installed";
  is_active_pack: boolean;
  models: RetrievalModelItem[];
};

type PendingRemove = {
  modelId: string;
  family: RetrievalFamily;
  displayName: string;
  wasActive: boolean;
};

type PendingDeleteProvider = {
  family: RetrievalFamily;
  providerName: string;
};

const PROVIDER_MODEL_SUGGESTIONS: Record<RetrievalFamily, string[]> = {
  embedding: [
    "text-embedding-3-small",
    "text-embedding-3-large",
    "bge-m3",
    "jina-embeddings-v3",
  ],
  rerank: [
    "jina-reranker-v2-base-multilingual",
    "bge-reranker-v2-m3",
    "jina-reranker-v2-base-multilingual",
  ],
};

const FALLBACK_MODEL_CATALOG: Record<RetrievalFamily, Array<{ model_id: string; display_name: string; locale: string; license: string; approx_size_bytes: number }>> = {
  embedding: [
    {
      model_id: "zh-embedding-lite",
      display_name: "Jina Embeddings v2 Base ZH (INT8)",
      locale: "zh-CN",
      license: "apache-2.0",
      approx_size_bytes: 154 * 1024 * 1024,
    },
    {
      model_id: "en-embedding-lite",
      display_name: "BGE Small EN v1.5 (ONNX)",
      locale: "en-US",
      license: "mit",
      approx_size_bytes: 127 * 1024 * 1024,
    },
  ],
  rerank: [
    {
      model_id: "zh-rerank-lite",
      display_name: "Jina Reranker v2 Base Multilingual (Quantized)",
      locale: "zh-CN",
      license: "apache-2.0",
      approx_size_bytes: 279577152,
    },
    {
      model_id: "en-rerank-lite",
      display_name: "Jina Reranker v1 Tiny EN (INT8)",
      locale: "en-US",
      license: "apache-2.0",
      approx_size_bytes: 32 * 1024 * 1024,
    },
  ],
};

const PACK_MODEL_MAP: Record<RetrievalPackId, { embedding: string; rerank: string }> = {
  zh: { embedding: "zh-embedding-lite", rerank: "zh-rerank-lite" },
  en: { embedding: "en-embedding-lite", rerank: "en-rerank-lite" },
};

function getDesktopBridge(): DesktopBridge | null {
  if (typeof window === "undefined") {
    return null;
  }
  const bridge = (window as Window & { neoDesktop?: unknown }).neoDesktop;
  if (!bridge || typeof bridge !== "object") {
    return null;
  }
  return bridge as DesktopBridge;
}

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "--";
  }
  const mb = bytes / 1024 / 1024;
  if (mb < 1024) {
    return `${mb.toFixed(mb > 100 ? 0 : 1)} MB`;
  }
  return `${(mb / 1024).toFixed(2)} GB`;
}

function parseStatusModels(statusResponse: RetrievalOperationResponse | null): Record<RetrievalFamily, RetrievalModelItem[]> {
  const result = statusResponse?.result;
  if (!result || typeof result !== "object") {
    return { embedding: [], rerank: [] };
  }
  const modelsByFamily = (result as { models_by_family?: unknown }).models_by_family;
  if (!modelsByFamily || typeof modelsByFamily !== "object") {
    return { embedding: [], rerank: [] };
  }

  const parseFamily = (family: RetrievalFamily): RetrievalModelItem[] => {
    const raw = (modelsByFamily as Record<string, unknown>)[family];
    if (!Array.isArray(raw)) {
      return [];
    }
    const parsed: RetrievalModelItem[] = [];
    for (const item of raw) {
      if (!item || typeof item !== "object") {
        continue;
      }
      const row = item as Record<string, unknown>;
      const modelId = asString(row.model_id).trim();
      const displayName = asString(row.display_name).trim() || modelId;
      if (!modelId || !displayName) {
        continue;
      }
      parsed.push({
        model_id: modelId,
        family,
        display_name: displayName,
        approx_size_bytes: Number(row.approx_size_bytes ?? 0),
        license: typeof row.license === "string" ? row.license : undefined,
        locale: typeof row.locale === "string" ? row.locale : undefined,
        installed: Boolean(row.installed),
        is_active: Boolean(row.is_active),
        is_configured_active: Boolean(row.is_configured_active),
      });
    }
    return parsed;
  };

  return {
    embedding: parseFamily("embedding"),
    rerank: parseFamily("rerank"),
  };
}

function parseStatusPacks(statusResponse: RetrievalOperationResponse | null): RetrievalPackItem[] {
  const result = statusResponse?.result;
  if (!result || typeof result !== "object") {
    return [];
  }
  const packsRaw = (result as { packs?: unknown }).packs;
  if (!Array.isArray(packsRaw)) {
    return [];
  }
  const parsed: RetrievalPackItem[] = [];
  for (const item of packsRaw) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const row = item as Record<string, unknown>;
    const packId = asString(row.pack_id).trim() as RetrievalPackId;
    if (packId !== "zh" && packId !== "en") {
      continue;
    }
    const rawModels = Array.isArray(row.models) ? row.models : [];
    const models: RetrievalModelItem[] = [];
    for (const modelItem of rawModels) {
      if (!modelItem || typeof modelItem !== "object") {
        continue;
      }
      const modelRow = modelItem as Record<string, unknown>;
      const modelId = asString(modelRow.model_id).trim();
      const family = asString(modelRow.family).trim() as RetrievalFamily;
      if (!modelId || (family !== "embedding" && family !== "rerank")) {
        continue;
      }
      models.push({
        model_id: modelId,
        family,
        display_name: asString(modelRow.display_name).trim() || modelId,
        approx_size_bytes: Number(modelRow.approx_size_bytes ?? 0),
        license: typeof modelRow.license === "string" ? modelRow.license : undefined,
        locale: typeof modelRow.locale === "string" ? modelRow.locale : undefined,
        installed: Boolean(modelRow.installed),
        is_active: Boolean(modelRow.is_active),
        is_configured_active: Boolean(modelRow.is_configured_active),
      });
    }
    const totalCount = Number(row.total_count ?? models.length ?? 0);
    const installedCount = Number(row.installed_count ?? models.filter((model) => model.installed).length);
    parsed.push({
      pack_id: packId,
      display_name: asString(row.display_name).trim() || packId,
      locale: asString(row.locale).trim() || undefined,
      approx_size_bytes: Number(row.approx_size_bytes ?? 0),
      installed: Boolean(row.installed),
      installed_count: installedCount,
      total_count: totalCount,
      status: (asString(row.status).trim() as RetrievalPackItem["status"]) || "not_installed",
      is_active_pack: Boolean(row.is_active_pack),
      models,
    });
  }
  return parsed;
}

function canUseCredential(value: string): boolean {
  const normalized = value.trim();
  return normalized.length > 0 && !normalized.startsWith("$");
}

export function RetrievalSettingsPage() {
  const { t } = useI18n();
  const m = t.migration.settings?.retrieval;
  const desktopBridge = useMemo(() => getDesktopBridge(), []);
  const {
    draftConfig,
    validationErrors,
    isLoading,
    error,
    dirty,
    disabled,
    saving,
    onConfigChange,
    onDiscard,
    onSave,
    onSaveConfig,
    refetchConfig,
  } = useConfigEditor();

  const [activeTab, setActiveTab] = useState<"packs" | "testing">("packs");
  const [legacyApiMode, setLegacyApiMode] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusResponse, setStatusResponse] = useState<RetrievalOperationResponse | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [packNormalizedToastShown, setPackNormalizedToastShown] = useState(false);
  const [activeAction, setActiveAction] = useState<string>("");
  const [downloadProgress, setDownloadProgress] = useState<{
    modelId: string;
    downloaded: number;
    total: number | null;
    percentage: number | null;
  } | null>(null);
  const [packDownloadProgress, setPackDownloadProgress] = useState<{
    packId: RetrievalPackId;
    completed: number;
    total: number;
    currentModelId: string | null;
  } | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<PendingRemove | null>(null);
  const [pendingDeleteProvider, setPendingDeleteProvider] = useState<PendingDeleteProvider | null>(null);
  const [progressByModel, setProgressByModel] = useState<Record<string, string>>({});
  const [showApiKey, setShowApiKey] = useState<Record<RetrievalFamily, boolean>>({
    embedding: false,
    rerank: false,
  });
  const [providerTesting, setProviderTesting] = useState<"" | RetrievalFamily>("");
  const [showProviderModels, setShowProviderModels] = useState<Record<RetrievalFamily, boolean>>({
    embedding: false,
    rerank: false,
  });

  const [testQuery, setTestQuery] = useState(m?.defaultTestQuery ?? "Test retrieval reranking quality");
  const [testDocs, setTestDocs] = useState(
    m?.defaultTestDocs
      ?? "Doc A: Nion supports a unified retrieval model center.\nDoc B: Generic chat feature.",
  );
  const [testResult, setTestResult] = useState<string>("");
  const [testBusy, setTestBusy] = useState<"" | "embedding" | "rerank">("");

  const retrievalConfig = useMemo(() => asObject(draftConfig.retrieval_models), [draftConfig.retrieval_models]);
  const providers = useMemo(() => asObject(retrievalConfig.providers), [retrievalConfig.providers]);
  const openAIEmbeddingProvider = useMemo(() => asObject(providers.openai_embedding), [providers.openai_embedding]);
  const rerankProvider = useMemo(() => asObject(providers.rerank_api), [providers.rerank_api]);

  const parsedModels = useMemo(() => parseStatusModels(statusResponse), [statusResponse]);
  const parsedPacks = useMemo(() => parseStatusPacks(statusResponse), [statusResponse]);
  const downloadedPackCount = useMemo(
    () => parsedPacks.filter((pack) => pack.status !== "not_installed").length,
    [parsedPacks],
  );
  const activePackId = useMemo(() => {
    const result = statusResponse?.result;
    if (!result || typeof result !== "object") {
      return null;
    }
    const raw = asString(asObject(result).active_pack_id).trim();
    return raw === "zh" || raw === "en" ? (raw as RetrievalPackId) : null;
  }, [statusResponse]);
  const statusProviders = useMemo(() => {
    const result = statusResponse?.result;
    if (!result || typeof result !== "object") {
      return { openai_embedding: {}, rerank_api: {} };
    }
    const providersObj = asObject(asObject(result).providers);
    return {
      openai_embedding: asObject(providersObj.openai_embedding),
      rerank_api: asObject(providersObj.rerank_api),
    };
  }, [statusResponse]);

  const isRouteNotFoundError = (err: unknown): boolean => {
    if (err instanceof RetrievalApiError) {
      return err.status === 404;
    }
    if (err instanceof Error) {
      return /not found/i.test(err.message);
    }
    return false;
  };

  const isFetchTransportError = (err: unknown): boolean => {
    if (err instanceof RetrievalApiError) {
      return false;
    }
    const message = err instanceof Error ? err.message : String(err);
    return /failed to fetch|network ?error|load failed|err_failed/i.test(message);
  };

  const shouldUseCompatFallback = (err: unknown): boolean =>
    isRouteNotFoundError(err) || isFetchTransportError(err);

  const isDesktopHandlerMissingError = (err: unknown): boolean => {
    const message = err instanceof Error ? err.message : String(err);
    return /No handler registered/i.test(message) || /Error invoking remote method/i.test(message);
  };

  const loadInstalledModelsFromDesktop = async (): Promise<Record<string, boolean>> => {
    const installedByModel: Record<string, boolean> = {};
    if (!desktopBridge) {
      return installedByModel;
    }

    try {
      if (desktopBridge.listRetrievalModels) {
        const listed = await desktopBridge.listRetrievalModels();
        const rawModels = listed && typeof listed === "object"
          ? (listed as { models?: unknown }).models
          : null;
        if (Array.isArray(rawModels)) {
          for (const item of rawModels) {
            if (!item || typeof item !== "object") {
              continue;
            }
            const row = item as Record<string, unknown>;
            const modelId = asString(row.model_id).trim();
            if (!modelId) {
              continue;
            }
            installedByModel[modelId] = Boolean(row.installed);
          }
          return installedByModel;
        }
      }
    } catch {
      // Best-effort fallback mode only.
    }

    return installedByModel;
  };

  const buildFallbackStatusResponse = async (): Promise<RetrievalOperationResponse> => {
    const retrieval = asObject(draftConfig.retrieval_models);
    const activeObj = asObject(retrieval.active);
    const activeEmbedding = asObject(activeObj.embedding);
    const activeRerank = asObject(activeObj.rerank);
    const providersObj = asObject(retrieval.providers);
    const installedMap = await loadInstalledModelsFromDesktop();

    const models_by_family: Record<RetrievalFamily, RetrievalModelItem[]> = {
      embedding: FALLBACK_MODEL_CATALOG.embedding.map((item) => ({
        ...item,
        family: "embedding" as const,
        installed: Boolean(installedMap[item.model_id]),
        is_active: (asString(activeEmbedding.provider) === "local_onnx"
          && asString(activeEmbedding.model_id) === item.model_id)
          && Boolean(installedMap[item.model_id]),
        is_configured_active: asString(activeEmbedding.provider) === "local_onnx"
          && asString(activeEmbedding.model_id) === item.model_id,
      })),
      rerank: FALLBACK_MODEL_CATALOG.rerank.map((item) => ({
        ...item,
        family: "rerank" as const,
        installed: Boolean(installedMap[item.model_id]),
        is_active: (asString(activeRerank.provider) === "local_onnx"
          && asString(activeRerank.model_id) === item.model_id)
          && Boolean(installedMap[item.model_id]),
        is_configured_active: asString(activeRerank.provider) === "local_onnx"
          && asString(activeRerank.model_id) === item.model_id,
      })),
    };

    const inferActivePackId = (): RetrievalPackId | null => {
      const embeddingModelId = asString(activeEmbedding.model_id).trim();
      const rerankModelId = asString(activeRerank.model_id).trim();
      if (
        asString(activeEmbedding.provider) !== "local_onnx"
        || asString(activeRerank.provider) !== "local_onnx"
      ) {
        return null;
      }
      for (const packId of ["zh", "en"] as const) {
        const member = PACK_MODEL_MAP[packId];
        if (member.embedding === embeddingModelId && member.rerank === rerankModelId) {
          return packId;
        }
      }
      return null;
    };

    const activePackId = inferActivePackId();
    const packs: RetrievalPackItem[] = (["zh", "en"] as const).map((packId) => {
      const mapping = PACK_MODEL_MAP[packId];
      const modelList = [
        models_by_family.embedding.find((item) => item.model_id === mapping.embedding),
        models_by_family.rerank.find((item) => item.model_id === mapping.rerank),
      ].filter((item): item is RetrievalModelItem => Boolean(item));
      const installedCount = modelList.filter((item) => item.installed).length;
      const totalCount = 2;
      const status = installedCount === 0 ? "not_installed" : (installedCount === totalCount ? "installed" : "partial");
      return {
        pack_id: packId,
        display_name: packId === "zh"
          ? t.settings.retrieval.packNameZh
          : t.settings.retrieval.packNameEn,
        locale: packId === "zh" ? "zh-CN" : "en-US",
        approx_size_bytes: modelList.reduce((sum, item) => sum + item.approx_size_bytes, 0),
        installed: installedCount === totalCount,
        installed_count: installedCount,
        total_count: totalCount,
        status,
        is_active_pack: activePackId === packId,
        models: modelList,
      };
    });

    return {
      status: "degraded",
      latency_ms: 0,
      error_code: "retrieval_status_fallback",
      result: {
        enabled: asBoolean(retrieval.enabled, true),
        source_priority: Array.isArray(retrieval.source_priority)
          ? retrieval.source_priority
          : ["modelscope", "manual_import"],
        providers: providersObj,
        active: {
          embedding: activeEmbedding,
          rerank: activeRerank,
        },
        active_pack_id: activePackId,
        normalization_applied: false,
        packs,
        models_by_family,
        compatibility_mode: true,
      },
    };
  };

  const loadStatus = async (): Promise<RetrievalOperationResponse | null> => {
    setStatusLoading(true);
    setStatusError(null);
    try {
      const response = await loadRetrievalModelsStatus();
      setStatusResponse(response);
      setLegacyApiMode(false);
      return response;
    } catch (err) {
      if (shouldUseCompatFallback(err)) {
        const fallbackResponse = await buildFallbackStatusResponse();
        setStatusResponse(fallbackResponse);
        setLegacyApiMode(true);
        setStatusError(
          m?.routeMissingCompatApplied
            ?? "Retrieval route missing. Applied via config compatibility mode.",
        );
        return fallbackResponse;
      }
      const message = err instanceof Error ? err.message : String(err);
      setStatusError(message);
      return null;
    } finally {
      setStatusLoading(false);
    }
  };

  useEffect(() => {
    void loadStatus();
  }, []);

  useEffect(() => {
    const result = statusResponse?.result;
    if (!result || typeof result !== "object") {
      return;
    }
    const normalized = asBoolean(asObject(result).normalization_applied, false);
    if (normalized && !packNormalizedToastShown) {
      toast.success(t.settings.retrieval.packNormalizedHint);
      setPackNormalizedToastShown(true);
    }
  }, [packNormalizedToastShown, statusResponse, t.settings.retrieval.packNormalizedHint]);

  useEffect(() => {
    if (!desktopBridge?.onRetrievalModelDownloadProgress) {
      return;
    }
    const unsubscribe = desktopBridge.onRetrievalModelDownloadProgress((payload) => {
      if (!payload || typeof payload !== "object") {
        return;
      }
      const record = payload as {
        modelId?: string;
        status?: string;
        downloadedBytes?: number;
        totalBytes?: number | null;
        message?: string;
      };
      if (!record.modelId) {
        return;
      }
      const downloaded = typeof record.downloadedBytes === "number" ? formatSize(record.downloadedBytes) : "--";
      const total = typeof record.totalBytes === "number" ? formatSize(record.totalBytes) : "--";
      setProgressByModel((prev) => ({
        ...prev,
        [record.modelId!]: `${record.status ?? "-"} ${downloaded}/${total} ${record.message ?? ""}`,
      }));
    });
    return () => {
      if (typeof unsubscribe === "function") {
        unsubscribe();
      }
    };
  }, [desktopBridge]);

  const updateRetrievalConfig = (updater: (current: Record<string, unknown>) => Record<string, unknown>) => {
    const next = cloneConfig(draftConfig);
    const current = asObject(next.retrieval_models);
    next.retrieval_models = updater(current);
    onConfigChange(next);
  };

  const updateProviderField = (
    providerKey: "openai_embedding" | "rerank_api",
    field: string,
    value: string | boolean,
  ) => {
    updateRetrievalConfig((current) => {
      const currentProviders = asObject(current.providers);
      const provider = asObject(currentProviders[providerKey]);
      provider[field] = value;
      currentProviders[providerKey] = provider;
      return {
        ...current,
        providers: currentProviders,
      };
    });
  };

  const persistActiveThroughConfig = async (
    family: RetrievalFamily,
    provider: "local_onnx" | "openai_compatible" | "rerank_api",
    modelId?: string,
    model?: string,
  ): Promise<boolean> => {
    const next = cloneConfig(draftConfig);
    const retrieval = asObject(next.retrieval_models);
    const active = asObject(retrieval.active);
    const target = asObject(active[family]);
    target.provider = provider;
    target.model_id = provider === "local_onnx" ? (modelId ?? null) : null;
    target.model = provider === "local_onnx" ? null : (model ?? null);
    active[family] = target;
    retrieval.active = active;
    next.retrieval_models = retrieval;

    onConfigChange(next);
    const saved = await onSaveConfig(next);
    if (!saved) {
      return false;
    }
    await refetchConfig();
    await loadStatus();
    return true;
  };

  const persistLocalPackThroughConfig = async (packId: RetrievalPackId): Promise<boolean> => {
    const mapping = PACK_MODEL_MAP[packId];
    const next = cloneConfig(draftConfig);
    const retrieval = asObject(next.retrieval_models);
    const active = asObject(retrieval.active);
    const embedding = asObject(active.embedding);
    embedding.provider = "local_onnx";
    embedding.model_id = mapping.embedding;
    embedding.model = null;
    const rerank = asObject(active.rerank);
    rerank.provider = "local_onnx";
    rerank.model_id = mapping.rerank;
    rerank.model = null;
    active.embedding = embedding;
    active.rerank = rerank;
    retrieval.active = active;
    next.retrieval_models = retrieval;

    onConfigChange(next);
    const saved = await onSaveConfig(next);
    if (!saved) {
      return false;
    }
    await refetchConfig();
    await loadStatus();
    return true;
  };

  const runDesktopModelAction = async (
    actionKey: string,
    modelId: string,
    action: ((modelId: string) => Promise<{ success?: boolean; message?: string }>) | undefined,
  ) => {
    // If no desktop bridge action, try backend API fallback
    if (!action) {
      // Download and remove are supported via backend API
      if (actionKey === "download") {
        setActiveAction(`${actionKey}:${modelId}`);
        setDownloadProgress({ modelId, downloaded: 0, total: null, percentage: null });
        try {
          const response = await downloadRetrievalModelWithProgress(modelId, (progress) => {
            setDownloadProgress({
              modelId,
              downloaded: progress.downloaded,
              total: progress.total,
              percentage: progress.percentage,
            });
          });
          if (response.status !== "ok") {
            throw new Error(response.error_code ?? "download_failed");
          }
          await loadStatus();
          toast.success(t.settings.retrieval.downloadSuccess ?? "Model downloaded successfully");
          return true;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          toast.error(`${t.settings.retrieval.operationFailedPrefix}${message}`);
          return false;
        } finally {
          setActiveAction("");
          setDownloadProgress(null);
        }
      } else if (actionKey === "import") {
        // Create file input for model import
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".onnx";
        input.onchange = async (e) => {
          const file = (e.target as HTMLInputElement).files?.[0];
          if (!file) {
            return;
          }

          setActiveAction(`${actionKey}:${modelId}`);
          try {
            const response = await importRetrievalModel(modelId, file);
            if (response.status !== "ok") {
              throw new Error(response.error_code ?? "import_failed");
            }
            await loadStatus();
            toast.success(t.settings.retrieval.importSuccess ?? "Model imported successfully");
            return true;
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            toast.error(`${t.settings.retrieval.operationFailedPrefix}${message}`);
            return false;
          } finally {
            setActiveAction("");
          }
        };
        input.click();
        return true;
      } else if (actionKey === "remove") {
        setActiveAction(`${actionKey}:${modelId}`);
        try {
          const response = await removeRetrievalModel(modelId);
          if (response.status !== "ok") {
            const errorCode = response.error_code ?? "remove_failed";
            if (errorCode === "retrieval_active_model_remove_forbidden") {
              throw new Error(
                t.settings.retrieval.packDeleteActiveForbidden,
              );
            }
            if (errorCode === "retrieval_pack_keep_one_required") {
              throw new Error(
                t.settings.retrieval.packDeleteKeepOneRequired,
              );
            }
            throw new Error(errorCode);
          }
          await loadStatus();
          return true;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          toast.error(`${t.settings.retrieval.operationFailedPrefix}${message}`);
          return false;
        } finally {
          setActiveAction("");
        }
      } else {
        // Import and other actions require desktop bridge
        toast.error(
          desktopBridge
            ? (m?.desktopModelActionUnsupported
              ?? "This desktop runtime does not support model actions yet. Please restart or upgrade desktop.")
            : t.settings.retrieval.desktopOnlyHint,
        );
        return false;
      }
    }

    // Use desktop bridge action
    setActiveAction(`${actionKey}:${modelId}`);
    try {
      const result = await action(modelId);
      if (result?.success === false) {
        throw new Error(result.message ?? "action_failed");
      }
      await loadStatus();
      return true;
    } catch (err) {
      const message = isDesktopHandlerMissingError(err)
        ? (m?.desktopModelActionUnsupported
          ?? "This desktop runtime does not support model actions yet. Please restart or upgrade desktop.")
        : (err instanceof Error ? err.message : String(err));
      toast.error(`${t.settings.retrieval.operationFailedPrefix}${message}`);
      return false;
    } finally {
      setActiveAction("");
    }
  };

  const handleSetActivePack = async (
    packId: RetrievalPackId,
    options?: { suppressSuccessToast?: boolean; manageAction?: boolean },
  ): Promise<boolean> => {
    const suppressSuccessToast = options?.suppressSuccessToast ?? false;
    const manageAction = options?.manageAction ?? true;
    if (manageAction) {
      setActiveAction(`enable-pack:${packId}`);
    }
    try {
      if (legacyApiMode) {
        const ok = await persistLocalPackThroughConfig(packId);
        if (ok) {
          if (!suppressSuccessToast) {
            toast.success(t.settings.retrieval.setActiveSuccess);
          }
          return true;
        }
      }
      const response = await setActiveRetrievalPack(packId);
      if (response.status !== "ok") {
        throw new Error(response.error_code ?? "set_active_pack_failed");
      }
      if (!suppressSuccessToast) {
        const migrationResult = response.result?.migration;
        if (migrationResult && typeof migrationResult === "object" && "migrated" in migrationResult && migrationResult.migrated === true) {
          toast.success(t.settings.retrieval.migrationSuccess);
        } else {
          toast.success(t.settings.retrieval.setActiveSuccess);
        }
      }
      await loadStatus();
      await refetchConfig();
      return true;
    } catch (err) {
      if (shouldUseCompatFallback(err)) {
        const ok = await persistLocalPackThroughConfig(packId);
        if (ok) {
          setLegacyApiMode(true);
          setStatusError(
            m?.routeMissingCompatApplied
              ?? "Retrieval route missing. Applied via config compatibility mode.",
          );
          if (!suppressSuccessToast) {
            toast.success(t.settings.retrieval.setActiveSuccess);
          }
          return true;
        }
      }
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`${t.settings.retrieval.operationFailedPrefix}${message}`);
      return false;
    } finally {
      if (manageAction) {
        setActiveAction("");
      }
    }
  };

  const downloadSingleModelForPack = async (modelId: string): Promise<boolean> => {
    if (desktopBridge?.downloadRetrievalModel) {
      try {
        const result = await desktopBridge.downloadRetrievalModel(modelId);
        if (result?.success === false) {
          throw new Error(result.message ?? "download_failed");
        }
        return true;
      } catch (err) {
        const message = isDesktopHandlerMissingError(err)
          ? (m?.desktopModelActionUnsupported
            ?? "This desktop runtime does not support model actions yet. Please restart or upgrade desktop.")
          : (err instanceof Error ? err.message : String(err));
        toast.error(`${t.settings.retrieval.operationFailedPrefix}${message}`);
        return false;
      }
    }

    setDownloadProgress({ modelId, downloaded: 0, total: null, percentage: null });
    try {
      const response = await downloadRetrievalModelWithProgress(modelId, (progress) => {
        setDownloadProgress({
          modelId,
          downloaded: progress.downloaded,
          total: progress.total,
          percentage: progress.percentage,
        });
      });
      if (response.status !== "ok") {
        throw new Error(response.error_code ?? "download_failed");
      }
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`${t.settings.retrieval.operationFailedPrefix}${message}`);
      return false;
    } finally {
      setDownloadProgress(null);
    }
  };

  const handleDownloadAndEnablePack = async (packId: RetrievalPackId) => {
    setActiveAction(`download-enable-pack:${packId}`);
    try {
      const mapping = PACK_MODEL_MAP[packId];
      const modelIds = [mapping.embedding, mapping.rerank];
      const pack = parsedPacks.find((item) => item.pack_id === packId);
      const installedModelIds = new Set(
        (pack?.models ?? [])
          .filter((item) => item.installed)
          .map((item) => item.model_id),
      );
      const pendingModelIds = modelIds.filter((modelId) => !installedModelIds.has(modelId));

      setPackDownloadProgress({
        packId,
        completed: 0,
        total: pendingModelIds.length,
        currentModelId: pendingModelIds[0] ?? null,
      });

      for (const [index, modelId] of pendingModelIds.entries()) {
        setPackDownloadProgress({
          packId,
          completed: index,
          total: pendingModelIds.length,
          currentModelId: modelId,
        });
        const ok = await downloadSingleModelForPack(modelId);
        if (!ok) {
          return;
        }
      }

      setPackDownloadProgress({
        packId,
        completed: pendingModelIds.length,
        total: pendingModelIds.length,
        currentModelId: null,
      });

      await loadStatus();
      const activated = await handleSetActivePack(packId, {
        suppressSuccessToast: true,
        manageAction: false,
      });
      if (activated) {
        await refetchConfig();
        toast.success(t.settings.retrieval.packDownloadAndEnableSuccess);
        return;
      }
    } finally {
      setPackDownloadProgress(null);
      setDownloadProgress(null);
      setActiveAction("");
    }
  };

  const handleDeletePack = async (packId: RetrievalPackId) => {
    setActiveAction(`delete-pack:${packId}`);
    try {
      const response = await deleteRetrievalPack(packId);
      if (response.status !== "ok") {
        const errorCode = response.error_code ?? "delete_pack_failed";
        if (errorCode === "retrieval_active_model_remove_forbidden") {
          throw new Error(
            t.settings.retrieval.packDeleteActiveForbidden,
          );
        }
        if (errorCode === "retrieval_pack_keep_one_required") {
          throw new Error(
            t.settings.retrieval.packDeleteKeepOneRequired,
          );
        }
        throw new Error(errorCode);
      }
      await loadStatus();
      toast.success(t.settings.retrieval.packDeleteSuccess);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`${t.settings.retrieval.operationFailedPrefix}${message}`);
    } finally {
      setActiveAction("");
    }
  };

  const handleSetActiveLocal = async (family: RetrievalFamily, modelId: string) => {
    setActiveAction(`enable:${modelId}`);
    try {
      const response = await setActiveRetrievalModel({
        family,
        provider: "local_onnx",
        model_id: modelId,
      });
      if (response.status !== "ok") {
        throw new Error(response.error_code ?? "set_active_failed");
      }
      // Check if migration happened
      const migrationResult = response.result?.migration;
      if (migrationResult && typeof migrationResult === "object" && "migrated" in migrationResult && migrationResult.migrated === true) {
        toast.success(t.settings.retrieval.migrationSuccess);
      } else {
        toast.success(t.settings.retrieval.setActiveSuccess);
      }
      await loadStatus();
      await refetchConfig();
    } catch (err) {
      if (isRouteNotFoundError(err)) {
        const ok = await persistActiveThroughConfig(family, "local_onnx", modelId);
        if (ok) {
          setLegacyApiMode(true);
          setStatusError(
            m?.routeMissingCompatApplied
              ?? "Retrieval route missing. Applied via config compatibility mode.",
          );
          toast.success(t.settings.retrieval.setActiveSuccess);
          return;
        }
      }
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`${t.settings.retrieval.operationFailedPrefix}${message}`);
    } finally {
      setActiveAction("");
    }
  };

  const handleSetActiveRemote = async (family: RetrievalFamily) => {
    setActiveAction(`enable-remote:${family}`);
    try {
      const payload = family === "embedding"
        ? {
            family,
            provider: "openai_compatible" as const,
            model: asString(openAIEmbeddingProvider.model).trim() || undefined,
          }
        : {
            family,
            provider: "rerank_api" as const,
            model: asString(rerankProvider.model).trim() || undefined,
          };
      const response = await setActiveRetrievalModel(payload);
      if (response.status !== "ok") {
        throw new Error(response.error_code ?? "set_active_failed");
      }
      toast.success(t.settings.retrieval.setActiveSuccess);
      await loadStatus();
      await refetchConfig();
    } catch (err) {
      if (isRouteNotFoundError(err)) {
        const provider = family === "embedding" ? "openai_compatible" : "rerank_api";
        const modelValue = family === "embedding"
          ? (asString(openAIEmbeddingProvider.model).trim() || undefined)
          : (asString(rerankProvider.model).trim() || undefined);
        const ok = await persistActiveThroughConfig(family, provider, undefined, modelValue);
        if (ok) {
          setLegacyApiMode(true);
          setStatusError(
            m?.routeMissingCompatApplied
              ?? "Retrieval route missing. Applied via config compatibility mode.",
          );
          toast.success(t.settings.retrieval.setActiveSuccess);
          return;
        }
      }
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`${t.settings.retrieval.operationFailedPrefix}${message}`);
    } finally {
      setActiveAction("");
    }
  };

  const clearProviderConfig = (family: RetrievalFamily) => {
    if (family === "embedding") {
      updateRetrievalConfig((current) => {
        const currentProviders = asObject(current.providers);
        currentProviders.openai_embedding = {
          enabled: false,
          name: "OpenAI-compatible Embedding",
          protocol: "openai_compatible",
          model: "",
          api_base: "",
          api_key: "",
          timeout_ms: 12000,
          dimension: 1536,
          input: "text",
        };
        return { ...current, providers: currentProviders };
      });
      return;
    }

    updateRetrievalConfig((current) => {
      const currentProviders = asObject(current.providers);
      currentProviders.rerank_api = {
        enabled: false,
        name: "Rerank API",
        protocol: "rerank_api",
        model: "",
        api_base: "",
        api_key: "",
        path: "/rerank",
        timeout_ms: 12000,
      };
      return { ...current, providers: currentProviders };
    });
  };

  const handleTestProviderConnection = async (family: RetrievalFamily) => {
    const saved = await onSave();
    if (!saved) {
      return;
    }

    setProviderTesting(family);
    try {
      const payload = family === "embedding"
        ? {
            family,
            provider: "openai_compatible" as const,
            model: asString(openAIEmbeddingProvider.model).trim() || undefined,
          }
        : {
            family,
            provider: "rerank_api" as const,
            model: asString(rerankProvider.model).trim() || undefined,
          };
      const response = await testRetrievalProviderConnection(payload);
      if (response.status !== "ok") {
        throw new Error(response.error_code ?? "provider_connection_failed");
      }
      toast.success(t.settings.retrieval.providerConnectionSuccess);
      setTestResult(JSON.stringify(response, null, 2));
    } catch (err) {
      if (isRouteNotFoundError(err)) {
        const message = m?.providerTestApiUnsupported ?? "Current backend does not support provider connection test route yet.";
        toast.error(message);
        setTestResult(message);
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`${t.settings.retrieval.operationFailedPrefix}${message}`);
      setTestResult(`${t.settings.retrieval.operationFailedPrefix}${message}`);
    } finally {
      setProviderTesting("");
    }
  };

  const handleConfirmDeleteProvider = async () => {
    if (!pendingDeleteProvider) {
      return;
    }
    clearProviderConfig(pendingDeleteProvider.family);
    setPendingDeleteProvider(null);
    toast.success(t.settings.retrieval.providerDeleteSuccess);
  };

  const tryAutoSwitchAfterRemove = async (family: RetrievalFamily, removedModelId: string) => {
    const currentStatus = await loadStatus();
    const models = parseStatusModels(currentStatus)[family]
      .filter((item) => item.installed && item.model_id !== removedModelId);

    if (models.length > 0) {
      const target = models.at(0);
      if (!target) {
        return;
      }
      try {
        const response = await setActiveRetrievalModel({
          family,
          provider: "local_onnx",
          model_id: target.model_id,
        });
        if (response.status === "ok") {
          toast.success(t.settings.retrieval.autoSwitchLocalSuccess);
          await loadStatus();
          await refetchConfig();
          return;
        }
      } catch (error) {
        if (isRouteNotFoundError(error)) {
          const ok = await persistActiveThroughConfig(family, "local_onnx", target.model_id);
          if (ok) {
            toast.success(t.settings.retrieval.autoSwitchLocalSuccess);
            return;
          }
        } else {
          throw error;
        }
      }
    }

    if (family === "embedding") {
      const providerCfg = statusProviders.openai_embedding;
      if (
        asBoolean(providerCfg.enabled)
        && canUseCredential(asString(providerCfg.api_base))
        && canUseCredential(asString(providerCfg.api_key))
      ) {
        try {
          const response = await setActiveRetrievalModel({
            family,
            provider: "openai_compatible",
            model: asString(providerCfg.model).trim() || undefined,
          });
          if (response.status === "ok") {
            toast.success(t.settings.retrieval.autoSwitchRemoteSuccess);
            await loadStatus();
            await refetchConfig();
            return;
          }
        } catch (error) {
          if (isRouteNotFoundError(error)) {
            const ok = await persistActiveThroughConfig(
              family,
              "openai_compatible",
              undefined,
              asString(providerCfg.model).trim() || undefined,
            );
            if (ok) {
              toast.success(t.settings.retrieval.autoSwitchRemoteSuccess);
              return;
            }
          } else {
            throw error;
          }
        }
      }
    }

    if (family === "rerank") {
      const providerCfg = statusProviders.rerank_api;
      if (asBoolean(providerCfg.enabled) && canUseCredential(asString(providerCfg.api_base))) {
        try {
          const response = await setActiveRetrievalModel({
            family,
            provider: "rerank_api",
            model: asString(providerCfg.model).trim() || undefined,
          });
          if (response.status === "ok") {
            toast.success(t.settings.retrieval.autoSwitchRemoteSuccess);
            await loadStatus();
            await refetchConfig();
            return;
          }
        } catch (error) {
          if (isRouteNotFoundError(error)) {
            const ok = await persistActiveThroughConfig(
              family,
              "rerank_api",
              undefined,
              asString(providerCfg.model).trim() || undefined,
            );
            if (ok) {
              toast.success(t.settings.retrieval.autoSwitchRemoteSuccess);
              return;
            }
          } else {
            throw error;
          }
        }
      }
    }

    toast.error(t.settings.retrieval.autoSwitchFailed);
  };

  const handleConfirmRemove = async () => {
    if (!pendingRemove) {
      return;
    }
    const { modelId, family, wasActive } = pendingRemove;
    const removed = await runDesktopModelAction(
      "remove",
      modelId,
      desktopBridge?.removeRetrievalModel
        ? (id) => desktopBridge.removeRetrievalModel!(id)
        : undefined,
    );
    if (!removed) {
      return;
    }
    toast.success(t.settings.retrieval.removeSuccess);
    setPendingRemove(null);

    if (wasActive) {
      try {
        await tryAutoSwitchAfterRemove(family, modelId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        toast.error(`${t.settings.retrieval.operationFailedPrefix}${message}`);
      }
    }
  };

  const handleTestEmbedding = async () => {
    setTestBusy("embedding");
    try {
      const query = testQuery.trim();
      const result = await testRetrievalEmbedding(query.length > 0 ? query : "test");
      setTestResult(JSON.stringify(result, null, 2));
    } catch (err) {
      if (isRouteNotFoundError(err)) {
        const message = m?.embeddingTestApiUnsupported ?? "Current backend does not support embedding test route yet.";
        setTestResult(message);
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      setTestResult(`${t.settings.retrieval.operationFailedPrefix}${message}`);
    } finally {
      setTestBusy("");
    }
  };

  const handleTestRerank = async () => {
    setTestBusy("rerank");
    try {
      const query = testQuery.trim();
      const documents = testDocs
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      const result = await testRetrievalRerank(query.length > 0 ? query : "test", documents);
      setTestResult(JSON.stringify(result, null, 2));
    } catch (err) {
      if (isRouteNotFoundError(err)) {
        const message = m?.rerankTestApiUnsupported ?? "Current backend does not support rerank test route yet.";
        setTestResult(message);
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      setTestResult(`${t.settings.retrieval.operationFailedPrefix}${message}`);
    } finally {
      setTestBusy("");
    }
  };

  const renderPackCards = () => {
    if (parsedPacks.length === 0) {
      return <div className="text-muted-foreground text-sm">{t.settings.retrieval.noModels}</div>;
    }

    return (
      <div className="space-y-3">
        {parsedPacks.map((pack) => {
          const isBusy = activeAction !== "";
          const isPackDownloading = activeAction === `download-enable-pack:${pack.pack_id}`;
          const isPackEnabling = activeAction === `enable-pack:${pack.pack_id}`;
          const isPackDeleting = activeAction === `delete-pack:${pack.pack_id}`;
          const packDownloadMeta = packDownloadProgress?.packId === pack.pack_id
            ? packDownloadProgress
            : null;
          const currentDownloadModel = packDownloadMeta?.currentModelId
            ? pack.models.find((item) => item.model_id === packDownloadMeta.currentModelId)
            : null;
          const packDownloadStatusText = packDownloadMeta?.currentModelId
            ? progressByModel[packDownloadMeta.currentModelId]
            : "";
          const packByteProgress = packDownloadMeta?.currentModelId
            && downloadProgress?.modelId === packDownloadMeta.currentModelId
            ? downloadProgress
            : null;
          const canEnable = pack.status === "installed" && !pack.is_active_pack && !isBusy;
          const canDownloadAndEnable = !isBusy && pack.status !== "installed";
          const canDelete = !isBusy
            && pack.status !== "not_installed"
            && !pack.is_active_pack
            && downloadedPackCount > 1;
          const statusLabel = pack.status === "installed"
            ? t.settings.retrieval.statusInstalled
            : t.settings.retrieval.statusNotInstalled;

          return (
            <div key={pack.pack_id} className="space-y-3 rounded-md border p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold">{pack.display_name}</div>
                  <div className="text-muted-foreground text-xs">
                    {pack.pack_id.toUpperCase()} · {pack.locale ?? "--"} · {formatSize(pack.approx_size_bytes)}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant={pack.status === "installed" ? "default" : "secondary"}>
                    {statusLabel}
                  </Badge>
                  {pack.is_active_pack ? <Badge variant="outline">{t.settings.retrieval.statusActive}</Badge> : null}
                </div>
              </div>

              <div className="text-muted-foreground text-xs">
                {pack.models.map((model) => `${model.family === "embedding" ? t.settings.retrieval.tabEmbedding : t.settings.retrieval.tabRerank}: ${model.display_name}`).join(" · ")}
              </div>

              <div className="flex flex-wrap gap-2">
                {pack.status !== "installed" ? (
                  <Button
                    size="sm"
                    disabled={!canDownloadAndEnable}
                    onClick={() => {
                      void handleDownloadAndEnablePack(pack.pack_id);
                    }}
                  >
                    {isPackDownloading ? <Loader2Icon className="mr-1 size-4 animate-spin" /> : <DownloadIcon className="mr-1 size-4" />}
                    {t.settings.retrieval.packActionDownloadAndEnable}
                  </Button>
                ) : pack.is_active_pack ? (
                  <Button size="sm" disabled>
                    {t.settings.retrieval.actionEnabled}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    disabled={!canEnable}
                    onClick={() => {
                      void handleSetActivePack(pack.pack_id);
                    }}
                  >
                    {isPackEnabling ? <Loader2Icon className="mr-1 size-4 animate-spin" /> : null}
                    {t.settings.retrieval.packActionEnable}
                  </Button>
                )}

                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!canDelete}
                  onClick={() => {
                    void handleDeletePack(pack.pack_id);
                  }}
                >
                  {isPackDeleting ? <Loader2Icon className="mr-1 size-4 animate-spin" /> : <Trash2Icon className="mr-1 size-4" />}
                  {t.settings.retrieval.packActionDelete}
                </Button>
              </div>

              {packDownloadMeta ? (
                <div className="space-y-1">
                  <div className="text-muted-foreground text-xs">
                    {t.settings.retrieval.packDownloadProgressTemplate
                      .replace("{completed}", String(packDownloadMeta.completed))
                      .replace("{total}", String(packDownloadMeta.total))
                      .replace(
                        "{currentModel}",
                        currentDownloadModel ? ` · ${currentDownloadModel.display_name}` : "",
                      )}
                  </div>
                  {packByteProgress ? (
                    <div className="space-y-1">
                      <div className="text-muted-foreground text-xs">
                        {packByteProgress.percentage !== null
                          ? `${packByteProgress.percentage}%`
                          : "0%"}
                      </div>
                      <div className="h-1.5 overflow-hidden rounded bg-muted">
                        <div
                          className="h-full bg-primary transition-all"
                          style={{
                            width: packByteProgress.percentage
                              ? `${packByteProgress.percentage}%`
                              : "0%",
                          }}
                        />
                      </div>
                    </div>
                  ) : null}
                  {packDownloadStatusText ? (
                    <div className="text-muted-foreground text-xs">{packDownloadStatusText}</div>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    );
  };

  const renderModelCards = (family: RetrievalFamily) => {
    const models = parsedModels[family];
    if (models.length === 0) {
      return <div className="text-muted-foreground text-sm">{t.settings.retrieval.noModels}</div>;
    }

    return (
      <div className="space-y-3">
        {models.map((model) => {
          const isBusy = activeAction !== "";
          const isActionBusy = (prefix: string) => activeAction === `${prefix}:${model.model_id}`;
          // Download is always available (backend API fallback)
          const canDownload = true;
          // Import is always available (backend API with file upload)
          const canImport = true;
          // Active local model cannot be removed until switched away.
          const canRemove = !model.is_active;
          const isConfiguredActive = Boolean(model.is_configured_active);

          return (
            <div key={model.model_id} className="space-y-3 rounded-md border p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold">{model.display_name}</div>
                  <div className="text-muted-foreground text-xs">
                    {model.model_id} · {formatSize(model.approx_size_bytes)}
                    {model.locale ? ` · ${model.locale}` : ""}
                    {model.license ? ` · ${model.license}` : ""}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant={model.installed ? "default" : "secondary"}>
                    {model.installed ? t.settings.retrieval.statusInstalled : t.settings.retrieval.statusNotInstalled}
                  </Badge>
                  {model.is_active ? <Badge variant="outline">{t.settings.retrieval.statusActive}</Badge> : null}
                  {!model.installed && isConfiguredActive ? (
                    <Badge variant="outline">{t.settings.retrieval.statusConfiguredPending}</Badge>
                  ) : null}
                </div>
              </div>

              {!model.installed && isConfiguredActive ? (
                <div className="text-amber-700 text-xs">{t.settings.retrieval.configuredPendingHint}</div>
              ) : null}

              {progressByModel[model.model_id] ? (
                <div className="text-muted-foreground text-xs">{progressByModel[model.model_id]}</div>
              ) : null}

              <div className="flex flex-wrap gap-2">
                {!model.installed ? (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!canDownload || isBusy}
                      onClick={() =>
                        void runDesktopModelAction(
                          "download",
                          model.model_id,
                          desktopBridge?.downloadRetrievalModel
                            ? (id) => desktopBridge.downloadRetrievalModel!(id)
                            : undefined,
                        )
                      }
                    >
                      {isActionBusy("download") ? (
                        <Loader2Icon className="mr-1 size-4 animate-spin" />
                      ) : (
                        <DownloadIcon className="mr-1 size-4" />
                      )}
                      {t.settings.retrieval.actionDownload}
                    </Button>
                    {downloadProgress?.modelId === model.model_id && (
                      <div className="w-full mt-2 space-y-1">
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>
                            {downloadProgress.percentage !== null
                              ? `${downloadProgress.percentage}%`
                              : t.settings.retrieval.downloading}
                          </span>
                          <span>
                            {downloadProgress.total
                              ? `${(downloadProgress.downloaded / 1024 / 1024).toFixed(1)}MB / ${(downloadProgress.total / 1024 / 1024).toFixed(1)}MB`
                              : `${(downloadProgress.downloaded / 1024 / 1024).toFixed(1)}MB`}
                          </span>
                        </div>
                        <div className="w-full h-2 bg-secondary rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary transition-all duration-300"
                            style={{
                              width: downloadProgress.percentage
                                ? `${downloadProgress.percentage}%`
                                : "0%",
                            }}
                          />
                        </div>
                      </div>
                    )}
                  </>
                ) : model.is_active ? (
                  <Button size="sm" disabled>
                    {t.settings.retrieval.actionEnabled}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => {
                      void handleSetActiveLocal(family, model.model_id);
                    }}
                    disabled={isBusy}
                  >
                    {isActionBusy("enable") ? <Loader2Icon className="mr-1 size-4 animate-spin" /> : null}
                    {t.settings.retrieval.actionEnable}
                  </Button>
                )}

                <Button
                  size="sm"
                  variant="outline"
                  disabled={!canImport || isBusy}
                  onClick={() =>
                    void runDesktopModelAction(
                      "import",
                      model.model_id,
                      desktopBridge?.importRetrievalModel
                        ? (id) => desktopBridge.importRetrievalModel!(id)
                        : undefined,
                    )
                  }
                >
                  {isActionBusy("import") ? (
                    <Loader2Icon className="mr-1 size-4 animate-spin" />
                  ) : (
                    <UploadIcon className="mr-1 size-4" />
                  )}
                  {t.settings.retrieval.actionImport}
                </Button>

                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!model.installed || !canRemove || isBusy}
                  onClick={() => {
                    setPendingRemove({
                      modelId: model.model_id,
                      family,
                      displayName: model.display_name,
                      wasActive: Boolean(model.is_active),
                    });
                  }}
                >
                  {isActionBusy("remove") ? (
                    <Loader2Icon className="mr-1 size-4 animate-spin" />
                  ) : (
                    <Trash2Icon className="mr-1 size-4" />
                  )}
                  {t.settings.retrieval.actionDelete}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderAdvancedProvider = (family: RetrievalFamily) => {
    const providerKey = family === "embedding" ? "openai_embedding" : "rerank_api";
    const provider = family === "embedding" ? openAIEmbeddingProvider : rerankProvider;
    const providerName = family === "embedding"
      ? t.settings.retrieval.providerEmbeddingTitle
      : t.settings.retrieval.providerRerankTitle;
    const providerModel = asString(provider.model).trim();
    const providerApiBase = asString(provider.api_base);
    const providerApiKey = asString(provider.api_key);
    const providerPath = asString(provider.path);
    const providerEnabled = asBoolean(provider.enabled);
    const isProviderActive = activeAction === `enable-remote:${family}`;
    const protocolLabel = family === "embedding"
      ? t.settings.retrieval.providerProtocolOpenAI
      : t.settings.retrieval.providerProtocolRerank;

    const setProviderField = (field: string, value: string | boolean) => {
      updateProviderField(providerKey, field, value);
    };

    const showModels = showProviderModels[family];
    const testBusy = providerTesting === family;
    const deleteDangerClass = "text-rose-600 hover:text-rose-600";

    const handleDeleteProviderClick = () => {
      setPendingDeleteProvider({
        family,
        providerName,
      });
    };

    const modelSuggestions = PROVIDER_MODEL_SUGGESTIONS[family];

    if (family === "embedding") {
      return (
        <div className="space-y-4 rounded-xl border p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="space-y-1">
              <div className="text-base font-semibold">{t.settings.retrieval.providerDetailTitle}</div>
              <div className="text-muted-foreground text-sm">{providerName}</div>
            </div>
            <Badge variant="secondary" className="rounded-full border px-2.5 py-1 text-xs font-medium">
              {protocolLabel}
            </Badge>
          </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1.5">
            <div className="text-sm font-medium">{t.settings.retrieval.providerApiKey}</div>
            <div className="relative">
                <Input
                  value={providerApiKey}
                  onChange={(event) => setProviderField("api_key", event.target.value)}
                  placeholder="$OPENAI_API_KEY"
                  type={showApiKey.embedding ? "text" : "password"}
                  className="pr-10"
                  disabled={disabled}
                />
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  className="absolute top-1/2 right-1 -translate-y-1/2"
                  onClick={() => setShowApiKey((prev) => ({ ...prev, embedding: !prev.embedding }))}
                  disabled={disabled}
                >
                  {showApiKey.embedding ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
                </Button>
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="text-sm font-medium">{t.settings.retrieval.providerApiBase}</div>
              <Input
                value={providerApiBase}
                onChange={(event) => setProviderField("api_base", event.target.value)}
                placeholder="https://api.openai.com/v1"
                disabled={disabled}
              />
            </div>
            <div className="space-y-1.5">
              <div className="text-sm font-medium">{t.settings.retrieval.providerModel}</div>
              <Input
                value={providerModel}
                onChange={(event) => setProviderField("model", event.target.value)}
                placeholder="text-embedding-3-small"
                disabled={disabled}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={disabled || testBusy}
              onClick={() => {
                void handleTestProviderConnection("embedding");
              }}
            >
              {testBusy ? <Loader2Icon className="mr-1 size-4 animate-spin" /> : null}
              {testBusy ? t.settings.retrieval.providerTesting : t.settings.retrieval.providerTestConnection}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={() => setShowProviderModels((prev) => ({ ...prev, embedding: !prev.embedding }))}
            >
              {t.settings.retrieval.providerModelList}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className={deleteDangerClass}
              disabled={disabled}
              onClick={handleDeleteProviderClick}
            >
              <Trash2Icon className="mr-1 size-4" />
              {t.settings.retrieval.providerDelete}
            </Button>
            <Button
              size="sm"
              variant={providerEnabled ? "default" : "outline"}
              disabled={disabled}
              onClick={() => setProviderField("enabled", !providerEnabled)}
            >
              {providerEnabled ? t.settings.retrieval.actionEnabled : t.settings.retrieval.actionEnable}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={activeAction !== ""}
              onClick={() => {
                void handleSetActiveRemote("embedding");
              }}
            >
              {isProviderActive ? <Loader2Icon className="mr-1 size-4 animate-spin" /> : null}
              {t.settings.retrieval.actionEnable}
            </Button>
          </div>

          {showModels ? (
            <div className="bg-muted/40 space-y-2 rounded-md border p-3">
              <div className="text-xs font-medium">{t.settings.retrieval.providerModelList}</div>
              <div className="flex flex-wrap gap-2">
                {modelSuggestions.map((suggestion) => (
                  <Button
                    key={suggestion}
                    size="sm"
                    variant="outline"
                    onClick={() => setProviderField("model", suggestion)}
                    disabled={disabled}
                  >
                    {suggestion}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      );
    }

    return (
      <div className="space-y-4 rounded-xl border p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="space-y-1">
            <div className="text-base font-semibold">{t.settings.retrieval.providerDetailTitle}</div>
            <div className="text-muted-foreground text-sm">{providerName}</div>
          </div>
          <Badge variant="secondary" className="rounded-full border px-2.5 py-1 text-xs font-medium">
            {protocolLabel}
          </Badge>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1.5">
            <div className="text-sm font-medium">{t.settings.retrieval.providerApiKey}</div>
            <div className="relative">
              <Input
                value={providerApiKey}
                onChange={(event) => setProviderField("api_key", event.target.value)}
                placeholder="$RERANK_API_KEY"
                type={showApiKey.rerank ? "text" : "password"}
                className="pr-10"
                disabled={disabled}
              />
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                className="absolute top-1/2 right-1 -translate-y-1/2"
                onClick={() => setShowApiKey((prev) => ({ ...prev, rerank: !prev.rerank }))}
                disabled={disabled}
              >
                {showApiKey.rerank ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
              </Button>
            </div>
          </div>
          <div className="space-y-1.5">
            <div className="text-sm font-medium">{t.settings.retrieval.providerApiBase}</div>
            <Input
              value={providerApiBase}
              onChange={(event) => setProviderField("api_base", event.target.value)}
              placeholder="https://your-rerank-provider.example.com"
              disabled={disabled}
            />
          </div>
          <div className="space-y-1.5">
            <div className="text-sm font-medium">{t.settings.retrieval.providerPath}</div>
            <Input
              value={providerPath}
              onChange={(event) => setProviderField("path", event.target.value)}
              placeholder="/rerank"
              disabled={disabled}
            />
          </div>
          <div className="space-y-1.5">
            <div className="text-sm font-medium">{t.settings.retrieval.providerModel}</div>
            <Input
              value={providerModel}
              onChange={(event) => setProviderField("model", event.target.value)}
              placeholder="jina-reranker-v2-base-multilingual"
              disabled={disabled}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={disabled || testBusy}
            onClick={() => {
              void handleTestProviderConnection("rerank");
            }}
          >
            {testBusy ? <Loader2Icon className="mr-1 size-4 animate-spin" /> : null}
            {testBusy ? t.settings.retrieval.providerTesting : t.settings.retrieval.providerTestConnection}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={() => setShowProviderModels((prev) => ({ ...prev, rerank: !prev.rerank }))}
          >
            {t.settings.retrieval.providerModelList}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className={deleteDangerClass}
            disabled={disabled}
            onClick={handleDeleteProviderClick}
          >
            <Trash2Icon className="mr-1 size-4" />
            {t.settings.retrieval.providerDelete}
          </Button>
          <Button
            size="sm"
            variant={providerEnabled ? "default" : "outline"}
            disabled={disabled}
            onClick={() => setProviderField("enabled", !providerEnabled)}
          >
            {providerEnabled ? t.settings.retrieval.actionEnabled : t.settings.retrieval.actionEnable}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={activeAction !== ""}
            onClick={() => {
              void handleSetActiveRemote("rerank");
            }}
          >
            {isProviderActive ? <Loader2Icon className="mr-1 size-4 animate-spin" /> : null}
            {t.settings.retrieval.actionEnable}
          </Button>
        </div>

        {showModels ? (
          <div className="bg-muted/40 space-y-2 rounded-md border p-3">
            <div className="text-xs font-medium">{t.settings.retrieval.providerModelList}</div>
            <div className="flex flex-wrap gap-2">
              {modelSuggestions.map((suggestion) => (
                <Button
                  key={suggestion}
                  size="sm"
                  variant="outline"
                  onClick={() => setProviderField("model", suggestion)}
                  disabled={disabled}
                >
                  {suggestion}
                </Button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <SettingsSection
      title={t.settings.retrieval.title}
      description={t.settings.retrieval.description}
    >
      {isLoading ? (
        <div className="text-muted-foreground text-sm">{t.common.loading}</div>
      ) : error ? (
        <div className="text-destructive text-sm">
          {error instanceof Error ? error.message : "Failed to load config"}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Tabs
              value={activeTab}
              onValueChange={(value) => setActiveTab(value as "packs" | "testing")}
            >
              <TabsList variant="line">
                <TabsTrigger value="packs">{t.settings.retrieval.tabPacks}</TabsTrigger>
                <TabsTrigger value="testing">{t.settings.retrieval.tabTesting}</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="flex items-center gap-2">
              {statusError ? <Badge variant={legacyApiMode ? "secondary" : "destructive"}>{statusError}</Badge> : null}
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void loadStatus();
                }}
                disabled={statusLoading}
              >
                {statusLoading ? <Loader2Icon className="mr-1 size-4 animate-spin" /> : <RefreshCwIcon className="mr-1 size-4" />}
                {t.settings.retrieval.actionRefresh}
              </Button>
            </div>
          </div>

          {activeTab === "packs" ? (
            <section className="space-y-3 rounded-lg border p-4">
              <div className="space-y-1">
                <div className="text-sm font-medium">{t.settings.retrieval.packTitle}</div>
                {activePackId ? (
                  <div className="text-muted-foreground text-xs">
                    {t.settings.retrieval.activePackHint.replace("{pack}", activePackId.toUpperCase())}
                  </div>
                ) : null}
              </div>
              {renderPackCards()}
              {!desktopBridge ? (
                <div className="text-muted-foreground text-xs">{t.settings.retrieval.desktopOnlyHint}</div>
              ) : null}
              <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm">
                    <ChevronDownIcon className={`mr-1 size-4 transition-transform ${advancedOpen ? "rotate-180" : ""}`} />
                    {t.settings.retrieval.packAdvancedTitle ?? t.settings.retrieval.advancedTitle}
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-2 space-y-4">
                  <div className="space-y-3 rounded-lg border p-3">
                    <div className="text-sm font-medium">{t.settings.retrieval.localModelsTitleEmbedding}</div>
                    {renderModelCards("embedding")}
                  </div>
                  <div className="space-y-3 rounded-lg border p-3">
                    <div className="text-sm font-medium">{t.settings.retrieval.localModelsTitleRerank}</div>
                    {renderModelCards("rerank")}
                  </div>
                  <div className="space-y-2">
                    {renderAdvancedProvider("embedding")}
                    {renderAdvancedProvider("rerank")}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </section>
          ) : null}

          {activeTab === "testing" ? (
            <section className="space-y-3 rounded-lg border p-4">
              <div className="text-sm font-medium">{t.settings.retrieval.testTitle}</div>
              <div className="space-y-2">
                <Input
                  value={testQuery}
                  onChange={(event) => setTestQuery(event.target.value)}
                  placeholder={t.settings.retrieval.testQueryPlaceholder}
                />
                <Textarea
                  value={testDocs}
                  onChange={(event) => setTestDocs(event.target.value)}
                  rows={4}
                  placeholder={t.settings.retrieval.testDocsPlaceholder}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" disabled={testBusy !== ""} onClick={() => void handleTestEmbedding()}>
                  {testBusy === "embedding" && <Loader2Icon className="mr-1 size-4 animate-spin" />}
                  {t.settings.retrieval.actionTestEmbedding}
                </Button>
                <Button variant="outline" disabled={testBusy !== ""} onClick={() => void handleTestRerank()}>
                  {testBusy === "rerank" && <Loader2Icon className="mr-1 size-4 animate-spin" />}
                  {t.settings.retrieval.actionTestRerank}
                </Button>
              </div>
              <pre className="bg-muted min-h-24 max-h-80 overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap">
                {testResult || t.settings.retrieval.testEmpty}
              </pre>
            </section>
          ) : null}

          <ConfigValidationErrors errors={validationErrors} />
          <ConfigSaveBar
            dirty={dirty}
            disabled={disabled}
            saving={saving}
            onDiscard={onDiscard}
            onSave={() => {
              void onSave();
            }}
          />

          <ConfirmActionDialog
            open={pendingRemove !== null}
            onOpenChange={(open) => {
              if (!open) {
                setPendingRemove(null);
              }
            }}
            title={t.settings.retrieval.deleteConfirmTitle}
            description={t.settings.retrieval.deleteConfirmDescription(pendingRemove?.displayName ?? "")}
            cancelText={t.common.cancel}
            confirmText={t.settings.retrieval.actionDelete}
            onConfirm={() => {
              void handleConfirmRemove();
            }}
          />

          <ConfirmActionDialog
            open={pendingDeleteProvider !== null}
            onOpenChange={(open) => {
              if (!open) {
                setPendingDeleteProvider(null);
              }
            }}
            title={t.settings.retrieval.providerDeleteConfirmTitle}
            description={t.settings.retrieval.providerDeleteConfirmDescription(pendingDeleteProvider?.providerName ?? "")}
            cancelText={t.common.cancel}
            confirmText={t.settings.retrieval.providerDelete}
            onConfirm={() => {
              void handleConfirmDeleteProvider();
            }}
          />
        </div>
      )}
    </SettingsSection>
  );
}
