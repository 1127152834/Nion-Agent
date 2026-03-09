"use client";

import { InfoIcon } from "lucide-react";

import { cn } from "@/lib/utils";

import { Tooltip } from "./tooltip";

type TipDisplayMode = "inline" | "hover";
type TipTone = "neutral" | "success" | "warning";
type TipAppearance = "default" | "quiet-question";

function toneClassOf(tone: TipTone) {
  switch (tone) {
    case "success":
      return {
        text: "text-emerald-700 dark:text-emerald-300",
        bg: "bg-emerald-500/10",
        border: "border-emerald-500/30",
      };
    case "warning":
      return {
        text: "text-amber-700 dark:text-amber-300",
        bg: "bg-amber-500/10",
        border: "border-amber-500/30",
      };
    default:
      return {
        text: "text-muted-foreground",
        bg: "bg-muted/40",
        border: "border-border/60",
      };
  }
}

export function ContextTip({
  text,
  title,
  icon,
  className,
  mode = "inline",
  tone = "neutral",
  appearance = "default",
  hoverAriaLabel,
}: {
  text: string;
  title?: string;
  icon?: React.ReactNode;
  className?: string;
  mode?: TipDisplayMode;
  tone?: TipTone;
  appearance?: TipAppearance;
  hoverAriaLabel?: string;
}) {
  const toneClass = toneClassOf(tone);
  const iconNode = icon ?? <InfoIcon className="size-3.5" />;

  if (mode === "hover") {
    return (
      <Tooltip
        content={
          <div className="max-w-72 space-y-1.5">
            {title ? <div className="text-foreground text-xs font-semibold">{title}</div> : null}
            <div className="text-muted-foreground text-xs leading-relaxed">{text}</div>
          </div>
        }
      >
        <button
          type="button"
          aria-label={hoverAriaLabel ?? title ?? text}
          className={cn(
            appearance === "quiet-question"
              ? "inline-flex size-6 items-center justify-center rounded-full border border-black/10 bg-black/5 text-black/65 transition-colors hover:bg-black/10 hover:text-black/80 dark:border-white/16 dark:bg-white/8 dark:text-white/70 dark:hover:bg-white/14 dark:hover:text-white/90 focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-2"
              : "inline-flex size-7 items-center justify-center rounded-full border transition-colors hover:bg-muted/70 focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-2",
            appearance !== "quiet-question" && toneClass.text,
            appearance !== "quiet-question" && toneClass.bg,
            appearance !== "quiet-question" && toneClass.border,
            className,
          )}
        >
          {iconNode}
        </button>
      </Tooltip>
    );
  }

  return (
    <div className={cn("flex items-start gap-1.5 text-xs leading-relaxed", toneClass.text, className)}>
      <span className="mt-0.5 shrink-0">{iconNode}</span>
      <span>
        {title ? <span className="text-foreground mr-1 font-medium">{title}</span> : null}
        {text}
      </span>
    </div>
  );
}

export function InlineTip({
  text,
  title,
  icon,
  className,
  tone = "neutral",
}: {
  text: string;
  title?: string;
  icon?: React.ReactNode;
  className?: string;
  tone?: TipTone;
}) {
  return <ContextTip text={text} title={title} icon={icon} className={className} tone={tone} mode="inline" />;
}
