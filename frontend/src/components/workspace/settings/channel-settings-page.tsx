"use client";

import {
  AlertCircleIcon,
  ArrowUpRightIcon,
  CheckCircle2Icon,
  CopyIcon,
  LinkIcon,
  Loader2Icon,
  RefreshCwIcon,
  ShieldCheckIcon,
  UnplugIcon,
  XCircleIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useApprovePairRequest,
  useAuthorizedUsers,
  useChannelConfig,
  useChannelRuntimeStatus,
  useCreatePairingCode,
  usePendingPairRequests,
  useRejectPairRequest,
  useRevokeAuthorizedUser,
  useTestChannelConnection,
  useUpdateAuthorizedUserWorkspace,
  useUpsertChannelConfig,
  type ChannelMode,
  type ChannelPlatform,
} from "@/core/channels";
import { getBackendBaseURL } from "@/core/config";
import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";

import { SettingsSection } from "./settings-section";

type ChannelFormState = {
  enabled: boolean;
  mode: ChannelMode;
  default_workspace_id: string;
  credentials: Record<string, string>;
};

type CredentialFieldSpec = {
  key: string;
  label: string;
  sensitive?: boolean;
  modes?: ChannelMode[];
  requiredModes?: ChannelMode[];
  hintKey?: string;
};

const PAIR_CODE_SLOT_COUNT = 6;

const PLATFORM_FIELDS: Record<ChannelPlatform, CredentialFieldSpec[]> = {
  lark: [
    {
      key: "app_id",
      label: "App ID",
      requiredModes: ["webhook", "stream"],
    },
    {
      key: "app_secret",
      label: "App Secret",
      sensitive: true,
      requiredModes: ["webhook", "stream"],
    },
    {
      key: "verification_token",
      label: "Verification Token",
      sensitive: true,
      modes: ["webhook"],
      hintKey: "larkVerificationToken",
    },
    {
      key: "encrypt_key",
      label: "Encrypt Key",
      sensitive: true,
      modes: ["webhook"],
      hintKey: "larkEncryptKey",
    },
  ],
  dingtalk: [
    {
      key: "client_id",
      label: "Client ID",
      requiredModes: ["webhook", "stream"],
    },
    {
      key: "client_secret",
      label: "Client Secret",
      sensitive: true,
      requiredModes: ["webhook", "stream"],
    },
    {
      key: "robot_code",
      label: "Robot Code",
      modes: ["stream"],
      hintKey: "dingtalkRobotCode",
    },
    {
      key: "proxy_mode",
      label: "Proxy Mode",
      modes: ["stream"],
      hintKey: "dingtalkProxyMode",
    },
    {
      key: "card_template_id",
      label: "Card Template ID",
      modes: ["stream"],
      hintKey: "dingtalkCardTemplateId",
    },
    {
      key: "webhook_url",
      label: "Webhook URL",
      modes: ["webhook"],
      requiredModes: ["webhook"],
      hintKey: "dingtalkWebhookUrl",
    },
    {
      key: "signing_secret",
      label: "Signing Secret",
      sensitive: true,
      modes: ["webhook"],
      hintKey: "dingtalkSigningSecret",
    },
  ],
};

function isFieldVisible(field: CredentialFieldSpec, mode: ChannelMode): boolean {
  if (!field.modes || field.modes.length === 0) {
    return true;
  }
  return field.modes.includes(mode);
}

function isFieldRequired(field: CredentialFieldSpec, mode: ChannelMode): boolean {
  if (!field.requiredModes || field.requiredModes.length === 0) {
    return false;
  }
  return field.requiredModes.includes(mode);
}

function stringifyError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === "string" ? error : "";
}

function formatConversationType(
  value: string | null | undefined,
  labels: { conversation: string; group: string; direct: string },
): string {
  const normalized = (value ?? "").trim().toLowerCase();
  if (!normalized) {
    return labels.conversation;
  }
  if (normalized.includes("group")) {
    return labels.group;
  }
  if (normalized.includes("single") || normalized.includes("private")) {
    return labels.direct;
  }
  return labels.conversation;
}

function formatDateTime(value: string | null | undefined, locale: string, unknownTimeLabel: string): string {
  if (!value) {
    return unknownTimeLabel;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return unknownTimeLabel;
  }
  return date.toLocaleString(locale);
}

function renderErrorHint(message: string, apiNotReadyHint: string): string | null {
  const lower = message.toLowerCase();
  if (!lower.includes("404")) {
    return null;
  }
  return apiNotReadyHint;
}

function shouldRefetchForChannelEvent(eventType: string): boolean {
  const normalized = eventType.trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  if (
    normalized === "agent_partial"
    || normalized === "agent_started"
    || normalized === "agent_state"
  ) {
    return false;
  }
  if (normalized === "runtime_health_changed") {
    return true;
  }
  if (normalized === "agent_finished" || normalized === "agent_failed") {
    return true;
  }
  if (normalized.startsWith("pair_")) {
    return true;
  }
  if (normalized.startsWith("authorized_user_")) {
    return true;
  }
  return true;
}

function InlineError({
  error,
  apiNotReadyHint,
}: {
  error: string;
  apiNotReadyHint: string;
}) {
  const hint = renderErrorHint(error, apiNotReadyHint);
  return (
    <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">
      <div className="text-destructive flex items-start gap-2">
        <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
        <div>{error}</div>
      </div>
      {hint ? (
        <div className="text-muted-foreground mt-1 pl-6 text-xs">
          {hint}
        </div>
      ) : null}
    </div>
  );
}

function PairCodeBlock({
  platform,
  pairCommandLabel,
  className,
}: {
  platform: ChannelPlatform;
  pairCommandLabel: string;
  className?: string;
}) {
  const { locale, t } = useI18n();
  const m = t.migration.settings?.channel;
  const createPairingCode = useCreatePairingCode(platform);
  const [ttlMinutes, setTtlMinutes] = useState("10");
  const latestCode = createPairingCode.data;
  const normalizedPairCode = useMemo(
    () => (latestCode?.code ?? "").replace(/\s+/g, "").toUpperCase(),
    [latestCode?.code],
  );
  const hasPairCode = normalizedPairCode.length > 0;
  const pairCodeSlots = useMemo(
    () =>
      Array.from({ length: PAIR_CODE_SLOT_COUNT }, (_, index) => normalizedPairCode[index] ?? ""),
    [normalizedPairCode],
  );
  const pairCommandToCopy = useMemo(() => {
    if (!normalizedPairCode) {
      return "";
    }
    if (pairCommandLabel.includes("123456")) {
      return pairCommandLabel.replace("123456", normalizedPairCode);
    }
    const commandPrefix = pairCommandLabel.trim().split(/\s+/)[0] ?? "/pair";
    return `${commandPrefix} ${normalizedPairCode}`;
  }, [pairCommandLabel, normalizedPairCode]);

  const generate = () => {
    const ttl = Number.parseInt(ttlMinutes, 10);
    void createPairingCode
      .mutateAsync(Number.isFinite(ttl) && ttl > 0 ? ttl : 10)
      .then((code) => {
        toast.success((m?.pairCodeGenerated ?? "Pair code generated: {code}").replaceAll("{code}", code.code));
      })
      .catch((error) => {
        toast.error(error instanceof Error ? error.message : (m?.pairCodeGenerateFailed ?? "Failed to generate pair code"));
      });
  };

  return (
    <section className={cn("flex h-full flex-col space-y-3 rounded-md border p-3", className)}>
      <div className="space-y-1">
        <div className="text-sm font-medium">{m?.pairCodeTitle ?? "Pair Code"}</div>
        <div className="text-muted-foreground text-xs">
          {(m?.pairCodeDescription ?? "Recommend sending any message to start authorization. `{command}` is only for manual fallback.")
            .replaceAll("{command}", pairCommandLabel)}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Input
          value={ttlMinutes}
          onChange={(event) => setTtlMinutes(event.target.value)}
          className="h-8 w-20 text-sm"
          inputMode="numeric"
        />
        <div className="text-muted-foreground text-xs">{m?.pairCodeExpireMinutes ?? "minutes to expire"}</div>
        <Button
          size="sm"
          onClick={generate}
          disabled={createPairingCode.isPending}
          className="ml-auto"
        >
          {createPairingCode.isPending ? (
            <Loader2Icon className="size-4 animate-spin" />
          ) : (
            <RefreshCwIcon className="size-4" />
          )}
          {m?.generateAction ?? "Generate"}
        </Button>
      </div>

      <div className="bg-muted/20 flex min-h-[160px] flex-1 flex-col justify-between rounded-md border px-3 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-muted-foreground text-xs">
            {hasPairCode
              ? (m?.activePairCode ?? "Active pair code")
              : (m?.noPairCodeGenerated ?? "No pair code generated")}
          </div>
          {latestCode ? (
            <Button
              size="icon-sm"
              variant="outline"
              onClick={() => {
                void navigator.clipboard.writeText(pairCommandToCopy || latestCode.code);
                toast.success(m?.pairCommandCopied ?? "Pair command copied");
              }}
            >
              <CopyIcon className="size-4" />
            </Button>
          ) : null}
        </div>

        <div className="grid grid-cols-6 gap-2">
          {pairCodeSlots.map((char, index) => (
            <div
              key={`pair-slot-${index}`}
              className={cn(
                "flex h-14 items-center justify-center rounded-md text-xl font-mono tracking-wider",
                hasPairCode
                  ? "border bg-background text-foreground shadow-[0_1px_2px_hsl(var(--foreground)/0.08)]"
                  : "border border-dashed bg-background/35 text-transparent",
              )}
            >
              {char || " "}
            </div>
          ))}
        </div>

        <div className="text-muted-foreground text-xs">
          {latestCode
            ? `${m?.expiresAtPrefix ?? "Expires at"}: ${new Date(latestCode.expires_at).toLocaleString(locale)}`
            : (m?.pairCodeSlotHint ?? "A 6-digit pair code will be shown here after generation")}
        </div>
      </div>
    </section>
  );
}

function ChannelPlatformPanel({ platform }: { platform: ChannelPlatform }) {
  const { locale, t } = useI18n();
  const m = t.migration.settings?.channel;
  const fields = PLATFORM_FIELDS[platform];

  const {
    data: config,
    isLoading: configLoading,
    error: configError,
  } = useChannelConfig(platform);
  const upsertConfig = useUpsertChannelConfig(platform);
  const testConnection = useTestChannelConnection(platform);
  const {
    data: runtimeStatus,
    isLoading: runtimeLoading,
    error: runtimeError,
    refetch: refetchRuntime,
  } = useChannelRuntimeStatus(platform, {
    enabled: true,
  });
  const {
    data: pendingRequests = [],
    isLoading: pendingLoading,
    refetch: refetchPendingRequests,
  } = usePendingPairRequests(platform);
  const {
    data: authorizedUsers = [],
    isLoading: usersLoading,
    refetch: refetchAuthorizedUsers,
  } = useAuthorizedUsers(platform);
  const approvePairRequest = useApprovePairRequest(platform);
  const rejectPairRequest = useRejectPairRequest(platform);
  const revokeAuthorizedUser = useRevokeAuthorizedUser(platform);
  const updateAuthorizedUserWorkspace = useUpdateAuthorizedUserWorkspace(platform);
  const workspaceList: Array<{ workspace_id: string; name?: string }> = [];

  const [form, setForm] = useState<ChannelFormState>({
    enabled: false,
    mode: "webhook",
    default_workspace_id: "default",
    credentials: {},
  });
  const [authorizedWorkspaceDrafts, setAuthorizedWorkspaceDrafts] = useState<Record<number, string>>({});

  useEffect(() => {
    if (!config) {
      return;
    }
    setForm({
      enabled: Boolean(config.enabled),
      mode: config.mode ?? "webhook",
      default_workspace_id: config.default_workspace_id ?? "default",
      credentials: { ...config.credentials },
    });
  }, [config]);

  useEffect(() => {
    if (authorizedUsers.length === 0) {
      return;
    }
    setAuthorizedWorkspaceDrafts((prev) => {
      const next = { ...prev };
      for (const user of authorizedUsers) {
        next[user.id] ??= (user.workspace_id ?? form.default_workspace_id) || "default";
      }
      return next;
    });
  }, [authorizedUsers, form.default_workspace_id]);

  const platformTitle = platform === "lark"
    ? (m?.platformLark ?? "Lark")
    : (m?.platformDingTalk ?? "DingTalk");
  const platformDocsUrl =
    platform === "lark"
      ? "https://open.feishu.cn/document/develop-an-echo-bot/introduction"
      : "https://open.dingtalk.com/document/orgapp/overview";
  const pairCommandLabel = useMemo(() => "/pair 123456", []);
  const pairingSectionId = `${platform}-pairing-authorization`;
  const configErrorMessage = stringifyError(configError);
  const runtimeErrorMessage = stringifyError(runtimeError);
  const effectiveDefaultWorkspace = form.default_workspace_id ?? "default";
  const shouldSubscribeEvents = Boolean(config?.enabled);
  const visibleFields = useMemo(
    () => fields.filter((field) => isFieldVisible(field, form.mode)),
    [fields, form.mode],
  );

  const missingRequiredFields = useMemo(
    () =>
      visibleFields.filter((field) => {
        if (!isFieldRequired(field, form.mode)) {
          return false;
        }
        return !(form.credentials[field.key] ?? "").trim();
      }),
    [visibleFields, form.credentials, form.mode],
  );

  const missingConnectivityFields = useMemo(() => {
    const neededKeys =
      platform === "lark"
        ? ["app_id", "app_secret"]
        : ["client_id", "client_secret"];
    return neededKeys.filter((key) => !(form.credentials[key] ?? "").trim());
  }, [platform, form.credentials]);
  const shouldShowPairingGuide =
    ((testConnection.data?.success ?? false) || (runtimeStatus?.connected ?? false))
    && authorizedUsers.length === 0;

  useEffect(() => {
    if (!shouldSubscribeEvents) {
      return;
    }

    let disposed = false;
    let reconnectTimer: number | null = null;
    let source: EventSource | null = null;

    const reconnectDelayMs = 2_500;

    const openStream = () => {
      if (disposed) {
        return;
      }
      const streamUrl = `${getBackendBaseURL()}/api/channels/${platform}/events`;
      source = new EventSource(streamUrl);

      source.addEventListener("ready", () => {
        if (disposed) {
          return;
        }
      });

      source.addEventListener("channel_event", (rawEvent) => {
        if (disposed) {
          return;
        }
        try {
          const messageEvent = rawEvent as MessageEvent<string>;
          const eventPayload = JSON.parse(messageEvent.data) as { type?: string };
          if (!shouldRefetchForChannelEvent(eventPayload.type ?? "")) {
            return;
          }
        } catch {
          // Ignore parse error and keep backward compatibility by refetching.
        }
        void refetchPendingRequests();
        void refetchAuthorizedUsers();
        void refetchRuntime();
      });

      source.onerror = () => {
        if (disposed) {
          return;
        }
        source?.close();
        source = null;
        reconnectTimer = window.setTimeout(openStream, reconnectDelayMs);
      };
    };

    openStream();

    return () => {
      disposed = true;
      if (reconnectTimer != null) {
        window.clearTimeout(reconnectTimer);
      }
      source?.close();
    };
  }, [
    platform,
    shouldSubscribeEvents,
    refetchAuthorizedUsers,
    refetchPendingRequests,
    refetchRuntime,
  ]);

  const onSave = () => {
    if (missingRequiredFields.length > 0) {
      toast.error(
        (m?.fillRequiredFieldsFirst ?? "Please fill required fields first: {fields}")
          .replaceAll("{fields}", missingRequiredFields.map((field) => field.label).join(m?.listDelimiter ?? ", ")),
      );
      return;
    }
    void upsertConfig
      .mutateAsync({
        enabled: form.enabled,
        mode: form.mode,
        credentials: form.credentials,
        default_workspace_id: effectiveDefaultWorkspace,
      })
      .then(() => {
        toast.success((m?.platformConfigSaved ?? "{platform} configuration saved").replaceAll("{platform}", platformTitle));
        void refetchRuntime();
      })
      .catch((error) => {
        toast.error(error instanceof Error ? error.message : (m?.saveConfigFailed ?? "Failed to save configuration"));
      });
  };

  const onTest = () => {
    if (missingConnectivityFields.length > 0) {
      const names = missingConnectivityFields
        .map((key) => fields.find((field) => field.key === key)?.label ?? key)
        .join(m?.listDelimiter ?? ", ");
      toast.error(
        (m?.fillConnectionFieldsFirst ?? "Please fill required fields for connection test: {fields}")
          .replaceAll("{fields}", names),
      );
      return;
    }
    void testConnection
      .mutateAsync({
        credentials: form.credentials,
        timeout_seconds: 8,
      })
      .then((result) => {
        if (result.success) {
          toast.success((m?.platformConnectionSuccess ?? "{platform} connection test succeeded").replaceAll("{platform}", platformTitle));
        } else {
          toast.error(result.message || (m?.connectionTestFailed ?? "Connection test failed"));
        }
      })
      .catch((error) => {
        toast.error(error instanceof Error ? error.message : (m?.connectionTestFailed ?? "Connection test failed"));
      });
  };

  const toggleCredential = (key: string, value: string) => {
    setForm((prev) => ({
      ...prev,
      credentials: {
        ...prev.credentials,
        [key]: value,
      },
    }));
  };

  return (
    <div className="space-y-6">
      <section className="space-y-4 rounded-lg border p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="text-sm font-medium">
              {platformTitle} {m?.channelConfiguration ?? "Channel Configuration"}
            </div>
            <div className="text-muted-foreground text-xs">
              {m?.channelConfigurationDescription
                ?? "Fill credentials, verify connectivity, then handle pairing and authorization."}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={form.enabled ? "default" : "secondary"}>
              {form.enabled ? (m?.enabledLabel ?? "Enabled") : (m?.disabledLabel ?? "Disabled")}
            </Badge>
            <Button
              asChild
              size="sm"
              variant="outline"
            >
              <a
                href={platformDocsUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center"
              >
                <LinkIcon className="size-4" />
                {m?.setupDocsAction ?? "Setup Docs"}
                <ArrowUpRightIcon className="size-3.5 opacity-70" />
              </a>
            </Button>
          </div>
        </div>

        {configErrorMessage ? (
          <InlineError
            error={configErrorMessage}
            apiNotReadyHint={
              m?.apiNotReadyHint
                ?? "Channel API is not ready. Restart desktop runtime and ensure frontend backend base URL points to gateway (not /api path)."
            }
          />
        ) : null}

      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1.5 md:col-span-2">
            <div className="text-xs font-medium">{m?.accessModeLabel ?? "Access Mode"}</div>
            <Select
              value={form.mode}
              onValueChange={(value) =>
                setForm((prev) => ({
                  ...prev,
                  mode: value as ChannelMode,
                }))
              }
            >
              <SelectTrigger className="w-[240px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="webhook">{m?.webhookOption ?? "Webhook (HTTP callback)"}</SelectItem>
                <SelectItem value="stream">{m?.streamOption ?? "Stream (persistent connection)"}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {visibleFields.map((field) => (
            <div
              className="space-y-1.5"
              key={field.key}
            >
              <div className="flex items-center gap-1.5 text-xs font-medium">
                <span>{field.label}</span>
                <Badge
                  variant={isFieldRequired(field, form.mode) ? "default" : "secondary"}
                  className="h-5 px-1.5 text-[10px]"
                >
                  {isFieldRequired(field, form.mode)
                    ? (m?.requiredLabel ?? "Required")
                    : (m?.optionalLabel ?? "Optional")}
                </Badge>
              </div>
              {field.key === "proxy_mode" ? (
                <Select
                  value={form.credentials[field.key] ?? "auto"}
                  onValueChange={(value) => toggleCredential(field.key, value)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">{m?.proxyModeAuto ?? "auto (adaptive)"}</SelectItem>
                    <SelectItem value="direct">{m?.proxyModeDirect ?? "direct (no proxy)"}</SelectItem>
                    <SelectItem value="system">{m?.proxyModeSystem ?? "system (system proxy)"}</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  value={form.credentials[field.key] ?? ""}
                  onChange={(event) => toggleCredential(field.key, event.target.value)}
                  type={field.sensitive ? "password" : "text"}
                />
              )}
              {field.hintKey ? (
                <p className="text-muted-foreground text-xs">
                  {m?.fieldHints?.[field.hintKey] ?? ""}
                </p>
              ) : null}
            </div>
          ))}

          <div className="space-y-1.5 md:col-span-2">
            <div className="text-xs font-medium">{m?.defaultWorkspaceLabel ?? "Default Workspace"}</div>
            <Select
              value={effectiveDefaultWorkspace}
              onValueChange={(value) =>
                setForm((prev) => ({
                  ...prev,
                  default_workspace_id: value,
                }))
              }
            >
              <SelectTrigger className="w-[280px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">{m?.defaultWorkspaceOption ?? "Default workspace (default)"}</SelectItem>
                {workspaceList.map((workspace) =>
                  workspace.workspace_id === "default" ? null : (
                    <SelectItem
                      key={workspace.workspace_id}
                      value={workspace.workspace_id}
                    >
                      {workspace.name} ({workspace.workspace_id})
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-xs">
              {m?.defaultWorkspaceHint
                ?? "Newly approved users will bind to this workspace by default; adjust per user later in authorization list."}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="mr-1 flex items-center gap-2 text-sm">
            <Switch
              checked={form.enabled}
              onCheckedChange={(checked) => {
                setForm((prev) => ({ ...prev, enabled: checked }));
              }}
            />
            {form.enabled ? (m?.enabledLabel ?? "Enabled") : (m?.disabledLabel ?? "Disabled")}
          </label>
          <Button
            variant="outline"
            onClick={onTest}
            disabled={
              configLoading
              || testConnection.isPending
              || upsertConfig.isPending
              || missingConnectivityFields.length > 0
            }
          >
            {testConnection.isPending ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <RefreshCwIcon className="size-4" />
            )}
            {m?.testConnectionAction ?? "Test Connection"}
          </Button>
          <Button
            onClick={onSave}
            disabled={
              configLoading
              || upsertConfig.isPending
              || missingRequiredFields.length > 0
            }
          >
            {upsertConfig.isPending ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <ShieldCheckIcon className="size-4" />
            )}
            {m?.saveAndApplyAction ?? "Save & Apply"}
          </Button>
          {testConnection.data ? (
            <Badge variant={testConnection.data.success ? "default" : "destructive"}>
              {testConnection.data.success
                ? (m?.connectedLabel ?? "Connected")
                : (m?.connectionFailedLabel ?? "Connection failed")}
              {testConnection.data.latency_ms != null ? ` · ${testConnection.data.latency_ms}ms` : ""}
            </Badge>
          ) : null}
        </div>
        {missingRequiredFields.length > 0 ? (
          <div className="text-muted-foreground rounded-md border border-dashed px-3 py-2 text-xs">
            {m?.missingRequiredFieldsPrefix ?? "Missing required fields for current mode: "}
            {missingRequiredFields.map((field) => field.label).join(m?.listDelimiter ?? ", ")}
          </div>
        ) : null}
        {shouldShowPairingGuide ? (
          <div className="flex flex-wrap items-start justify-between gap-2 rounded-md border border-amber-300/40 bg-amber-500/5 px-3 py-2">
            <div className="text-xs leading-5">
              {(m?.pairingGuideText
                ?? "Successful connection only means the channel is reachable. Next: ask user to send any message in DingTalk -> approve it in \"Pending Pair Requests\" below (fallback with {command} if needed).")
                .replaceAll("{command}", pairCommandLabel)}
            </div>
            <Button
              size="sm"
              type="button"
              variant="outline"
              onClick={() => {
                document.getElementById(pairingSectionId)?.scrollIntoView({
                  behavior: "smooth",
                  block: "start",
                });
              }}
            >
              {m?.goToPairingAction ?? "Go to Pairing & Authorization"}
            </Button>
          </div>
        ) : null}
      </section>

      <section className="space-y-3 rounded-lg border p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="text-sm font-medium">{m?.runtimeStatusTitle ?? "Runtime Status"}</div>
            <div className="text-muted-foreground text-xs">
              {m?.runtimeStatusDescription
                ?? "仅展示关键运行信息，详细诊断请查看日志。"}
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              void refetchRuntime();
            }}
            disabled={runtimeLoading}
          >
            {runtimeLoading ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <RefreshCwIcon className="size-4" />
            )}
            {m?.refreshAction ?? "Refresh"}
          </Button>
        </div>

        {runtimeErrorMessage ? (
          <InlineError
            error={runtimeErrorMessage}
            apiNotReadyHint={
              m?.apiNotReadyHint
                ?? "Channel API is not ready. Restart desktop runtime and ensure frontend backend base URL points to gateway (not /api path)."
            }
          />
        ) : null}

        {runtimeStatus ? (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant={runtimeStatus.running ? "default" : "secondary"}>
              {runtimeStatus.running ? (m?.runningLabel ?? "Running") : (m?.stoppedLabel ?? "Stopped")}
            </Badge>
            <Badge variant={runtimeStatus.connected ? "default" : "secondary"}>
              {runtimeStatus.connected ? (m?.connectedLabel ?? "Connected") : (m?.disconnectedLabel ?? "Disconnected")}
            </Badge>
            <Badge variant="outline">{m?.activeUsersLabel ?? "Active users"}: {runtimeStatus.active_users}</Badge>
            {runtimeStatus.last_ws_connected_at ? (
              <Badge variant="outline">
                {m?.lastConnectedLabel ?? "Last connected"}: {formatDateTime(
                  runtimeStatus.last_ws_connected_at,
                  locale,
                  m?.unknownTimeLabel ?? "Unknown time",
                )}
              </Badge>
            ) : null}
            {runtimeStatus.last_error ? (
              <Badge
                variant="destructive"
                className="max-w-full truncate"
              >
                <AlertCircleIcon className="mr-1 size-3" />
                {runtimeStatus.last_error_code
                  ? `${runtimeStatus.last_error_code}: ${runtimeStatus.last_error}`
                  : runtimeStatus.last_error}
              </Badge>
            ) : null}
          </div>
        ) : (
          <div className="text-muted-foreground text-sm">{m?.noRuntimeStatus ?? "No runtime status"}</div>
        )}
      </section>

      <section
        id={pairingSectionId}
        className="space-y-4 rounded-lg border p-4"
      >
        <div className="space-y-1">
          <div className="text-sm font-medium">{m?.pairingAuthorizationTitle ?? "Pairing & Authorization"}</div>
          <div className="text-muted-foreground text-xs">
            {m?.pairingAuthorizationDescription
              ?? "Recommend users send any message in DingTalk first, then approve and bind workspace."}
          </div>
        </div>
        <div className="grid items-stretch gap-4 xl:grid-cols-[340px_1fr]">
          <PairCodeBlock
            platform={platform}
            pairCommandLabel={pairCommandLabel}
            className="h-full"
          />

          <div className="grid h-full gap-4 xl:grid-rows-2">
            <section className="flex h-full min-h-0 flex-col space-y-2 rounded-md border p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium">{m?.pendingPairRequestsTitle ?? "Pending Pair Requests"}</div>
                <Badge variant="secondary">{pendingRequests.length}</Badge>
              </div>
              {pendingLoading ? (
                <div className="text-muted-foreground text-sm">{m?.loadingLabel ?? "Loading..."}</div>
              ) : pendingRequests.length === 0 ? (
                <div className="text-muted-foreground rounded-md border border-dashed px-3 py-2 text-sm">
                  {m?.noPendingRequests ?? "No pending requests"}
                </div>
              ) : (
                <div className="min-h-0 space-y-2 overflow-auto pr-1">
                  {pendingRequests.map((item) => (
                    <div
                      key={item.id}
                      className="rounded-md border p-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">
                            {item.external_user_name ?? item.external_user_id}
                          </div>
                          <div className="text-muted-foreground text-xs">
                            {formatConversationType(item.conversation_type, {
                              conversation: m?.conversationTypeConversation ?? "Conversation",
                              group: m?.conversationTypeGroup ?? "Group",
                              direct: m?.conversationTypeDirect ?? "Direct",
                            })} · {m?.requestedAtLabel ?? "Requested at"}:
                            {formatDateTime(item.created_at, locale, m?.unknownTimeLabel ?? "Unknown time")}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={rejectPairRequest.isPending || approvePairRequest.isPending}
                            onClick={() => {
                              void rejectPairRequest
                                .mutateAsync({
                                  requestId: item.id,
                                  payload: { handled_by: "ui" },
                                })
                                .then(() => toast.success(m?.rejectedToast ?? "Rejected"))
                                .catch((error) =>
                                  toast.error(
                                    error instanceof Error ? error.message : (m?.rejectFailedToast ?? "Reject failed"),
                                  ),
                                );
                            }}
                          >
                            <XCircleIcon className="size-4" />
                            {m?.rejectAction ?? "Reject"}
                          </Button>
                          <Button
                            size="sm"
                            disabled={rejectPairRequest.isPending || approvePairRequest.isPending}
                            onClick={() => {
                              void approvePairRequest
                                .mutateAsync({
                                  requestId: item.id,
                                  payload: {
                                    handled_by: "ui",
                                    workspace_id: effectiveDefaultWorkspace,
                                  },
                                })
                                .then(() => toast.success(m?.approvedToast ?? "Approved and authorized"))
                                .catch((error) =>
                                  toast.error(
                                    error instanceof Error ? error.message : (m?.approveFailedToast ?? "Approve failed"),
                                  ),
                                );
                            }}
                          >
                            <CheckCircle2Icon className="size-4" />
                            {m?.approveAction ?? "Approve"}
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="flex h-full min-h-0 flex-col space-y-2 rounded-md border p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium">{m?.authorizedUsersTitle ?? "Authorized Users"}</div>
                <Badge variant="secondary">{authorizedUsers.length}</Badge>
              </div>
              {usersLoading ? (
                <div className="text-muted-foreground text-sm">{m?.loadingLabel ?? "Loading..."}</div>
              ) : authorizedUsers.length === 0 ? (
                <div className="text-muted-foreground rounded-md border border-dashed px-3 py-2 text-sm">
                  {m?.noAuthorizedUsers ?? "No authorized users"}
                </div>
              ) : (
                <div className="min-h-0 space-y-2 overflow-auto pr-1">
                  {authorizedUsers.map((item) => (
                    <div
                      key={item.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">
                          {item.external_user_name ?? item.external_user_id}
                        </div>
                        <div className="text-muted-foreground text-xs">
                          {formatConversationType(item.conversation_type, {
                            conversation: m?.conversationTypeConversation ?? "Conversation",
                            group: m?.conversationTypeGroup ?? "Group",
                            direct: m?.conversationTypeDirect ?? "Direct",
                          })} · {m?.grantedAtLabel ?? "Granted at"}:
                          {formatDateTime(item.granted_at, locale, m?.unknownTimeLabel ?? "Unknown time")}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Select
                          value={authorizedWorkspaceDrafts[item.id] ?? item.workspace_id ?? "default"}
                          onValueChange={(value) =>
                            setAuthorizedWorkspaceDrafts((prev) => ({
                              ...prev,
                              [item.id]: value,
                            }))
                          }
                        >
                          <SelectTrigger className="h-8 w-[220px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="default">{m?.defaultWorkspaceOption ?? "Default workspace (default)"}</SelectItem>
                            {workspaceList.map((workspace) =>
                              workspace.workspace_id === "default" ? null : (
                                <SelectItem
                                  key={workspace.workspace_id}
                                  value={workspace.workspace_id}
                                >
                                  {workspace.name} ({workspace.workspace_id})
                                </SelectItem>
                              ),
                            )}
                          </SelectContent>
                        </Select>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={updateAuthorizedUserWorkspace.isPending}
                          onClick={() => {
                            const workspaceId =
                              authorizedWorkspaceDrafts[item.id] ?? item.workspace_id ?? "default";
                            void updateAuthorizedUserWorkspace
                              .mutateAsync({
                                userId: item.id,
                                workspaceId,
                              })
                              .then(() => toast.success(m?.authorizedWorkspaceUpdatedToast ?? "Authorized user workspace updated"))
                              .catch((error) =>
                                toast.error(
                                  error instanceof Error ? error.message : (m?.updateFailedToast ?? "Update failed"),
                                ),
                              );
                          }}
                        >
                          {m?.saveAction ?? "Save"}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={revokeAuthorizedUser.isPending}
                          onClick={() => {
                            const displayName = item.external_user_name ?? item.external_user_id;
                            const confirmed = window.confirm(
                              (m?.revokeConfirmTemplate
                                ?? "Revoke channel authorization for \"{name}\"? The user will need to pair again.")
                                .replaceAll("{name}", displayName),
                            );
                            if (!confirmed) {
                              return;
                            }
                            void revokeAuthorizedUser
                              .mutateAsync(item.id)
                              .then(() => toast.success(m?.authorizationRevokedToast ?? "Authorization revoked"))
                              .catch((error) =>
                                toast.error(error instanceof Error ? error.message : (m?.revokeFailedToast ?? "Revoke failed")),
                              );
                          }}
                        >
                          <UnplugIcon className="size-4" />
                          {m?.revokeAction ?? "Revoke"}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      </section>
    </div>
  );
}

export function ChannelSettingsPage() {
  const { t } = useI18n();
  const m = t.migration.settings?.channel;
  const [activePlatform, setActivePlatform] = useState<ChannelPlatform>("lark");

  return (
    <SettingsSection
      title={t.settings.channels.title}
      description={t.settings.channels.description}
    >
      <Tabs
        value={activePlatform}
        onValueChange={(value) => {
          setActivePlatform(value as ChannelPlatform);
        }}
        className="space-y-4"
      >
        <TabsList variant="line">
          <TabsTrigger value="lark">{m?.platformLark ?? "Lark"}</TabsTrigger>
          <TabsTrigger value="dingtalk">{m?.platformDingTalk ?? "DingTalk"}</TabsTrigger>
        </TabsList>
      </Tabs>
      <div
        key={activePlatform}
        className="animate-in fade-in-0 slide-in-from-bottom-1 duration-200"
      >
        <ChannelPlatformPanel platform={activePlatform} />
      </div>
    </SettingsSection>
  );
}
