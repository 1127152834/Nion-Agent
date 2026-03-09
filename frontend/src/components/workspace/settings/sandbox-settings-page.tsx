"use client";

import { useI18n } from "@/core/i18n/hooks";

import { ConfigValidationErrors } from "./config-validation-errors";
import { ConfigSaveBar } from "./configuration/config-save-bar";
import { CheckpointerSection } from "./configuration/sections/checkpointer-section";
import { EnvironmentVariablesSection } from "./configuration/sections/environment-variables-section";
import { SandboxSection } from "./configuration/sections/sandbox-section";
import { SettingsSection } from "./settings-section";
import { useConfigEditor } from "./use-config-editor";

export function SandboxSettingsPage() {
  const { t } = useI18n();
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
  } = useConfigEditor();

  return (
    <SettingsSection
      title={t.settings.sandbox.title}
      description={t.settings.sandbox.description}
    >
      {isLoading ? (
        <div className="text-muted-foreground text-sm">{t.common.loading}</div>
      ) : error ? (
        <div className="text-destructive text-sm">
          {error instanceof Error ? error.message : "Failed to load config"}
        </div>
      ) : (
        <div className="space-y-4">
          <SandboxSection
            config={draftConfig}
            onChange={onConfigChange}
            disabled={disabled}
          />
          <CheckpointerSection
            config={draftConfig}
            onChange={onConfigChange}
            disabled={disabled}
          />
          <EnvironmentVariablesSection
            config={draftConfig}
            onChange={onConfigChange}
            disabled={disabled}
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
