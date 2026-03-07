"use client";

import { CircleHelpIcon } from "lucide-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";

export function FieldTip({
  className,
  zh,
  en,
  recommended,
  risk,
}: {
  className?: string;
  zh: string;
  en: string;
  recommended?: string;
  risk?: string;
}) {
  const { locale, t } = useI18n();
  const fallbackCopy = locale === "zh-CN"
    ? {
      ariaLabel: "字段提示",
      recommendedEn: "推荐",
      recommendedZh: "推荐",
      riskEn: "风险",
      riskZh: "风险",
    }
    : {
      ariaLabel: "Field hint",
      recommendedEn: "Recommended",
      recommendedZh: "Recommended",
      riskEn: "Risk",
      riskZh: "Risk",
    };
  const settingsLike = t.settings as unknown as {
    configSections?: {
      fieldTip?: Record<string, string>;
    };
  };
  const copy = {
    ...fallbackCopy,
    ...(settingsLike.configSections?.fieldTip ?? {}),
  };
  const primary = locale === "zh-CN" ? zh : en;
  const recommendedLabel = locale === "zh-CN"
    ? copy.recommendedZh
    : copy.recommendedEn;
  const riskLabel = locale === "zh-CN"
    ? copy.riskZh
    : copy.riskEn;
  const hasDetail = Boolean((recommended ?? "").trim() || (risk ?? "").trim());

  if (!primary && !recommended && !risk) {
    return null;
  }

  return (
    <div className={cn("text-muted-foreground flex items-center gap-1.5 text-xs", className)}>
      <span className="truncate">{primary}</span>
      {hasDetail && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground inline-flex items-center"
              aria-label={copy.ariaLabel}
            >
              <CircleHelpIcon className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-72 space-y-1">
            <p>{primary}</p>
            {recommended && (
              <p className="text-emerald-300">
                {recommendedLabel}: {recommended}
              </p>
            )}
            {risk && (
              <p className="text-amber-300">
                {riskLabel}: {risk}
              </p>
            )}
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
