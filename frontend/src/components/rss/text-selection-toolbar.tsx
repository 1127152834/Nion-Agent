"use client";

import {
  CheckIcon,
  CopyIcon,
  LanguagesIcon,
  MessageCircleIcon,
  ScrollTextIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

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

const VIEWPORT_PADDING = 10;
const DEFAULT_WIDTH = 320;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
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
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => {
      window.clearTimeout(timer);
    };
  }, [copied]);

  const position = useMemo(() => {
    if (!selection) {
      return null;
    }

    const top = Math.max(selection.rect.top - 52, VIEWPORT_PADDING);
    const viewportWidth = typeof window === "undefined" ? DEFAULT_WIDTH : window.innerWidth;
    const maxLeft = Math.max(VIEWPORT_PADDING, viewportWidth - DEFAULT_WIDTH - VIEWPORT_PADDING);
    const left = clamp(
      selection.rect.left + selection.rect.width / 2 - DEFAULT_WIDTH / 2,
      VIEWPORT_PADDING,
      maxLeft,
    );

    return { top, left };
  }, [selection]);

  if (!selection || !position) {
    return null;
  }

  return (
    <div
      className={cn("pointer-events-none fixed z-50", className)}
      style={{
        top: position.top,
        left: position.left,
        width: DEFAULT_WIDTH,
      }}
    >
      <div className="bg-background/95 pointer-events-auto flex items-center gap-1 rounded-2xl border p-1.5 shadow-xl backdrop-blur">
        <Button
          variant="ghost"
          size="sm"
          className="h-8 rounded-full px-2 text-xs"
          onClick={async () => {
            if (!navigator.clipboard) {
              return;
            }
            await navigator.clipboard.writeText(selection.selectedText);
            setCopied(true);
          }}
        >
          {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
          {copied ? t.rssReader.selectionCopied : t.rssReader.selectionCopy}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 rounded-full px-2 text-xs"
          onClick={() => onAskAI(selection.selectedText)}
        >
          <MessageCircleIcon className="size-3.5" />
          {t.rssReader.askAI}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 rounded-full px-2 text-xs"
          onClick={() => onSummarize(selection.selectedText)}
        >
          <ScrollTextIcon className="size-3.5" />
          {t.rssReader.summarize}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 rounded-full px-2 text-xs"
          onClick={() => onTranslate(selection.selectedText)}
        >
          <LanguagesIcon className="size-3.5" />
          {t.rssReader.translate}
        </Button>
      </div>
    </div>
  );
}
