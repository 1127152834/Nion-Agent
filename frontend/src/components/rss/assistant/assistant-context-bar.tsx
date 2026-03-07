"use client";

import { KeyboardIcon } from "lucide-react";
import { useMemo } from "react";

import { useI18n } from "@/core/i18n/hooks";
import { useRSSContext } from "@/core/rss";
import { cn } from "@/lib/utils";

function formatShortcutLabel(isMac: boolean, key: string) {
  return isMac ? `⌘ ${key}` : `Ctrl ${key}`;
}

export function AssistantContextBar({ className }: { className?: string }) {
  const { t } = useI18n();
  const { blocks } = useRSSContext();

  const isMac = useMemo(() => {
    if (typeof navigator === "undefined") {
      return false;
    }
    return /Mac|iPhone|iPad|iPod/.test(navigator.platform);
  }, []);

  const labels = useMemo(() => {
    return blocks.map((block) => {
      if (block.type === "mainEntry") {
        return {
          id: block.id,
          text: `${t.rssReader.aiContextEntry}: ${block.metadata?.title ?? block.value}`,
        };
      }
      return {
        id: block.id,
        text: `${t.rssReader.aiContextFeed}: ${block.metadata?.title ?? block.value}`,
      };
    });
  }, [blocks, t.rssReader.aiContextEntry, t.rssReader.aiContextFeed]);

  return (
    <div className={cn("border-t px-3 py-2", className)}>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {labels.length > 0 ? (
          labels.map((item) => (
            <span
              key={item.id}
              className="bg-muted text-muted-foreground inline-flex max-w-full items-center truncate rounded-full border px-2 py-0.5 text-[11px]"
              title={item.text}
            >
              {item.text}
            </span>
          ))
        ) : (
          <span className="text-muted-foreground text-[11px]">
            {t.rssReader.aiContextEmpty}
          </span>
        )}
      </div>

      <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-[11px]">
        <KeyboardIcon className="size-3.5" />
        <span className="rounded border px-1.5 py-0.5 font-medium">
          {formatShortcutLabel(isMac, "I")}
        </span>
        <span>{t.rssReader.shortcutToggleAssistant}</span>
        <span className="rounded border px-1.5 py-0.5 font-medium">
          {formatShortcutLabel(isMac, "N")}
        </span>
        <span>{t.rssReader.shortcutNewAssistantChat}</span>
        <span className="rounded border px-1.5 py-0.5 font-medium">
          {formatShortcutLabel(isMac, "W")}
        </span>
        <span>{t.rssReader.shortcutCloseAssistant}</span>
      </div>
    </div>
  );
}
