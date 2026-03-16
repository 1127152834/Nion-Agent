"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useMemo } from "react";

import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";

import { AuroraText } from "../ui/aurora-text";

let waved = false;

export function Welcome({
  className,
  mode,
}: {
  className?: string;
  mode?: "ultra" | "pro" | "thinking" | "flash";
}) {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const isUltra = useMemo(() => mode === "ultra", [mode]);
  const colors = useMemo(() => {
    if (isUltra) {
      return ["#efe5b2", "#d9bf70", "#b88e28"];
    }
    return ["var(--color-foreground)"];
  }, [isUltra]);

  useEffect(() => {
    waved = true;
  }, []);

  if (searchParams.get("mode") === "temporary-chat") {
    return (
      <div
        className={cn(
          "mx-auto flex w-full flex-col items-center justify-center gap-3 px-4 text-center",
          className,
        )}
      >
        <div className="inline-flex items-center gap-2 rounded-full border bg-background/60 px-3 py-1 text-xs">
          <span className="font-medium">{t.inputBox.temporaryChat}</span>
          <span className="text-foreground/60">{t.welcome.temporaryChatBadgeHint}</span>
        </div>
        <div className="text-[clamp(2rem,4vw,3rem)] font-semibold tracking-[-0.05em] text-balance text-foreground">
          🕶 {t.welcome.temporaryChatTitle}
        </div>
        <div className="text-foreground/62 max-w-2xl text-[15px] leading-7">
          {t.welcome.temporaryChatDescription.includes("\n") ? (
            <pre className="font-sans whitespace-pre-wrap">
              {t.welcome.temporaryChatDescription}
            </pre>
          ) : (
            <p>{t.welcome.temporaryChatDescription}</p>
          )}
        </div>
      </div>
    );
  }

  if (searchParams.get("mode") === "skill") {
    return (
      <div
        className={cn(
          "mx-auto flex w-full flex-col items-center justify-center gap-4 px-4 text-center",
          className,
        )}
      >
        <div className="text-[clamp(2rem,4vw,3rem)] font-semibold tracking-[-0.05em] text-balance">
          ✨ {t.welcome.createYourOwnSkill} ✨
        </div>
        <div className="text-foreground/62 max-w-2xl text-[15px] leading-7">
          {t.welcome.createYourOwnSkillDescription.includes("\n") ? (
            <pre className="font-sans whitespace-pre-wrap">{t.welcome.createYourOwnSkillDescription}</pre>
          ) : (
            <p>{t.welcome.createYourOwnSkillDescription}</p>
          )}
        </div>
      </div>
    );
  }

  if (searchParams.get("mode") === "workbench-plugin") {
    return (
      <div
        className={cn(
          "mx-auto flex w-full flex-col items-center justify-center gap-4 px-4 text-center",
          className,
        )}
      >
        <div className="text-[clamp(2rem,4vw,3rem)] font-semibold tracking-[-0.05em] text-balance">
          🔌 {t.welcome.createYourOwnPlugin} 🔌
        </div>
        <div className="text-foreground/62 max-w-2xl text-[15px] leading-7">
          {t.welcome.createYourOwnPluginDescription.includes("\n") ? (
            <pre className="font-sans whitespace-pre-wrap">{t.welcome.createYourOwnPluginDescription}</pre>
          ) : (
            <p>{t.welcome.createYourOwnPluginDescription}</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "mx-auto flex w-full flex-col items-center justify-center gap-4 px-4 text-center",
        className,
      )}
    >
      <div className="flex items-center justify-center gap-3 text-[clamp(2.35rem,4.6vw,3.6rem)] font-semibold tracking-[-0.06em] text-balance text-foreground">
        <div className={cn("inline-flex shrink-0 items-center justify-center", !waved ? "animate-wave" : "")}>{isUltra ? "🚀" : "👋"}</div>
        <AuroraText colors={colors}>{t.welcome.greeting}</AuroraText>
      </div>
      <div className="text-foreground/62 max-w-[44rem] text-[15px] leading-8 sm:text-base">
        {t.welcome.description.includes("\n") ? (
          <pre className="font-sans whitespace-pre-wrap">{t.welcome.description}</pre>
        ) : (
          <p>{t.welcome.description}</p>
        )}
      </div>
    </div>
  );
}
