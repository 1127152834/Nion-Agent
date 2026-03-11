"use client";

import { useI18n } from "@/core/i18n/hooks";

import { ConfigValidationErrors } from "./config-validation-errors";
import { ConfigSaveBar } from "./configuration/config-save-bar";
import { SubagentsSection } from "./configuration/sections/subagents-section";
import { SuggestionsSection } from "./configuration/sections/suggestions-section";
import { SummarizationSection } from "./configuration/sections/summarization-section";
import { TitleSection } from "./configuration/sections/title-section";
import { SettingsSection } from "./settings-section";
import { useConfigEditor } from "./use-config-editor";

export function SessionPolicySettingsPage() {
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
      title={t.settings.sessionPolicy.title}
      description={t.settings.sessionPolicy.description}
    >
      {isLoading ? (
        <div className="text-muted-foreground text-sm">{t.common.loading}</div>
      ) : error ? (
        <div className="text-destructive text-sm">
          {error instanceof Error ? error.message : "Failed to load config"}
        </div>
      ) : (
        <div className="space-y-4">
          <SuggestionsSection
            config={draftConfig}
            onChange={onConfigChange}
            disabled={disabled}
          />
          <TitleSection
            config={draftConfig}
            onChange={onConfigChange}
            disabled={disabled}
          />
          <SummarizationSection
            config={draftConfig}
            onChange={onConfigChange}
            disabled={disabled}
          />
          <SubagentsSection
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
