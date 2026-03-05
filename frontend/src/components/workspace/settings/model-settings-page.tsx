"use client";

import { BotIcon, Building2Icon, Layers3Icon } from "lucide-react";
import { useMemo, useState } from "react";

import { useI18n } from "@/core/i18n/hooks";

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

export function ModelSettingsPage() {
  const { t } = useI18n();
  const m = t.migration.settings?.modelSettings;
  const [activeView, setActiveView] = useState<ModelSettingsChildView>("providers");
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
