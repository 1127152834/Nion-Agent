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
  SearchIcon,
  Trash2Icon,
  WrenchIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { subscribeCliInstallJobStatus } from "@/core/cli/api";
import {
  useCLIConfig,
  useCliDiscover,
  useCliMarketplaceToolDetail,
  useCliMarketplaceTools,
  useCliPrerequisites,
  useCliProbe,
  useEnsureCliPipxToolchain,
  useEnsureCliUvToolchain,
  useInstallCliTool,
  useStartCliInstallJob,
  useSetCliEnabled,
  useUninstallCliTool,
  useUpdateCLIConfig,
} from "@/core/cli/hooks";
import type { CLIMarketplaceInstallKind, CliSource, CLIInstallJobStatusResponse, CLIStateConfig } from "@/core/cli/types";
import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";

import { ConfirmActionDialog } from "./confirm-action-dialog";
import { SettingsSection } from "./settings-section";

type TabKey = "marketplace" | "installed";

const FALLBACK_COPY = {
  title: "CLI 工具",
  description: "启用仅影响 agent 是否可用，不会卸载或影响系统已有 CLI。",
  marketplace: "公共 CLI",
  installed: "我的 CLI",
  searchMarketplace: "搜索 CLI（名称、标签、描述）",
  categoryAll: "所有分类",
  refresh: "刷新",
  discoverImport: "发现/导入",
  details: "查看详情",
  install: "安装",
  installedAction: "已安装",
  installing: "安装中...",
  viewDocs: "查看文档",
  verified: "已验证",
  featured: "精选",
  appCli: "应用 CLI",
  systemCli: "系统 CLI",
  installKindHttp: "HTTP",
  installKindUv: "uv",
  installKindPipx: "pipx",
  noMarketplace: "暂无可用公共 CLI 条目。",
  loadFailed: "加载失败",
  // detail dialog
  prerequisites: "前置条件",
  prereqMissing: "缺少前置条件：{name}",
  ensureUv: "一键安装 uv",
  ensurePipx: "一键安装 pipx",
  ensureWorking: "正在安装依赖...",
  // my clis
  filterAll: "全部",
  filterApp: "应用 CLI",
  filterSystem: "系统 CLI",
  statusInstalled: "可用",
  statusMissing: "未找到",
  statusDisabled: "已禁用",
  edit: "编辑",
  remove: "移除",
  uninstall: "卸载",
  uninstallConfirmTitle: "确认卸载",
  uninstallConfirmDescription: "卸载 \"{name}\" 的应用版本？不会影响你系统中已有的同名 CLI。",
  uninstallKeepConfig: "保留配置（推荐）",
  uninstallRemoveConfig: "同时移除配置",
  // enable confirm
  enableConfirmTitle: "二次确认",
  enableConfirmDescription: "此 CLI 不是已验证的应用安装，启用后 agent 将可以执行它。确认启用？",
  // discover
  discoverTitle: "发现/导入 CLI",
  discoverWhitelist: "白名单发现",
  discoverFull: "全 PATH 扫描",
  discoverSearch: "搜索可执行文件名",
  importSystem: "导入系统版本",
  installAppRecommended: "安装应用版本（推荐）",
  importCandidateTitle: "导入为系统 CLI",
  toolId: "标识",
  execPath: "可执行路径",
  saveImport: "导入",
} as const;

function badgeForInstallKind(kind: CLIMarketplaceInstallKind | null | undefined): string {
  if (kind === "uv") return FALLBACK_COPY.installKindUv;
  if (kind === "pipx") return FALLBACK_COPY.installKindPipx;
  return FALLBACK_COPY.installKindHttp;
}

function isAppCli(source: CliSource): boolean {
  return source === "managed";
}

function sourceLabel(source: CliSource): string {
  return isAppCli(source) ? FALLBACK_COPY.appCli : FALLBACK_COPY.systemCli;
}

function normalizeToolId(value: string): string {
  return String(value ?? "").trim();
}

function filteredKeys(keys: string[], query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return keys;
  return keys.filter((key) => key.toLowerCase().includes(q));
}

function summarizeProbe(installed: boolean | undefined, message: string | undefined): string {
  if (installed) return FALLBACK_COPY.statusInstalled;
  const trimmed = message?.trim();
  if (trimmed) return trimmed;
  return FALLBACK_COPY.statusMissing;
}

function mergeCliConfig(
  base: Record<string, CLIStateConfig>,
  patch: Record<string, CLIStateConfig | null>,
): Record<string, CLIStateConfig> {
  const next = { ...(base ?? {}) };
  for (const [k, v] of Object.entries(patch ?? {})) {
    const key = normalizeToolId(k);
    if (!key) continue;
    if (v === null) {
      delete next[key];
      continue;
    }
    next[key] = v;
  }
  return next;
}

function toolMatchesSearch(tool: {
  id: string;
  name: string;
  description: string;
  tags: string[];
}, rawQuery: string): boolean {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return true;
  const hay = [
    tool.id,
    tool.name,
    tool.description,
    ...(tool.tags ?? []),
  ].join(" ").toLowerCase();
  return hay.includes(q);
}

function openExternal(url: string) {
  const u = String(url ?? "").trim();
  if (!u) return;
  window.open(u, "_blank", "noopener,noreferrer");
}

function MarketplaceDetailDialog({
  open,
  onOpenChange,
  toolId,
  installKind,
  installed,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  toolId: string | null;
  installKind: CLIMarketplaceInstallKind | null;
  installed: boolean;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const { data: detail, isLoading, error } = useCliMarketplaceToolDetail(open ? toolId : null);
  const startJobMutation = useStartCliInstallJob();
  const [installJobId, setInstallJobId] = useState<string | null>(null);
  const [installJobStatus, setInstallJobStatus] = useState<CLIInstallJobStatusResponse | null>(null);
  const prereqCommands = useMemo(() => {
    if (installKind === "uv") return ["uv"];
    if (installKind === "pipx") return ["pipx"];
    return [];
  }, [installKind]);
  const prereqQuery = useCliPrerequisites(prereqCommands, open && prereqCommands.length > 0);
  const ensureUv = useEnsureCliUvToolchain();
  const ensurePipx = useEnsureCliPipxToolchain();

  const prereqsMissing = useMemo(() => {
    if (!prereqCommands.length) return [];
    const statuses = prereqQuery.data?.commands ?? {};
    return prereqCommands.filter((cmd) => !statuses[cmd]?.available);
  }, [prereqCommands, prereqQuery.data?.commands]);

  const ensureWorking = ensureUv.isPending || ensurePipx.isPending;
  const jobStatus = installJobStatus?.status;
  const jobRunning = startJobMutation.isPending
    || (Boolean(installJobId) && jobStatus !== "succeeded" && jobStatus !== "failed");
  const installWorking = jobRunning;
  const installDisabled = installed || installWorking || ensureWorking || prereqsMissing.length > 0;

  const lastLogLine = installJobStatus?.lastLogLine ?? "";
  const showLogLine = Boolean(installJobId);
  const normalizedLastLogLine = lastLogLine.trim() ? lastLogLine : null;
  const jobMessage = installJobStatus?.message ?? null;
  const normalizedJobMessage = typeof jobMessage === "string" && jobMessage.trim() ? jobMessage : null;
  const fallbackLogText = installWorking ? "安装中..." : "";
  const logKey = normalizedLastLogLine ?? jobStatus ?? "log";
  const logTitle = normalizedLastLogLine ?? normalizedJobMessage ?? "";
  const logText = normalizedLastLogLine ?? normalizedJobMessage ?? fallbackLogText;

  // When the dialog is closed (or tool changes), reset install job UI state.
  useEffect(() => {
    if (!open) {
      setInstallJobId(null);
      setInstallJobStatus(null);
      return;
    }
    // Tool changed while dialog stays open, clear previous job state.
    setInstallJobId(null);
    setInstallJobStatus(null);
  }, [open, toolId]);

  useEffect(() => {
    if (!open || !installJobId) {
      return;
    }
    let disposed = false;
    const unsubscribe = subscribeCliInstallJobStatus(
      installJobId,
      (snapshot) => {
        if (disposed) return;
        setInstallJobStatus(snapshot);
      },
    );
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [open, installJobId]);

  // Handle job completion once.
  useEffect(() => {
    const status = installJobStatus?.status;
    if (!status) return;
    if (status === "succeeded") {
      const enabled = Boolean(installJobStatus?.result?.enabled);
      const doneToolId = installJobStatus?.toolId ?? toolId;
      toast.success(
        enabled
          ? `已安装并自动启用：${doneToolId}`
          : `已安装：${doneToolId}（默认未启用）`,
      );
      void queryClient.invalidateQueries({ queryKey: ["cliConfig"] });
      void queryClient.invalidateQueries({ queryKey: ["cliMarketplace"] });
      setInstallJobId(null);
      setInstallJobStatus(null);
      onOpenChange(false);
      return;
    }
    if (status === "failed") {
      toast.error(installJobStatus?.message ?? "安装失败");
    }
  }, [installJobStatus?.status, installJobStatus?.message, installJobStatus?.result, installJobStatus?.toolId, toolId, queryClient, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader className="gap-1">
          <DialogTitle>{detail?.name ?? toolId ?? FALLBACK_COPY.details}</DialogTitle>
          {detail?.description ? (
            <DialogDescription>{detail.description}</DialogDescription>
          ) : null}
        </DialogHeader>

        {isLoading ? (
          <div className="text-muted-foreground text-sm">{t.common.loading}</div>
        ) : error ? (
          <div className="text-destructive text-sm">
            {error instanceof Error ? error.message : FALLBACK_COPY.loadFailed}
          </div>
        ) : (
	          <div className="space-y-4">
	            <div className="flex flex-wrap items-center justify-between gap-2">
	              <div className="flex flex-wrap items-center gap-2">
                {detail?.verified ? <Badge variant="secondary">{FALLBACK_COPY.verified}</Badge> : null}
                {detail?.featured ? <Badge variant="outline">{FALLBACK_COPY.featured}</Badge> : null}
                <Badge variant="outline">{FALLBACK_COPY.appCli}</Badge>
                <Badge variant="outline">{badgeForInstallKind(installKind)}</Badge>
                <Badge variant="outline">{detail?.version ?? "0.0.0"}</Badge>
              </div>

	              <div className="flex items-center gap-2">
                {detail?.docsUrl ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => openExternal(detail.docsUrl ?? "")}
                  >
                    <ExternalLinkIcon className="size-4" />
                    {FALLBACK_COPY.viewDocs}
                  </Button>
                ) : null}

	                <Button
	                  type="button"
	                  size="sm"
	                  disabled={installDisabled}
	                  onClick={() => {
	                    if (!toolId) return;
	                    startJobMutation.mutate(toolId, {
	                      onSuccess: (resp) => {
	                        if (!resp.jobId) {
	                          toast.error(resp.message || "启动安装失败");
	                          return;
	                        }
                          setInstallJobStatus(null);
	                        setInstallJobId(resp.jobId);
	                      },
	                      onError: (e) => {
	                        toast.error(e instanceof Error ? e.message : "启动安装失败");
	                      },
	                    });
	                  }}
	                >
	                  {installWorking ? (
	                    <>
	                      <Loader2Icon className="size-4 animate-spin" />
	                      {FALLBACK_COPY.installing}
	                    </>
                  ) : installed ? (
                    <>
                      <CheckCircle2Icon className="size-4" />
                      {FALLBACK_COPY.installedAction}
                    </>
                  ) : (
                    <>
                      <ArrowDownToLineIcon className="size-4" />
                      {t.common.install ?? FALLBACK_COPY.install}
                    </>
                  )}
	                </Button>
	              </div>
	            </div>

            {showLogLine ? (
              <div
                className={cn(
                  "flex items-center gap-2 rounded-md border px-3 py-2 text-xs",
                  installJobStatus?.status === "failed"
                    ? "border-destructive/40 bg-destructive/5"
                    : "bg-muted/20",
                )}
              >
                {installWorking ? (
                  <Loader2Icon className="size-3 animate-spin text-muted-foreground" />
                ) : (
                  <CheckCircle2Icon className="size-3 text-muted-foreground" />
                )}
                <span
                  key={logKey}
                  className={cn(
                    "min-w-0 flex-1 font-mono text-muted-foreground line-clamp-1",
                    "animate-in fade-in-0 slide-in-from-top-2",
                  )}
                  title={logTitle}
                >
                  {logText}
                </span>
              </div>
            ) : null}

	            {prereqCommands.length > 0 ? (
              <section className="space-y-2 rounded-lg border bg-muted/20 p-3 text-sm">
                <div className="flex items-center gap-2 font-medium">
                  <WrenchIcon className="size-4" />
                  <span>{FALLBACK_COPY.prerequisites}</span>
                </div>

                {prereqQuery.isLoading ? (
                  <div className="text-muted-foreground text-sm">{t.common.loading}</div>
                ) : (
                  <div className="space-y-2">
                    {prereqCommands.map((cmd) => {
                      const status = prereqQuery.data?.commands?.[cmd];
                      return (
                        <div key={cmd} className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <Badge variant={status?.available ? "secondary" : "destructive"}>
                              {cmd}
                            </Badge>
                            <span className="text-muted-foreground">
                              {status?.available ? (status.path ?? "") : FALLBACK_COPY.prereqMissing.replace("{name}", cmd)}
                            </span>
                          </div>
                          {!status?.available ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={ensureWorking}
                              onClick={() => {
                                if (cmd === "uv") {
                                  ensureUv.mutate(undefined, {
                                    onSuccess: () => toast.success("uv 已就绪"),
                                    onError: (e) => toast.error(e instanceof Error ? e.message : "安装 uv 失败"),
                                  });
                                  return;
                                }
                                ensurePipx.mutate(undefined, {
                                  onSuccess: () => toast.success("pipx 已就绪"),
                                  onError: (e) => toast.error(e instanceof Error ? e.message : "安装 pipx 失败"),
                                });
                              }}
                            >
                              {ensureWorking ? (
                                <>
                                  <Loader2Icon className="size-4 animate-spin" />
                                  {FALLBACK_COPY.ensureWorking}
                                </>
                              ) : cmd === "uv" ? FALLBACK_COPY.ensureUv : FALLBACK_COPY.ensurePipx}
                            </Button>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            ) : null}

            <section className="prose prose-sm max-w-none dark:prose-invert">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {detail?.readmeMarkdown ?? ""}
              </ReactMarkdown>
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function UninstallDialog({
  open,
  onOpenChange,
  toolId,
  onConfirm,
  working,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  toolId: string | null;
  onConfirm: (keepConfig: boolean) => void;
  working: boolean;
}) {
  const { t } = useI18n();
  const [keepConfig, setKeepConfig] = useState(true);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader className="gap-1">
          <DialogTitle>{FALLBACK_COPY.uninstallConfirmTitle}</DialogTitle>
          <DialogDescription>
            {FALLBACK_COPY.uninstallConfirmDescription.replace("{name}", toolId ?? "")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/20 p-3 text-sm">
            <div className="space-y-1">
              <div className="font-medium">{keepConfig ? FALLBACK_COPY.uninstallKeepConfig : FALLBACK_COPY.uninstallRemoveConfig}</div>
              <div className="text-muted-foreground text-xs">
                {keepConfig ? "卸载后仍保留开关状态与来源信息。" : "卸载后同时删除该 CLI 的配置条目。"}
              </div>
            </div>
            <Switch checked={keepConfig} onCheckedChange={setKeepConfig} />
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t.common.cancel}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={working}
              onClick={() => onConfirm(keepConfig)}
            >
              {working ? (
                <>
                  <Loader2Icon className="size-4 animate-spin" />
                  {t.common.loading}
                </>
              ) : (
                FALLBACK_COPY.uninstall
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EditExecDialog({
  open,
  onOpenChange,
  toolId,
  initialExec,
  onSave,
  working,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  toolId: string;
  initialExec: string;
  onSave: (nextExec: string) => void;
  working: boolean;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState(initialExec);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader className="gap-1">
          <DialogTitle>{FALLBACK_COPY.edit}</DialogTitle>
          <DialogDescription>
            {toolId}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <div className="text-sm font-medium">{FALLBACK_COPY.execPath}</div>
            <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="/abs/path/to/cli 或命令名" />
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t.common.cancel}
            </Button>
            <Button
              type="button"
              disabled={working || !value.trim()}
              onClick={() => onSave(value)}
            >
              {working ? (
                <>
                  <Loader2Icon className="size-4 animate-spin" />
                  {t.common.loading}
                </>
              ) : (
                t.common.save
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DiscoverImportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const { config } = useCLIConfig();
  const updateConfig = useUpdateCLIConfig();
  const installMutation = useInstallCliTool();
  const [mode, setMode] = useState<"whitelist" | "full">("whitelist");
  const [search, setSearch] = useState("");
  const discoverQuery = useCliDiscover(mode, open);

  const candidates = useMemo(() => {
    const raw = discoverQuery.data?.candidates;
    const list = Array.isArray(raw) ? raw : [];
    if (!search.trim()) return list;
    const q = search.trim().toLowerCase();
    return list.filter((c) => String(c.name ?? "").toLowerCase().includes(q));
  }, [discoverQuery.data?.candidates, search]);

  const working = updateConfig.isPending || installMutation.isPending;

  const ensureUniqueToolId = (desired: string) => {
    const base = normalizeToolId(desired);
    if (!base) return `custom:${Date.now()}`;
    const existing = new Set(Object.keys(config?.clis ?? {}));
    if (!existing.has(base)) return base;
    for (let i = 2; i < 1000; i += 1) {
      const candidate = `${base}-${i}`;
      if (!existing.has(candidate)) return candidate;
    }
    return `${base}-${Date.now()}`;
  };

  const writeSystemConfig = (toolId: string, exec: string) => {
    if (!config) return;
    const next = mergeCliConfig(config.clis ?? {}, {
      [toolId]: { enabled: false, source: "system", exec, label: toolId } as CLIStateConfig,
    });
    updateConfig.mutate(
      { clis: next },
      {
        onSuccess: () => toast.success(`已导入：${toolId}（默认未启用）`),
        onError: (e) => toast.error(e instanceof Error ? e.message : "导入失败"),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader className="gap-1">
            <DialogTitle>{FALLBACK_COPY.discoverTitle}</DialogTitle>
            <DialogDescription>从系统已有 CLI 或 PATH 中导入，或基于白名单安装应用版本。</DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Tabs value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
                <TabsList>
                  <TabsTrigger value="whitelist">{FALLBACK_COPY.discoverWhitelist}</TabsTrigger>
                  <TabsTrigger value="full">{FALLBACK_COPY.discoverFull}</TabsTrigger>
                </TabsList>
              </Tabs>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    void discoverQuery.refetch();
                  }}
                >
                  <RefreshCwIcon className={cn("size-4", discoverQuery.isFetching ? "animate-spin" : "")} />
                  {FALLBACK_COPY.refresh}
                </Button>
              </div>
            </div>

            {mode === "full" ? (
              <div className="flex items-center gap-2">
                <SearchIcon className="size-4 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={FALLBACK_COPY.discoverSearch}
                />
              </div>
            ) : null}

            {discoverQuery.isLoading ? (
              <div className="text-muted-foreground text-sm">{t.common.loading}</div>
            ) : discoverQuery.error ? (
              <div className="text-destructive text-sm">
                {discoverQuery.error instanceof Error ? discoverQuery.error.message : FALLBACK_COPY.loadFailed}
              </div>
            ) : mode === "whitelist" ? (
              <div className="space-y-2">
                {discoverQuery.data?.tools?.length ? (
                  <ItemGroup className="gap-2">
                    {discoverQuery.data.tools.map((tool) => {
                      const toolId = String(tool.toolId ?? "");
                      const bins = Array.isArray(tool.bins) ? tool.bins : [];
                      const firstBin = bins[0];
                      const alreadyManaged = Boolean(config?.clis?.[toolId]?.source === "managed");
                      return (
                        <Item key={toolId} variant="outline" className="items-start">
                          <ItemContent>
                            <ItemTitle className="flex flex-wrap items-center gap-2">
                              <span>{toolId}</span>
                              <Badge variant="outline">{FALLBACK_COPY.systemCli}</Badge>
                              <Badge variant="outline">{FALLBACK_COPY.appCli}</Badge>
                            </ItemTitle>
                            <ItemDescription className="whitespace-pre-wrap">
                              {bins.map((b) => `• ${b.name}: ${b.path}`).join("\n")}
                            </ItemDescription>
                          </ItemContent>
                          <ItemActions className="flex-wrap justify-end">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={!firstBin || working}
                              onClick={() => {
                                if (!firstBin) return;
                                writeSystemConfig(toolId, firstBin.name);
                              }}
                            >
                              <PlusIcon className="size-4" />
                              {FALLBACK_COPY.importSystem}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              disabled={alreadyManaged || working}
                              onClick={() => {
                                installMutation.mutate(toolId, {
                                  onSuccess: (resp) => {
                                    toast.success(
                                      resp.enabled
                                        ? `已安装并自动启用：${resp.toolId}`
                                        : `已安装：${resp.toolId}（默认未启用）`,
                                    );
                                  },
                                  onError: (e) => toast.error(e instanceof Error ? e.message : "安装失败"),
                                });
                              }}
                            >
                              <ArrowDownToLineIcon className="size-4" />
                              {alreadyManaged ? FALLBACK_COPY.installedAction : FALLBACK_COPY.installAppRecommended}
                            </Button>
                          </ItemActions>
                        </Item>
                      );
                    })}
                  </ItemGroup>
                ) : (
                  <div className="text-muted-foreground text-sm">未发现白名单 CLI。</div>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {candidates.length ? (
                  <ItemGroup className="gap-2">
                    {candidates.slice(0, 200).map((item) => {
                      const name = String(item.name ?? "");
                      const path = String(item.path ?? "");
                      const toolId = ensureUniqueToolId(name);
                      return (
                        <Item key={`${name}:${path}`} variant="outline" className="items-start">
                          <ItemContent>
                            <ItemTitle className="flex flex-wrap items-center gap-2">
                              <span>{name}</span>
                              <Badge variant="outline">{FALLBACK_COPY.systemCli}</Badge>
                            </ItemTitle>
                            <ItemDescription className="break-all">{path}</ItemDescription>
                          </ItemContent>
                          <ItemActions>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={working}
                              onClick={() => {
                                if (!config) return;
                                const next = mergeCliConfig(config.clis ?? {}, {
                                  [toolId]: { enabled: false, source: "custom", exec: path, label: name } as CLIStateConfig,
                                });
                                updateConfig.mutate(
                                  { clis: next },
                                  {
                                    onSuccess: () => toast.success(`已导入：${name}（默认未启用）`),
                                    onError: (e) => toast.error(e instanceof Error ? e.message : "导入失败"),
                                  },
                                );
                              }}
                            >
                              <PlusIcon className="size-4" />
                              {FALLBACK_COPY.saveImport}
                            </Button>
                          </ItemActions>
                        </Item>
                      );
                    })}
                  </ItemGroup>
                ) : (
                  <div className="text-muted-foreground text-sm">未扫描到可导入候选项。</div>
                )}
                {candidates.length > 200 ? (
                  <div className="text-muted-foreground text-xs">
                    已显示前 200 条候选项，请使用搜索缩小范围。
                  </div>
                ) : null}
              </div>
            )}
          </div>
      </DialogContent>
    </Dialog>
  );
}

function MyCliItem({
  toolId,
  entry,
}: {
  toolId: string;
  entry: CLIStateConfig;
}) {
  const queryClient = useQueryClient();
  const setEnabledMutation = useSetCliEnabled();
  const uninstallMutation = useUninstallCliTool();
  const updateConfig = useUpdateCLIConfig();
  const { config } = useCLIConfig();
  const probe = useCliProbe(toolId, true);

  const [confirmEnable, setConfirmEnable] = useState<{
    open: boolean;
    token: string | null;
    desired: boolean;
  }>({ open: false, token: null, desired: false });

  const [uninstallOpen, setUninstallOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const source: CliSource = entry.source ?? "managed";
  const isManaged = source === "managed";
  const execValue = typeof entry.exec === "string" ? entry.exec : "";
  const labelValue = typeof (entry as unknown as { label?: unknown }).label === "string"
    ? String((entry as unknown as { label: string }).label).trim()
    : "";
  const fallbackName = toolId.startsWith("custom:")
    ? toolId.slice("custom:".length)
    : toolId.startsWith("system:")
      ? toolId.slice("system:".length)
      : toolId;
  const displayName = labelValue || fallbackName;
  const showToolId = displayName !== toolId;

  const statusText = summarizeProbe(probe.data?.installed, probe.data?.message);

  const working = setEnabledMutation.isPending || uninstallMutation.isPending || updateConfig.isPending;

  const removeConfig = () => {
    if (!config) return;
    const next = mergeCliConfig(config.clis ?? {}, { [toolId]: null });
    updateConfig.mutate(
      { clis: next },
      {
        onSuccess: () => toast.success(`已移除：${toolId}`),
        onError: (e) => toast.error(e instanceof Error ? e.message : "移除失败"),
      },
    );
  };

  const saveExec = (nextExec: string) => {
    if (!config) return;
    const existing = config.clis?.[toolId] ?? entry;
    const next = mergeCliConfig(config.clis ?? {}, {
      [toolId]: { ...(existing ?? {}), exec: nextExec.trim(), source } as CLIStateConfig,
    });
    updateConfig.mutate(
      { clis: next },
      {
        onSuccess: () => {
          toast.success("已保存");
          setEditOpen(false);
          void queryClient.invalidateQueries({ queryKey: ["cliProbe"] });
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : "保存失败"),
      },
    );
  };

  return (
    <>
      <Item variant="outline" className="items-start">
        <ItemContent>
          <ItemTitle className="flex flex-wrap items-center gap-2">
            <span>{displayName}</span>
            {showToolId ? (
              <span className="text-muted-foreground text-xs">({toolId})</span>
            ) : null}
            <Badge variant="outline">{sourceLabel(source)}</Badge>
            {probe.data?.installed ? (
              <Badge variant="secondary">{FALLBACK_COPY.statusInstalled}</Badge>
            ) : (
              <Badge variant="destructive">{FALLBACK_COPY.statusMissing}</Badge>
            )}
            {!entry.enabled ? <Badge variant="outline">{FALLBACK_COPY.statusDisabled}</Badge> : null}
          </ItemTitle>
          <ItemDescription className="space-y-1 whitespace-pre-wrap">
            <div className="text-muted-foreground">
              {statusText}
            </div>
            {!isManaged ? (
              <div className="break-all">
                exec: <span className="font-mono text-xs">{execValue || "-"}</span>
              </div>
            ) : null}
          </ItemDescription>
        </ItemContent>

        <ItemActions className="flex flex-wrap items-center justify-end gap-2">
          <div className="flex items-center gap-2 rounded-md border bg-muted/20 px-3 py-2">
            <span className="text-xs text-muted-foreground">
              {entry.enabled ? "启用" : "禁用"}
            </span>
            <Switch
              checked={Boolean(entry.enabled)}
              disabled={working}
              onCheckedChange={(next) => {
                const desired = Boolean(next);
                setEnabledMutation.mutate(
                  { toolId, enabled: desired },
                  {
                    onSuccess: (resp) => {
                      if (resp.requiresConfirmation && resp.confirmationToken) {
                        setConfirmEnable({ open: true, token: resp.confirmationToken, desired });
                        return;
                      }
                      if (!resp.success) {
                        toast.error(resp.message || "操作失败");
                        return;
                      }
                      toast.success(resp.message || "OK");
                    },
                    onError: (e) => toast.error(e instanceof Error ? e.message : "操作失败"),
                  },
                );
              }}
            />
          </div>

          {!isManaged ? (
            <>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={working}
                onClick={() => setEditOpen(true)}
              >
                <PencilIcon className="size-4" />
                {FALLBACK_COPY.edit}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={working}
                onClick={removeConfig}
              >
                <Trash2Icon className="size-4" />
                {FALLBACK_COPY.remove}
              </Button>
            </>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={working}
              onClick={() => setUninstallOpen(true)}
            >
              <Trash2Icon className="size-4" />
              {FALLBACK_COPY.uninstall}
            </Button>
          )}
        </ItemActions>
      </Item>

      <ConfirmActionDialog
        open={confirmEnable.open}
        onOpenChange={(open) => setConfirmEnable((s) => ({ ...s, open }))}
        title={FALLBACK_COPY.enableConfirmTitle}
        description={FALLBACK_COPY.enableConfirmDescription}
        confirmText="确认启用"
        confirmVariant="destructive"
        confirmDisabled={working}
        onConfirm={() => {
          if (!confirmEnable.token) return;
          setEnabledMutation.mutate(
            {
              toolId,
              enabled: confirmEnable.desired,
              confirmationToken: confirmEnable.token,
            },
            {
              onSuccess: (resp) => {
                if (!resp.success) {
                  toast.error(resp.message || "操作失败");
                  return;
                }
                toast.success(resp.message || "OK");
                setConfirmEnable({ open: false, token: null, desired: false });
              },
              onError: (e) => toast.error(e instanceof Error ? e.message : "操作失败"),
            },
          );
        }}
      />

      <UninstallDialog
        open={uninstallOpen}
        onOpenChange={setUninstallOpen}
        toolId={toolId}
        working={uninstallMutation.isPending}
        onConfirm={(keepConfig) => {
          uninstallMutation.mutate(
            { toolId, keepConfig },
            {
              onSuccess: () => {
                toast.success(`已卸载：${toolId}`);
                setUninstallOpen(false);
              },
              onError: (e) => toast.error(e instanceof Error ? e.message : "卸载失败"),
            },
          );
        }}
      />

      <EditExecDialog
        open={editOpen}
        onOpenChange={(open) => setEditOpen(open)}
        toolId={toolId}
        initialExec={execValue}
        working={updateConfig.isPending}
        onSave={(nextExec) => saveExec(nextExec)}
      />
    </>
  );
}

export function CliToolsPage() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const { config, isLoading: configLoading } = useCLIConfig();
  const marketplace = useCliMarketplaceTools();
  const [tab, setTab] = useState<TabKey>("marketplace");
  const [marketplaceSearch, setMarketplaceSearch] = useState("");
  const [marketplaceCategory, setMarketplaceCategory] = useState<string>("all");
  const [detail, setDetail] = useState<{ toolId: string; installKind: CLIMarketplaceInstallKind | null } | null>(null);
  const [discoverOpen, setDiscoverOpen] = useState(false);

  const marketplaceCategories = useMemo(() => {
    const tools = marketplace.data?.tools ?? [];
    const categories = new Set<string>();
    for (const tool of tools) {
      const trimmed = tool.category?.trim();
      if (trimmed) categories.add(trimmed);
    }
    return Array.from(categories).sort((a, b) => a.localeCompare(b));
  }, [marketplace.data?.tools]);

  const marketplaceFiltered = useMemo(() => {
    const tools = marketplace.data?.tools ?? [];
    return tools
      .filter((tool) => (marketplaceCategory === "all" ? true : tool.category === marketplaceCategory))
      .filter((tool) => toolMatchesSearch(tool, marketplaceSearch));
  }, [marketplace.data?.tools, marketplaceCategory, marketplaceSearch]);

  const myCliKeys = useMemo(() => Object.keys(config?.clis ?? {}).sort((a, b) => a.localeCompare(b)), [config?.clis]);
  const [myFilter, setMyFilter] = useState<"all" | "app" | "system">("all");
  const [mySearch, setMySearch] = useState("");

  const myCliKeysFiltered = useMemo(() => {
    let keys = filteredKeys(myCliKeys, mySearch);
    if (myFilter === "app") {
      keys = keys.filter((k) => config?.clis?.[k]?.source === "managed");
    } else if (myFilter === "system") {
      keys = keys.filter((k) => config?.clis?.[k]?.source !== "managed");
    }
    return keys;
  }, [config?.clis, myCliKeys, myFilter, mySearch]);

  const title = (() => {
    const sections: unknown = t.settings.sections;
    if (sections && typeof sections === "object" && "cliTools" in sections) {
      const raw = (sections as { cliTools?: unknown }).cliTools;
      if (typeof raw === "string" && raw.trim()) {
        return raw;
      }
    }
    return FALLBACK_COPY.title;
  })();

  return (
    <SettingsSection title={title} description={FALLBACK_COPY.description}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
            <TabsList>
              <TabsTrigger value="marketplace">{FALLBACK_COPY.marketplace}</TabsTrigger>
              <TabsTrigger value="installed">{FALLBACK_COPY.installed}</TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                void queryClient.invalidateQueries({ queryKey: ["cliConfig"] });
                void queryClient.invalidateQueries({ queryKey: ["cliMarketplace"] });
                void queryClient.invalidateQueries({ queryKey: ["cliProbe"] });
              }}
            >
              <RefreshCwIcon className="size-4" />
              {FALLBACK_COPY.refresh}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => setDiscoverOpen(true)}
            >
              <PlusIcon className="size-4" />
              {FALLBACK_COPY.discoverImport}
            </Button>
          </div>
        </div>

        {tab === "marketplace" ? (
          <section className="space-y-3 rounded-lg border p-4">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex min-w-[240px] flex-1 items-center gap-2">
                <SearchIcon className="size-4 text-muted-foreground" />
                <Input
                  value={marketplaceSearch}
                  onChange={(e) => setMarketplaceSearch(e.target.value)}
                  placeholder={FALLBACK_COPY.searchMarketplace}
                />
              </div>
              <Select value={marketplaceCategory} onValueChange={setMarketplaceCategory}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder={FALLBACK_COPY.categoryAll} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{FALLBACK_COPY.categoryAll}</SelectItem>
                  {marketplaceCategories.map((cat) => (
                    <SelectItem key={cat} value={cat}>
                      {cat}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {marketplace.isLoading ? (
              <div className="text-muted-foreground text-sm">{t.common.loading}</div>
            ) : marketplace.error ? (
              <div className="text-destructive text-sm">
                {marketplace.error instanceof Error ? marketplace.error.message : FALLBACK_COPY.loadFailed}
              </div>
            ) : marketplaceFiltered.length === 0 ? (
              <div className="text-muted-foreground text-sm">{FALLBACK_COPY.noMarketplace}</div>
            ) : (
              <ItemGroup className="gap-2">
                {marketplaceFiltered.map((tool) => {
                  const managedInstalled = Boolean(config?.clis?.[tool.id]?.source === "managed");
                  const installKind = tool.installKind ?? null;
                  return (
                    <Item key={tool.id} variant="outline" className="items-start">
                      <ItemContent>
                        <ItemTitle className="flex flex-wrap items-center gap-2">
                          <span>{tool.name}</span>
                          <span className="text-muted-foreground text-xs">({tool.id})</span>
                          {tool.verified ? <Badge variant="secondary">{FALLBACK_COPY.verified}</Badge> : null}
                          {tool.featured ? <Badge variant="outline">{FALLBACK_COPY.featured}</Badge> : null}
                          <Badge variant="outline">{FALLBACK_COPY.appCli}</Badge>
                          <Badge variant="outline">{badgeForInstallKind(installKind)}</Badge>
                          <Badge variant="outline">{tool.version}</Badge>
                        </ItemTitle>
                        <ItemDescription>{tool.description}</ItemDescription>
                      </ItemContent>
                      <ItemActions className="flex-wrap justify-end">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setDetail({ toolId: tool.id, installKind })}
                        >
                          {FALLBACK_COPY.details}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          disabled={managedInstalled}
                          onClick={() => setDetail({ toolId: tool.id, installKind })}
                        >
                          {managedInstalled ? FALLBACK_COPY.installedAction : t.common.install}
                        </Button>
                      </ItemActions>
                    </Item>
                  );
                })}
              </ItemGroup>
            )}
          </section>
        ) : (
          <section className="space-y-3 rounded-lg border p-4">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex min-w-[240px] flex-1 items-center gap-2">
                <SearchIcon className="size-4 text-muted-foreground" />
                <Input
                  value={mySearch}
                  onChange={(e) => setMySearch(e.target.value)}
                  placeholder="搜索我的 CLI..."
                />
              </div>
              <Select value={myFilter} onValueChange={(v) => setMyFilter(v as typeof myFilter)}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{FALLBACK_COPY.filterAll}</SelectItem>
                  <SelectItem value="app">{FALLBACK_COPY.filterApp}</SelectItem>
                  <SelectItem value="system">{FALLBACK_COPY.filterSystem}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {configLoading ? (
              <div className="text-muted-foreground text-sm">{t.common.loading}</div>
            ) : myCliKeysFiltered.length === 0 ? (
              <div className="text-muted-foreground text-sm">
                还没有配置 CLI。你可以点击右上角“{FALLBACK_COPY.discoverImport}”导入系统 CLI 或安装应用 CLI。
              </div>
            ) : (
              <ItemGroup className="gap-2">
                {myCliKeysFiltered.map((toolId) => {
                  const entry = config?.clis?.[toolId];
                  if (!entry) return null;
                  return (
                    <MyCliItem
                      key={toolId}
                      toolId={toolId}
                      entry={entry}
                    />
                  );
                })}
              </ItemGroup>
            )}
          </section>
        )}
      </div>

      <MarketplaceDetailDialog
        open={Boolean(detail?.toolId)}
        onOpenChange={(open) => {
          if (!open) setDetail(null);
        }}
        toolId={detail?.toolId ?? null}
        installKind={detail?.installKind ?? null}
        installed={Boolean(detail?.toolId && config?.clis?.[detail.toolId]?.source === "managed")}
      />

      <DiscoverImportDialog open={discoverOpen} onOpenChange={setDiscoverOpen} />
    </SettingsSection>
  );
}
