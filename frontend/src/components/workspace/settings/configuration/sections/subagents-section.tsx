"use client";

import { PlusIcon, Trash2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/core/i18n/hooks";

import { asObject, cloneConfig, type ConfigDraft } from "../shared";

function parsePositiveInt(value: string): number | undefined {
  if (!value.trim()) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return undefined;
  }
  return Math.trunc(parsed);
}

function toInputValue(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }
  if (typeof value === "string") {
    return value;
  }
  return "";
}

export function SubagentsSection({
  config,
  onChange,
  disabled,
}: {
  config: ConfigDraft;
  onChange: (next: ConfigDraft) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const m = t.migration.settings?.configSections?.subagents;

  const subagents = asObject(config.subagents);
  const agents = asObject(subagents.agents);
  const entries: Array<[string, string]> = Object.entries(agents).map(([name, value]) => {
    const item = asObject(value);
    return [name, toInputValue(item.timeout_seconds)];
  });

  const copy = {
    title: m?.title ?? "Subagent timeouts",
    subtitle: m?.subtitle ?? "Configure default and per-agent execution timeout.",
    defaultTimeout: m?.defaultTimeout ?? "Default timeout (seconds)",
    perAgent: m?.perAgent ?? "Per-agent overrides",
    agentName: m?.agentName ?? "Agent name",
    timeout: m?.timeout ?? "Timeout (seconds)",
    add: m?.add ?? "Add override",
    remove: m?.remove ?? "Remove",
    empty: m?.empty ?? "No overrides. Default timeout will be used.",
    hint: m?.hint ?? "Use this to control subtask wait time and avoid long-running stalls. Enter seconds greater than 0.",
  };

  const updateSubagents = (nextSubagents: Record<string, unknown>) => {
    const next = cloneConfig(config);
    if (Object.keys(nextSubagents).length === 0) {
      delete next.subagents;
    } else {
      next.subagents = nextSubagents;
    }
    onChange(next);
  };

  const updateDefaultTimeout = (raw: string) => {
    const nextSubagents = asObject(config.subagents);
    const parsed = parsePositiveInt(raw);
    if (parsed === undefined) {
      delete nextSubagents.timeout_seconds;
    } else {
      nextSubagents.timeout_seconds = parsed;
    }
    updateSubagents(nextSubagents);
  };

  const persistEntries = (nextEntries: Array<[string, string]>) => {
    const normalizedAgents: Record<string, { timeout_seconds: number }> = {};
    for (const [rawName, rawTimeout] of nextEntries) {
      const name = rawName.trim();
      const timeout = parsePositiveInt(rawTimeout);
      if (!name || timeout === undefined) {
        continue;
      }
      normalizedAgents[name] = { timeout_seconds: timeout };
    }

    const nextSubagents = asObject(config.subagents);
    if (Object.keys(normalizedAgents).length === 0) {
      delete nextSubagents.agents;
    } else {
      nextSubagents.agents = normalizedAgents;
    }
    updateSubagents(nextSubagents);
  };

  const updateEntryName = (index: number, nextName: string) => {
    const nextEntries = [...entries];
    const timeout = nextEntries[index]?.[1] ?? "";
    nextEntries[index] = [nextName, timeout];
    persistEntries(nextEntries);
  };

  const updateEntryTimeout = (index: number, nextTimeout: string) => {
    const nextEntries = [...entries];
    const name = nextEntries[index]?.[0] ?? "";
    nextEntries[index] = [name, nextTimeout];
    persistEntries(nextEntries);
  };

  const removeEntry = (index: number) => {
    persistEntries(entries.filter((_, idx) => idx !== index));
  };

  const addEntry = () => {
    const usedNames = new Set(entries.map(([name]) => name.trim()));
    let name = "general-purpose";
    let suffix = 2;
    while (usedNames.has(name)) {
      name = `general-purpose-${suffix}`;
      suffix += 1;
    }
    persistEntries([...entries, [name, "900"]]);
  };

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div className="space-y-1">
        <div className="text-sm font-medium">{copy.title}</div>
        <div className="text-muted-foreground text-xs">{copy.subtitle}</div>
      </div>

      <div className="space-y-1.5">
        <div className="text-xs font-medium">{copy.defaultTimeout}</div>
        <Input
          type="number"
          min={1}
          placeholder="900"
          value={toInputValue(subagents.timeout_seconds)}
          onChange={(e) => updateDefaultTimeout(e.target.value)}
          disabled={disabled}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-medium">{copy.perAgent}</div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={addEntry}
            disabled={disabled}
          >
            <PlusIcon className="size-4" />
            {copy.add}
          </Button>
        </div>

        {entries.length === 0 ? (
          <div className="text-muted-foreground rounded-md border border-dashed px-3 py-4 text-sm">
            {copy.empty}
          </div>
        ) : (
          <div className="space-y-2">
            {entries.map(([name, timeout], index) => (
              <div
                key={`${name}-${index}`}
                className="grid gap-2 md:grid-cols-[minmax(0,240px)_minmax(0,1fr)_auto]"
              >
                <Input
                  value={name}
                  placeholder="general-purpose"
                  onChange={(e) => updateEntryName(index, e.target.value)}
                  disabled={disabled}
                />
                <Input
                  type="number"
                  min={1}
                  value={timeout}
                  placeholder="900"
                  onChange={(e) => updateEntryTimeout(index, e.target.value)}
                  disabled={disabled}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removeEntry(index)}
                  disabled={disabled}
                  aria-label={copy.remove}
                >
                  <Trash2Icon className="size-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="text-muted-foreground text-xs">{copy.hint}</div>
    </div>
  );
}
