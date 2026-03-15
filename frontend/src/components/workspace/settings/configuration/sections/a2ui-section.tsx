"use client";

import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/core/i18n/hooks";

import { asBoolean, asObject, cloneConfig, type ConfigDraft } from "../shared";

export function A2UISection({
  config,
  onChange,
  disabled,
}: {
  config: ConfigDraft;
  onChange: (next: ConfigDraft) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const settingsLike = t.settings as {
    configSections?: {
      a2ui?: Record<string, string>;
    };
  };
  const copy = settingsLike.configSections?.a2ui ?? {};

  const a2ui = asObject(config.a2ui);
  const enabled = asBoolean(a2ui.enabled, true);

  const updateEnabled = (checked: boolean) => {
    const next = cloneConfig(config);
    const target = asObject(next.a2ui);

    if (checked) {
      // Default is enabled; keep config clean by removing the override.
      delete target.enabled;
    } else {
      target.enabled = false;
    }

    if (Object.keys(target).length === 0) {
      delete next.a2ui;
    } else {
      next.a2ui = target;
    }

    onChange(next);
  };

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="text-sm font-medium">{copy.title ?? "A2UI"}</div>
          <div className="text-muted-foreground text-xs">
            {copy.subtitle ?? "Enable/disable Agent-to-UI interactive surfaces."}
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={enabled}
            onCheckedChange={updateEnabled}
            disabled={disabled}
          />
          {copy.enabled ?? "Enable"}
        </label>
      </div>

      <div className="text-muted-foreground text-xs">
        {copy.hint ?? "When disabled, the assistant will not render A2UI cards and will ask in plain text."}
      </div>
    </div>
  );
}

