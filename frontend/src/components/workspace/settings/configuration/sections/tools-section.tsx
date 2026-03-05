"use client";

import { EyeIcon, EyeOffIcon, Loader2Icon } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { getBackendBaseURL } from "@/core/config";
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

type KeyTestState = {
  status: "idle" | "testing" | "ok" | "error";
  message: string;
};

type WebProviderId = "web_search" | "web_fetch";

const TOOL_PRESETS: ToolPreset[] = [
  {
    id: "web_search",
    name: "web_search",
    group: "web",
    use: "src.community.tavily.tools:web_search_tool",
    title: "Web Search",
    desc: "Allow agent to search the web.",
  },
  {
    id: "web_fetch",
    name: "web_fetch",
    group: "web",
    use: "src.community.jina_ai.tools:web_fetch_tool",
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

function toInputNumber(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "string") {
    return value;
  }
  return "";
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
  const m = t.migration.settings?.configSections?.tools;

  const tools = asArray(config.tools);
  const [secretVisible, setSecretVisible] = useState<{
    web_search: boolean;
    web_fetch: boolean;
  }>({
    web_search: false,
    web_fetch: false,
  });
  const [keyTestState, setKeyTestState] = useState<Record<WebProviderId, KeyTestState>>({
    web_search: { status: "idle", message: "" },
    web_fetch: { status: "idle", message: "" },
  });

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

  const copy = {
    title: m?.title ?? "Built-in tools",
    subtitle: m?.subtitle ?? "Toggle built-in tools without exposing raw YAML structures.",
    webConfigTitle: m?.webConfigTitle ?? "Web tool settings",
    webConfigSubtitle: m?.webConfigSubtitle ?? "Configure web search and page-fetch behavior: result size, fetch timeout, and API keys.",
    tavilyApiKey: m?.tavilyApiKey ?? "Tavily API key (web search)",
    jinaApiKey: m?.jinaApiKey ?? "Jina API key (web fetch)",
    maxResults: m?.maxResults ?? "Max results",
    timeout: m?.timeout ?? "Timeout (seconds)",
    placeholderApiKey: m?.placeholderApiKey ?? "Enter API key (supports $ENV_VAR)",
    show: m?.show ?? "Show",
    hide: m?.hide ?? "Hide",
    testingKey: m?.testingKey ?? "正在校验密钥...",
    keyTestSuccess: m?.keyTestSuccess ?? "密钥可用",
    keyTestFailed: m?.keyTestFailed ?? "密钥不可用",
    keyTestInvalid: m?.keyTestInvalid ?? "密钥无效",
    keyTestInvalidCleared: m?.keyTestInvalidCleared ?? "密钥无效，已清空",
    keyTestMissing: m?.keyTestMissing ?? "请输入密钥",
    keyTestNetwork: m?.keyTestNetwork ?? "网络异常，请稍后重试",
    keyTestUnsupported: m?.keyTestUnsupported ?? "当前运行时不支持密钥测试，请重启应用",
    hintZh: m?.hintZh ?? (m?.hintEn ?? "Use a raw key or an env placeholder like $VAR_NAME."),
    hintEn: m?.hintEn ?? "Use a raw key or an env placeholder like $VAR_NAME.",
    customInfo:
      customToolCount > 0
        ? (m?.customInfoTemplate ?? "{count} custom tools detected. They are preserved but not edited here.")
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

  const runKeyTest = async (providerId: WebProviderId) => {
    const isSearch = providerId === "web_search";
    const preset = TOOL_PRESETS.find((item) => item.id === providerId);
    if (!preset) {
      return;
    }
    const toolConfig = isSearch ? presetTools.web_search : presetTools.web_fetch;
    const rawKey = asString(toolConfig?.api_key).trim();
    const numericValue = isSearch
      ? Number(toInputNumber(toolConfig?.max_results || 1))
      : Number(toInputNumber(toolConfig?.timeout || 10));

    setKeyTestState((prev) => ({
      ...prev,
      [providerId]: {
        status: "testing",
        message: copy.testingKey,
      },
    }));

    try {
      const response = await fetch(`${getBackendBaseURL()}/api/tools/test-web-provider`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          provider: isSearch ? "tavily" : "jina",
          api_key: rawKey || null,
          ...(isSearch
            ? { max_results: Number.isFinite(numericValue) && numericValue > 0 ? Math.floor(numericValue) : 1 }
            : { timeout_seconds: Number.isFinite(numericValue) && numericValue > 0 ? Math.floor(numericValue) : 10 }),
        }),
      });

      const payload = (await response.json()) as {
        status?: "ok" | "degraded";
        error_code?: string | null;
        result?: { message?: string } | null;
        detail?: string;
      };

      if (!response.ok || payload.status !== "ok") {
        let message = payload?.result?.message || payload?.error_code || payload?.detail || copy.keyTestFailed;
        if (payload?.error_code === "tool_api_key_invalid") {
          if (rawKey) {
            upsertPresetTool(preset, { api_key: undefined });
            message = copy.keyTestInvalidCleared;
          } else {
            message = copy.keyTestInvalid;
          }
        } else if (payload?.error_code === "tool_api_key_missing") {
          message = copy.keyTestMissing;
        } else if (payload?.error_code === "tool_provider_unreachable") {
          message = copy.keyTestNetwork;
        } else if (response.status === 404) {
          message = copy.keyTestUnsupported;
        }
        setKeyTestState((prev) => ({
          ...prev,
          [providerId]: {
            status: "error",
            message,
          },
        }));
        return;
      }

      setKeyTestState((prev) => ({
        ...prev,
        [providerId]: {
          status: "ok",
          message: copy.keyTestSuccess,
        },
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setKeyTestState((prev) => ({
        ...prev,
        [providerId]: {
          status: "error",
          message,
        },
      }));
    }
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
                      {m?.presetTitles?.[preset.id] ?? preset.title}
                    </div>
                    <div className="text-muted-foreground mt-0.5 text-xs">
                      {m?.presetDescriptions?.[preset.id] ?? preset.desc}
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
      </section>

      <section className="space-y-3 rounded-lg border p-4">
        <div>
          <div className="text-sm font-medium">{copy.webConfigTitle}</div>
          <p className="text-muted-foreground text-xs">{copy.webConfigSubtitle}</p>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-md border p-3">
            <div className="mb-1 text-xs font-medium">{copy.tavilyApiKey}</div>
            <div className="flex items-start gap-2">
              <div className="relative min-w-0 flex-1">
                <Input
                  className="pr-10"
                  disabled={disabled}
                  placeholder={copy.placeholderApiKey}
                  type={secretVisible.web_search ? "text" : "password"}
                  value={asString(presetTools.web_search?.api_key)}
                  onChange={(e) => {
                    const preset = TOOL_PRESETS.find(
                      (item) => item.id === "web_search",
                    );
                    if (!preset) return;
                    upsertPresetTool(preset, { api_key: e.target.value });
                    setKeyTestState((prev) => ({
                      ...prev,
                      web_search: { status: "idle", message: "" },
                    }));
                  }}
                  onBlur={() => {
                    if (asString(presetTools.web_search?.api_key).trim()) {
                      void runKeyTest("web_search");
                    }
                  }}
                />
                <Button
                  aria-label={
                    secretVisible.web_search ? copy.hide : copy.show
                  }
                  className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2 p-0"
                  disabled={disabled}
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                  onMouseDown={(event) => {
                    event.preventDefault();
                  }}
                  onClick={() =>
                    setSecretVisible((prev) => ({
                      ...prev,
                      web_search: !prev.web_search,
                    }))
                  }
                >
                  {secretVisible.web_search ? (
                    <EyeOffIcon className="size-4" />
                  ) : (
                    <EyeIcon className="size-4" />
                  )}
                </Button>
              </div>
              <Input
                className="w-[76px] shrink-0 px-2"
                disabled={disabled}
                min={1}
                placeholder={copy.maxResults}
                type="number"
                value={toInputNumber(presetTools.web_search?.max_results)}
                onChange={(e) => {
                  const preset = TOOL_PRESETS.find(
                    (item) => item.id === "web_search",
                  );
                  if (!preset) return;
                  const raw = e.target.value.trim();
                  if (!raw) {
                    upsertPresetTool(preset, { max_results: undefined });
                    return;
                  }
                  const parsed = Number(raw);
                  if (Number.isFinite(parsed) && parsed > 0) {
                    upsertPresetTool(preset, { max_results: Math.floor(parsed) });
                  }
                }}
              />
            </div>
            {keyTestState.web_search.status !== "idle" ? (
              <div className="mt-2 flex items-center gap-2 text-xs">
                {keyTestState.web_search.status === "testing" ? (
                  <Loader2Icon className="size-3.5 animate-spin text-muted-foreground" />
                ) : (
                  <span
                    className={`inline-block size-2 rounded-full ${
                      keyTestState.web_search.status === "ok"
                        ? "bg-emerald-500"
                        : "bg-rose-500"
                    }`}
                  />
                )}
                <span
                  className={
                    keyTestState.web_search.status === "ok"
                      ? "text-emerald-600"
                      : keyTestState.web_search.status === "error"
                        ? "text-destructive"
                        : "text-muted-foreground"
                  }
                >
                  {keyTestState.web_search.message || copy.testingKey}
                </span>
              </div>
            ) : null}
          </div>

          <div className="rounded-md border p-3">
            <div className="mb-1 text-xs font-medium">{copy.jinaApiKey}</div>
            <div className="flex items-start gap-2">
              <div className="relative min-w-0 flex-1">
                <Input
                  className="pr-10"
                  disabled={disabled}
                  placeholder={copy.placeholderApiKey}
                  type={secretVisible.web_fetch ? "text" : "password"}
                  value={asString(presetTools.web_fetch?.api_key)}
                  onChange={(e) => {
                    const preset = TOOL_PRESETS.find(
                      (item) => item.id === "web_fetch",
                    );
                    if (!preset) return;
                    upsertPresetTool(preset, { api_key: e.target.value });
                    setKeyTestState((prev) => ({
                      ...prev,
                      web_fetch: { status: "idle", message: "" },
                    }));
                  }}
                  onBlur={() => {
                    if (asString(presetTools.web_fetch?.api_key).trim()) {
                      void runKeyTest("web_fetch");
                    }
                  }}
                />
                <Button
                  aria-label={
                    secretVisible.web_fetch ? copy.hide : copy.show
                  }
                  className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2 p-0"
                  disabled={disabled}
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                  onMouseDown={(event) => {
                    event.preventDefault();
                  }}
                  onClick={() =>
                    setSecretVisible((prev) => ({
                      ...prev,
                      web_fetch: !prev.web_fetch,
                    }))
                  }
                >
                  {secretVisible.web_fetch ? (
                    <EyeOffIcon className="size-4" />
                  ) : (
                    <EyeIcon className="size-4" />
                  )}
                </Button>
              </div>
              <Input
                className="w-[84px] shrink-0 px-2"
                disabled={disabled}
                min={1}
                placeholder={copy.timeout}
                type="number"
                value={toInputNumber(presetTools.web_fetch?.timeout)}
                onChange={(e) => {
                  const preset = TOOL_PRESETS.find(
                    (item) => item.id === "web_fetch",
                  );
                  if (!preset) return;
                  const raw = e.target.value.trim();
                  if (!raw) {
                    upsertPresetTool(preset, { timeout: undefined });
                    return;
                  }
                  const parsed = Number(raw);
                  if (Number.isFinite(parsed) && parsed > 0) {
                    upsertPresetTool(preset, { timeout: Math.floor(parsed) });
                  }
                }}
              />
            </div>
            {keyTestState.web_fetch.status !== "idle" ? (
              <div className="mt-2 flex items-center gap-2 text-xs">
                {keyTestState.web_fetch.status === "testing" ? (
                  <Loader2Icon className="size-3.5 animate-spin text-muted-foreground" />
                ) : (
                  <span
                    className={`inline-block size-2 rounded-full ${
                      keyTestState.web_fetch.status === "ok"
                        ? "bg-emerald-500"
                        : "bg-rose-500"
                    }`}
                  />
                )}
                <span
                  className={
                    keyTestState.web_fetch.status === "ok"
                      ? "text-emerald-600"
                      : keyTestState.web_fetch.status === "error"
                        ? "text-destructive"
                        : "text-muted-foreground"
                  }
                >
                  {keyTestState.web_fetch.message || copy.testingKey}
                </span>
              </div>
            ) : null}
          </div>
        </div>

        <FieldTip
          en={copy.hintEn}
          zh={copy.hintZh}
        />

        {copy.customInfo ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            {copy.customInfo}
          </div>
        ) : null}
      </section>
    </div>
  );
}
