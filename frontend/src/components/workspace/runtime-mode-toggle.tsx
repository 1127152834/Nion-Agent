"use client";

import {
  MonitorIcon,
  ShieldCheckIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

import { Tooltip } from "./tooltip";

export type RuntimeModeToggleMode = "sandbox" | "host";

export type RuntimeModeCopy = {
  sandboxLabel: string;
  hostLabel: string;
  pickDir: string;
  hostDialogTitle: string;
  hostDialogDescription: string;
  hostDialogCurrentDir: string;
  hostDialogChooseDir: string;
  hostDialogCancel: string;
  hostBoundDirectory: string;
  hostDirLocked: string;
  hostDirMissing: string;
  hostDirDetected: (path: string) => string;
  hostDirNotEmptyHint: string;
  createEmptyFolderAndUse: string;
  folderNamePlaceholder: string;
  folderNameRequired: string;
  folderNameInvalid: string;
  creating: string;
  confirm: string;
  locked: string;
  lockedTip: string;
  desktopOnly: string;
  modeSaveFailed: string;
  sandboxTip: string;
  hostTip: string;
};

export function RuntimeModeToggle({
  mode,
  locked,
  saving,
  desktopOnlyDisabled,
  hostDirPath,
  copy,
  onSwitch,
  className,
}: {
  mode: RuntimeModeToggleMode;
  locked: boolean;
  saving: boolean;
  desktopOnlyDisabled?: boolean;
  hostDirPath?: string | null;
  copy: RuntimeModeCopy;
  onSwitch: (nextMode: RuntimeModeToggleMode) => void;
  className?: string;
}) {
  const switchDisabled = saving || locked;
  const hostDisabled = switchDisabled || desktopOnlyDisabled;
  const sharedTooltipClassName =
    "max-w-[min(24rem,calc(100vw-2rem))] text-wrap rounded-[1.15rem] border border-black/10 bg-[#1d1a17] px-4 py-3 text-stone-100 shadow-[0_24px_60px_-26px_rgba(0,0,0,0.72)]";
  const sandboxTooltipContent = (
    <div className="space-y-1.5 text-left">
      <div className="text-[11px] font-semibold tracking-[0.08em] text-stone-100/72 uppercase">{copy.sandboxLabel}</div>
      <div className="text-xs leading-relaxed text-stone-200/88">{copy.sandboxTip}</div>
      {locked ? <div className="text-xs leading-relaxed text-amber-200/92">{copy.lockedTip}</div> : null}
    </div>
  );
  const hostTooltipContent = (
    <div className="space-y-1.5 text-left">
      <div className="text-[11px] font-semibold tracking-[0.08em] text-stone-100/72 uppercase">{copy.hostLabel}</div>
      <div className="text-xs leading-relaxed text-stone-200/88">
        {desktopOnlyDisabled && mode !== "host" ? copy.desktopOnly : copy.hostTip}
      </div>
      {mode === "host" && hostDirPath ? (
        <div className="break-all text-xs leading-relaxed text-stone-200/88">
          <span className="font-medium text-stone-50">{copy.hostBoundDirectory}: </span>
          {hostDirPath}
        </div>
      ) : null}
      {locked ? <div className="text-xs leading-relaxed text-amber-200/92">{copy.lockedTip}</div> : null}
    </div>
  );

  return (
    <div className={cn("relative inline-flex min-w-[250px] max-w-full items-center justify-center", className)}>
      <div className="relative inline-grid grid-cols-2 gap-1 rounded-[1.55rem] bg-[linear-gradient(180deg,rgba(250,248,243,0.94),rgba(239,234,225,0.9))] p-1.5 shadow-[inset_0_1px_1px_rgba(255,255,255,0.92),inset_0_-1px_2px_rgba(102,88,63,0.08)]">
          <div
            className={cn(
              "pointer-events-none absolute top-1.5 bottom-1.5 left-1.5 w-[calc(50%-7px)] rounded-[1.2rem] blur-md transition-transform duration-[320ms] ease-[cubic-bezier(0.22,1,0.36,1)]",
              mode === "sandbox" && "bg-emerald-300/36",
              mode === "host" && "translate-x-full bg-amber-300/38",
            )}
          />
          <div
            className={cn(
              "pointer-events-none absolute top-1.5 bottom-1.5 left-1.5 w-[calc(50%-7px)] rounded-[1.2rem] transition-transform duration-[320ms] ease-[cubic-bezier(0.22,1,0.36,1)]",
              mode === "sandbox" && "bg-[linear-gradient(180deg,rgba(229,250,237,0.98),rgba(201,242,219,0.92))] shadow-[0_14px_28px_-18px_rgba(22,163,74,0.55)]",
              mode === "host" && "translate-x-full bg-[linear-gradient(180deg,rgba(255,241,214,0.98),rgba(250,221,163,0.92))] shadow-[0_14px_28px_-18px_rgba(217,119,6,0.58)]",
            )}
          />

          <Tooltip content={sandboxTooltipContent} delayDuration={180} contentClassName={sharedTooltipClassName}>
            <button
              type="button"
              aria-label={copy.sandboxLabel}
              className={cn(
                "relative flex h-12 w-[4.8rem] items-center justify-center rounded-[1.1rem] transition-[color,opacity,transform] duration-[260ms] sm:w-[5.4rem]",
                mode === "sandbox"
                  ? "-translate-y-px text-emerald-700 drop-shadow-[0_3px_8px_rgba(22,163,74,0.32)]"
                  : "text-foreground/55 hover:text-foreground/82",
                switchDisabled && "cursor-not-allowed opacity-55",
              )}
              disabled={switchDisabled}
              onClick={() => onSwitch("sandbox")}
            >
              <ShieldCheckIcon className="size-5.5" />
            </button>
          </Tooltip>

          <Tooltip
            content={hostTooltipContent}
            delayDuration={180}
            contentClassName={sharedTooltipClassName}
          >
            <button
              type="button"
              aria-label={copy.hostLabel}
              className={cn(
                "relative flex h-12 w-[4.8rem] items-center justify-center rounded-[1.1rem] transition-[color,opacity,transform] duration-[260ms] sm:w-[5.4rem]",
                mode === "host"
                  ? "-translate-y-px text-amber-700 drop-shadow-[0_3px_8px_rgba(217,119,6,0.35)]"
                  : "text-foreground/55 hover:text-foreground/82",
                hostDisabled && "cursor-not-allowed opacity-55",
              )}
              disabled={hostDisabled}
              onClick={() => onSwitch("host")}
            >
              <MonitorIcon className="size-5.5" />
            </button>
          </Tooltip>
        </div>
    </div>
  );
}
