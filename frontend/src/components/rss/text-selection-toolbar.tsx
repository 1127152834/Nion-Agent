"use client";

import { LanguagesIcon, MessageCircleIcon, ScrollTextIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";

export interface TextSelectionInfo {
  selectedText: string;
  rect: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
}

export function TextSelectionToolbar({
  selection,
  onAskAI,
  onSummarize,
  onTranslate,
  className,
}: {
  selection: TextSelectionInfo | null;
  onAskAI: (text: string) => void;
  onSummarize: (text: string) => void;
  onTranslate: (text: string) => void;
  className?: string;
}) {
  const { t } = useI18n();
  if (!selection) {
    return null;
  }

  const top = Math.max(selection.rect.top - 8, 8);
  const left = selection.rect.left + selection.rect.width / 2;

  return (
    <div
      className={cn(
        "pointer-events-none fixed z-50",
        className,
      )}
      style={{
        top,
        left,
        transform: "translate(-50%, -100%)",
      }}
    >
      <div className="bg-background pointer-events-auto flex items-center gap-1 rounded-xl border p-1 shadow-lg">
        <Button
          variant="ghost"
          size="sm"
          className="h-8 px-2 text-xs"
          onClick={() => onAskAI(selection.selectedText)}
        >
          <MessageCircleIcon className="size-3.5" />
          {t.rssReader.askAI}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 px-2 text-xs"
          onClick={() => onSummarize(selection.selectedText)}
        >
          <ScrollTextIcon className="size-3.5" />
          {t.rssReader.summarize}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 px-2 text-xs"
          onClick={() => onTranslate(selection.selectedText)}
        >
          <LanguagesIcon className="size-3.5" />
          {t.rssReader.translate}
        </Button>
      </div>
    </div>
  );
}
