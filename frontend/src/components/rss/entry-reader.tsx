"use client";

import {
  ArrowUpRightIcon,
  BookmarkIcon,
  CheckIcon,
  Loader2Icon,
  SparklesIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useI18n } from "@/core/i18n/hooks";
import { useRSSContext, useRSSEntry, useUpdateRSSEntry } from "@/core/rss";
import { formatTimeAgo } from "@/core/utils/datetime";
import { cn } from "@/lib/utils";

import { TextSelectionToolbar, type TextSelectionInfo } from "./text-selection-toolbar";

function sanitizeHTML(raw: string): string {
  const template = document.createElement("template");
  template.innerHTML = raw;

  const forbiddenTags = [
    "script",
    "iframe",
    "object",
    "embed",
    "link",
    "meta",
    "base",
  ];
  for (const tag of forbiddenTags) {
    template.content.querySelectorAll(tag).forEach((node) => node.remove());
  }

  const elements = template.content.querySelectorAll("*");
  for (const element of elements) {
    for (const attrName of element.getAttributeNames()) {
      const lowered = attrName.toLowerCase();
      if (lowered.startsWith("on")) {
        element.removeAttribute(attrName);
        continue;
      }
      if (lowered === "src" || lowered === "href" || lowered === "xlink:href") {
        const attrValue = element.getAttribute(attrName) ?? "";
        if (/^\s*javascript:/i.test(attrValue)) {
          element.removeAttribute(attrName);
        }
      }
    }
  }

  return template.innerHTML;
}

function buildArticleHTML(content: string): string {
  if (!content.trim()) {
    return `<article class="entry"><p class="empty">No readable content found.</p></article>`;
  }

  const sanitized = sanitizeHTML(content);
  return `<article class="entry">${sanitized}</article>`;
}

function buildShadowDOMDocument(content: string): string {
  return `
    <style>
      :host {
        color: hsl(var(--foreground));
        font-family: "Times New Roman", "STSong", serif;
      }
      .entry {
        color: hsl(var(--foreground));
        line-height: 1.78;
        font-size: 1rem;
        max-width: 72ch;
        margin: 0 auto;
      }
      .entry :where(h1,h2,h3,h4,h5,h6) {
        line-height: 1.35;
        margin: 1.2em 0 0.6em;
      }
      .entry h1 {
        font-size: 2rem;
      }
      .entry h2 {
        font-size: 1.5rem;
      }
      .entry p {
        margin: 0.8em 0;
      }
      .entry img,
      .entry video,
      .entry iframe {
        max-width: 100%;
        border-radius: 0.75rem;
      }
      .entry pre {
        overflow-x: auto;
        background: hsl(var(--muted));
        border: 1px solid hsl(var(--border));
        border-radius: 0.75rem;
        padding: 0.9rem;
      }
      .entry code {
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      }
      .entry blockquote {
        margin: 1rem 0;
        padding: 0.5rem 1rem;
        border-left: 3px solid hsl(var(--border));
        color: hsl(var(--muted-foreground));
      }
      .entry a {
        color: hsl(var(--primary));
        text-decoration: underline;
      }
      .entry a:hover {
        text-decoration-thickness: 2px;
      }
      .empty {
        color: hsl(var(--muted-foreground));
      }
    </style>
    ${buildArticleHTML(content)}
  `;
}

export function EntryReader({
  entryId,
  className,
}: {
  entryId: string;
  className?: string;
}) {
  const router = useRouter();
  const { t } = useI18n();
  const { entry, isLoading, error } = useRSSEntry(entryId);
  const { addBlock, removeBlock } = useRSSContext();
  const updateEntryMutation = useUpdateRSSEntry();

  const contentHostRef = useRef<HTMLDivElement | null>(null);
  const shadowRootRef = useRef<ShadowRoot | null>(null);
  const didAutoMarkReadRef = useRef<string | null>(null);
  const [textSelection, setTextSelection] = useState<TextSelectionInfo | null>(
    null,
  );

  const articleContent = useMemo(
    () => entry?.content ?? entry?.description ?? "",
    [entry?.content, entry?.description],
  );

  useEffect(() => {
    if (!entry || entry.read || didAutoMarkReadRef.current === entry.id) {
      return;
    }
    didAutoMarkReadRef.current = entry.id;
    void updateEntryMutation
      .mutateAsync({
        entryId: entry.id,
        request: { read: true },
      })
      .catch(() => {
        didAutoMarkReadRef.current = null;
      });
  }, [entry, updateEntryMutation]);

  useEffect(() => {
    if (!entry) {
      return;
    }
    addBlock({
      id: "mainEntry",
      type: "mainEntry",
      value: entry.id,
      metadata: {
        title: entry.title,
        url: entry.url,
        summary: entry.description,
        feed_id: entry.feed_id,
      },
    });
    return () => {
      removeBlock("mainEntry");
    };
  }, [addBlock, entry, removeBlock]);

  useEffect(() => {
    setTextSelection(null);
  }, [entryId]);

  useEffect(() => {
    const host = contentHostRef.current;
    if (!host) {
      return;
    }

    shadowRootRef.current ??= host.attachShadow({ mode: "open" });
    const shadowRoot = shadowRootRef.current;
    shadowRoot.innerHTML = buildShadowDOMDocument(articleContent);

    const clickHandler = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (!target) {
        return;
      }
      const anchor = target.closest("a");
      if (!anchor) {
        return;
      }
      anchor.setAttribute("target", "_blank");
      anchor.setAttribute("rel", "noreferrer noopener");
    };

    const selectionHandler = () => {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) {
        setTextSelection(null);
        return;
      }
      const selectedText = selection.toString().trim();
      if (!selectedText) {
        setTextSelection(null);
        return;
      }
      const range = selection.getRangeAt(0);
      const rootNode = range.commonAncestorContainer.getRootNode();
      if (rootNode !== shadowRoot) {
        setTextSelection(null);
        return;
      }
      const rect = range.getBoundingClientRect();
      if (rect.width <= 0 && rect.height <= 0) {
        setTextSelection(null);
        return;
      }
      setTextSelection({
        selectedText,
        rect: {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        },
      });
    };

    const clearSelectionOnScroll = () => {
      setTextSelection(null);
    };

    shadowRoot.addEventListener("click", clickHandler);
    shadowRoot.addEventListener("mouseup", selectionHandler);
    shadowRoot.addEventListener("keyup", selectionHandler);
    window.addEventListener("scroll", clearSelectionOnScroll, true);
    return () => {
      shadowRoot.removeEventListener("click", clickHandler);
      shadowRoot.removeEventListener("mouseup", selectionHandler);
      shadowRoot.removeEventListener("keyup", selectionHandler);
      window.removeEventListener("scroll", clearSelectionOnScroll, true);
    };
  }, [articleContent]);

  const openChatWithPrompt = useCallback(
    (prompt: string) => {
      const query = new URLSearchParams();
      query.set("prefill", prompt);
      router.push(`/workspace/chats/new?${query.toString()}`);
    },
    [router],
  );

  const handleAskAIFromSelection = useCallback(
    (selectedText: string) => {
      openChatWithPrompt(
        t.rssReader.askAIPrompt.replace("{text}", selectedText),
      );
      setTextSelection(null);
    },
    [openChatWithPrompt, t.rssReader.askAIPrompt],
  );

  const handleSummarizeSelection = useCallback(
    (selectedText: string) => {
      openChatWithPrompt(
        t.rssReader.summarizePrompt.replace("{text}", selectedText),
      );
      setTextSelection(null);
    },
    [openChatWithPrompt, t.rssReader.summarizePrompt],
  );

  const handleTranslateSelection = useCallback(
    (selectedText: string) => {
      openChatWithPrompt(
        t.rssReader.translatePrompt.replace("{text}", selectedText),
      );
      setTextSelection(null);
    },
    [openChatWithPrompt, t.rssReader.translatePrompt],
  );

  const handleToggleRead = async () => {
    if (!entry) {
      return;
    }
    try {
      await updateEntryMutation.mutateAsync({
        entryId: entry.id,
        request: { read: !entry.read },
      });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t.rssReader.entryUpdateFailed,
      );
    }
  };

  const handleToggleStarred = async () => {
    if (!entry) {
      return;
    }
    try {
      await updateEntryMutation.mutateAsync({
        entryId: entry.id,
        request: { starred: !entry.starred },
      });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t.rssReader.entryUpdateFailed,
      );
    }
  };

  if (isLoading) {
    return (
      <div className="text-muted-foreground flex size-full items-center justify-center gap-2 text-sm">
        <Loader2Icon className="size-4 animate-spin" />
        {t.rssReader.loadingEntry}
      </div>
    );
  }

  if (error || !entry) {
    return (
      <div className="text-destructive flex size-full items-center justify-center px-4 text-sm">
        {error instanceof Error ? error.message : t.rssReader.entryNotFound}
      </div>
    );
  }

  return (
    <>
      <ResizablePanelGroup
        orientation="horizontal"
        defaultLayout={{ article: 62, ai: 38 }}
        className={cn("size-full", className)}
      >
        <ResizablePanel id="article" className="min-w-0">
          <ScrollArea className="size-full">
            <div className="mx-auto flex max-w-4xl flex-col gap-6 p-6">
              <header className="space-y-3">
                <h1 className="text-2xl leading-tight font-semibold">
                  {entry.title}
                </h1>
                <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
                  <span>{formatTimeAgo(entry.published_at)}</span>
                  {entry.author && (
                    <>
                      <span>·</span>
                      <span>{entry.author}</span>
                    </>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void handleToggleRead()}
                  >
                    <CheckIcon className="size-4" />
                    {entry.read ? t.rssReader.markUnread : t.rssReader.markRead}
                  </Button>
                  <Button
                    variant={entry.starred ? "default" : "outline"}
                    size="sm"
                    onClick={() => void handleToggleStarred()}
                  >
                    <BookmarkIcon className="size-4" />
                    {entry.starred ? t.rssReader.unstar : t.rssReader.star}
                  </Button>
                  <Button variant="ghost" size="sm" asChild>
                    <a href={entry.url} target="_blank" rel="noreferrer noopener">
                      <ArrowUpRightIcon className="size-4" />
                      {t.rssReader.openOriginal}
                    </a>
                  </Button>
                </div>
              </header>

              <div
                ref={contentHostRef}
                className="bg-card min-h-[50vh] rounded-2xl border px-6 py-8 shadow-xs"
              />
            </div>
          </ScrollArea>
        </ResizablePanel>
        <ResizableHandle className="opacity-40 hover:opacity-100" />
        <ResizablePanel id="ai" className="min-w-0">
          <div className="bg-muted/30 flex size-full flex-col border-l">
            <div className="border-b px-4 py-3">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <SparklesIcon className="text-primary size-4" />
                {t.rssReader.aiPanelTitle}
              </div>
            </div>
            <div className="text-muted-foreground flex flex-1 items-center justify-center p-6 text-center text-sm leading-relaxed">
              {t.rssReader.aiPanelDescription}
            </div>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
      <TextSelectionToolbar
        selection={textSelection}
        onAskAI={handleAskAIFromSelection}
        onSummarize={handleSummarizeSelection}
        onTranslate={handleTranslateSelection}
      />
    </>
  );
}
