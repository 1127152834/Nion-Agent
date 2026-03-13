"use client";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/core/i18n/hooks";

import { ConfigValidationErrors } from "./config-validation-errors";
import { ConfigSaveBar } from "./configuration/config-save-bar";
import { ToolsSection } from "./configuration/sections/tools-section";
import { useSettingsDialog } from "./settings-dialog-context";
import { SettingsSection } from "./settings-section";
import { useConfigEditor } from "./use-config-editor";

const DEFAULT_TOOL_PAGE_COPY = {
  builtInTitle: "Built-in tools",
  builtInDesc: "Manage built-in tool presets.",
  searchSettingsTitle: "Search settings",
  searchSettingsDesc: "Configure web search and web fetch providers, priority, and fallback.",
  searchSettingsAction: "Open search settings",
  loadConfigFailed: "Failed to load tool config",
  runtimeTitle: "Runtime config status",
  runtimeSource: "Source",
  runtimeVersion: "Version",
  runtimeInSync: "In sync with storage",
  runtimeOutOfSync: "Not synced to latest storage version",
  runtimeWarnings: "Runtime warnings",
  runtimeProcesses: "Processes",
} as const;

export function ToolSettingsPage() {
  const { t } = useI18n();
  const dialog = useSettingsDialog();
  const settingsLike = t.settings as {
    toolPage?: Partial<typeof DEFAULT_TOOL_PAGE_COPY>;
  };
  const copy: typeof DEFAULT_TOOL_PAGE_COPY = {
    ...DEFAULT_TOOL_PAGE_COPY,
    ...(settingsLike.toolPage ?? {}),
  };

  const {
    draftConfig,
    validationErrors,
    validationWarnings,
    runtimeStatus,
    isLoading,
    error,
    dirty,
    disabled,
    saving,
    onConfigChange,
    onDiscard,
    onSave,
  } = useConfigEditor();

  return (
    <SettingsSection
      title={t.settings.tools.title}
      description={t.settings.tools.description}
    >
      <div className="space-y-6">
        <section className="space-y-3 rounded-lg border p-4">
          <div>
            <div className="text-sm font-medium">{copy.builtInTitle}</div>
            <p className="text-muted-foreground text-xs">{copy.builtInDesc}</p>
          </div>

          {isLoading ? (
            <div className="text-muted-foreground text-sm">{t.common.loading}</div>
          ) : error ? (
            <div className="text-destructive text-sm">
              {error instanceof Error ? error.message : copy.loadConfigFailed}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-lg border bg-muted/20 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{copy.searchSettingsTitle}</div>
                    <p className="text-muted-foreground mt-0.5 text-xs">
                      {copy.searchSettingsDesc}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => dialog?.goToSection("searchSettings")}
                  >
                    {copy.searchSettingsAction}
                  </Button>
                </div>
              </div>

              {runtimeStatus && (
                <div className="space-y-2 rounded-md border bg-muted/30 p-3 text-xs">
                  <div className="text-sm font-medium">{copy.runtimeTitle}</div>
                  <div className="grid gap-1">
                    <div>
                      {copy.runtimeSource}: {runtimeStatus.loaded_source_path ?? "-"}
                    </div>
                    <div>
                      {copy.runtimeVersion}: {runtimeStatus.loaded_version ?? "-"} /{" "}
                      {runtimeStatus.store_version ?? "-"}
                    </div>
                    <div
                      className={
                        runtimeStatus.is_in_sync ? "text-emerald-700" : "text-amber-700"
                      }
                    >
                      {runtimeStatus.is_in_sync ? copy.runtimeInSync : copy.runtimeOutOfSync}
                    </div>
                  </div>

                  {Object.keys(runtimeStatus.runtime_processes ?? {}).length > 0 && (
                    <div className="space-y-1">
                      <div className="font-medium">{copy.runtimeProcesses}</div>
                      {Object.entries(runtimeStatus.runtime_processes).map(([name, info]) => (
                        <div key={name}>
                          {name}: {info.loaded_version ?? "-"} ({info.status})
                          {info.reason ? ` - ${info.reason}` : ""}
                        </div>
                      ))}
                    </div>
                  )}

                  {runtimeStatus.warnings.length > 0 && (
                    <div className="space-y-1 text-amber-800">
                      <div className="font-medium">{copy.runtimeWarnings}</div>
                      {runtimeStatus.warnings.map((warning, index) => (
                        <div key={`runtime-warning-${index}`}>{warning}</div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <ToolsSection
                config={draftConfig}
                onChange={onConfigChange}
                disabled={disabled}
              />
              <ConfigValidationErrors
                errors={validationErrors}
                warnings={validationWarnings}
              />
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
        </section>
      </div>
    </SettingsSection>
  );
}
