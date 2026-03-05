"use client";

import { useMemo } from "react";

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

import { FieldTip } from "../field-tip";
import {
  asArray,
  asBoolean,
  asObject,
  asString,
  cloneConfig,
  type ConfigDraft,
} from "../shared";

const DEFAULT_MODEL_VALUE = "__default_model__";

function parseOptionalPositiveInt(value: string): number | undefined {
  if (!value.trim()) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return undefined;
  }
  return Math.trunc(parsed);
}

export function RSSSection({
  config,
  onChange,
  disabled,
}: {
  config: ConfigDraft;
  onChange: (next: ConfigDraft) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const m = t.migration.settings?.configSections?.rss;

  const rss = asObject(config.rss);
  const learning = asObject(rss.learning);
  const models = asArray(config.models);
  const selectedAssistantModel = asString(rss.assistant_model_name).trim();

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
    title: "RSS",
    subtitle: m?.subtitle ?? "Configure RSS ingestion and workspace learning defaults.",
    enabled: m?.enabled ?? "Enable RSS",
    fetchInterval: m?.fetchInterval ?? "Fetch interval (minutes)",
    maxEntries: m?.maxEntries ?? "Max entries per source per run",
    assistantModel: m?.assistantModel ?? "AI reader assistant model",
    assistantModelTip: m?.assistantModelTip ?? "Applies only to RSS assistant chats. Empty means using default model.",
    useDefaultModel: m?.useDefaultModel ?? "Use default model",
    learningTitle: m?.learningTitle ?? "Learning defaults",
    maxDocs: m?.maxDocs ?? "Max docs per run",
    minScore: m?.minScore ?? "Min quality score",
    tokenBudget: m?.tokenBudget ?? "Daily token budget",
  };

  const updateRSS = (key: string, value: unknown) => {
    const next = cloneConfig(config);
    const nextRSS = asObject(next.rss);
    if (value === undefined || value === null || value === "") {
      delete nextRSS[key];
    } else {
      nextRSS[key] = value;
    }

    if (Object.keys(nextRSS).length === 0) {
      delete next.rss;
    } else {
      next.rss = nextRSS;
    }
    onChange(next);
  };

  const updateLearning = (key: string, value: unknown) => {
    const next = cloneConfig(config);
    const nextRSS = asObject(next.rss);
    const nextLearning = asObject(nextRSS.learning);

    if (value === undefined || value === null || value === "") {
      delete nextLearning[key];
    } else {
      nextLearning[key] = value;
    }

    if (Object.keys(nextLearning).length === 0) {
      delete nextRSS.learning;
    } else {
      nextRSS.learning = nextLearning;
    }

    if (Object.keys(nextRSS).length === 0) {
      delete next.rss;
    } else {
      next.rss = nextRSS;
    }
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
            checked={asBoolean(rss.enabled, true)}
            onCheckedChange={(checked) => updateRSS("enabled", checked)}
            disabled={disabled}
          />
          {copy.enabled}
        </label>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1.5">
          <FieldTip
            zh={m?.fetchIntervalTipZh ?? (m?.fetchIntervalTipEn ?? "Controls background RSS polling frequency.")}
            en={m?.fetchIntervalTipEn ?? "Controls background RSS polling frequency."}
            recommended={m?.fetchIntervalRecommended ?? "Recommended 15-60 minutes"}
          />
          <Input
            type="number"
            min={1}
            placeholder="60"
            value={asString(rss.fetch_interval_minutes)}
            onChange={(event) =>
              updateRSS(
                "fetch_interval_minutes",
                parseOptionalPositiveInt(event.target.value),
              )
            }
            disabled={disabled}
          />
          <div className="text-xs font-medium">{copy.fetchInterval}</div>
        </div>
        <div className="space-y-1.5">
          <FieldTip
            zh={m?.maxEntriesTipZh ?? (m?.maxEntriesTipEn ?? "Caps how many entries are processed per source in one run.")}
            en={m?.maxEntriesTipEn ?? "Caps how many entries are processed per source in one run."}
            recommended={m?.maxEntriesRecommended ?? "Recommended 100-300"}
          />
          <Input
            type="number"
            min={1}
            placeholder="200"
            value={asString(rss.max_entries_per_source_per_run)}
            onChange={(event) =>
              updateRSS(
                "max_entries_per_source_per_run",
                parseOptionalPositiveInt(event.target.value),
              )
            }
            disabled={disabled}
          />
          <div className="text-xs font-medium">{copy.maxEntries}</div>
        </div>
      </div>

      <div className="space-y-1.5">
        <FieldTip
          zh={m?.assistantModelTipZh ?? (m?.assistantModelTipEn ?? "Default model used by the RSS reading assistant only.")}
          en={m?.assistantModelTipEn ?? "Default model used by the RSS reading assistant only."}
          recommended={copy.assistantModelTip}
        />
        <Select
          value={selectedAssistantModel || DEFAULT_MODEL_VALUE}
          onValueChange={(value) =>
            updateRSS("assistant_model_name", value === DEFAULT_MODEL_VALUE ? "" : value)
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
        <div className="text-xs font-medium">{copy.assistantModel}</div>
      </div>

      <div className="space-y-3 rounded-md border border-dashed p-3">
        <div className="text-xs font-medium">{copy.learningTitle}</div>
        <div className="grid gap-3 md:grid-cols-3">
          <div className="space-y-1.5">
            <Input
              type="number"
              min={1}
              placeholder="20"
              value={asString(learning.max_docs_per_run)}
              onChange={(event) =>
                updateLearning(
                  "max_docs_per_run",
                  parseOptionalPositiveInt(event.target.value),
                )
              }
              disabled={disabled}
            />
            <div className="text-xs font-medium">{copy.maxDocs}</div>
          </div>
          <div className="space-y-1.5">
            <Input
              type="number"
              min={1}
              placeholder="60"
              value={asString(learning.min_quality_score)}
              onChange={(event) =>
                updateLearning(
                  "min_quality_score",
                  parseOptionalPositiveInt(event.target.value),
                )
              }
              disabled={disabled}
            />
            <div className="text-xs font-medium">{copy.minScore}</div>
          </div>
          <div className="space-y-1.5">
            <Input
              type="number"
              min={1}
              placeholder="120000"
              value={asString(learning.daily_token_budget)}
              onChange={(event) =>
                updateLearning(
                  "daily_token_budget",
                  parseOptionalPositiveInt(event.target.value),
                )
              }
              disabled={disabled}
            />
            <div className="text-xs font-medium">{copy.tokenBudget}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
