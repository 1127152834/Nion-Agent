"use client";

import { CheckCircle2Icon, DownloadIcon, FileTextIcon, ImageIcon, Loader2Icon, PackageIcon, RefreshCcwIcon, ShieldCheckIcon, ShieldXIcon, SparklesIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/core/i18n/hooks";
import type { PluginStudioSession } from "@/core/workbench";
import { cn } from "@/lib/utils";

type FlowAction =
  | "create"
  | "generate"
  | "auto-verify"
  | "manual-pass"
  | "manual-fail"
  | "package"
  | "download"
  | null;

function statusTone(state: PluginStudioSession["state"]) {
  if (state === "packaged" || state === "manual_verified" || state === "auto_verified") {
    return "bg-emerald-100 text-emerald-700 border-emerald-200";
  }
  if (state === "generated") {
    return "bg-amber-100 text-amber-700 border-amber-200";
  }
  return "bg-muted text-muted-foreground border-border";
}

export function PluginAssistantFlowPanel({
  session,
  pluginName,
  description,
  manualNote,
  activeAction,
  errorMessage,
  onPluginNameChange,
  onDescriptionChange,
  onManualNoteChange,
  onCreateSession,
  onGenerate,
  onAutoVerify,
  onManualVerify,
  onPackage,
  onDownload,
}: {
  session: PluginStudioSession | null;
  pluginName: string;
  description: string;
  manualNote: string;
  activeAction: FlowAction;
  errorMessage: string | null;
  onPluginNameChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onManualNoteChange: (value: string) => void;
  onCreateSession: () => void;
  onGenerate: () => void;
  onAutoVerify: () => void;
  onManualVerify: (passed: boolean) => void;
  onPackage: () => void;
  onDownload: () => void;
}) {
  const { t } = useI18n();
  const copy = t.workspace.pluginAssistant.flow;
  const statusLabels: Record<PluginStudioSession["state"], string> = {
    draft: copy.states.draft,
    generated: copy.states.generated,
    auto_verified: copy.states.autoVerified,
    manual_verified: copy.states.manualVerified,
    packaged: copy.states.packaged,
  };
  const actionBusy = (name: Exclude<FlowAction, null>) => activeAction === name;
  const currentSession = session;
  const hasSession = Boolean(session);
  const canGenerate = hasSession;
  const canAutoVerify = hasSession && currentSession?.state !== "draft";
  const canManualPass = hasSession && Boolean(currentSession?.autoVerified);
  const canManualFail = hasSession && currentSession?.state !== "draft";
  const canPackage = hasSession && Boolean(currentSession?.autoVerified && currentSession?.manualVerified);
  const canDownload = hasSession && Boolean(currentSession?.packageDownloadUrl);

  return (
    <aside className="flex h-full min-h-0 flex-col border-l bg-muted/20">
      <header className="border-b px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <SparklesIcon className="size-4" />
          {copy.title}
        </div>
        <p className="text-muted-foreground mt-1 text-xs">
          {copy.subtitle}
        </p>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <section className="space-y-2 rounded-lg border bg-background p-3">
          <div className="text-xs font-medium">{copy.sessionConfig}</div>
          <Input
            value={pluginName}
            onChange={(event) => onPluginNameChange(event.target.value)}
            placeholder={copy.pluginNamePlaceholder}
            className="h-8 text-xs"
          />
          <textarea
            value={description}
            onChange={(event) => onDescriptionChange(event.target.value)}
            placeholder={copy.descriptionPlaceholder}
            className="border-input bg-background min-h-[84px] w-full rounded-md border px-2 py-1.5 text-xs outline-none"
          />
          <Button
            size="sm"
            className="h-8 w-full text-xs"
            onClick={onCreateSession}
            disabled={actionBusy("create") || !pluginName.trim()}
          >
            {actionBusy("create") ? <Loader2Icon className="size-3.5 animate-spin" /> : <RefreshCcwIcon className="size-3.5" />}
            {copy.createSession}
          </Button>
        </section>

        <section className="space-y-2 rounded-lg border bg-background p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium">{copy.sessionStatus}</span>
            {currentSession ? (
              <Badge className={cn("border text-[10px]", statusTone(currentSession.state))}>
                {statusLabels[currentSession.state]}
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[10px]">{copy.uninitialized}</Badge>
            )}
          </div>
          {currentSession ? (
            <div className="text-muted-foreground space-y-1 text-[11px] leading-5">
              <div>session: {currentSession.sessionId}</div>
              <div>thread: {currentSession.chatThreadId ?? "-"}</div>
              <div>plugin: {currentSession.pluginId}</div>
            </div>
          ) : null}
        </section>

        <section className="space-y-2 rounded-lg border bg-background p-3">
          <div className="text-xs font-medium">{copy.actions}</div>
          <div className="grid grid-cols-2 gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              onClick={onGenerate}
              disabled={!canGenerate || actionBusy("generate")}
            >
              {actionBusy("generate") ? <Loader2Icon className="size-3.5 animate-spin" /> : <SparklesIcon className="size-3.5" />}
              {copy.generate}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              onClick={onAutoVerify}
              disabled={!canAutoVerify || actionBusy("auto-verify")}
            >
              {actionBusy("auto-verify") ? <Loader2Icon className="size-3.5 animate-spin" /> : <ShieldCheckIcon className="size-3.5" />}
              {copy.autoVerify}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              onClick={() => onManualVerify(true)}
              disabled={!canManualPass || actionBusy("manual-pass")}
            >
              {actionBusy("manual-pass") ? <Loader2Icon className="size-3.5 animate-spin" /> : <CheckCircle2Icon className="size-3.5" />}
              {copy.manualPass}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              onClick={() => onManualVerify(false)}
              disabled={!canManualFail || actionBusy("manual-fail")}
            >
              {actionBusy("manual-fail") ? <Loader2Icon className="size-3.5 animate-spin" /> : <ShieldXIcon className="size-3.5" />}
              {copy.manualFail}
            </Button>
            <Button
              size="sm"
              className="h-8 text-xs"
              onClick={onPackage}
              disabled={!canPackage || actionBusy("package")}
            >
              {actionBusy("package") ? <Loader2Icon className="size-3.5 animate-spin" /> : <PackageIcon className="size-3.5" />}
              {copy.package}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              className="h-8 text-xs"
              onClick={onDownload}
              disabled={!canDownload || actionBusy("download")}
            >
              {actionBusy("download") ? <Loader2Icon className="size-3.5 animate-spin" /> : <DownloadIcon className="size-3.5" />}
              {copy.download}
            </Button>
          </div>
          <textarea
            value={manualNote}
            onChange={(event) => onManualNoteChange(event.target.value)}
            placeholder={copy.manualNotePlaceholder}
            className="border-input bg-background min-h-[72px] w-full rounded-md border px-2 py-1.5 text-xs outline-none"
          />
        </section>

        {currentSession && (currentSession.readmeUrl || currentSession.demoImageUrls.length > 0) ? (
          <section className="space-y-2 rounded-lg border bg-background p-3">
            <div className="text-xs font-medium">{copy.artifacts}</div>
            <div className="space-y-2 text-xs">
              {currentSession.readmeUrl ? (
                <a href={currentSession.readmeUrl} target="_blank" rel="noreferrer" className="text-primary inline-flex items-center gap-1 hover:underline">
                  <FileTextIcon className="size-3.5" />
                  README
                </a>
              ) : null}
              {currentSession.demoImageUrls.map((url) => (
                <a
                  key={url}
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary inline-flex items-center gap-1 hover:underline"
                >
                  <ImageIcon className="size-3.5" />
                  {copy.demoImage}
                </a>
              ))}
            </div>
          </section>
        ) : null}

        {errorMessage ? (
          <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {errorMessage}
          </div>
        ) : null}
      </div>
    </aside>
  );
}

export type { FlowAction as PluginAssistantFlowAction };
