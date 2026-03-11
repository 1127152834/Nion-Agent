"use client";

import { useRouter } from "next/navigation";
import type { ComponentProps, MouseEvent } from "react";
import { Streamdown } from "streamdown";

import { useI18n } from "@/core/i18n/hooks";
import { useMemory } from "@/core/memory/hooks";
import type { UserMemory } from "@/core/memory/types";
import { platform } from "@/core/platform";
import { streamdownPlugins } from "@/core/streamdown/plugins";
import { pathOfThread } from "@/core/threads/utils";
import { formatTimeAgo } from "@/core/utils/datetime";

import { SettingsSection } from "./settings-section";

function confidenceToLevelKey(confidence: unknown): {
  key: "veryHigh" | "high" | "normal" | "unknown";
  value?: number;
} {
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) {
    return { key: "unknown" };
  }

  // Clamp to [0, 1] since confidence is expected to be a probability-like score.
  const value = Math.min(1, Math.max(0, confidence));

  // 3 levels:
  // - veryHigh: [0.85, 1]
  // - high:     [0.65, 0.85)
  // - normal:   [0, 0.65)
  if (value >= 0.85) return { key: "veryHigh", value };
  if (value >= 0.65) return { key: "high", value };
  return { key: "normal", value };
}

function resolveWorkspaceHref(href: string | undefined): string | null {
  if (!href) {
    return null;
  }

  if (href.startsWith("/workspace/")) {
    return href;
  }

  try {
    const base = typeof window !== "undefined" ? window.location.origin : "http://localhost";
    const url = new URL(href, base);
    if (url.pathname.startsWith("/workspace/")) {
      return `${url.pathname}${url.search}${url.hash}`;
    }
  } catch {
    return null;
  }

  return null;
}

function isModifiedEvent(event: MouseEvent<HTMLAnchorElement>): boolean {
  return event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0;
}

function MemorySourceLink({
  href,
  children,
  onClick,
  onNavigate,
  ...props
}: ComponentProps<"a"> & { onNavigate?: () => void }) {
  const router = useRouter();
  const internalHref = resolveWorkspaceHref(href);

  const handleClick = async (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || isModifiedEvent(event)) {
      return;
    }

    if (internalHref) {
      event.preventDefault();
      event.stopPropagation();
      onNavigate?.();
      router.push(internalHref);
      return;
    }

    if (href) {
      event.preventDefault();
      event.stopPropagation();
      await platform.openExternal(href);
    }
  };

  return (
    <a
      {...props}
      href={internalHref ?? href}
      onClick={(event) => {
        void handleClick(event);
      }}
    >
      {children}
    </a>
  );
}

function formatMemorySection(
  title: string,
  summary: string,
  updatedAt: string | undefined,
  t: ReturnType<typeof useI18n>["t"],
): string {
  const content =
    summary.trim() ||
    `<span class="text-muted-foreground">${t.settings.memory.markdown.empty}</span>`;
  return [
    `### ${title}`,
    content,
    "",
    updatedAt &&
      `> ${t.settings.memory.markdown.updatedAt}: \`${formatTimeAgo(updatedAt)}\``,
  ]
    .filter(Boolean)
    .join("\n");
}

function memoryToMarkdown(
  memory: UserMemory,
  t: ReturnType<typeof useI18n>["t"],
) {
  const parts: string[] = [];

  parts.push(`## ${t.settings.memory.markdown.overview}`);
  parts.push(
    `- **${t.common.lastUpdated}**: \`${formatTimeAgo(memory.lastUpdated)}\``,
  );

  parts.push(`\n## ${t.settings.memory.markdown.userContext}`);
  parts.push(
    formatMemorySection(
      t.settings.memory.markdown.work,
      memory.user.workContext.summary,
      memory.user.workContext.updatedAt,
      t,
    ),
  );
  parts.push(
    formatMemorySection(
      t.settings.memory.markdown.personal,
      memory.user.personalContext.summary,
      memory.user.personalContext.updatedAt,
      t,
    ),
  );
  parts.push(
    formatMemorySection(
      t.settings.memory.markdown.topOfMind,
      memory.user.topOfMind.summary,
      memory.user.topOfMind.updatedAt,
      t,
    ),
  );

  parts.push(`\n## ${t.settings.memory.markdown.historyBackground}`);
  parts.push(
    formatMemorySection(
      t.settings.memory.markdown.recentMonths,
      memory.history.recentMonths.summary,
      memory.history.recentMonths.updatedAt,
      t,
    ),
  );
  parts.push(
    formatMemorySection(
      t.settings.memory.markdown.earlierContext,
      memory.history.earlierContext.summary,
      memory.history.earlierContext.updatedAt,
      t,
    ),
  );
  parts.push(
    formatMemorySection(
      t.settings.memory.markdown.longTermBackground,
      memory.history.longTermBackground.summary,
      memory.history.longTermBackground.updatedAt,
      t,
    ),
  );

  parts.push(`\n## ${t.settings.memory.markdown.facts}`);
  if (memory.facts.length === 0) {
    parts.push(
      `<span class="text-muted-foreground">${t.settings.memory.markdown.empty}</span>`,
    );
  } else {
    parts.push(
      [
        `| ${t.settings.memory.markdown.table.category} | ${t.settings.memory.markdown.table.confidence} | ${t.settings.memory.markdown.table.content} | ${t.settings.memory.markdown.table.source} | ${t.settings.memory.markdown.table.createdAt} |`,
        "|---|---|---|---|---|",
        ...memory.facts.map((f) => {
          const { key, value } = confidenceToLevelKey(f.confidence);
          const levelLabel =
            t.settings.memory.markdown.table.confidenceLevel[key];
          const confidenceText =
            typeof value === "number" ? `${levelLabel}` : levelLabel;
          return `| ${upperFirst(f.category)} | ${confidenceText} | ${f.content} | [${t.settings.memory.markdown.table.view}](${pathOfThread(f.source)}) | ${formatTimeAgo(f.createdAt)} |`;
        }),
      ].join("\n"),
    );
  }

  const markdown = parts.join("\n\n");

  // Ensure every level-2 heading (##) is preceded by a horizontal rule.
  const lines = markdown.split("\n");
  const out: string[] = [];
  let i = 0;
  for (const line of lines) {
    i++;
    if (i !== 1 && line.startsWith("## ")) {
      if (out.length === 0 || out[out.length - 1] !== "---") {
        out.push("---");
      }
    }
    out.push(line);
  }

  return out.join("\n");
}

export function MemorySettingsPage({ onClose }: { onClose?: () => void }) {
  const { t } = useI18n();
  const { memory, isLoading, error } = useMemory();
  return (
    <SettingsSection
      title={t.settings.memory.title}
      description={t.settings.memory.description}
    >
      <div className="bg-muted/40 mb-4 rounded-lg border px-3 py-2 text-xs">
        <p className="font-medium">{t.settings.memory.scopeTitle}</p>
        <p className="text-muted-foreground mt-1">{t.settings.memory.scopeDescription}</p>
      </div>
      {isLoading ? (
        <div className="text-muted-foreground text-sm">{t.common.loading}</div>
      ) : error ? (
        <div>Error: {error.message}</div>
      ) : !memory ? (
        <div className="text-muted-foreground text-sm">
          {t.settings.memory.empty}
        </div>
      ) : (
        <div className="rounded-lg border p-4">
          <Streamdown
            className="size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
            {...streamdownPlugins}
            components={{
              a: (props) => <MemorySourceLink {...props} onNavigate={onClose} />,
            }}
          >
            {memoryToMarkdown(memory, t)}
          </Streamdown>
        </div>
      )}
    </SettingsSection>
  );
}

function upperFirst(str: string) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
