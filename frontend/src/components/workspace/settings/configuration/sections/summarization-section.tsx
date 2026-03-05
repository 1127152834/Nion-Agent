"use client";

import { ChevronDownIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
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

type ContextSizeType = "tokens" | "messages" | "fraction";
const DEFAULT_MODEL_VALUE = "__default_model__";

function normalizeTriggerList(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.map((item) => asObject(item));
  }
  if (value && typeof value === "object") {
    return [asObject(value)];
  }
  return [];
}

function parseContextValue(raw: string, type: ContextSizeType): number | undefined {
  if (!raw.trim()) {
    return undefined;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  if (type === "fraction") {
    return parsed;
  }
  return Math.trunc(parsed);
}

export function SummarizationSection({
  config,
  onChange,
  disabled,
}: {
  config: ConfigDraft;
  onChange: (next: ConfigDraft) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const m = t.migration.settings?.configSections?.summarization;
  const summarization = asObject(config.summarization);
  const triggerList = normalizeTriggerList(summarization.trigger);
  const keep = asObject(summarization.keep);
  const keepType = (asString(keep.type) || "messages") as ContextSizeType;
  const selectedModel = asString(summarization.model_name).trim();
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

  const copy = {
    title: m?.title ?? "Summarization",
    subtitle: m?.subtitle ?? "Summarize history when context gets long.",
    enabled: m?.enabled ?? "Enable summarization",
    model: m?.model ?? "Summarization model",
    useDefaultModel: m?.useDefaultModel ?? "Use default model",
    triggers: m?.triggers ?? "Triggers",
    addTrigger: m?.addTrigger ?? "Add trigger",
    triggerType: m?.triggerType ?? "Type",
    triggerValue: m?.triggerValue ?? "Threshold",
    remove: m?.remove ?? "Remove",
    advanced: m?.advanced ?? "Advanced options",
    keepType: m?.keepType ?? "Keep type",
    keepValue: m?.keepValue ?? "Keep value",
    noTrigger: m?.noTrigger ?? "No trigger set. Auto summarization is disabled.",
  };

  const triggerTypeLabel: Record<ContextSizeType, string> = {
    tokens: m?.tokensLabel ?? "Tokens",
    messages: m?.messagesLabel ?? "Messages",
    fraction: m?.fractionLabel ?? "Context fraction",
  };

  const updateSummarization = (key: string, value: unknown) => {
    const next = cloneConfig(config);
    const target = asObject(next.summarization);
    if (value === undefined || value === null || value === "") {
      delete target[key];
    } else {
      target[key] = value;
    }
    next.summarization = target;
    onChange(next);
  };

  const updateTrigger = (index: number, key: string, value: unknown) => {
    const next = cloneConfig(config);
    const target = asObject(next.summarization);
    const list = normalizeTriggerList(target.trigger);
    const current = list[index] ?? {};
    const nextTrigger = { ...current };
    if (value === undefined || value === "") {
      delete nextTrigger[key];
    } else {
      nextTrigger[key] = value;
    }
    list[index] = nextTrigger;
    target.trigger = list;
    next.summarization = target;
    onChange(next);
  };

  const addTrigger = () => {
    const next = cloneConfig(config);
    const target = asObject(next.summarization);
    const list = normalizeTriggerList(target.trigger);
    list.push({ type: "tokens", value: 4096 });
    target.trigger = list;
    next.summarization = target;
    onChange(next);
  };

  const removeTrigger = (index: number) => {
    const next = cloneConfig(config);
    const target = asObject(next.summarization);
    const list = normalizeTriggerList(target.trigger);
    list.splice(index, 1);
    target.trigger = list;
    next.summarization = target;
    onChange(next);
  };

  const updateKeep = (key: string, value: unknown) => {
    const next = cloneConfig(config);
    const target = asObject(next.summarization);
    const keepObj = asObject(target.keep);
    if (value === undefined || value === null || value === "") {
      delete keepObj[key];
    } else {
      keepObj[key] = value;
    }
    target.keep = keepObj;
    next.summarization = target;
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
            checked={asBoolean(summarization.enabled, false)}
            onCheckedChange={(checked) => updateSummarization("enabled", checked)}
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
            updateSummarization("model_name", value === DEFAULT_MODEL_VALUE ? "" : value)
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

      <section className="space-y-3 rounded-md border p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-medium">{copy.triggers}</div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={addTrigger}
            disabled={disabled}
          >
            <PlusIcon className="size-4" />
            {copy.addTrigger}
          </Button>
        </div>

        {triggerList.length === 0 && (
          <div className="text-muted-foreground text-xs">{copy.noTrigger}</div>
        )}

        {triggerList.map((trigger, index) => {
          const triggerType = (asString(trigger.type) || "tokens") as ContextSizeType;
          return (
            <div
              key={`${triggerType}-${index}`}
              className="grid gap-2 md:grid-cols-[190px_1fr_auto]"
            >
              <div className="space-y-1.5">
                <div className="text-xs font-medium">{copy.triggerType}</div>
                <Select
                  value={triggerType}
                  onValueChange={(value) => updateTrigger(index, "type", value)}
                >
                  <SelectTrigger disabled={disabled}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="tokens">{triggerTypeLabel.tokens}</SelectItem>
                    <SelectItem value="messages">{triggerTypeLabel.messages}</SelectItem>
                    <SelectItem value="fraction">{triggerTypeLabel.fraction}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <div className="text-xs font-medium">{copy.triggerValue}</div>
                <Input
                  type="number"
                  step={triggerType === "fraction" ? "0.1" : "1"}
                  placeholder={triggerType === "fraction" ? "0.8" : "4096"}
                  value={asString(trigger.value)}
                  onChange={(e) =>
                    updateTrigger(index, "value", parseContextValue(e.target.value, triggerType))
                  }
                  disabled={disabled}
                />
              </div>

              <div className="flex items-end">
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => removeTrigger(index)}
                  disabled={disabled}
                  aria-label={copy.remove}
                >
                  <Trash2Icon className="size-4" />
                </Button>
              </div>
            </div>
          );
        })}
      </section>

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
              <div className="text-xs font-medium">{copy.keepType}</div>
              <Select value={keepType} onValueChange={(value) => updateKeep("type", value)}>
                <SelectTrigger disabled={disabled}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="tokens">{triggerTypeLabel.tokens}</SelectItem>
                  <SelectItem value="messages">{triggerTypeLabel.messages}</SelectItem>
                  <SelectItem value="fraction">{triggerTypeLabel.fraction}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <div className="text-xs font-medium">{copy.keepValue}</div>
              <Input
                type="number"
                step={keepType === "fraction" ? "0.1" : "1"}
                placeholder={keepType === "fraction" ? "0.2" : "12"}
                value={asString(keep.value)}
                onChange={(e) =>
                  updateKeep("value", parseContextValue(e.target.value, keepType))
                }
                disabled={disabled}
              />
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
