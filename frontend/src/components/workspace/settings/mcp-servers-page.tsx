"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownToLineIcon,
  CheckCircle2Icon,
  ExternalLinkIcon,
  Loader2Icon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  SparklesIcon,
  Trash2Icon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/core/i18n/hooks";
import { getMcpDebugInfo } from "@/core/mcp/api";
import {
  useMCPConfig,
  useMCPServerProbe,
  useEnsureNodeToolchain,
  useMcpPrerequisites,
  useMcpMarketplaceServerDetail,
  useMcpMarketplaceServers,
  useUpdateMCPConfig,
} from "@/core/mcp/hooks";
import type {
  MCPConfig,
  MCPMarketplaceInstallInput,
  MCPMarketplaceInstallOption,
  MCPMarketplaceInstallFingerprint,
  MCPMarketplaceServerListItem,
  MCPServerConfig,
  MCPServerType,
} from "@/core/mcp/types";
import {
  applyMarketplaceInstallOption,
  normalizeServerKey,
  parseKeyValueText,
  parseMcpClipboardImport,
} from "@/core/mcp/utils";

import { ConfigSaveBar } from "./configuration/config-save-bar";
import { ConfirmActionDialog } from "./confirm-action-dialog";
import { SettingsSection } from "./settings-section";

type TabKey = "marketplace" | "installed";

const FALLBACK_COPY = {
  title: "MCP 服务器",
  description: "管理 MCP 连接、安装方式与可用工具。",
  installed: "已安装",
  marketplace: "公共 MCP",
  searchPlaceholder: "搜索 MCP 服务器...",
  categoryAll: "所有分类",
  refresh: "刷新",
  addServer: "添加服务器",
  verified: "已验证",
  featured: "精选",
  install: "安装",
  installedAction: "已安装",
  installing: "安装中...",
  viewDocs: "查看文档",
  details: "查看详情",
  close: "关闭",
  noMarketplace: "暂无可用公共 MCP 条目。",
  loadFailed: "加载失败",
  pendingChanges: "未保存的更改",
  // prerequisites
  prerequisitesMissing: "缺少前置条件：{name}",
  installNodeToolchain: "一键安装 Node.js（包含 npx）",
  installingPrereqs: "正在安装依赖...",
  // installed statuses
  statusDisabled: "已禁用",
  statusPending: "待保存",
  statusTesting: "正在检测连接...",
  statusConnected: "已连接",
  statusFailed: "连接失败",
  retry: "重试",
  copyDiagnostics: "复制诊断信息",
  diagnosticsCopied: "已复制诊断信息",
  diagnosticsCopyFailed: "复制失败",
  toolsLabel: "可用工具",
  edit: "编辑",
  remove: "删除",
  deleteConfirmTitle: "确认删除",
  deleteConfirmDescription: "删除 MCP 服务器 \"{name}\"？此操作不可撤销。",
  cancelAction: "取消",
  confirmDeleteAction: "删除",
  // editor
  editorAddTitle: "添加服务器",
  editorEditTitle: "编辑 MCP 服务器",
  clipboardImport: "从剪贴板导入",
  serverKey: "服务器标识",
  serverKeyPlaceholder: "my-mcp-server",
  displayName: "显示名称",
  displayNamePlaceholder: "可选显示名称",
  descriptionLabel: "描述",
  descriptionPlaceholder: "可选描述",
  transportType: "传输类型",
  stdio: "stdio",
  http: "http",
  sse: "sse",
  command: "命令",
  commandPlaceholder: "uvx / npx / python -m ...",
  args: "参数（每行一个）",
  url: "地址",
  urlPlaceholder: "https://example.com/sse",
  env: "环境变量（每行 KEY=value）",
  headers: "请求头（每行 KEY=value）",
  oauthJson: "OAuth JSON（可选）",
  enabled: "启用",
  saveAction: "保存",
  createAction: "添加",
  // installer
  installDialogTitle: "安装 MCP 服务器",
  installMethod: "安装方式",
  prerequisites: "前置条件",
  inputs: "参数",
  serverKeyFromMarketplace: "安装后的服务器标识",
  installConfirmTitle: "继续安装并保存？",
  installConfirmDescription: "检测到未保存的更改。继续安装将会同时保存当前所有更改。",
  installConfirmAction: "继续安装",
} as const;

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value ?? {})) as T;
}

function stableSortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableSortValue);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    out[key] = stableSortValue(obj[key]);
  }
  return out;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(stableSortValue(value ?? {}));
}

function summarizeConfig(config: MCPServerConfig): string {
  const type = typeof config.type === "string" ? config.type : "stdio";
  if (type === "stdio") {
    const command = typeof config.command === "string" ? config.command : "";
    const argsList = Array.isArray(config.args) ? config.args : [];
    const redactedArgs: string[] = [];
    const secretFlags = new Set([
      "--api-key",
      "--token",
      "--access-token",
      "--secret",
      "--authorization",
      "--auth",
      "--password",
      "--key",
    ]);
    for (let i = 0; i < argsList.length; i += 1) {
      const arg = argsList[i] ?? "";
      if (typeof arg !== "string") {
        redactedArgs.push(String(arg));
        continue;
      }
      const [flagRaw, value] = arg.split("=", 2);
      const flag = flagRaw ?? "";
      if (secretFlags.has(flag)) {
        if (value !== undefined) {
          redactedArgs.push(`${flag}=******`);
        } else {
          redactedArgs.push(flag);
          const next = argsList[i + 1];
          if (typeof next === "string") {
            redactedArgs.push("******");
            i += 1;
          }
        }
        continue;
      }
      redactedArgs.push(arg);
    }
    const args = redactedArgs.join(" ");
    return [type, command, args].filter(Boolean).join(" ");
  }
  const url = typeof config.url === "string" ? config.url : "";
  return [type, url].filter(Boolean).join(" · ");
}

function toArgLines(config: MCPServerConfig): string {
  return Array.isArray(config.args) ? config.args.join("\n") : "";
}

function ensureUniqueKey(desired: string, existing: Set<string>): string {
  const base = normalizeServerKey(desired);
  if (!existing.has(base)) return base;
  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${base}-${i}`;
    if (!existing.has(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}

function serverDisplayName(serverName: string, config: MCPServerConfig): string {
  const meta = config.meta;
  if (meta && typeof meta.display_name === "string" && meta.display_name.trim()) {
    return meta.display_name.trim();
  }
  return serverName;
}

function commandBasename(command: string): string {
  const raw = String(command ?? "").trim();
  if (!raw) return "";
  const parts = raw.split(/[/\\]/);
  return parts[parts.length - 1] ?? raw;
}

function normalizeNpmPackageSpec(spec: string): string {
  const raw = String(spec ?? "").trim();
  if (!raw) return "";
  if (raw.startsWith("@")) {
    // scoped: @scope/name or @scope/name@version
    const idx = raw.lastIndexOf("@");
    if (idx > 0) {
      return raw.slice(0, idx);
    }
    return raw;
  }
  // unscoped: name or name@version
  const idx = raw.indexOf("@");
  if (idx > 0) {
    return raw.slice(0, idx);
  }
  return raw;
}

function looksLikeNpmPackageSpec(spec: string): boolean {
  const raw = String(spec ?? "").trim();
  if (!raw) return false;
  if (raw.startsWith("-")) return false;
  // heuristic: package names usually contain letters/numbers and may contain "/" (scoped packages)
  return /[a-z0-9]/i.test(raw);
}

function argsPrefixMatches(prefix: string[], args: string[]): boolean {
  if (prefix.length === 0) return true;
  if (args.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i += 1) {
    const expected = String(prefix[i] ?? "");
    const actual = String(args[i] ?? "");
    if (expected === actual) continue;
    if (looksLikeNpmPackageSpec(expected) && looksLikeNpmPackageSpec(actual)) {
      // Allow version differences like "@pkg/name@latest" vs "@pkg/name".
      if (normalizeNpmPackageSpec(expected) === normalizeNpmPackageSpec(actual)) continue;
    }
    return false;
  }
  return true;
}

function configMatchesFingerprint(config: MCPServerConfig, fp: MCPMarketplaceInstallFingerprint): boolean {
  const type = typeof config.type === "string" ? config.type : "stdio";
  if (fp.transport !== type) return false;

  if (fp.transport === "stdio") {
    const cmd = typeof config.command === "string" ? config.command.trim() : "";
    const fpCmd = fp.command.trim();
    if (!cmd || !fpCmd) return false;
    const base = commandBasename(cmd);
    if (!(cmd === fpCmd || base === fpCmd || base === `${fpCmd}.cmd` || base === `${fpCmd}.exe`)) {
      return false;
    }
    const args = Array.isArray(config.args) ? config.args : [];
    return argsPrefixMatches(fp.args_prefix ?? [], args);
  }

  const url = typeof config.url === "string" ? config.url.trim() : "";
  return url !== "" && url === fp.url.trim();
}

function MarketplaceBadges({ item, copy }: { item: MCPMarketplaceServerListItem; copy: typeof FALLBACK_COPY }) {
  return (
    <>
      {item.verified ? (
        <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600">
          <CheckCircle2Icon className="size-3.5" />
          {copy.verified}
        </span>
      ) : null}
      {item.featured ? (
        <span className="inline-flex items-center gap-1 text-[11px] text-amber-600">
          <SparklesIcon className="size-3.5" />
          {copy.featured}
        </span>
      ) : null}
    </>
  );
}

function MarketplaceDetailDialog({
  open,
  serverId,
  onOpenChange,
  onInstall,
  copy,
  installed,
}: {
  open: boolean;
  serverId: string | null;
  onOpenChange: (open: boolean) => void;
  onInstall: (serverId: string) => void;
  copy: typeof FALLBACK_COPY;
  installed: boolean;
}) {
  const { data: detail, isLoading } = useMcpMarketplaceServerDetail(open ? serverId : null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[75vh] max-h-[calc(100vh-2rem)] flex-col sm:max-w-3xl"
        aria-describedby={undefined}
      >
        <DialogHeader className="gap-1">
          <DialogTitle>{copy.details}</DialogTitle>
        </DialogHeader>
        <ScrollArea className="min-h-0 flex-1">
          {isLoading ? (
            <div className="text-muted-foreground pr-1 text-sm">{copy.statusTesting}</div>
          ) : detail ? (
            <div className="space-y-3 pr-1">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="truncate text-base font-semibold">{detail.name}</div>
                    <span className="text-muted-foreground text-xs">v{detail.version}</span>
                    <MarketplaceBadges item={{ ...detail, detailUrl: "" }} copy={copy} />
                  </div>
                  <div className="text-muted-foreground text-xs">
                    {[detail.author, detail.category].filter(Boolean).join(" · ") || "-"}
                  </div>
                  <div className="text-muted-foreground mt-1 text-sm">{detail.description}</div>
                </div>
                <div className="flex items-center gap-2">
                  {detail.docsUrl ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => window.open(detail.docsUrl ?? "", "_blank", "noopener,noreferrer")}
                    >
                      <ExternalLinkIcon className="size-4" />
                      {copy.viewDocs}
                    </Button>
                  ) : null}
                  <Button size="sm" onClick={() => onInstall(detail.id)} disabled={installed}>
                    {installed ? copy.installedAction : copy.install}
                  </Button>
                </div>
              </div>

              {detail.demoImageUrls.length > 0 ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  {detail.demoImageUrls.map((url) => (
                    <img
                      key={url}
                      src={url}
                      alt={detail.name}
                      className="h-auto w-full rounded border"
                    />
                  ))}
                </div>
              ) : null}

              <article className="prose prose-sm max-w-none dark:prose-invert">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {detail.readmeMarkdown}
                </ReactMarkdown>
              </article>
            </div>
          ) : (
            <div className="text-muted-foreground pr-1 text-sm">{copy.loadFailed}</div>
          )}
        </ScrollArea>
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>
            {copy.close}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function InstallInputField({
  input,
  value,
  onChange,
  disabled,
}: {
  input: MCPMarketplaceInstallInput;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled: boolean;
}) {
  const label = (
    <div className="text-xs font-medium">
      {input.label}
      {input.required ? <span className="text-rose-600"> *</span> : null}
    </div>
  );

  if (input.type === "boolean") {
    return (
      <label className="flex items-center justify-between gap-3 rounded-md border p-3">
        <div className="min-w-0">
          {label}
          {input.help ? <div className="text-muted-foreground mt-1 text-xs">{input.help}</div> : null}
        </div>
        <Switch checked={Boolean(value)} onCheckedChange={(checked) => onChange(checked)} disabled={disabled} />
      </label>
    );
  }

  if (input.type === "select") {
    return (
      <div className="space-y-1.5">
        {label}
        <Select
          value={typeof value === "string" ? value : String(input.default ?? "")}
          onValueChange={(next) => onChange(next)}
        >
          <SelectTrigger disabled={disabled}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(input.options ?? []).map((opt) => (
              <SelectItem key={opt} value={opt}>
                {opt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {input.help ? <div className="text-muted-foreground text-xs">{input.help}</div> : null}
      </div>
    );
  }

  const stringValue =
    value === undefined || value === null
      ? ""
      : typeof value === "string" || typeof value === "number" || typeof value === "boolean"
        ? String(value)
        : "";

  const inputType = input.type === "number" ? "number" : input.type === "secret" ? "password" : "text";
  return (
    <div className="space-y-1.5">
      {label}
      <Input
        type={inputType}
        value={stringValue}
        placeholder={input.placeholder}
        onChange={(e) => {
          const raw = e.target.value;
          if (input.type === "number") {
            const num = Number(raw);
            onChange(Number.isFinite(num) ? num : raw);
            return;
          }
          onChange(raw);
        }}
        disabled={disabled}
      />
      {input.help ? <div className="text-muted-foreground text-xs">{input.help}</div> : null}
    </div>
  );
}

function InstallMcpServerDialog({
  open,
  serverId,
  existingKeys,
  dirty,
  onInstall,
  onOpenChange,
  copy,
  disabled,
}: {
  open: boolean;
  serverId: string | null;
  existingKeys: Set<string>;
  dirty: boolean;
  onInstall: (payload: { serverKey: string; config: MCPServerConfig }) => Promise<void>;
  onOpenChange: (open: boolean) => void;
  copy: typeof FALLBACK_COPY;
  disabled: boolean;
}) {
  const { data: detail, isLoading } = useMcpMarketplaceServerDetail(open ? serverId : null);
  const [optionId, setOptionId] = useState<string>("");
  const [serverKey, setServerKey] = useState<string>("");
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [commandOverrides, setCommandOverrides] = useState<Record<string, string>>({});
  const ensureNodeMutation = useEnsureNodeToolchain();
  const [installing, setInstalling] = useState(false);
  const [confirmPayload, setConfirmPayload] = useState<{ serverKey: string; config: MCPServerConfig } | null>(null);

  useEffect(() => {
    if (!detail) return;
    const first = detail.installOptions[0]?.id ?? "";
    setOptionId(first);
    setServerKey(normalizeServerKey(detail.id));
    const defaults: Record<string, unknown> = {};
    for (const input of detail.installOptions.find((opt) => opt.id === first)?.inputs ?? []) {
      if (input.default !== undefined) {
        defaults[input.id] = input.default;
      }
    }
    setValues(defaults);
  }, [detail]);

  const option: MCPMarketplaceInstallOption | undefined = useMemo(() => {
    if (!detail) return undefined;
    return detail.installOptions.find((item) => item.id === optionId);
  }, [detail, optionId]);

  const prereqCommands = useMemo(() => option?.prerequisites ?? [], [option]);
  const prereqQuery = useMcpPrerequisites(prereqCommands, open && Boolean(option));
  const prereqStatuses = prereqQuery.data?.commands ?? {};
  const missingPrereqs = prereqCommands.filter((item) => prereqStatuses[item]?.available === false);
  const missingNodeToolchain = missingPrereqs.includes("node") || missingPrereqs.includes("npx");
  const installBlocked = (prereqCommands.length > 0 && prereqQuery.isLoading) || missingPrereqs.length > 0;

  useEffect(() => {
    if (!detail || !option) return;
    const defaults: Record<string, unknown> = {};
    for (const input of option.inputs ?? []) {
      if (input.default !== undefined) {
        defaults[input.id] = input.default;
      }
    }
    setValues(defaults);
  }, [detail, option]);

  useEffect(() => {
    if (!open) {
      setConfirmPayload(null);
      setInstalling(false);
    }
  }, [open]);

  const handleInstall = async () => {
    if (!detail || !option) return;
    const desiredKey = normalizeServerKey(serverKey || detail.id);
    const safeKey = ensureUniqueKey(desiredKey, existingKeys);
    try {
      const built = applyMarketplaceInstallOption({
        detail: detail,
        optionId: option.id,
        values,
        serverKey: safeKey,
      });
      // If user installed a managed node toolchain, prefer an absolute `npx` path so MCP can run
      // even when shell PATH isn't updated.
      if (
        built.config.type === "stdio"
        && typeof built.config.command === "string"
        && built.config.command.trim() === "npx"
      ) {
        const override = commandOverrides.npx;
        if (override?.trim()) {
          built.config.command = override.trim();
        }
      }
      if (safeKey !== desiredKey) {
        toast.message(`服务器标识已存在，已自动改名为 ${safeKey}`);
      }
      const payload = { serverKey: built.serverKey, config: built.config };
      if (dirty) {
        setConfirmPayload(payload);
        return;
      }
      setInstalling(true);
      await onInstall(payload);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "安装失败");
    } finally {
      setInstalling(false);
    }
  };

  const handleConfirmInstall = async () => {
    if (!confirmPayload) return;
    setInstalling(true);
    try {
      await onInstall(confirmPayload);
      setConfirmPayload(null);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "安装失败");
    } finally {
      setInstalling(false);
    }
  };

  const handleCancel = () => {
    if (confirmPayload) {
      setConfirmPayload(null);
      return;
    }
    onOpenChange(false);
  };

  const handleEnsureNodeToolchain = async () => {
    try {
      const result = await ensureNodeMutation.mutateAsync();
      toast.success(result.message || "Node 工具链已就绪");
      const npxPath = result.commands?.npx?.path;
      if (typeof npxPath === "string" && npxPath.trim()) {
        setCommandOverrides((prev) => ({ ...prev, npx: npxPath.trim() }));
      }
      await prereqQuery.refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "依赖安装失败");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[75vh] max-h-[calc(100vh-2rem)] flex-col sm:max-w-2xl"
        aria-describedby={undefined}
      >
        <DialogHeader className="gap-1">
          <DialogTitle>{copy.installDialogTitle}</DialogTitle>
        </DialogHeader>
        <ScrollArea className="min-h-0 flex-1">
          {isLoading ? (
            <div className="text-muted-foreground pr-1 text-sm">{copy.statusTesting}</div>
          ) : detail ? (
            <div className="space-y-4 pr-1">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="truncate text-base font-semibold">{detail.name}</div>
                    <MarketplaceBadges item={{ ...detail, detailUrl: "" }} copy={copy} />
                  </div>
                  <div className="text-muted-foreground text-xs">
                    {[detail.author, detail.category].filter(Boolean).join(" · ") || "-"}
                  </div>
                  <div className="text-muted-foreground mt-1 text-sm">{detail.description}</div>
                </div>
                {detail.docsUrl ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => window.open(detail.docsUrl ?? "", "_blank", "noopener,noreferrer")}
                  >
                    <ExternalLinkIcon className="size-4" />
                    {copy.viewDocs}
                  </Button>
                ) : null}
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1.5 md:col-span-2">
                  <div className="text-xs font-medium">{copy.serverKeyFromMarketplace}</div>
                  <Input
                    value={serverKey}
                    onChange={(e) => setServerKey(e.target.value)}
                    disabled={disabled}
                  />
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <div className="text-xs font-medium">{copy.installMethod}</div>
                  <Select
                    value={optionId}
                    onValueChange={(value) => setOptionId(value)}
                  >
                    <SelectTrigger disabled={disabled}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {detail.installOptions.map((opt) => (
                        <SelectItem key={opt.id} value={opt.id}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {option && option.prerequisites.length > 0 ? (
                <div className="space-y-2">
                  <div className="text-xs font-medium">{copy.prerequisites}</div>
                  <div className="flex flex-wrap gap-1">
                    {option.prerequisites.map((item) => (
                      <span
                        key={item}
                        className={`inline-flex rounded px-2 py-0.5 text-xs ${
                          prereqStatuses[item]?.available === false
                            ? "bg-rose-50 text-rose-700"
                            : prereqStatuses[item]?.available === true
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-muted text-foreground"
                        }`}
                      >
                        {item}
                      </span>
                    ))}
                  </div>
                  {missingPrereqs.map((item) => (
                    <div key={`missing-${item}`} className="text-rose-600 text-xs">
                      {copy.prerequisitesMissing.replaceAll("{name}", item)}
                    </div>
                  ))}
                  {missingNodeToolchain ? (
                    <div className="pt-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void handleEnsureNodeToolchain()}
                        disabled={disabled || ensureNodeMutation.isPending}
                      >
                        {ensureNodeMutation.isPending ? (
                          <Loader2Icon className="size-4 animate-spin" />
                        ) : (
                          <ArrowDownToLineIcon className="size-4" />
                        )}
                        {ensureNodeMutation.isPending ? copy.installingPrereqs : copy.installNodeToolchain}
                      </Button>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {option && option.inputs.length > 0 ? (
                <div className="space-y-2">
                  <div className="text-xs font-medium">{copy.inputs}</div>
                  <div className="grid gap-3 md:grid-cols-2">
                    {option.inputs.map((input) => (
                      <InstallInputField
                        key={input.id}
                        input={input}
                        value={values[input.id]}
                        disabled={disabled}
                        onChange={(next) =>
                          setValues((prev) => ({ ...prev, [input.id]: next }))
                        }
                      />
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="text-muted-foreground pr-1 text-sm">{copy.loadFailed}</div>
          )}
        </ScrollArea>

        {confirmPayload ? (
          <div className="bg-amber-50 text-amber-800 rounded-md border border-amber-200 p-3 text-xs">
            <div className="font-medium">{copy.installConfirmTitle}</div>
            <div className="mt-1">{copy.installConfirmDescription}</div>
          </div>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={handleCancel}>
            {copy.cancelAction}
          </Button>
          {confirmPayload ? (
            <Button
              size="sm"
              onClick={() => void handleConfirmInstall()}
              disabled={disabled || installing || !detail || !option || installBlocked}
            >
              {installing ? copy.installing : copy.installConfirmAction}
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => void handleInstall()}
              disabled={disabled || installing || !detail || !option || installBlocked}
            >
              {installing ? copy.installing : copy.install}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function McpServerEditorDialog({
  open,
  mode,
  initialKey,
  initialConfig,
  existingKeys,
  onOpenChange,
  onSubmit,
  copy,
  disabled,
}: {
  open: boolean;
  mode: "add" | "edit";
  initialKey: string;
  initialConfig: MCPServerConfig | null;
  existingKeys: Set<string>;
  onOpenChange: (open: boolean) => void;
  onSubmit: (nextKey: string, nextConfig: MCPServerConfig) => void;
  copy: typeof FALLBACK_COPY;
  disabled: boolean;
}) {
  const [serverKey, setServerKey] = useState<string>(initialKey);
  const [displayName, setDisplayName] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [type, setType] = useState<MCPServerType>("stdio");
  const [command, setCommand] = useState<string>("");
  const [argsText, setArgsText] = useState<string>("");
  const [url, setUrl] = useState<string>("");
  const [envText, setEnvText] = useState<string>("");
  const [headersText, setHeadersText] = useState<string>("");
  const [oauthText, setOauthText] = useState<string>("");
  const [enabled, setEnabled] = useState<boolean>(true);

  useEffect(() => {
    if (!open) return;
    setServerKey(initialKey);
    setEnabled(Boolean(initialConfig?.enabled ?? true));
    setDescription(String(initialConfig?.description ?? ""));
    setDisplayName(String(initialConfig?.meta?.display_name ?? ""));
    const effectiveType = (typeof initialConfig?.type === "string" ? initialConfig.type : "stdio") as MCPServerType;
    setType(effectiveType);
    setCommand(String(initialConfig?.command ?? ""));
    setArgsText(initialConfig ? toArgLines(initialConfig) : "");
    setUrl(String(initialConfig?.url ?? ""));
    const envMap = initialConfig?.env ?? {};
    setEnvText(Object.entries(envMap).map(([k, v]) => `${k}=${v}`).join("\n"));
    const headersMap = initialConfig?.headers ?? {};
    setHeadersText(Object.entries(headersMap).map(([k, v]) => `${k}=${v}`).join("\n"));
    setOauthText(initialConfig?.oauth ? JSON.stringify(initialConfig.oauth, null, 2) : "");
  }, [open, initialKey, initialConfig]);

  const handleClipboardImport = async () => {
    try {
      const raw = await navigator.clipboard.readText();
      const result = parseMcpClipboardImport(raw);
      const entries = Object.entries(result.imported);
      if (entries.length === 0) {
        toast.error("剪贴板内容未包含可导入的 MCP 配置");
        return;
      }
      if (entries.length > 1) {
        toast.message("检测到多个 MCP 配置条目，请逐个导入或粘贴到配置文件中处理。");
        return;
      }
      const firstEntry = entries[0];
      if (!firstEntry) {
        toast.error("剪贴板内容未包含可导入的 MCP 配置");
        return;
      }
      const [key, cfg] = firstEntry;
      setServerKey(key);
      setEnabled(Boolean(cfg.enabled ?? true));
      setDescription(String(cfg.description ?? ""));
      setDisplayName(String(cfg.meta?.display_name ?? ""));
      const effectiveType = (typeof cfg.type === "string" ? cfg.type : "stdio") as MCPServerType;
      setType(effectiveType);
      setCommand(String(cfg.command ?? ""));
      setArgsText(Array.isArray(cfg.args) ? cfg.args.join("\n") : "");
      setUrl(String(cfg.url ?? ""));
      setEnvText(
        Object.entries(cfg.env ?? {})
          .map(([k, v]) => {
            const value =
              typeof v === "string" || typeof v === "number" || typeof v === "boolean"
                ? String(v)
                : "";
            return `${k}=${value}`;
          })
          .join("\n"),
      );
      setHeadersText(
        Object.entries(cfg.headers ?? {})
          .map(([k, v]) => {
            const value =
              typeof v === "string" || typeof v === "number" || typeof v === "boolean"
                ? String(v)
                : "";
            return `${k}=${value}`;
          })
          .join("\n"),
      );
      setOauthText(cfg.oauth ? JSON.stringify(cfg.oauth, null, 2) : "");
      toast.success("已从剪贴板导入配置");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "剪贴板导入失败");
    }
  };

  const handleSubmit = () => {
    const normalizedKey = normalizeServerKey(serverKey);
    const keyCollision = mode === "add"
      ? existingKeys.has(normalizedKey)
      : normalizedKey !== initialKey && existingKeys.has(normalizedKey);
    if (!normalizedKey || keyCollision) {
      toast.error("服务器标识为空或已存在");
      return;
    }

    const args = type === "stdio"
      ? argsText
        .split(/\r?\n/)
        .map((item) => item.trim())
        .filter(Boolean)
      : [];
    const env = parseKeyValueText(envText);
    const headers = parseKeyValueText(headersText);

    let oauth: MCPServerConfig["oauth"] | undefined;
    const oauthRaw = oauthText.trim();
    if (oauthRaw) {
      try {
        oauth = JSON.parse(oauthRaw) as MCPServerConfig["oauth"];
      } catch {
        toast.error("OAuth JSON 解析失败");
        return;
      }
    }

    const now = new Date().toISOString();
    const base = initialConfig ? deepClone(initialConfig) : ({} as MCPServerConfig);
    const baseMeta = base.meta ?? {};
    const next: MCPServerConfig = {
      ...base,
      enabled,
      description: description.trim(),
      type,
      command: type === "stdio" ? command.trim() : undefined,
      args,
      url: type === "stdio" ? undefined : url.trim(),
      env,
      headers,
      oauth,
      meta: {
        ...baseMeta,
        origin: baseMeta.origin === "marketplace" || baseMeta.origin === "custom"
          ? baseMeta.origin
          : "custom",
        display_name: displayName.trim() || undefined,
        created_at: typeof baseMeta.created_at === "string" ? baseMeta.created_at : now,
        updated_at: now,
      },
    };

    onSubmit(normalizedKey, next);
    onOpenChange(false);
  };

  const title = mode === "add" ? copy.editorAddTitle : copy.editorEditTitle;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[60vh] max-h-[calc(100vh-2rem)] flex-col sm:max-w-2xl"
        aria-describedby={undefined}
      >
        <DialogHeader className="gap-1">
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-4 pr-1">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs text-muted-foreground">
                {copy.serverKey} / {copy.transportType}
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void handleClipboardImport()}
                disabled={disabled}
              >
                {copy.clipboardImport}
              </Button>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <div className="text-xs font-medium">{copy.serverKey}</div>
                <Input
                  value={serverKey}
                  placeholder={copy.serverKeyPlaceholder}
                  onChange={(e) => setServerKey(e.target.value)}
                  disabled={disabled || mode === "edit"}
                />
              </div>
              <div className="space-y-1.5">
                <div className="text-xs font-medium">{copy.displayName}</div>
                <Input
                  value={displayName}
                  placeholder={copy.displayNamePlaceholder}
                  onChange={(e) => setDisplayName(e.target.value)}
                  disabled={disabled}
                />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <div className="text-xs font-medium">{copy.descriptionLabel}</div>
                <Input
                  value={description}
                  placeholder={copy.descriptionPlaceholder}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={disabled}
                />
              </div>

              <div className="space-y-1.5">
                <div className="text-xs font-medium">{copy.transportType}</div>
                <Select
                  value={type}
                  onValueChange={(value) => setType(value as MCPServerType)}
                >
                  <SelectTrigger disabled={disabled}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="stdio">{copy.stdio}</SelectItem>
                    <SelectItem value="http">{copy.http}</SelectItem>
                    <SelectItem value="sse">{copy.sse}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <label className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
                <div className="text-xs font-medium">{copy.enabled}</div>
                <Switch checked={enabled} onCheckedChange={setEnabled} disabled={disabled} />
              </label>

              {type === "stdio" ? (
                <>
                  <div className="space-y-1.5 md:col-span-2">
                    <div className="text-xs font-medium">{copy.command}</div>
                    <Input
                      value={command}
                      placeholder={copy.commandPlaceholder}
                      onChange={(e) => setCommand(e.target.value)}
                      disabled={disabled}
                    />
                  </div>
                  <div className="space-y-1.5 md:col-span-2">
                    <div className="text-xs font-medium">{copy.args}</div>
                    <Textarea
                      value={argsText}
                      onChange={(e) => setArgsText(e.target.value)}
                      disabled={disabled}
                      className="min-h-24"
                    />
                  </div>
                </>
              ) : (
                <div className="space-y-1.5 md:col-span-2">
                  <div className="text-xs font-medium">{copy.url}</div>
                  <Input
                    value={url}
                    placeholder={copy.urlPlaceholder}
                    onChange={(e) => setUrl(e.target.value)}
                    disabled={disabled}
                  />
                </div>
              )}

              <div className="space-y-1.5 md:col-span-2">
                <div className="text-xs font-medium">{copy.env}</div>
                <Textarea
                  value={envText}
                  onChange={(e) => setEnvText(e.target.value)}
                  disabled={disabled}
                  className="min-h-24 font-mono text-xs"
                />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <div className="text-xs font-medium">{copy.headers}</div>
                <Textarea
                  value={headersText}
                  onChange={(e) => setHeadersText(e.target.value)}
                  disabled={disabled}
                  className="min-h-24 font-mono text-xs"
                />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <div className="text-xs font-medium">{copy.oauthJson}</div>
                <Textarea
                  value={oauthText}
                  onChange={(e) => setOauthText(e.target.value)}
                  disabled={disabled}
                  className="min-h-24 font-mono text-xs"
                />
              </div>
            </div>
          </div>
        </ScrollArea>

        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>
            {copy.cancelAction}
          </Button>
          <Button size="sm" onClick={handleSubmit} disabled={disabled}>
            {mode === "add" ? copy.createAction : copy.saveAction}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function InstalledServerItem({
  name,
  config,
  storedConfig,
  dirty,
  disabled,
  onToggle,
  onEdit,
  onRemove,
  copy,
}: {
  name: string;
  config: MCPServerConfig;
  storedConfig: MCPServerConfig | undefined;
  dirty: boolean;
  disabled: boolean;
  onToggle: (name: string, enabled: boolean) => void;
  onEdit: (name: string) => void;
  onRemove: (name: string) => void;
  copy: typeof FALLBACK_COPY;
}) {
  const inSync = !dirty || stableStringify(config) === stableStringify(storedConfig ?? null);
  const probeEnabled = Boolean(config.enabled) && inSync && !disabled;
  const probeQuery = useMCPServerProbe(name, probeEnabled);
  const probe = probeQuery.data;
  const descriptionText = config.description?.trim() ?? "";
  const probeErrorMessage = probeQuery.error instanceof Error ? probeQuery.error.message : "";

  const handleCopyDiagnostics = async () => {
    try {
      const debug = await getMcpDebugInfo();
      const payload = {
        server: name,
        probe_error: probeErrorMessage,
        debug,
      };
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      toast.success(copy.diagnosticsCopied);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : copy.diagnosticsCopyFailed);
    }
  };

  const statusNode = !config.enabled ? (
    <span className="text-muted-foreground text-xs">{copy.statusDisabled}</span>
  ) : !inSync ? (
    <span className="text-amber-700 text-xs">{copy.statusPending}</span>
  ) : probeQuery.isLoading ? (
    <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
      <Loader2Icon className="size-3.5 animate-spin" />
      {copy.statusTesting}
    </span>
  ) : probeQuery.isError ? (
    <span className="text-rose-600 text-xs">{copy.statusFailed}</span>
  ) : probe ? (
    probe.success ? (
      <span className="text-emerald-700 text-xs">
        {copy.statusConnected} ({probe.tool_count})
      </span>
    ) : (
      <span className="text-rose-600 text-xs">
        {copy.statusFailed}: {probe.message}
      </span>
    )
  ) : null;

  return (
    <div className="rounded-md border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="truncate text-sm font-medium">{serverDisplayName(name, config)}</div>
            <span className="text-muted-foreground truncate text-xs">{statusNode}</span>
          </div>
          <div className="text-muted-foreground truncate text-xs">
            {descriptionText ? descriptionText : "-"}
          </div>
          <div className="text-muted-foreground truncate text-xs">
            {summarizeConfig(config) || "-"}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Switch
            checked={Boolean(config.enabled)}
            onCheckedChange={(checked) => onToggle(name, checked)}
            disabled={disabled}
          />
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={() => onEdit(name)}
            disabled={disabled}
            aria-label={copy.edit}
          >
            <PencilIcon className="size-4" />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={() => onRemove(name)}
            disabled={disabled}
            aria-label={copy.remove}
          >
            <Trash2Icon className="size-4" />
          </Button>
        </div>
      </div>

      {config.enabled && inSync ? (
        <div className="mt-3 space-y-2 border-t pt-3">
          {probeQuery.isError ? (
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <div className="text-rose-600 text-xs">{copy.statusFailed}</div>
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-xs"
                    onClick={() => {
                      void probeQuery.refetch();
                    }}
                  >
                    <RefreshCwIcon className="size-3.5" />
                    {copy.retry}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-xs"
                    onClick={() => {
                      void handleCopyDiagnostics();
                    }}
                  >
                    {copy.copyDiagnostics}
                  </Button>
                </div>
              </div>
              {probeErrorMessage ? (
                <div className="text-rose-600 text-xs">{probeErrorMessage}</div>
              ) : null}
            </div>
          ) : probe?.success && probe.tools.length > 0 ? (
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
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function MCPServersPage() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const settingsLike = t.settings as unknown as {
    mcpServersPage?: Partial<typeof FALLBACK_COPY>;
  };
  const copy: typeof FALLBACK_COPY = {
    ...FALLBACK_COPY,
    ...(settingsLike.mcpServersPage ?? {}),
  };

  const { config: mcpConfig, isLoading: mcpLoading, error: mcpError } = useMCPConfig();
  const updateMutation = useUpdateMCPConfig();
  const {
    data: marketplaceServers,
    isLoading: marketplaceLoading,
    error: marketplaceError,
    refetch: refetchMarketplace,
  } = useMcpMarketplaceServers();

  const storedServers = useMemo(
    () => mcpConfig?.mcp_servers ?? {},
    [mcpConfig?.mcp_servers],
  );
  const [draftServers, setDraftServers] = useState<Record<string, MCPServerConfig>>({});
  const [activeTab, setActiveTab] = useState<TabKey>("marketplace");
  const [search, setSearch] = useState<string>("");
  const [category, setCategory] = useState<string>("all");

  const [installingServerId, setInstallingServerId] = useState<string | null>(null);
  const [detailServerId, setDetailServerId] = useState<string | null>(null);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<"add" | "edit">("add");
  const [editingKey, setEditingKey] = useState<string>("");

  const [pendingDeleteKey, setPendingDeleteKey] = useState<string | null>(null);

  useEffect(() => {
    if (!mcpConfig) return;
    setDraftServers(deepClone(storedServers));
  }, [mcpConfig, storedServers]);

  const dirty = useMemo(
    () => stableStringify(draftServers) !== stableStringify(storedServers),
    [draftServers, storedServers],
  );

  const disabled = updateMutation.isPending;

  const existingKeys = useMemo(() => new Set(Object.keys(draftServers)), [draftServers]);

  const categoryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const item of marketplaceServers ?? []) {
      if (item.category) set.add(item.category);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [marketplaceServers]);

  const installedMarketplaceIds = useMemo(() => {
    // Back-compat helper set: used by dialogs and non-catalog installs.
    const ids = new Set<string>();
    for (const [key, cfg] of Object.entries(storedServers)) {
      const marketplaceId = typeof cfg.meta?.marketplace_id === "string" ? cfg.meta.marketplace_id : "";
      if (marketplaceId) ids.add(marketplaceId);
      if (key) ids.add(key);
    }
    return ids;
  }, [storedServers]);

  const installedPublicIds = useMemo(() => {
    const installed = new Set<string>();
    const installedByMetaOrKey = installedMarketplaceIds;
    for (const item of marketplaceServers ?? []) {
      if (installedByMetaOrKey.has(item.id)) {
        installed.add(item.id);
        continue;
      }
      let matched = false;
      for (const [, cfg] of Object.entries(storedServers)) {
        if (matched) break;
        for (const fp of item.fingerprints ?? []) {
          if (configMatchesFingerprint(cfg, fp)) {
            matched = true;
            break;
          }
        }
      }
      if (matched) installed.add(item.id);
    }
    return installed;
  }, [installedMarketplaceIds, marketplaceServers, storedServers]);

  const filteredMarketplace = useMemo(() => {
    const q = search.trim().toLowerCase();
    const c = category.trim();
    return (marketplaceServers ?? [])
      .filter((item) => {
        if (c !== "all" && item.category !== c) return false;
        if (!q) return true;
        const hay = [
          item.id,
          item.name,
          item.description,
          item.author ?? "",
          item.category ?? "",
          ...(item.tags ?? []),
        ]
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [category, marketplaceServers, search]);

  const filteredInstalled = useMemo(() => {
    const q = search.trim().toLowerCase();
    return Object.entries(draftServers)
      .filter(([name, cfg]) => {
        if (!q) return true;
        const hay = [
          name,
          cfg.description ?? "",
          serverDisplayName(name, cfg),
          summarizeConfig(cfg),
        ]
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      })
      .sort(([a], [b]) => a.localeCompare(b));
  }, [draftServers, search]);

  const openAddEditor = () => {
    setEditorMode("add");
    setEditingKey("my-mcp-server");
    setEditorOpen(true);
  };

  const openEditEditor = (name: string) => {
    setEditorMode("edit");
    setEditingKey(name);
    setEditorOpen(true);
  };

  const handleUpsert = (nextKey: string, nextConfig: MCPServerConfig) => {
    setDraftServers((prev) => {
      const next = { ...prev };
      if (editorMode === "edit" && editingKey !== nextKey) {
        delete next[editingKey];
      }
      next[nextKey] = nextConfig;
      return next;
    });
  };

  const handleToggle = (name: string, enabled: boolean) => {
    setDraftServers((prev) => ({
      ...prev,
      [name]: { ...prev[name], enabled },
    }));
  };

  const handleRemove = (name: string) => {
    setDraftServers((prev) => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
  };

  const handleInstallFromMarketplace = async (payload: { serverKey: string; config: MCPServerConfig }) => {
    const prevServers = deepClone(draftServers);
    const nextServers: Record<string, MCPServerConfig> = {
      ...draftServers,
      [payload.serverKey]: payload.config,
    };
    setDraftServers(nextServers);
    try {
      const saved = await updateMutation.mutateAsync({ mcp_servers: nextServers } satisfies MCPConfig);
      queryClient.setQueryData(["mcpConfig"], saved);
      toast.success("已安装并保存 MCP 配置");
    } catch (err) {
      setDraftServers(prevServers);
      throw err instanceof Error ? err : new Error("保存失败");
    }
  };

  const handleSave = async () => {
    try {
      const saved = await updateMutation.mutateAsync({ mcp_servers: draftServers } satisfies MCPConfig);
      queryClient.setQueryData(["mcpConfig"], saved);
      toast.success("已保存 MCP 配置");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败");
    }
  };

  const handleDiscard = () => {
    setDraftServers(deepClone(storedServers));
  };

  const handleRefresh = async () => {
    if (activeTab === "marketplace") {
      await refetchMarketplace();
      return;
    }
    // Installed probe refresh: just re-render; probe hooks have staleTime 30s and can be retried per-item.
    toast.message("已刷新列表");
  };

  const topRight = dirty ? (
    <div className="text-amber-700 flex items-center gap-2 text-xs">
      <span className="bg-amber-500 size-2 rounded-full" />
      {copy.pendingChanges}
    </div>
  ) : null;

  return (
    <SettingsSection title={copy.title} description={copy.description}>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <Tabs defaultValue="marketplace" onValueChange={(value) => setActiveTab(value as TabKey)}>
            <TabsList variant="line">
              <TabsTrigger value="marketplace">{copy.marketplace}</TabsTrigger>
              <TabsTrigger value="installed">{copy.installed}</TabsTrigger>
            </TabsList>
          </Tabs>
          {topRight}
        </div>

        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-1 items-center gap-2">
            <Input
              value={search}
              placeholder={copy.searchPlaceholder}
              onChange={(e) => setSearch(e.target.value)}
            />
            {activeTab === "marketplace" ? (
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{copy.categoryAll}</SelectItem>
                  {categoryOptions.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            <Button
              size="icon-sm"
              variant="outline"
              onClick={() => void handleRefresh()}
              aria-label={copy.refresh}
            >
              <RefreshCwIcon className="size-4" />
            </Button>
          </div>
          {activeTab === "installed" ? (
            <Button size="sm" onClick={openAddEditor} disabled={disabled}>
              <PlusIcon className="size-4" />
              {copy.addServer}
            </Button>
          ) : null}
        </div>

        {activeTab === "marketplace" ? (
          <div className="space-y-2">
            {marketplaceLoading ? (
              <div className="text-muted-foreground text-sm">{t.common.loading}</div>
            ) : marketplaceError ? (
              <div className="text-rose-600 text-sm">
                {marketplaceError instanceof Error ? marketplaceError.message : copy.loadFailed}
              </div>
            ) : filteredMarketplace.length === 0 ? (
              <div className="text-muted-foreground text-sm">{copy.noMarketplace}</div>
            ) : (
              filteredMarketplace.map((item) => (
                <Item className="w-full" variant="outline" key={item.id}>
                  <ItemContent>
                    <ItemTitle>
                      <div className="flex items-center gap-2">
                        <span>{item.name}</span>
                        <span className="text-muted-foreground text-xs">v{item.version}</span>
                        <MarketplaceBadges item={item} copy={copy} />
                      </div>
                    </ItemTitle>
                    <ItemDescription className="line-clamp-3">
                      {item.description}
                    </ItemDescription>
                    <div className="text-muted-foreground mt-1 text-xs">
                      {[item.author, item.category].filter(Boolean).join(" · ") || "-"}
                    </div>
                    {item.tags.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {item.tags.map((tag) => (
                          <span
                            key={`${item.id}:${tag}`}
                            className="bg-muted inline-flex rounded px-1.5 py-0.5 text-[10px]"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </ItemContent>
                  <ItemActions>
                    <Button size="sm" variant="ghost" onClick={() => setDetailServerId(item.id)}>
                      {copy.details}
                    </Button>
                    {installedPublicIds.has(item.id) ? (
                      <Button size="sm" variant="outline" disabled>
                        {copy.installedAction}
                      </Button>
                    ) : (
                    <Button
                      size="sm"
                      onClick={() => setInstallingServerId(item.id)}
                      disabled={disabled}
                    >
                      {copy.install}
                    </Button>
                    )}
                  </ItemActions>
                </Item>
              ))
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {mcpLoading ? (
              <div className="text-muted-foreground text-sm">{t.common.loading}</div>
            ) : mcpError ? (
              <div className="text-rose-600 text-sm">
                {mcpError instanceof Error ? mcpError.message : copy.loadFailed}
              </div>
            ) : filteredInstalled.length === 0 ? (
              <div className="text-muted-foreground text-sm">暂无 MCP 服务器</div>
            ) : (
              filteredInstalled.map(([name, cfg]) => (
                <InstalledServerItem
                  key={name}
                  name={name}
                  config={cfg}
                  storedConfig={storedServers[name]}
                  dirty={dirty}
                  disabled={disabled}
                  copy={copy}
                  onToggle={handleToggle}
                  onEdit={openEditEditor}
                  onRemove={(serverName) => setPendingDeleteKey(serverName)}
                />
              ))
            )}
          </div>
        )}

        <ConfigSaveBar
          dirty={dirty}
          disabled={disabled}
          saving={updateMutation.isPending}
          onDiscard={handleDiscard}
          onSave={() => {
            void handleSave();
          }}
        />

        <InstallMcpServerDialog
          open={installingServerId !== null}
          serverId={installingServerId}
          existingKeys={existingKeys}
          dirty={dirty}
          onOpenChange={(open) => {
            if (!open) setInstallingServerId(null);
          }}
          onInstall={handleInstallFromMarketplace}
          copy={copy}
          disabled={disabled}
        />

        <MarketplaceDetailDialog
          open={detailServerId !== null}
          serverId={detailServerId}
          onOpenChange={(open) => {
            if (!open) setDetailServerId(null);
          }}
          onInstall={(id) => {
            setDetailServerId(null);
            setInstallingServerId(id);
          }}
          copy={copy}
          installed={detailServerId ? installedPublicIds.has(detailServerId) : false}
        />

        <McpServerEditorDialog
          open={editorOpen}
          mode={editorMode}
          initialKey={editingKey}
          initialConfig={editorMode === "edit" ? draftServers[editingKey] ?? null : null}
          existingKeys={existingKeys}
          onOpenChange={(open) => setEditorOpen(open)}
          onSubmit={handleUpsert}
          copy={copy}
          disabled={disabled}
        />

        <ConfirmActionDialog
          open={pendingDeleteKey !== null}
          onOpenChange={(open) => {
            if (!open) setPendingDeleteKey(null);
          }}
          title={copy.deleteConfirmTitle}
          description={copy.deleteConfirmDescription.replaceAll("{name}", pendingDeleteKey ?? "")}
          cancelText={copy.cancelAction}
          confirmText={copy.confirmDeleteAction}
          confirmDisabled={disabled}
          confirmVariant="destructive"
          onConfirm={() => {
            if (!pendingDeleteKey) return;
            handleRemove(pendingDeleteKey);
            setPendingDeleteKey(null);
          }}
        />
      </div>
    </SettingsSection>
  );
}
