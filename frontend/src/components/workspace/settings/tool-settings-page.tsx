"use client";

import { Loader2Icon, PlusIcon, RefreshCwIcon, Trash2Icon } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
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
import {
  useEnableMCPServer,
  useMCPConfig,
  useMCPServerProbe,
  useUpdateMCPConfig,
} from "@/core/mcp/hooks";
import type { MCPConfig, MCPServerConfig } from "@/core/mcp/types";
import { env } from "@/env";

import { ConfigValidationErrors } from "./config-validation-errors";
import { ConfigSaveBar } from "./configuration/config-save-bar";
import { ToolsSection } from "./configuration/sections/tools-section";
import { SettingsSection } from "./settings-section";
import { useConfigEditor } from "./use-config-editor";

type ServerType = "stdio" | "sse" | "http";

type NewServerDraft = {
  name: string;
  description: string;
  type: ServerType;
  command: string;
  args: string;
  url: string;
  enabled: boolean;
};

const EMPTY_DRAFT: NewServerDraft = {
  name: "",
  description: "",
  type: "stdio",
  command: "",
  args: "",
  url: "",
  enabled: true,
};

function MCPServerItem({
  name,
  config,
  mcpDisabled,
  copy,
  onToggle,
  onRemove,
}: {
  name: string;
  config: MCPServerConfig;
  mcpDisabled: boolean;
  copy: {
    remove: string;
    probeDisabled: string;
    probeTesting: string;
    probeRetry: string;
    probeFailed: string;
    probeConnected: string;
    toolsLabel: string;
  };
  onToggle: (serverName: string, enabled: boolean) => void;
  onRemove: (serverName: string) => void;
}) {
  const probeQuery = useMCPServerProbe(name, Boolean(config.enabled) && !mcpDisabled);
  const probe = probeQuery.data;

  return (
    <div className="rounded-md border p-3">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{name}</div>
          <div className="text-muted-foreground truncate text-xs">
            {config.description || "-"}
          </div>
          <div className="text-muted-foreground truncate text-xs">
            {typeof config.type === "string" ? config.type : "stdio"}{" "}
            {typeof config.url === "string" && config.url
              ? `· ${config.url}`
              : typeof config.command === "string" && config.command
                ? `· ${config.command}`
                : ""}
          </div>
        </div>
        <Switch
          checked={Boolean(config.enabled)}
          disabled={mcpDisabled}
          onCheckedChange={(checked) => onToggle(name, checked)}
        />
        <Button
          size="icon-sm"
          variant="ghost"
          disabled={mcpDisabled}
          onClick={() => onRemove(name)}
          aria-label={copy.remove}
        >
          <Trash2Icon className="size-4" />
        </Button>
      </div>

      <div className="mt-2 space-y-2 border-t pt-2">
        {!config.enabled ? (
          <div className="text-muted-foreground text-xs">{copy.probeDisabled}</div>
        ) : probeQuery.isLoading ? (
          <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <Loader2Icon className="size-3.5 animate-spin" />
            {copy.probeTesting}
          </div>
        ) : probeQuery.isError ? (
          <div className="flex items-center justify-between gap-2">
            <div className="text-destructive text-xs">{copy.probeFailed}</div>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-xs"
              onClick={() => {
                void probeQuery.refetch();
              }}
            >
              <RefreshCwIcon className="size-3.5" />
              {copy.probeRetry}
            </Button>
          </div>
        ) : probe ? (
          <>
            <div
              className={
                probe.success
                  ? "text-emerald-600 text-xs"
                  : "text-destructive text-xs"
              }
            >
              {probe.success
                ? `${copy.probeConnected} (${probe.tool_count})`
                : `${copy.probeFailed}: ${probe.message}`}
            </div>
            {probe.success && probe.tools.length > 0 && (
              <div>
                <div className="text-muted-foreground mb-1 text-[11px]">
                  {copy.toolsLabel}
                </div>
                <div className="flex flex-wrap gap-1">
                  {probe.tools.map((toolName) => (
                    <span
                      key={`${name}:${toolName}`}
                      className="bg-muted text-foreground rounded-md border px-2 py-0.5 text-xs"
                    >
                      {toolName}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}

export function ToolSettingsPage() {
  const { t } = useI18n();
  const m = t.migration.settings?.toolSettings;
  const {
    config: mcpConfig,
    isLoading: mcpLoading,
    error: mcpError,
  } = useMCPConfig();
  const { mutate: enableMCPServer } = useEnableMCPServer();
  const updateMCPConfigMutation = useUpdateMCPConfig();
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

  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<NewServerDraft>(EMPTY_DRAFT);
  const mcpServers = useMemo(
    () => mcpConfig?.mcp_servers ?? {},
    [mcpConfig?.mcp_servers],
  );

  const copy = {
    mcpTitle: m?.mcpTitle ?? "MCP Servers",
    mcpDesc: m?.mcpDesc ?? "Manage external MCP tool integrations.",
    addServer: m?.addServer ?? "Add server",
    emptyServer: m?.emptyServer ?? "No MCP servers yet. Add one to get started.",
    remove: m?.remove ?? "Remove",
    builtInTitle: m?.builtInTitle ?? "Built-in tools",
    builtInDesc: m?.builtInDesc ?? "Configure Nion built-in tools and tool groups.",
    serverName: m?.serverName ?? "Server name",
    serverNamePlaceholder: m?.serverNamePlaceholder ?? "e.g. github",
    serverDesc: m?.serverDesc ?? "Description",
    serverDescPlaceholder: m?.serverDescPlaceholder ?? "What this server provides",
    serverType: m?.serverType ?? "Connection type",
    command: m?.command ?? "Command",
    commandPlaceholder: m?.commandPlaceholder ?? "e.g. npx",
    args: m?.args ?? "Args (space separated)",
    argsPlaceholder: m?.argsPlaceholder ?? "e.g. -y @modelcontextprotocol/server-github",
    url: m?.url ?? "URL",
    urlPlaceholder: m?.urlPlaceholder ?? "e.g. https://example.com/mcp",
    enabled: m?.enabled ?? "Enabled",
    cancel: m?.cancel ?? "Cancel",
    create: m?.create ?? "Create",
    creating: m?.creating ?? "Creating...",
    loadConfigFailed: m?.loadConfigFailed ?? "Failed to load config",
    probeDisabled: m?.probeDisabled ?? "Disabled. Connection test skipped.",
    probeTesting: m?.probeTesting ?? "Testing connection and discovering tools...",
    probeRetry: m?.probeRetry ?? "Retry",
    probeFailed: m?.probeFailed ?? "Connection failed",
    probeConnected: m?.probeConnected ?? "Connected, tools",
    toolsLabel: m?.toolsLabel ?? "Available tools",
  };

  const mcpDisabled =
    env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY === "true" ||
    updateMCPConfigMutation.isPending;

  const upsertMCPServers = (servers: Record<string, MCPServerConfig>) => {
    updateMCPConfigMutation.mutate({ mcp_servers: servers } satisfies MCPConfig);
  };

  const handleCreate = () => {
    const name = draft.name.trim();
    if (!name || mcpServers[name]) {
      return;
    }

    const args = draft.args
      .split(" ")
      .map((item) => item.trim())
      .filter(Boolean);

    const nextServer: MCPServerConfig = {
      enabled: draft.enabled,
      description: draft.description.trim(),
      type: draft.type,
      command: draft.type === "stdio" ? draft.command.trim() : undefined,
      args: draft.type === "stdio" ? args : [],
      url: draft.type === "stdio" ? undefined : draft.url.trim(),
      headers: {},
      env: {},
    };

    upsertMCPServers({
      ...mcpServers,
      [name]: nextServer,
    });

    setDraft(EMPTY_DRAFT);
    setCreating(false);
  };

  const handleRemove = (name: string) => {
    const next = { ...mcpServers };
    delete next[name];
    upsertMCPServers(next);
  };

  return (
    <SettingsSection
      title={t.settings.tools.title}
      description={t.settings.tools.description}
    >
      <div className="space-y-6">
        <section className="space-y-3 rounded-lg border p-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-sm font-medium">{copy.mcpTitle}</div>
              <p className="text-muted-foreground text-xs">{copy.mcpDesc}</p>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={mcpDisabled}
              onClick={() => {
                setCreating((prev) => {
                  const next = !prev;
                  if (!next) {
                    setDraft(EMPTY_DRAFT);
                  }
                  return next;
                });
              }}
            >
              <PlusIcon className="size-4" />
              {copy.addServer}
            </Button>
          </div>

          {creating && (
            <div className="space-y-3 rounded-md border p-3">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <div className="text-xs font-medium">{copy.serverName}</div>
                  <Input
                    value={draft.name}
                    placeholder={copy.serverNamePlaceholder}
                    onChange={(e) =>
                      setDraft((prev) => ({ ...prev, name: e.target.value }))
                    }
                    disabled={mcpDisabled}
                  />
                </div>
                <div className="space-y-1.5">
                  <div className="text-xs font-medium">{copy.serverDesc}</div>
                  <Input
                    value={draft.description}
                    placeholder={copy.serverDescPlaceholder}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        description: e.target.value,
                      }))
                    }
                    disabled={mcpDisabled}
                  />
                </div>
                <div className="space-y-1.5">
                  <div className="text-xs font-medium">{copy.serverType}</div>
                  <Select
                    value={draft.type}
                    onValueChange={(value) =>
                      setDraft((prev) => ({
                        ...prev,
                        type: value as ServerType,
                      }))
                    }
                  >
                    <SelectTrigger disabled={mcpDisabled}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="stdio">stdio</SelectItem>
                      <SelectItem value="http">http</SelectItem>
                      <SelectItem value="sse">sse</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {draft.type === "stdio" ? (
                  <>
                    <div className="space-y-1.5">
                      <div className="text-xs font-medium">{copy.command}</div>
                      <Input
                        value={draft.command}
                        placeholder={copy.commandPlaceholder}
                        onChange={(e) =>
                          setDraft((prev) => ({ ...prev, command: e.target.value }))
                        }
                        disabled={mcpDisabled}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <div className="text-xs font-medium">{copy.args}</div>
                      <Input
                        value={draft.args}
                        placeholder={copy.argsPlaceholder}
                        onChange={(e) =>
                          setDraft((prev) => ({ ...prev, args: e.target.value }))
                        }
                        disabled={mcpDisabled}
                      />
                    </div>
                  </>
                ) : (
                  <div className="space-y-1.5 md:col-span-2">
                    <div className="text-xs font-medium">{copy.url}</div>
                    <Input
                      value={draft.url}
                      placeholder={copy.urlPlaceholder}
                      onChange={(e) =>
                        setDraft((prev) => ({ ...prev, url: e.target.value }))
                      }
                      disabled={mcpDisabled}
                    />
                  </div>
                )}
              </div>

              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={draft.enabled}
                  onCheckedChange={(checked) =>
                    setDraft((prev) => ({ ...prev, enabled: checked }))
                  }
                  disabled={mcpDisabled}
                />
                {copy.enabled}
              </label>

              <div className="flex items-center justify-end gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setCreating(false);
                    setDraft(EMPTY_DRAFT);
                  }}
                  disabled={mcpDisabled}
                >
                  {copy.cancel}
                </Button>
                <Button
                  size="sm"
                  onClick={handleCreate}
                  disabled={mcpDisabled || !draft.name.trim() || Boolean(mcpServers[draft.name.trim()])}
                >
                  {updateMCPConfigMutation.isPending ? copy.creating : copy.create}
                </Button>
              </div>
            </div>
          )}

          {mcpLoading ? (
            <div className="text-muted-foreground text-sm">{t.common.loading}</div>
          ) : mcpError ? (
            <div className="text-destructive text-sm">
              {mcpError instanceof Error ? mcpError.message : copy.loadConfigFailed}
            </div>
          ) : Object.keys(mcpServers).length === 0 ? (
            <div className="text-muted-foreground rounded-md border border-dashed p-4 text-sm">
              {copy.emptyServer}
            </div>
          ) : (
            <div className="space-y-2">
              {Object.entries(mcpServers).map(([name, config]) => (
                <MCPServerItem
                  key={name}
                  name={name}
                  config={config}
                  mcpDisabled={mcpDisabled}
                  copy={copy}
                  onToggle={(serverName, enabled) =>
                    enableMCPServer({ serverName, enabled })
                  }
                  onRemove={handleRemove}
                />
              ))}
            </div>
          )}
        </section>

        <section className="space-y-3 rounded-lg border p-4">
          <div>
            <div className="text-sm font-medium">{copy.builtInTitle}</div>
            <p className="text-muted-foreground text-xs">{copy.builtInDesc}</p>
          </div>

          {isLoading ? (
            <div className="text-muted-foreground text-sm">{t.common.loading}</div>
          ) : error ? (
            <div className="text-destructive text-sm">
              {error instanceof Error ? error.message : copy.loadConfigFailed}
            </div>
          ) : (
            <div className="space-y-4">
              <ToolsSection
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
        </section>
      </div>
    </SettingsSection>
  );
}
