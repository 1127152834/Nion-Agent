"use client";

import { ChevronDownIcon } from "lucide-react";
import { useMemo, useState } from "react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
import { cn } from "@/lib/utils";

import {
  asArray,
  asBoolean,
  asObject,
  asString,
  cloneConfig,
  type ConfigDraft,
} from "../shared";

function parseOptionalInteger(value: string): number | undefined {
  if (!value.trim()) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : undefined;
}

const DEFAULT_MODEL_VALUE = "__default_model__";

export function TitleSection({
  config,
  onChange,
  disabled,
}: {
  config: ConfigDraft;
  onChange: (next: ConfigDraft) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const m = t.migration.settings?.configSections?.title;
  const title = asObject(config.title);
  const models = asArray(config.models);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const modelOptions = useMemo(
    () =>
      models
        .map((item) => ({
          name: asString(item.name).trim(),
          label: asString(item.display_name).trim() || asString(item.name).trim(),
        }))
        .filter((item) => item.name.length > 0),
    [models],
  );

  const selectedModel = asString(title.model_name).trim();

  const copy = {
    title: m?.title ?? "Conversation title",
    subtitle: m?.subtitle ?? "Auto-generate a title for each chat.",
    enabled: m?.enabled ?? "Enable auto title",
    model: m?.model ?? "Title model",
    useDefaultModel: m?.useDefaultModel ?? "Use default model",
    advanced: m?.advanced ?? "Advanced options",
    maxWords: m?.maxWords ?? "Max words",
    maxChars: m?.maxChars ?? "Max characters",
  };

  const updateTitle = (key: string, value: unknown) => {
    const next = cloneConfig(config);
    const target = asObject(next.title);
    if (value === undefined || value === null || value === "") {
      delete target[key];
    } else {
      target[key] = value;
    }
    next.title = target;
    onChange(next);
  };

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="text-sm font-medium">{copy.title}</div>
          <div className="text-muted-foreground text-xs">{copy.subtitle}</div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={asBoolean(title.enabled, true)}
            onCheckedChange={(checked) => updateTitle("enabled", checked)}
            disabled={disabled}
          />
          {copy.enabled}
        </label>
      </div>

      <div className="space-y-1.5">
        <div className="text-xs font-medium">{copy.model}</div>
        <Select
          value={selectedModel || DEFAULT_MODEL_VALUE}
          onValueChange={(value) =>
            updateTitle("model_name", value === DEFAULT_MODEL_VALUE ? "" : value)
          }
        >
          <SelectTrigger disabled={disabled}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={DEFAULT_MODEL_VALUE}>{copy.useDefaultModel}</SelectItem>
            {modelOptions.map((model) => (
              <SelectItem key={model.name} value={model.name}>
                {model.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs"
          >
            <ChevronDownIcon
              className={cn("size-3.5 transition-transform", advancedOpen && "rotate-180")}
            />
            {copy.advanced}
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <div className="text-xs font-medium">{copy.maxWords}</div>
              <Input
                type="number"
                placeholder="6"
                value={asString(title.max_words)}
                onChange={(e) => updateTitle("max_words", parseOptionalInteger(e.target.value))}
                disabled={disabled}
              />
            </div>
            <div className="space-y-1.5">
              <div className="text-xs font-medium">{copy.maxChars}</div>
              <Input
                type="number"
                placeholder="60"
                value={asString(title.max_chars)}
                onChange={(e) => updateTitle("max_chars", parseOptionalInteger(e.target.value))}
                disabled={disabled}
              />
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
