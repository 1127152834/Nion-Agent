import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";

// Mention system types
export type InputMode = "flash" | "thinking" | "pro" | "ultra";

export type MentionTrigger = "@" | "/";

export interface MentionOption {
  id: string;
  label: string;
  value: string;
  kind: "file" | "directory" | "skill" | "mcp" | "cli";
  description?: string;
}

export interface MentionState {
  trigger: MentionTrigger;
  query: string;
  start: number;
  end: number;
}

export interface SelectedContextTag {
  value: string;
  kind: "file" | "directory";
}

export interface FollowUpSuggestionMessage {
  role: "user" | "assistant";
  content: string;
}

export interface RecentMentionsState {
  "@": string[];
  "/": string[];
}

export interface MentionGroup {
  id: string;
  label: string;
  options: MentionOption[];
}

// Constants
export const RECENT_MENTION_LIMIT = 5;
export const RECENT_MODELS_STORAGE_KEY = "nion:recent-models";
export const RECENT_MODELS_LIMIT = 5;

// Mention system utility functions
export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
}

export function basename(path: string): string {
  const normalized = normalizePath(path).replace(/\/$/, "");
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? normalized;
}

export function buildPathMentionOptions(paths: string[]): MentionOption[] {
  const fileSet = new Set<string>();
  const directorySet = new Set<string>();

  for (const rawPath of paths) {
    const normalized = normalizePath(rawPath).trim();
    if (!normalized) {
      continue;
    }

    const isDirectoryInput = normalized.endsWith("/");
    const pathWithoutTrailingSlash = normalized.replace(/\/+$/, "");
    if (!pathWithoutTrailingSlash) {
      continue;
    }

    if (isDirectoryInput) {
      directorySet.add(pathWithoutTrailingSlash);
    } else {
      fileSet.add(pathWithoutTrailingSlash);
    }

    const parts = pathWithoutTrailingSlash.split("/").filter(Boolean);
    const rootsPrefix = pathWithoutTrailingSlash.startsWith("/") ? "/" : "";
    let current = "";
    for (let index = 0; index < parts.length - 1; index += 1) {
      current = `${current}/${parts[index]}`;
      directorySet.add(`${rootsPrefix}${current}`.replace(/\/{2,}/g, "/"));
    }
  }

  const directoryOptions: MentionOption[] = [...directorySet]
    .filter((path) => path !== "/mnt" && path !== "mnt")
    .sort((a, b) => a.localeCompare(b))
    .map((path) => ({
      id: `dir:${path}`,
      label: basename(path),
      value: path,
      kind: "directory" as const,
      description: path,
    }));
  const fileOptions: MentionOption[] = [...fileSet]
    .sort((a, b) => a.localeCompare(b))
    .map((path) => ({
      id: `file:${path}`,
      label: basename(path),
      value: path,
      kind: "file" as const,
      description: path,
    }));
  return [...directoryOptions, ...fileOptions];
}

export function readRecentModels(): string[] {
  try {
    const stored = localStorage.getItem(RECENT_MODELS_STORAGE_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeRecentModels(models: string[]): void {
  try {
    localStorage.setItem(RECENT_MODELS_STORAGE_KEY, JSON.stringify(models));
  } catch {
    // Ignore storage errors
  }
}

export function getResolvedMode(
  mode: InputMode | undefined,
  supportsThinking: boolean,
): InputMode {
  if (!supportsThinking && mode !== "flash") {
    return "flash";
  }
  if (mode) {
    return mode;
  }
  return supportsThinking ? "pro" : "flash";
}

export function normalizeFollowUpRole(value: unknown): "user" | "assistant" | null {
  const role = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (role === "user" || role === "human") {
    return "user";
  }
  if (role === "assistant" || role === "ai") {
    return "assistant";
  }
  return null;
}

export function extractFollowUpText(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }
  if (Array.isArray(content)) {
    return content
      .flatMap((part) => {
        if (typeof part === "string") {
          return [part.trim()];
        }
        if (typeof part === "object" && part !== null) {
          const candidate = (part as { text?: unknown }).text;
          if (typeof candidate === "string") {
            return [candidate.trim()];
          }
        }
        return [];
      })
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  if (typeof content === "object" && content !== null) {
    const candidate = (content as { text?: unknown; content?: unknown }).text
      ?? (content as { text?: unknown; content?: unknown }).content;
    if (typeof candidate === "string") {
      return candidate.trim();
    }
  }
  return "";
}

export function buildFollowUpMessages(messages: unknown[]): FollowUpSuggestionMessage[] {
  const parsed = messages
    .map((message) => {
      if (typeof message !== "object" || message === null) {
        return null;
      }
      const role = normalizeFollowUpRole((message as { type?: unknown; role?: unknown }).type
        ?? (message as { type?: unknown; role?: unknown }).role);
      if (!role) {
        return null;
      }
      const content = extractFollowUpText((message as { content?: unknown }).content);
      if (!content) {
        return null;
      }
      return { role, content };
    })
    .filter((item): item is FollowUpSuggestionMessage => Boolean(item));

  return parsed.slice(-8);
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function hasInlineMention(text: string, mention: string): boolean {
  const pattern = new RegExp(`(^|\\s)${escapeRegExp(mention)}(?=\\s|$)`);
  return pattern.test(text);
}

export function buildSubmissionPayload(
  text: string,
  selectedSkills: string[],
  selectedContexts: SelectedContextTag[],
  selectedMcpTools: string[],
  selectedCliTools: string[],
): {
  text: string;
  implicitMentions: NonNullable<PromptInputMessage["implicitMentions"]>;
} {
  const trimmed = text.trim();
  if (!trimmed) {
    return { text: trimmed, implicitMentions: [] };
  }

  const implicitMentions: NonNullable<PromptInputMessage["implicitMentions"]> = [];
  const seenMentions = new Set<string>();

  const appendImplicitMention = (
    kind: "context" | "skill" | "mcp" | "cli",
    value: string,
    mention: string,
  ) => {
    if (hasInlineMention(trimmed, mention) || seenMentions.has(mention)) {
      return;
    }
    seenMentions.add(mention);
    implicitMentions.push({ kind, value, mention });
  };

  for (const context of selectedContexts) {
    const mention = `@${context.value}`;
    appendImplicitMention("context", context.value, mention);
  }

  for (const skill of selectedSkills) {
    const mention = `/${skill}`;
    appendImplicitMention("skill", skill, mention);
  }

  for (const tool of selectedMcpTools) {
    const mention = `@${tool}`;
    appendImplicitMention("mcp", tool, mention);
  }

  for (const tool of selectedCliTools) {
    const mention = `#${tool}`;
    appendImplicitMention("cli", tool, mention);
  }

  if (implicitMentions.length === 0) {
    return { text: trimmed, implicitMentions: [] };
  }

  const mentionLine = implicitMentions.map((item) => item.mention).join(" ");
  return {
    text: `${trimmed}\n\n${mentionLine}`,
    implicitMentions,
  };
}
