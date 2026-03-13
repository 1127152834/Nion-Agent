"use client";

import { useMemo } from "react";

import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/core/i18n/hooks";

import { FieldTip } from "../field-tip";
import {
  asArray,
  asString,
  cloneConfig,
  type ConfigDraft,
} from "../shared";

type ToolPreset = {
  id:
    | "web_search"
    | "web_fetch"
    | "image_search"
    | "ls"
    | "read_file"
    | "write_file"
    | "str_replace"
    | "bash";
  name: string;
  group: string;
  use: string;
  title: string;
  desc: string;
};

type ToolSectionCopy = {
  title: string;
  subtitle: string;
  hintEn: string;
  hintZh: string;
  customInfoTemplate: string;
  presetTitles: Record<ToolPreset["id"], string>;
  presetDescriptions: Record<ToolPreset["id"], string>;
};

const TOOL_PRESETS: ToolPreset[] = [
  {
    id: "web_search",
    name: "web_search",
    group: "web",
    use: "src.community.web_search.tools:web_search_tool",
    title: "Web Search",
    desc: "Allow agent to search the web.",
  },
  {
    id: "web_fetch",
    name: "web_fetch",
    group: "web",
    use: "src.community.web_fetch.tools:web_fetch_tool",
    title: "Web Fetch",
    desc: "Fetch webpage content (with configurable Jina key).",
  },
  {
    id: "image_search",
    name: "image_search",
    group: "web",
    use: "src.community.image_search.tools:image_search_tool",
    title: "Image Search",
    desc: "Search images for references.",
  },
  {
    id: "ls",
    name: "ls",
    group: "file:read",
    use: "src.sandbox.tools:ls_tool",
    title: "List Directory",
    desc: "List workspace directory tree.",
  },
  {
    id: "read_file",
    name: "read_file",
    group: "file:read",
    use: "src.sandbox.tools:read_file_tool",
    title: "Read File",
    desc: "Read file content.",
  },
  {
    id: "write_file",
    name: "write_file",
    group: "file:write",
    use: "src.sandbox.tools:write_file_tool",
    title: "Write File",
    desc: "Create or overwrite files.",
  },
  {
    id: "str_replace",
    name: "str_replace",
    group: "file:write",
    use: "src.sandbox.tools:str_replace_tool",
    title: "String Replace",
    desc: "Replace text fragments in files.",
  },
  {
    id: "bash",
    name: "bash",
    group: "bash",
    use: "src.sandbox.tools:bash_tool",
    title: "Bash Execution",
    desc: "Execute shell commands in sandbox.",
  },
];

function findToolIndex(
  tools: Record<string, unknown>[],
  preset: ToolPreset,
): number {
  return tools.findIndex(
    (tool) =>
      asString(tool.name).trim() === preset.name ||
      asString(tool.use).trim() === preset.use,
  );
}

function normalizeToolGroups(
  tools: Record<string, unknown>[],
): Record<string, unknown>[] {
  const seen = new Set<string>();
  const groups: Record<string, unknown>[] = [];
  for (const tool of tools) {
    const group = asString(tool.group).trim();
    if (!group || seen.has(group)) {
      continue;
    }
    seen.add(group);
    groups.push({ name: group });
  }
  return groups;
}

export function ToolsSection({
  config,
  onChange,
  disabled,
}: {
  config: ConfigDraft;
  onChange: (next: ConfigDraft) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const fallbackSection: ToolSectionCopy = {
    title: "Tools",
    subtitle: "Configure built-in tools.",
    hintEn: "Only enable tools you really need.",
    hintZh: "仅启用你真正需要的工具。",
    customInfoTemplate: "{count} custom tools configured",
    presetTitles: {
      web_search: "Web Search",
      web_fetch: "Web Fetch",
      image_search: "Image Search",
      ls: "List Directory",
      read_file: "Read File",
      write_file: "Write File",
      str_replace: "String Replace",
      bash: "Bash",
    },
    presetDescriptions: {
      web_search: "Allow agent to search the web.",
      web_fetch: "Fetch webpage content.",
      image_search: "Search images for references.",
      ls: "List workspace directory tree.",
      read_file: "Read file content.",
      write_file: "Create or overwrite files.",
      str_replace: "Replace text in files.",
      bash: "Execute shell commands in sandbox.",
    },
  };
  const settingsLike = t.settings as unknown as {
    configSections?: {
      tools?: Partial<ToolSectionCopy>;
    };
  };
  const sectionRaw = settingsLike.configSections?.tools ?? {};
  const section: ToolSectionCopy = {
    ...fallbackSection,
    ...sectionRaw,
    presetTitles: {
      ...fallbackSection.presetTitles,
      ...(sectionRaw.presetTitles ?? {}),
    },
    presetDescriptions: {
      ...fallbackSection.presetDescriptions,
      ...(sectionRaw.presetDescriptions ?? {}),
    },
  };

  const tools = asArray(config.tools);

  const presetTools = useMemo(() => {
    return Object.fromEntries(
      TOOL_PRESETS.map((preset) => {
        const index = findToolIndex(tools, preset);
        return [preset.id, index >= 0 ? tools[index] : null];
      }),
    ) as Partial<Record<ToolPreset["id"], Record<string, unknown> | null>>;
  }, [tools]);

  const customToolCount = useMemo(() => {
    const presetIds = new Set(TOOL_PRESETS.map((preset) => preset.id));
    return tools.filter((tool) => {
      const name = asString(tool.name).trim();
      return ![...presetIds].some((id) => {
        const preset = TOOL_PRESETS.find((item) => item.id === id);
        if (!preset) {
          return false;
        }
        return (
          name === preset.name || asString(tool.use).trim() === preset.use
        );
      });
    }).length;
  }, [tools]);

  const copy: ToolSectionCopy & { customInfo: string } = {
    ...section,
    customInfo:
      customToolCount > 0
        ? section.customInfoTemplate
          .replaceAll("{count}", String(customToolCount))
        : "",
  };

  const upsertPresetTool = (
    preset: ToolPreset,
    patch?: Record<string, unknown>,
  ) => {
    const next = cloneConfig(config);
    const list = asArray(next.tools);
    const index = findToolIndex(list, preset);
    const current = index >= 0 ? list[index] : {};
    const updated = {
      ...current,
      name: preset.name,
      group: preset.group,
      use: preset.use,
    } as Record<string, unknown>;
    if (preset.id === "web_search") {
      updated.provider = "auto";
    }

    if (patch) {
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined || value === null || value === "") {
          delete updated[key];
        } else {
          updated[key] = value;
        }
      }
    }

    if (index >= 0) {
      list[index] = updated;
    } else {
      list.push(updated);
    }
    next.tools = list;
    next.tool_groups = normalizeToolGroups(list);
    onChange(next);
  };

  const removePresetTool = (preset: ToolPreset) => {
    const next = cloneConfig(config);
    const list = asArray(next.tools);
    const index = findToolIndex(list, preset);
    if (index < 0) {
      return;
    }
    list.splice(index, 1);
    next.tools = list;
    next.tool_groups = normalizeToolGroups(list);
    onChange(next);
  };

  const togglePreset = (preset: ToolPreset, enabled: boolean) => {
    if (enabled) {
      upsertPresetTool(preset);
      return;
    }
    removePresetTool(preset);
  };

  return (
    <div className="space-y-6">
      <section className="space-y-3 rounded-lg border p-4">
        <div>
          <div className="text-sm font-medium">{copy.title}</div>
          <p className="text-muted-foreground text-xs">{copy.subtitle}</p>
        </div>

        <div className="space-y-2">
          {TOOL_PRESETS.map((preset) => {
            const tool = presetTools[preset.id];
            const enabled = Boolean(tool);
            return (
              <div
                className="rounded-md border px-3 py-2.5"
                key={preset.id}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">
                      {section.presetTitles[preset.id]}
                    </div>
                    <div className="text-muted-foreground mt-0.5 text-xs">
                      {section.presetDescriptions[preset.id]}
                    </div>
                  </div>
                  <Switch
                    checked={enabled}
                    disabled={disabled}
                    onCheckedChange={(checked) => togglePreset(preset, checked)}
                  />
                </div>
              </div>
            );
          })}
        </div>
        <FieldTip en={copy.hintEn} zh={copy.hintZh} />

        {copy.customInfo ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            {copy.customInfo}
          </div>
        ) : null}
      </section>
    </div>
  );
}
