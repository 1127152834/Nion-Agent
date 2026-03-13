"use client";

import type {
  MCPMarketplaceInstallApply,
  MCPMarketplaceServerDetail,
  MCPServerConfig,
} from "./types";

function utcNowIso(): string {
  return new Date().toISOString();
}

export function normalizeServerKey(raw: string): string {
  const input = String(raw ?? "").trim().toLowerCase();
  if (!input) return "server";
  const dashed = input
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
  return dashed || "server";
}

export function parseKeyValueText(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of String(text ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    if (!key) continue;
    const value = line.slice(idx + 1);
    out[key] = value;
  }
  return out;
}

function formatValue(format: string | undefined, value: unknown): string {
  const normalized =
    typeof value === "string" || typeof value === "number" || typeof value === "boolean"
      ? String(value)
      : "";
  const template = (format?.trim()) ? format : "{value}";
  return template.replaceAll("{value}", normalized);
}

function applyInstallApply(
  config: MCPServerConfig,
  apply: MCPMarketplaceInstallApply,
  value: unknown,
): MCPServerConfig {
  if (apply.kind === "env") {
    const key = apply.key;
    const nextEnv = { ...(config.env ?? {}) };
    nextEnv[key] = formatValue(apply.format, value);
    return { ...config, env: nextEnv };
  }

  if (apply.kind === "header") {
    const key = apply.key;
    const nextHeaders = { ...(config.headers ?? {}) };
    nextHeaders[key] = formatValue(apply.format, value);
    return { ...config, headers: nextHeaders };
  }

  if (apply.kind === "arg_append") {
    const baseArgs = Array.isArray(config.args) ? [...config.args] : [];
    // Note: apply.args is an array of raw strings; only "{value}" is substituted.
    const valueString =
      typeof value === "string" || typeof value === "number" || typeof value === "boolean"
        ? String(value)
        : "";
    const final = (apply.args ?? []).map((item) => String(item).replaceAll("{value}", valueString));
    return { ...config, args: [...baseArgs, ...final] };
  }

  // url
  return { ...config, url: formatValue(apply.format, value) };
}

export function applyMarketplaceInstallOption(params: {
  detail: MCPMarketplaceServerDetail;
  optionId: string;
  values: Record<string, unknown>;
  serverKey: string;
}): { serverKey: string; config: MCPServerConfig } {
  const { detail, optionId, values, serverKey } = params;
  const option = (detail.installOptions ?? []).find((item) => item.id === optionId);
  if (!option) {
    throw new Error(`Unknown install option: ${optionId}`);
  }

  const base: MCPServerConfig = JSON.parse(JSON.stringify(option.template ?? {})) as MCPServerConfig;
  let config: MCPServerConfig = {
    ...base,
    enabled: base.enabled ?? true,
    type: option.transport,
    description: base.description ?? detail.description ?? "",
  };

  const now = utcNowIso();
  const existingCreatedAt =
    config.meta && typeof config.meta.created_at === "string"
      ? config.meta.created_at
      : undefined;
  config.meta = {
    ...(config.meta ?? {}),
    origin: "marketplace",
    marketplace_id: detail.id,
    marketplace_version: detail.version,
    install_option_id: option.id,
    verified: detail.verified,
    featured: detail.featured,
    created_at: existingCreatedAt ?? now,
    updated_at: now,
  };

  for (const input of option.inputs ?? []) {
    const value = values[input.id];
    const hasValue = value !== undefined && value !== null && (typeof value !== "string" || value !== "");
    if (!hasValue) {
      if (input.required) {
        throw new Error(`Missing required input: ${input.label}`);
      }
      continue;
    }
    config = applyInstallApply(config, input.apply, value);
  }

  return { serverKey, config };
}

export function parseMcpClipboardImport(text: string): { imported: Record<string, MCPServerConfig> } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(text ?? ""));
  } catch {
    throw new Error("Clipboard content is not valid JSON");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Clipboard JSON must be an object");
  }

  const obj = parsed as Record<string, unknown>;
  const fromMcpServers = obj.mcpServers;
  const fromMcpServersSnake = obj.mcp_servers;

  const picked = (fromMcpServers && typeof fromMcpServers === "object")
    ? (fromMcpServers as Record<string, unknown>)
    : (fromMcpServersSnake && typeof fromMcpServersSnake === "object")
      ? (fromMcpServersSnake as Record<string, unknown>)
      : null;

  if (picked) {
    const imported: Record<string, MCPServerConfig> = {};
    for (const [key, value] of Object.entries(picked)) {
      if (!key || !value || typeof value !== "object") continue;
      imported[String(key)] = value as MCPServerConfig;
    }
    return { imported };
  }

  // Single server config
  const single = obj as MCPServerConfig;
  if ("enabled" in obj || "type" in obj || "command" in obj || "url" in obj) {
    return { imported: { "imported-server": single } };
  }

  throw new Error("Unsupported clipboard JSON format");
}
