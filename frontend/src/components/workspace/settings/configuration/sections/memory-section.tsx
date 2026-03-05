"use client";

import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/core/i18n/hooks";

import { asBoolean, asObject, asString, cloneConfig, type ConfigDraft } from "../shared";

function parseOptionalPositiveFloat(value: string): number | undefined {
  if (!value.trim()) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
}

function toInputValue(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return asString(value);
}

function resolveBm25Languages(value: unknown): Array<"zh" | "en"> {
  if (!Array.isArray(value)) {
    return ["zh", "en"];
  }
  const normalized = new Set(
    value
      .map((item) => String(item).trim().toLowerCase())
      .filter((item): item is "zh" | "en" => item === "zh" || item === "en"),
  );
  const ordered = (["zh", "en"] as Array<"zh" | "en">).filter((item) => normalized.has(item));
  return ordered.length ? ordered : ["zh", "en"];
}

export function MemorySection({
  config,
  onChange,
  disabled,
}: {
  config: ConfigDraft;
  onChange: (next: ConfigDraft) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const m = t.migration.settings?.configSections?.memory;
  const isDisabled = disabled ?? false;
  const memory = asObject(config.memory);
  const search = asObject(memory.search);
  const bm25Languages = resolveBm25Languages(search.bm25_languages);

  const copy = {
    title: m?.title ?? "Memory",
    subtitle:
      m?.subtitle
      ?? "Configure memory extraction, solution memory, collaboration and lightweight adaptation.",
    enabled: m?.enabled ?? "Enable memory",
    extract: m?.extract ?? "Auto fact extraction",
    solution: m?.solution ?? "Problem-solution memory",
    collective: m?.collective ?? "Workspace collective memory",
    compression: m?.compression ?? "Memory compression",
    searxng: m?.searxng ?? "SearXNG enrichment",
    evolution: m?.evolution ?? "Evolution workflow",
    autoStyle: m?.autoStyleAdaptation ?? "Auto style adaptation",
    autoStyleHint:
      m?.autoStyleHint
      ?? "Continuously align response style from conversation context without manual profile editing.",
    soulHint:
      m?.soulHint
      ?? "Workspace-shared adaptive personality profile. It evolves automatically from verified conversation signals.",
    soulEnabled: m?.soulEnabled ?? "Enable Soul in this workspace",
    soulSeedFromGlobal: m?.soulSeedFromGlobal ?? "Seed from global preference baseline",
    soulIncognito: m?.soulIncognito ?? "Support incognito (no-memory) thread mode",
    halfLife: m?.halfLife ?? "Decay half-life (days)",
    languages: m?.languages ?? "BM25 languages",
    chinese: m?.languageZh ?? "中文",
    english: m?.languageEn ?? "English",
  };

  const updateMemory = (path: string[], value: unknown) => {
    if (path.length === 0) {
      return;
    }
    const next = cloneConfig(config);
    const nextMemory = asObject(next.memory);
    if (path.length === 1) {
      const key = path[0];
      if (!key) {
        return;
      }
      if (value === undefined || value === null || value === "") {
        delete nextMemory[key];
      } else {
        nextMemory[key] = value;
      }
    } else {
      const top = path[0];
      const key = path[1];
      if (!top || !key) {
        return;
      }
      const nested = asObject(nextMemory[top]);
      if (value === undefined || value === null || value === "") {
        delete nested[key];
      } else {
        nested[key] = value;
      }
      if (Object.keys(nested).length === 0) {
        delete nextMemory[top];
      } else {
        nextMemory[top] = nested;
      }
    }
    if (Object.keys(nextMemory).length === 0) {
      delete next.memory;
    } else {
      next.memory = nextMemory;
    }
    onChange(next);
  };

  const toggleLanguage = (language: "zh" | "en", checked: boolean) => {
    const current = new Set(bm25Languages);
    if (checked) {
      current.add(language);
    } else {
      current.delete(language);
    }
    const next = (["zh", "en"] as Array<"zh" | "en">).filter((item) => current.has(item));
    if (!next.length) {
      return;
    }
    updateMemory(["search", "bm25_languages"], next);
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
            checked={asBoolean(memory.enabled, false)}
            onCheckedChange={(checked) => updateMemory(["enabled"], checked)}
            disabled={isDisabled}
          />
          {copy.enabled}
        </label>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={asBoolean(memory.extract_enabled, true)}
            onCheckedChange={(checked) => updateMemory(["extract_enabled"], checked)}
            disabled={isDisabled}
          />
          {copy.extract}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={asBoolean(memory.solution_memory_enabled, true)}
            onCheckedChange={(checked) => updateMemory(["solution_memory_enabled"], checked)}
            disabled={isDisabled}
          />
          {copy.solution}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={asBoolean(memory.collective_enabled, true)}
            onCheckedChange={(checked) => updateMemory(["collective_enabled"], checked)}
            disabled={isDisabled}
          />
          {copy.collective}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={asBoolean(memory.compression_enabled, true)}
            onCheckedChange={(checked) => updateMemory(["compression_enabled"], checked)}
            disabled={isDisabled}
          />
          {copy.compression}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={asBoolean(memory.searxng_enabled, false)}
            onCheckedChange={(checked) => updateMemory(["searxng_enabled"], checked)}
            disabled={isDisabled}
          />
          {copy.searxng}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={asBoolean(memory.evolution_enabled, false)}
            onCheckedChange={(checked) => updateMemory(["evolution_enabled"], checked)}
            disabled={isDisabled}
          />
          {copy.evolution}
        </label>
      </div>

      <div className="rounded-md border border-dashed p-3">
        <label className="flex items-center justify-between gap-2 text-sm font-medium">
          <span>{copy.soulEnabled}</span>
          <Switch
            checked={asBoolean(asObject(memory.soul).enabled, asBoolean(memory.auto_style_adaptation, true))}
            onCheckedChange={(checked) => updateMemory(["soul", "enabled"], checked)}
            disabled={isDisabled}
          />
        </label>
        <div className="text-muted-foreground mt-1 text-xs">{copy.soulHint}</div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={asBoolean(asObject(memory.soul).seed_from_global, true)}
              onCheckedChange={(checked) => updateMemory(["soul", "seed_from_global"], checked)}
              disabled={isDisabled}
            />
            {copy.soulSeedFromGlobal}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={asBoolean(asObject(memory.soul).incognito_supported, true)}
              onCheckedChange={(checked) => updateMemory(["soul", "incognito_supported"], checked)}
              disabled={isDisabled}
            />
            {copy.soulIncognito}
          </label>
        </div>
      </div>

      <div className="rounded-md border border-dashed p-3">
        <label className="flex items-center justify-between gap-2 text-sm font-medium">
          <span>{copy.autoStyle}</span>
          <Switch
            checked={asBoolean(memory.auto_style_adaptation, true)}
            onCheckedChange={(checked) => updateMemory(["auto_style_adaptation"], checked)}
            disabled={isDisabled}
          />
        </label>
        <div className="text-muted-foreground mt-1 text-xs">{copy.autoStyleHint}</div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1.5">
          <Input
            type="number"
            min={1}
            step="1"
            placeholder="30"
            value={toInputValue(memory.decay_half_life_days)}
            onChange={(event) =>
              updateMemory(
                ["decay_half_life_days"],
                parseOptionalPositiveFloat(event.target.value),
              )
            }
            disabled={isDisabled}
          />
          <div className="text-xs font-medium">{copy.halfLife}</div>
        </div>
        <div className="space-y-1.5">
          <div className="text-xs font-medium">{copy.languages}</div>
          <div className="flex items-center gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={bm25Languages.includes("zh")}
                onChange={(event) => toggleLanguage("zh", event.target.checked)}
                disabled={isDisabled}
              />
              <span>{copy.chinese}</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={bm25Languages.includes("en")}
                onChange={(event) => toggleLanguage("en", event.target.checked)}
                disabled={isDisabled}
              />
              <span>{copy.english}</span>
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}
