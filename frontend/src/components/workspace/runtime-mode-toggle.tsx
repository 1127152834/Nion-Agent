"use client";

import {
  CircleHelpIcon,
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
  locked: string;
  lockedTip: string;
  desktopOnly: string;
  modeSaveFailed: string;
  sandboxTip: string;
  hostTip: string;
  tipTitle: string;
  tipAriaLabel: string;
};

export function getRuntimeModeCopy(locale: string): RuntimeModeCopy {
  if (locale.startsWith("zh")) {
    return {
      sandboxLabel: "沙箱模式",
      hostLabel: "主机模式",
      pickDir: "选择目录",
      hostDialogTitle: "为本次对话指定主机工作目录",
      hostDialogDescription: "切换为主机模式后，需要先指定一个空目录作为当前会话工作区。",
      hostDialogCurrentDir: "当前目录",
      hostDialogChooseDir: "选择工作目录",
      hostDialogCancel: "取消",
      hostBoundDirectory: "当前已绑定目录",
      hostDirLocked: "该会话工作目录已绑定，不可更改。",
      hostDirMissing: "主机模式需要先选择一个空目录。",
      locked: "会话已开始，运行模式已锁定。",
      lockedTip: "本会话模式已锁定；如需切换请新建会话。",
      desktopOnly: "主机模式仅桌面版可用。",
      modeSaveFailed: "切换运行模式失败，请重试。",
      sandboxTip: "适合聊天问答、方案讨论、写作草稿、轻量代码分析等低风险任务。",
      hostTip: "适合直接读写本机文件、批量整理资料、执行本地命令和自动化办公任务。",
      tipTitle: "模式说明与建议",
      tipAriaLabel: "查看模式说明",
    };
  }
  return {
    sandboxLabel: "Sandbox mode",
    hostLabel: "Host mode",
    pickDir: "Pick folder",
    hostDialogTitle: "Choose a host working directory for this chat",
    hostDialogDescription: "Before host mode starts, select an empty folder as this conversation's working directory.",
    hostDialogCurrentDir: "Current directory",
    hostDialogChooseDir: "Choose directory",
    hostDialogCancel: "Cancel",
    hostBoundDirectory: "Currently bound directory",
    hostDirLocked: "This chat is already bound to a working directory and cannot be changed.",
    hostDirMissing: "Host mode requires selecting an empty working directory first.",
    locked: "Session already started. Runtime mode is locked.",
    lockedTip: "Runtime mode is locked for this session. Create a new chat to switch.",
    desktopOnly: "Host mode is available only in desktop runtime.",
    modeSaveFailed: "Failed to update runtime mode.",
    sandboxTip: "Best for chat Q&A, planning, drafting, and other low-risk tasks.",
    hostTip: "Best for direct local file operations, batch organization, local commands, and desktop automation.",
    tipTitle: "Mode differences and recommendation",
    tipAriaLabel: "View mode guidance",
  };
}

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
    "max-w-80 rounded-[1.15rem] border border-black/10 bg-[#1d1a17] px-4 py-3 text-stone-100 shadow-[0_24px_60px_-26px_rgba(0,0,0,0.72)]";
  const hostTooltipContent =
    desktopOnlyDisabled && mode !== "host"
      ? copy.desktopOnly
      : mode === "host" && hostDirPath
        ? (
          <div className="max-w-80 space-y-1.5 text-left">
            <div className="text-[11px] font-semibold tracking-[0.08em] text-stone-100/72 uppercase">{copy.hostLabel}</div>
            <div className="break-all text-xs leading-relaxed text-stone-200/88">
              <span className="font-medium text-stone-50">{copy.hostBoundDirectory}：</span>
              {hostDirPath}
            </div>
          </div>
        )
        : copy.hostLabel;

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

          <Tooltip content={copy.sandboxLabel} delayDuration={180} contentClassName={sharedTooltipClassName}>
            <button
              type="button"
              aria-label={copy.sandboxLabel}
              className={cn(
                "relative z-10 flex h-12 w-[4.8rem] items-center justify-center rounded-[1.1rem] transition-[color,opacity,transform] duration-[260ms] sm:w-[5.4rem]",
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
                "relative z-10 flex h-12 w-[4.8rem] items-center justify-center rounded-[1.1rem] transition-[color,opacity,transform] duration-[260ms] sm:w-[5.4rem]",
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

      <Tooltip
        side="top"
        align="end"
        sideOffset={10}
        delayDuration={180}
        contentClassName={sharedTooltipClassName}
        content={
          <div className="max-w-80 space-y-2 text-left">
            <div className="text-[11px] font-semibold tracking-[0.08em] text-stone-100/72 uppercase">{copy.tipTitle}</div>
            <div className="space-y-2 text-xs leading-relaxed text-stone-200/88">
              <div>
                <span className="font-medium text-stone-50">{copy.sandboxLabel}：</span>
                {copy.sandboxTip}
              </div>
              <div>
                <span className="font-medium text-stone-50">{copy.hostLabel}：</span>
                {copy.hostTip}
              </div>
              {locked ? <div className="text-amber-200/92">{copy.lockedTip}</div> : null}
            </div>
          </div>
        }
      >
        <button
          type="button"
          aria-label={copy.tipAriaLabel}
          className="absolute -top-1 -right-1 z-20 inline-flex size-5 items-center justify-center rounded-full bg-zinc-950 text-white shadow-[0_8px_16px_-8px_rgba(0,0,0,0.85)] transition-all duration-200 hover:scale-110 hover:shadow-[0_12px_20px_-10px_rgba(0,0,0,0.95)] focus-visible:ring-2 focus-visible:ring-zinc-950/35 focus-visible:outline-none"
        >
          <CircleHelpIcon className="size-3" />
        </button>
      </Tooltip>
    </div>
  );
}
