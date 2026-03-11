"use client";

import { useMemo } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18n } from "@/core/i18n/hooks";

import {
  asArray,
  asObject,
  asString,
  cloneConfig,
  type ConfigDraft,
} from "../shared";

const FOLLOW_CURRENT_CHAT_MODEL = "__follow_current_chat_model__";

export function SuggestionsSection({
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
      suggestions?: Record<string, string>;
    };
  };
  const copy = settingsLike.configSections?.suggestions ?? {};
  const suggestions = asObject(config.suggestions);
  const selectedModel = asString(suggestions.model_name).trim();
  const selectedValue = selectedModel || FOLLOW_CURRENT_CHAT_MODEL;

  const modelOptions = useMemo(
    () =>
      asArray(config.models)
        .map((item) => ({
          name: asString(item.name).trim(),
          label: asString(item.display_name).trim() || asString(item.name).trim(),
        }))
        .filter((item) => item.name.length > 0),
    [config.models],
  );

  const selectedLabel = useMemo(() => {
    if (selectedValue === FOLLOW_CURRENT_CHAT_MODEL) {
      return copy.followCurrent ?? "Follow current chat model";
    }
    const matched = modelOptions.find((item) => item.name === selectedValue);
    return matched?.label ?? selectedValue;
  }, [copy.followCurrent, modelOptions, selectedValue]);

  const updateSuggestionsModel = (value: string) => {
    const next = cloneConfig(config);
    const target = asObject(next.suggestions);
    if (value === FOLLOW_CURRENT_CHAT_MODEL) {
      delete target.model_name;
    } else {
      target.model_name = value;
    }
    if (Object.keys(target).length === 0) {
      delete next.suggestions;
    } else {
      next.suggestions = target;
    }
    onChange(next);
  };

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div className="space-y-1">
        <div className="text-sm font-medium">{copy.title}</div>
        <div className="text-muted-foreground text-xs">{copy.subtitle}</div>
      </div>

      <div className="space-y-1.5">
        <div className="text-xs font-medium">{copy.model}</div>
        <Select value={selectedValue} onValueChange={updateSuggestionsModel}>
          <SelectTrigger disabled={disabled}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={FOLLOW_CURRENT_CHAT_MODEL}>
              {copy.followCurrent}
            </SelectItem>
            {modelOptions.map((model) => (
              <SelectItem key={model.name} value={model.name}>
                {model.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="text-muted-foreground text-xs">
        {(copy.current ?? "Current: {model}").replace("{model}", selectedLabel)}
      </div>
    </div>
  );
}
