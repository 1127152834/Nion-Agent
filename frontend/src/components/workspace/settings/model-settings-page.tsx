"use client";

import { BotIcon, Building2Icon, Layers3Icon, SparklesIcon } from "lucide-react";
import { useMemo, useState } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18n } from "@/core/i18n/hooks";
import { useModels } from "@/core/models/hooks";
import { useLocalSettings } from "@/core/settings";

import { ConfigValidationErrors } from "./config-validation-errors";
import { ConfigSaveBar } from "./configuration/config-save-bar";
import {
  ModelsSection,
  type ModelSettingsChildView,
  normalizeModelProviderConfig,
} from "./configuration/sections/models-section";
import { asArray, asString } from "./configuration/shared";
import { SettingsSection } from "./settings-section";
import { useConfigEditor } from "./use-config-editor";

const FOLLOW_CURRENT_CHAT_MODEL = "__follow_current_chat_model__";

export function ModelSettingsPage() {
  const { t } = useI18n();
  const m = t.settings.modelPage;
  const [activeView, setActiveView] = useState<ModelSettingsChildView>("providers");
  const { models: availableModels } = useModels();
  const [localSettings, setLocalSettings] = useLocalSettings();
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
  } = useConfigEditor({
    prepareConfig: normalizeModelProviderConfig,
  });

  const normalizedConfig = useMemo(
    () => normalizeModelProviderConfig(draftConfig),
    [draftConfig],
  );
  const providers = useMemo(
    () => asArray(normalizedConfig.model_providers),
    [normalizedConfig],
  );
  const models = useMemo(
    () => asArray(normalizedConfig.models),
    [normalizedConfig],
  );
  const defaultModelLabel = useMemo(() => {
    const first = models[0];
    if (!first) {
      return m?.notSet ?? "Not set";
    }
    return (
      asString(first.display_name).trim()
      || asString(first.name).trim()
      || asString(first.model).trim()
      || (m?.unnamedModel ?? "Unnamed model")
    );
  }, [m?.notSet, m?.unnamedModel, models]);

  const suggestionModelValue =
    localSettings.suggestions.model_name?.trim() || FOLLOW_CURRENT_CHAT_MODEL;
  const suggestionModelLabel = useMemo(() => {
    if (suggestionModelValue === FOLLOW_CURRENT_CHAT_MODEL) {
      return m?.suggestionModelAutoLabel ?? "Follow current chat model (default)";
    }
    const matchedModel = availableModels.find((model) => model.name === suggestionModelValue);
    return matchedModel?.display_name?.trim() || matchedModel?.name || suggestionModelValue;
  }, [availableModels, m?.suggestionModelAutoLabel, suggestionModelValue]);

  const viewTabs: {
    id: ModelSettingsChildView;
    label: string;
    subtitle: string;
    count: number;
    icon: typeof Building2Icon;
  }[] = [
    {
      id: "providers",
      label: m?.providersLabel ?? "Providers",
      subtitle: m?.providersSubtitle ?? "Connection and auth",
      count: providers.length,
      icon: Building2Icon,
    },
    {
      id: "models",
      label: m?.modelsLabel ?? "Models",
      subtitle: m?.modelsSubtitle ?? "Catalog and capabilities",
      count: models.length,
      icon: Layers3Icon,
    },
  ];

  return (
    <SettingsSection
      title={t.settings.models.title}
      description={t.settings.models.description}
    >
      {isLoading ? (
        <div className="text-muted-foreground text-sm">{t.common.loading}</div>
      ) : error ? (
        <div className="text-destructive text-sm">
          {error instanceof Error ? error.message : (m?.loadConfigFailed ?? "Failed to load config")}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-2xl border bg-gradient-to-br from-primary/5 via-background to-background p-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex items-start gap-3">
                <div className="bg-primary/10 text-primary flex size-10 shrink-0 items-center justify-center rounded-xl border">
                  <SparklesIcon className="size-4" />
                </div>
                <div className="space-y-1">
                  <div className="text-sm font-semibold">
                    {m?.suggestionModelTitle ?? "追问建议模型"}
                  </div>
                  <p className="text-muted-foreground max-w-2xl text-xs leading-5">
                    {m?.suggestionModelDescription
                      ?? "为聊天页的追问建议单独指定模型；未设置时默认跟随当前聊天模型。"}
                  </p>
                </div>
              </div>

              <div className="bg-background/90 min-w-0 rounded-xl border px-3 py-2">
                <div className="text-muted-foreground text-[11px]">
                  {m?.suggestionModelCurrentLabel?.replace("{model}", suggestionModelLabel)
                    ?? `当前：${suggestionModelLabel}`}
                </div>
              </div>
            </div>

            <div className="mt-4 max-w-md">
              <Select
                value={suggestionModelValue}
                onValueChange={(value) => {
                  setLocalSettings("suggestions", {
                    model_name: value === FOLLOW_CURRENT_CHAT_MODEL ? undefined : value,
                  });
                }}
              >
                <SelectTrigger className="bg-background w-full">
                  <SelectValue
                    placeholder={
                      m?.suggestionModelPlaceholder ?? "选择追问建议模型"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={FOLLOW_CURRENT_CHAT_MODEL}>
                    {m?.suggestionModelAutoLabel
                      ?? "跟随当前聊天模型（默认）"}
                  </SelectItem>
                  {availableModels.map((model) => (
                    <SelectItem key={model.name} value={model.name}>
                      {model.display_name?.trim() || model.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="rounded-xl border bg-muted/20 p-2">
            <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_280px]">
              {viewTabs.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeView === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveView(tab.id)}
                    data-state={isActive ? "active" : "idle"}
                    className={[
                      "group flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
                      "bg-background/70 hover:bg-background",
                      isActive
                        ? "border-primary bg-background shadow-sm"
                        : "border-transparent",
                    ].join(" ")}
                  >
                    <div className="bg-muted/30 flex size-8 shrink-0 items-center justify-center rounded-md border">
                      <Icon className="text-muted-foreground size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="truncate text-sm font-semibold">{tab.label}</div>
                        <div className="text-muted-foreground text-xs">{tab.count}</div>
                      </div>
                      <div className="text-muted-foreground truncate text-[11px]">
                        {tab.subtitle}
                      </div>
                    </div>
                  </button>
                );
              })}

              <div className="bg-background/90 flex items-center gap-3 rounded-lg border px-3 py-2.5">
                <div className="bg-muted/30 flex size-8 shrink-0 items-center justify-center rounded-md border">
                  <BotIcon className="text-muted-foreground size-4" />
                </div>
                <div className="min-w-0">
                  <div className="text-muted-foreground text-[11px]">
                    {m?.defaultModelLabel ?? "Default model"}
                  </div>
                  <div className="truncate text-sm font-semibold">{defaultModelLabel}</div>
                </div>
              </div>
            </div>

            <div className="text-muted-foreground px-1 pt-2 text-xs">
              {m?.helperText ?? "Set up provider connection first, then add models from catalog or manually."}
            </div>
          </div>

          <ModelsSection
            config={draftConfig}
            onChange={onConfigChange}
            disabled={disabled}
            view={activeView}
            onViewChange={setActiveView}
          />

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
        </div>
      )}
    </SettingsSection>
  );
}
