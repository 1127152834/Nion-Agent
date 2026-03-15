"use client";

import type { ChatStatus } from "ai";
import {
  CheckIcon,
  FileIcon,
  FolderIcon,
  GraduationCapIcon,
  LightbulbIcon,
  PaperclipIcon,
  PlusIcon,
  SparklesIcon,
  RocketIcon,
  SquareTerminalIcon,
  WrenchIcon,
  ZapIcon,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  Fragment,
  useMemo,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";

import {
  PromptInput,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuItem,
  PromptInputActionMenuTrigger,
  PromptInputAttachment,
  PromptInputAttachments,
  PromptInputBody,
  PromptInputButton,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputAttachments,
  usePromptInputController,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import { ConfettiButton } from "@/components/ui/confetti-button";
import {
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useCLIConfig } from "@/core/cli/hooks";
import { getBackendBaseURL } from "@/core/config";
import { useI18n } from "@/core/i18n/hooks";
import { useMCPConfig } from "@/core/mcp/hooks";
import { useModels } from "@/core/models/hooks";
import { useAppRouter as useRouter } from "@/core/navigation";
import { useLocalSettings } from "@/core/settings";
import { useSkills } from "@/core/skills/hooks";
import { getLocalizedSkillDescription, getLocalizedSkillName } from "@/core/skills/i18n";
import type { AgentThreadContext } from "@/core/threads";
import { cn } from "@/lib/utils";

import {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorInput,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorName,
  ModelSelectorTrigger,
  ModelSelectorCheck,
  ModelSelectorGroupTitle,
  ModelSelectorSeparator,
} from "../ai-elements/model-selector";
import { Suggestion, Suggestions } from "../ai-elements/suggestion";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";

import { useThread } from "./messages/context";
import { ModeHoverGuide } from "./mode-hover-guide";
import { Tooltip } from "./tooltip";

type InputMode = "flash" | "thinking" | "pro" | "ultra";

// Mention system types
type MentionTrigger = "@" | "/";

interface MentionOption {
  id: string;
  label: string;
  value: string;
  kind: "file" | "directory" | "skill" | "mcp" | "cli";
  description?: string;
}

interface MentionState {
  trigger: MentionTrigger;
  query: string;
  start: number;
  end: number;
}

interface SelectedContextTag {
  value: string;
  kind: "file" | "directory";
}

interface FollowUpSuggestionMessage {
  role: "user" | "assistant";
  content: string;
}

interface RecentMentionsState {
  "@": string[];
  "/": string[];
}

interface MentionGroup {
  id: string;
  label: string;
  options: MentionOption[];
}

// Constants
const RECENT_MENTION_LIMIT = 5;
const RECENT_MODELS_STORAGE_KEY = "nion:recent-models";
const RECENT_MODELS_LIMIT = 5;

// Mention system utility functions
function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
}

function basename(path: string): string {
  const normalized = normalizePath(path).replace(/\/$/, "");
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? normalized;
}

function buildPathMentionOptions(paths: string[]): MentionOption[] {
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

/**
 * Parse text to identify selected mentions for highlighting
 */
function parseMentions(
  text: string,
  selectedSkills: string[],
  selectedContexts: SelectedContextTag[],
  selectedMcpTools: string[]
): Array<{ type: 'skill' | 'context' | 'tool'; value: string; start: number; end: number }> {
  const mentions: Array<{
    type: 'skill' | 'context' | 'tool';
    value: string;
    start: number;
    end: number;
  }> = [];

  // Match /skill-name format (ensure preceded by space or start of string)
  const skillRegex = /(^|\s)(\/[a-zA-Z0-9_-]+)/g;
  let match;
  while ((match = skillRegex.exec(text)) !== null) {
    const skillText = match[2]; // /skill-name
    const skillName = skillText.slice(1); // remove /
    if (selectedSkills.includes(skillName)) {
      mentions.push({
        type: 'skill',
        value: skillName,
        start: match.index + match[1].length,
        end: match.index + match[0].length,
      });
    }
  }

  // Match @file-path or @tool-name format (ensure preceded by space or start of string)
  const atRegex = /(^|\s)(@[^\s]+)/g;
  while ((match = atRegex.exec(text)) !== null) {
    const atText = match[2]; // @value
    const value = atText.slice(1); // remove @
    if (selectedMcpTools.includes(value)) {
      mentions.push({
        type: 'tool',
        value,
        start: match.index + match[1].length,
        end: match.index + match[0].length,
      });
    } else if (selectedContexts.some((c) => c.value === value)) {
      mentions.push({
        type: 'context',
        value,
        start: match.index + match[1].length,
        end: match.index + match[0].length,
      });
    }
  }

  return mentions;
}

/**
 * Overlay component to highlight selected mentions in the input text
 */
function MentionHighlightOverlay({
  text,
  mentions,
}: {
  text: string;
  mentions: Array<{ type: 'skill' | 'context' | 'tool'; value: string; start: number; end: number }>;
}) {
  // Split text into segments (plain text or mention)
  const segments: Array<{ text: string; isMention: boolean; type?: string }> = [];
  let lastIndex = 0;

  // Sort mentions by position
  const sortedMentions = [...mentions].sort((a, b) => a.start - b.start);

  for (const mention of sortedMentions) {
    // Add plain text before mention
    if (mention.start > lastIndex) {
      segments.push({
        text: text.slice(lastIndex, mention.start),
        isMention: false,
      });
    }
    // Add mention
    segments.push({
      text: text.slice(mention.start, mention.end),
      isMention: true,
      type: mention.type,
    });
    lastIndex = mention.end;
  }

  // Add remaining plain text
  if (lastIndex < text.length) {
    segments.push({
      text: text.slice(lastIndex),
      isMention: false,
    });
  }

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words p-3 text-sm leading-relaxed">
      {segments.map((segment, index) => {
        if (segment.isMention) {
          const colorClass =
            segment.type === 'skill'
              ? 'bg-purple-500/30 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300'
              : segment.type === 'context'
                ? 'bg-blue-500/30 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300'
                : 'bg-green-500/30 text-green-700 dark:bg-green-500/20 dark:text-green-300';
          return (
            <span key={index} className={cn('rounded px-0.5 font-semibold', colorClass)}>
              {segment.text}
            </span>
          );
        }
        return (
          <span key={index} className="text-transparent">
            {segment.text}
          </span>
        );
      })}
    </div>
  );
}

function resolveMentionState(value: string, caret: number): MentionState | null {
  const safeCaret = Math.max(0, Math.min(caret, value.length));
  if (safeCaret <= 0) {
    return null;
  }

  // Scan backward to find the nearest trigger character.
  let triggerIndex = -1;
  let trigger: MentionTrigger | null = null;

  for (let i = safeCaret - 1; i >= 0; i--) {
    const char = value.charAt(i);

    // Stop scanning when we hit whitespace/newline.
    if (char === ' ' || char === '\n') {
      break;
    }

    // Mention trigger found.
    if (char === '@' || char === '/') {
      // Allow mention triggers in any position.
      triggerIndex = i;
      trigger = char as MentionTrigger;
      break;
    }
  }

  if (triggerIndex === -1 || !trigger) {
    return null;
  }

  const query = value.slice(triggerIndex + 1, safeCaret);

  return {
    trigger,
    query,
    start: triggerIndex,
    end: safeCaret,
  };
}

function rankMentionOption(option: MentionOption, normalizedQuery: string): number {
  if (!normalizedQuery) {
    return 0;
  }
  const label = option.label.toLowerCase();
  const value = option.value.toLowerCase();
  const description = option.description?.toLowerCase() ?? "";

  if (label === normalizedQuery || value === normalizedQuery) {
    return 5;
  }
  if (label.startsWith(normalizedQuery) || value.startsWith(normalizedQuery)) {
    return 4;
  }
  if (label.includes(normalizedQuery) || value.includes(normalizedQuery)) {
    return 3;
  }

  if (description.includes(normalizedQuery)) {
    return 2;
  }

  const terms = normalizedQuery.split(/\s+/).filter(Boolean);
  if (terms.length > 1) {
    const matchedAllTerms = terms.every(
      (term) =>
        label.includes(term) || value.includes(term) || description.includes(term),
    );
    if (matchedAllTerms) {
      return 1;
    }
  }

  return 0;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasInlineMention(text: string, mention: string): boolean {
  const pattern = new RegExp(`(^|\\s)${escapeRegExp(mention)}(?=\\s|$)`);
  return pattern.test(text);
}

function buildSubmissionPayload(
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

function readRecentModels(): string[] {
  try {
    const stored = localStorage.getItem(RECENT_MODELS_STORAGE_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeRecentModels(models: string[]): void {
  try {
    localStorage.setItem(RECENT_MODELS_STORAGE_KEY, JSON.stringify(models));
  } catch {
    // Ignore storage errors
  }
}

function getResolvedMode(
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

function normalizeFollowUpRole(value: unknown): "user" | "assistant" | null {
  const role = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (role === "user" || role === "human") {
    return "user";
  }
  if (role === "assistant" || role === "ai") {
    return "assistant";
  }
  return null;
}

function extractFollowUpText(content: unknown): string {
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

function buildFollowUpMessages(messages: unknown[]): FollowUpSuggestionMessage[] {
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

export function InputBox({
  className,
  threadId,
  disabled,
  autoFocus,
  status = "ready",
  context,
  extraHeader,
  isNewThread,
  initialValue,
  workspacePaths = [],
  extraTools,
  onContextChange,
  onSubmit,
  onStop,
  ...props
}: Omit<ComponentProps<typeof PromptInput>, "onSubmit"> & {
  threadId: string;
  assistantId?: string | null;
  status?: ChatStatus;
  disabled?: boolean;
  context: Omit<
    AgentThreadContext,
    "thread_id" | "is_plan_mode" | "thinking_enabled" | "subagent_enabled"
  > & {
    mode: "flash" | "thinking" | "pro" | "ultra" | undefined;
    reasoning_effort?: "minimal" | "low" | "medium" | "high";
  };
  extraHeader?: React.ReactNode;
  isNewThread?: boolean;
  initialValue?: string;
  workspacePaths?: string[];
  extraTools?: React.ReactNode;
  onContextChange?: (
    context: Omit<
      AgentThreadContext,
      "thread_id" | "is_plan_mode" | "thinking_enabled" | "subagent_enabled"
    > & {
      mode: "flash" | "thinking" | "pro" | "ultra" | undefined;
      reasoning_effort?: "minimal" | "low" | "medium" | "high";
    },
  ) => void;
  onSubmit?: (message: PromptInputMessage) => void;
  onStop?: () => void;
}) {
  const { t, locale } = useI18n();
  const mentionLabels = t.migration.workspace?.inputBox;
  const searchParams = useSearchParams();
  const [hydrated, setHydrated] = useState(false);
  const { thread } = useThread();
  const [modelDialogOpen, setModelDialogOpen] = useState(false);
  const { models } = useModels();
  const [localSettings, setLocalSettings] = useLocalSettings();
  const [localModelName, setLocalModelName] = useState<string | undefined>(
    undefined,
  );

  // Mention system state
  const [mentionState, setMentionState] = useState<MentionState | null>(null);
  const [mentionActiveIndex, setMentionActiveIndex] = useState(0);
  const [selectedContexts, setSelectedContexts] = useState<SelectedContextTag[]>([]);
  const [selectedMcpTools, setSelectedMcpTools] = useState<string[]>([]);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [selectedCliTools, setSelectedCliTools] = useState<string[]>([]);
  const [recentMentions, setRecentMentions] = useState<RecentMentionsState>({
    "@": [],
    "/": [],
  });
  const [mcpSelectorOpen, setMcpSelectorOpen] = useState(false);
  const [mcpSelectorQuery, setMcpSelectorQuery] = useState("");
  const [cliSelectorOpen, setCliSelectorOpen] = useState(false);
  const [cliSelectorQuery, setCliSelectorQuery] = useState("");
  const [contextSelectorOpen, setContextSelectorOpen] = useState(false);
  const [contextSelectorQuery, setContextSelectorQuery] = useState("");
  const [skillSelectorOpen, setSkillSelectorOpen] = useState(false);
  const [skillSelectorQuery, setSkillSelectorQuery] = useState("");
  const [recentModelNames, setRecentModelNames] = useState<string[]>([]);

  useEffect(() => {
    setHydrated(true);
  }, []);

  // Load recent models on mount
  useEffect(() => {
    setRecentModelNames(readRecentModels());
  }, []);

  // Read initial model from local settings for model selector persistence
  useEffect(() => {
    const persistedModelName = localSettings.context.model_name;
    setLocalModelName(
      typeof persistedModelName === "string" ? persistedModelName : undefined,
    );
  }, [localSettings.context.model_name]);

  // Fetch data for mention options
  const { skills } = useSkills();
  const { config: mcpConfig } = useMCPConfig();
  const { config: cliConfig } = useCLIConfig();
  const defaultContextLabel = t.inputBox.contextLabel;
  const defaultSkillLabel = t.inputBox.skillLabel;
  const defaultMcpLabel = t.inputBox.mcpLabel;
  const defaultSearchMcpTools = t.inputBox.searchMcpTools;
  const defaultNoMcpTools = t.inputBox.noMcpTools;
  const defaultCliLabel = t.inputBox.cliLabel ?? "CLI Tools";
  const defaultSearchCliTools = t.inputBox.searchCliTools ?? "Search CLI tools...";
  const defaultNoCliTools = t.inputBox.noCliTools ?? "No CLI tools available";

  // Build mention options
  const fileMentionOptions = useMemo<MentionOption[]>(
    () => buildPathMentionOptions(workspacePaths),
    [workspacePaths],
  );

  const skillMentionOptions = useMemo<MentionOption[]>(
    () =>
      skills.map((skill) => ({
        id: `skill:${skill.name}`,
        label: getLocalizedSkillName(skill.name, locale),
        value: skill.name,
        kind: "skill",
        description: getLocalizedSkillDescription(skill, locale),
      })),
    [locale, skills],
  );

  const mcpMentionOptions = useMemo<MentionOption[]>(
    () =>
      Object.entries(mcpConfig?.mcp_servers ?? {})
        .filter(([, server]) => server.enabled)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([serverName, server]) => ({
          id: `mcp:${serverName}`,
          label: serverName,
          value: serverName,
          kind: "mcp",
          description: (server.description?.trim() ?? "") ? (server.description?.trim() ?? "") : "MCP tool",
        })),
    [mcpConfig?.mcp_servers],
  );

  const cliMentionOptions = useMemo<MentionOption[]>(
    () =>
      Object.entries(cliConfig?.clis ?? {})
        .filter(([, tool]) => tool.enabled)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([toolId, tool]) => ({
          id: `cli:${toolId}`,
          label: toolId,
          value: toolId,
          kind: "cli",
          description: `CLI tool (${tool.source})`,
        })),
    [cliConfig?.clis],
  );

  // Filter and rank mention options based on query
  const filteredMentionOptions = useMemo(() => {
    if (!mentionState) {
      return [];
    }
    const source =
      mentionState.trigger === "@"
        ? fileMentionOptions
        : skillMentionOptions;
    const normalizedQuery = mentionState.query.trim().toLowerCase();
    return source
      .map((option) => ({
        option,
        score: rankMentionOption(option, normalizedQuery),
      }))
      .filter((item) => item.score > 0 || !normalizedQuery)
      .sort((a, b) => {
        if (a.score !== b.score) {
          return b.score - a.score;
        }
        return a.option.value.localeCompare(b.option.value);
      })
      .slice(0, 80)
      .map((item) => item.option);
  }, [fileMentionOptions, mentionState, skillMentionOptions]);

  // Group mention options with recent items
  const mentionGroups = useMemo<MentionGroup[]>(() => {
    if (!mentionState) {
      return [];
    }

    const recents = recentMentions[mentionState.trigger] ?? [];
    const byValue = new Map(
      filteredMentionOptions.map((option) => [option.value, option]),
    );
    const recentOptions = recents
      .map((value) => byValue.get(value))
      .filter((item): item is MentionOption => Boolean(item));
    const recentValues = new Set(recentOptions.map((item) => item.value));
    const remaining = filteredMentionOptions.filter(
      (item) => !recentValues.has(item.value),
    );

    const groups: MentionGroup[] = [];
    if (recentOptions.length > 0) {
      groups.push({
        id: "recent",
        label: mentionLabels?.recentLabel ?? "Recent",
        options: recentOptions.slice(0, RECENT_MENTION_LIMIT),
      });
    }

    if (mentionState.trigger === "/") {
      if (remaining.length > 0) {
        groups.push({
          id: "skills",
          label: mentionLabels?.allSkillsLabel ?? "All skills",
          options: remaining.slice(0, 40),
        });
      }
    } else {
      const directories = remaining.filter((item) => item.kind === "directory");
      const files = remaining.filter((item) => item.kind === "file");

      if (directories.length > 0) {
        groups.push({
          id: "directories",
          label: mentionLabels?.directoriesLabel ?? "Directories",
          options: directories.slice(0, 20),
        });
      }
      if (files.length > 0) {
        groups.push({
          id: "files",
          label: mentionLabels?.filesLabel ?? "Files",
          options: files.slice(0, 20),
        });
      }
    }

    return groups;
  }, [filteredMentionOptions, mentionLabels, mentionState, recentMentions]);

  // Filter MCP options for selector
  const filteredMcpSelectorOptions = useMemo(() => {
    const normalizedQuery = mcpSelectorQuery.trim().toLowerCase();
    return mcpMentionOptions
      .map((option) => ({
        option,
        score: rankMentionOption(option, normalizedQuery),
      }))
      .filter((item) => item.score > 0 || !normalizedQuery)
      .sort((a, b) => {
        if (a.score !== b.score) {
          return b.score - a.score;
        }
        return a.option.value.localeCompare(b.option.value);
      })
      .map((item) => item.option);
  }, [mcpMentionOptions, mcpSelectorQuery]);

  const filteredContextSelectorOptions = useMemo(() => {
    const normalizedQuery = contextSelectorQuery.trim().toLowerCase();
    return fileMentionOptions
      .map((option) => ({
        option,
        score: rankMentionOption(option, normalizedQuery),
      }))
      .filter((item) => item.score > 0 || !normalizedQuery)
      .sort((a, b) => {
        if (a.score !== b.score) {
          return b.score - a.score;
        }
        return a.option.value.localeCompare(b.option.value);
      })
      .map((item) => item.option);
  }, [contextSelectorQuery, fileMentionOptions]);

  const filteredSkillSelectorOptions = useMemo(() => {
    const normalizedQuery = skillSelectorQuery.trim().toLowerCase();
    return skillMentionOptions
      .map((option) => ({
        option,
        score: rankMentionOption(option, normalizedQuery),
      }))
      .filter((item) => item.score > 0 || !normalizedQuery)
      .sort((a, b) => {
        if (a.score !== b.score) {
          return b.score - a.score;
        }
        return a.option.value.localeCompare(b.option.value);
      })
      .map((item) => item.option);
  }, [skillMentionOptions, skillSelectorQuery]);

  const filteredCliSelectorOptions = useMemo(() => {
    const normalizedQuery = cliSelectorQuery.trim().toLowerCase();
    return cliMentionOptions
      .map((option) => ({
        option,
        score: rankMentionOption(option, normalizedQuery),
      }))
      .filter((item) => item.score > 0 || !normalizedQuery)
      .sort((a, b) => {
        if (a.score !== b.score) {
          return b.score - a.score;
        }
        return a.option.value.localeCompare(b.option.value);
      })
      .map((item) => item.option);
  }, [cliMentionOptions, cliSelectorQuery]);

  const toggleMcpTool = useCallback((value: string) => {
    setSelectedMcpTools((prev) => {
      if (prev.includes(value)) {
        return prev.filter((item) => item !== value);
      }
      return [...prev, value];
    });
  }, []);

  const toggleContextOption = useCallback((option: MentionOption) => {
    if (option.kind !== "file" && option.kind !== "directory") {
      return;
    }
    setSelectedContexts((prev) => {
      if (prev.some((item) => item.value === option.value)) {
        return prev.filter((item) => item.value !== option.value);
      }
      return [
        ...prev,
        { value: option.value, kind: option.kind === "directory" ? "directory" : "file" },
      ];
    });
  }, []);

  const toggleSkillOption = useCallback((skill: string) => {
    setSelectedSkills((prev) => {
      if (prev.includes(skill)) {
        return prev.filter((item) => item !== skill);
      }
      return [...prev, skill];
    });
  }, []);

  const toggleCliTool = useCallback((value: string) => {
    setSelectedCliTools((prev) => {
      if (prev.includes(value)) {
        return prev.filter((item) => item !== value);
      }
      return [...prev, value];
    });
  }, []);

  // Get text input controller
  const { textInput } = usePromptInputController();
  const [followUpSuggestions, setFollowUpSuggestions] = useState<string[]>([]);
  const [followUpLoading, setFollowUpLoading] = useState(false);

  const suggestionModelName = useMemo<string | undefined>(() => {
    const contextModelName =
      typeof context.model_name === "string" ? context.model_name : undefined;
    return contextModelName ?? localModelName;
  }, [context.model_name, localModelName]);

  const followUpMessages = useMemo(
    () => buildFollowUpMessages(Array.isArray(thread.messages) ? thread.messages : []),
    [thread.messages],
  );
  const followUpFetchKey = useMemo(() => {
    if (!threadId || followUpMessages.length < 2) {
      return "";
    }
    const lastAssistant = [...followUpMessages]
      .reverse()
      .find((message) => message.role === "assistant");
    if (!lastAssistant) {
      return "";
    }
    return `${threadId}:${suggestionModelName ?? ""}:${followUpMessages.length}:${lastAssistant.content}`;
  }, [followUpMessages, suggestionModelName, threadId]);

  useEffect(() => {
    if (status === "streaming") {
      setFollowUpSuggestions([]);
    }
  }, [status]);

  useEffect(() => {
    if (isNewThread || status !== "ready" || !followUpFetchKey) {
      setFollowUpSuggestions((current) => (current.length === 0 ? current : []));
      return;
    }

    const controller = new AbortController();
    let disposed = false;

    const fetchSuggestions = async () => {
      setFollowUpLoading(true);
      try {
        const response = await fetch(
          `${getBackendBaseURL()}/api/threads/${threadId}/suggestions`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              messages: followUpMessages,
              n: 3,
              model_name: suggestionModelName,
            }),
            signal: controller.signal,
          },
        );
        if (!response.ok) {
          throw new Error(`suggestions http ${response.status}`);
        }
        const payload = (await response.json()) as { suggestions?: unknown };
        const parsed = Array.isArray(payload.suggestions)
          ? payload.suggestions
            .filter((item): item is string => typeof item === "string")
            .map((item) => item.trim())
            .filter(Boolean)
            .slice(0, 3)
          : [];
        if (!disposed) {
          setFollowUpSuggestions(parsed);
        }
      } catch {
        if (!disposed && !controller.signal.aborted) {
          setFollowUpSuggestions([]);
        }
      } finally {
        if (!disposed) {
          setFollowUpLoading(false);
        }
      }
    };

    void fetchSuggestions();

    return () => {
      disposed = true;
      controller.abort();
    };
  }, [followUpFetchKey, followUpMessages, isNewThread, status, suggestionModelName, threadId]);

  const handleFollowUpSuggestionClick = useCallback(
    (prompt: string) => {
      const normalized = prompt.trim();
      if (!normalized) {
        return;
      }
      textInput.setInput(normalized);
      setTimeout(() => {
        const textarea = document.querySelector<HTMLTextAreaElement>(
          "textarea[name='message']",
        );
        textarea?.focus();
      }, 0);
    },
    [textInput],
  );

  // Parse mentions for highlighting
  const highlightedMentions = useMemo(() => {
    return parseMentions(
      textInput.value,
      selectedSkills,
      selectedContexts,
      selectedMcpTools
    );
  }, [textInput.value, selectedSkills, selectedContexts, selectedMcpTools]);

  // Helper functions for mention system
  const pushRecentMention = useCallback((trigger: MentionTrigger, value: string) => {
    setRecentMentions((prev) => {
      const list = prev[trigger];
      const filtered = list.filter((item) => item !== value);
      const next = [value, ...filtered].slice(0, RECENT_MENTION_LIMIT);
      return { ...prev, [trigger]: next };
    });
  }, []);

  const addSelectedContext = useCallback((value: string, kind: "file" | "directory") => {
    setSelectedContexts((prev) => {
      if (prev.some((item) => item.value === value)) {
        return prev;
      }
      return [...prev, { value, kind }];
    });
  }, []);

  const addSelectedSkill = useCallback((value: string) => {
    setSelectedSkills((prev) => {
      if (prev.includes(value)) {
        return prev;
      }
      return [...prev, value];
    });
  }, []);

  const removeSelectedContext = useCallback((value: string) => {
    setSelectedContexts((prev) => prev.filter((item) => item.value !== value));
  }, []);

  const removeSelectedSkill = useCallback((value: string) => {
    setSelectedSkills((prev) => prev.filter((item) => item !== value));
  }, []);

  const removeSelectedCliTool = useCallback((value: string) => {
    setSelectedCliTools((prev) => prev.filter((item) => item !== value));
  }, []);

  const removeSelectedMcpTool = useCallback((value: string) => {
    setSelectedMcpTools((prev) => prev.filter((item) => item !== value));
  }, []);

  const focusMessageInput = useCallback(() => {
    return document.querySelector<HTMLTextAreaElement>("textarea[name='message']");
  }, []);

  const syncMentionState = useCallback((value: string, caret: number) => {
    const resolved = resolveMentionState(value, caret);
    if (!resolved) {
      setMentionState(null);
      return;
    }

    const query = value.slice(resolved.start + 1, caret);
    setMentionState({
      ...resolved,
      query,
      end: caret,
    });
  }, []);

  const applyMentionOption = useCallback(
    (option: MentionOption) => {
      if (!mentionState) {
        return;
      }
      const prefix = textInput.value.slice(0, mentionState.start);
      const suffix = textInput.value.slice(mentionState.end);

      // Insert selected mention and keep the trigger character.
      const mentionText = `${mentionState.trigger}${option.value}`;
      const nextValue = `${prefix}${mentionText} ${suffix}`;
      const nextCaret = prefix.length + mentionText.length + 1;

      textInput.setInput(nextValue);
      pushRecentMention(mentionState.trigger, option.value);
      if (mentionState.trigger === "@") {
        addSelectedContext(
          option.value,
          option.kind === "directory" ? "directory" : "file",
        );
      } else {
        addSelectedSkill(option.value);
      }
      setMentionState(null);
      setMentionActiveIndex(0);

      requestAnimationFrame(() => {
        const textarea = focusMessageInput();
        if (!textarea) {
          return;
        }
        textarea.focus();
        textarea.setSelectionRange(nextCaret, nextCaret);
      });
    },
    [
      addSelectedContext,
      addSelectedSkill,
      focusMessageInput,
      mentionState,
      pushRecentMention,
      textInput,
    ],
  );

  const insertMentionTrigger = useCallback((trigger: MentionTrigger) => {
    const textarea = focusMessageInput();
    const value = textInput.value;
    const start = textarea?.selectionStart ?? value.length;
    const end = textarea?.selectionEnd ?? start;

    const before = value.slice(0, start);
    const after = value.slice(end);
    const needsLeadingSpace = before.length > 0 && !/\s$/.test(before);
    const insertion = `${needsLeadingSpace ? " " : ""}${trigger}`;
    const nextValue = `${before}${insertion}${after}`;
    const nextCaret = before.length + insertion.length;

    textInput.setInput(nextValue);
    requestAnimationFrame(() => {
      const target = focusMessageInput();
      if (!target) {
        return;
      }
      target.focus();
      target.setSelectionRange(nextCaret, nextCaret);
    });
  }, [focusMessageInput, textInput]);

  const handleMentionKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const hasPrimaryModifier = event.metaKey || event.ctrlKey;
    if (hasPrimaryModifier && !event.altKey && event.key === "/") {
      event.preventDefault();
      insertMentionTrigger("/");
      return;
    }
    if (
      hasPrimaryModifier
      && !event.altKey
      && (event.key === "@" || (event.shiftKey && event.key === "2"))
    ) {
      event.preventDefault();
      insertMentionTrigger("@");
      return;
    }

    // When no mention popup is open, handle Enter for form submission
    if (!mentionState) {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        const form = event.currentTarget.form;
        if (form) {
          form.requestSubmit();
        }
      }
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setMentionState(null);
      return;
    }

    const flatOptions = mentionGroups.flatMap((group) => group.options);
    if (flatOptions.length === 0) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setMentionActiveIndex((current) =>
        (current + 1) % flatOptions.length,
      );
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setMentionActiveIndex((current) =>
        current === 0 ? flatOptions.length - 1 : current - 1,
      );
      return;
    }

    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      const currentOption =
        flatOptions[
          Math.min(mentionActiveIndex, flatOptions.length - 1)
        ];
      if (currentOption) {
        applyMentionOption(currentOption);
      }
    }
  }, [applyMentionOption, insertMentionTrigger, mentionActiveIndex, mentionGroups, mentionState]);

  // Reset active index when mention state changes
  useEffect(() => {
    if (!mentionState) {
      setMentionActiveIndex(0);
      return;
    }
    const flatOptions = mentionGroups.flatMap((group) => group.options);
    setMentionActiveIndex((current) => {
      if (flatOptions.length === 0) {
        return 0;
      }
      return Math.min(current, flatOptions.length - 1);
    });
  }, [mentionState, mentionGroups]);

  // Sync mention state on text input change
  useEffect(() => {
    const textarea = focusMessageInput();
    const caret = textarea?.selectionStart ?? textInput.value.length;
    syncMentionState(textInput.value, caret);
  }, [focusMessageInput, syncMentionState, textInput.value]);

  useEffect(() => {
    if (models.length === 0) {
      return;
    }
    const preferredModelName = context.model_name ?? localModelName;
    const currentModel = preferredModelName
      ? models.find((m) => m.name === preferredModelName)
      : undefined;
    const fallbackModel = currentModel ?? models[0]!;
    const supportsThinking = fallbackModel.supports_thinking ?? false;
    const nextModelName = fallbackModel.name;
    const nextMode = getResolvedMode(context.mode, supportsThinking);

    if (context.model_name === nextModelName && context.mode === nextMode) {
      return;
    }

    onContextChange?.({
      ...context,
      model_name: nextModelName,
      mode: nextMode,
    });

    setLocalSettings("context", {
      model_name: nextModelName,
    });
    setLocalModelName(nextModelName);
  }, [context, localModelName, models, onContextChange, setLocalSettings]);

  const activeModelName = context.model_name ?? localModelName;

  const selectedModel = useMemo(() => {
    if (models.length === 0) {
      return undefined;
    }
    return (
      models.find((m) => m.name === activeModelName) ??
      models.find((m) => m.name === localModelName) ??
      models[0]
    );
  }, [activeModelName, localModelName, models]);

  // Build recent and remaining models
  const modelNamesSet = useMemo(() => new Set(models.map((m) => m.name)), [models]);
  const recentModels = useMemo(
    () =>
      recentModelNames
        .filter((name) => modelNamesSet.has(name))
        .map((name) => models.find((model) => model.name === name))
        .filter((model): model is typeof models[0] => Boolean(model)),
    [modelNamesSet, models, recentModelNames],
  );
  const recentNameSet = useMemo(() => new Set(recentModels.map((m) => m.name)), [recentModels]);
  const remainingModels = useMemo(
    () => models.filter((model) => !recentNameSet.has(model.name)),
    [models, recentNameSet],
  );

  const supportThinking = useMemo(
    () => selectedModel?.supports_thinking ?? false,
    [selectedModel],
  );

  const supportReasoningEffort = useMemo(
    () => selectedModel?.supports_reasoning_effort ?? false,
    [selectedModel],
  );
  const resolvedMode = useMemo(
    () => getResolvedMode(context.mode, supportThinking),
    [context.mode, supportThinking],
  );

  const handleModelSelect = useCallback(
    (model_name: string) => {
      const model = models.find((m) => m.name === model_name);
      if (!model) {
        return;
      }
      onContextChange?.({
        ...context,
        model_name,
        mode: getResolvedMode(context.mode, model.supports_thinking ?? false),
        reasoning_effort: context.reasoning_effort,
      });
      setLocalSettings("context", {
        model_name,
      });
      setLocalModelName(model_name);
      setModelDialogOpen(false);

      // Track recent model
      setRecentModelNames((prev) => {
        const filtered = prev.filter((name) => name !== model_name);
        const next = [model_name, ...filtered].slice(0, RECENT_MODELS_LIMIT);
        writeRecentModels(next);
        return next;
      });
    },
    [onContextChange, context, models, setLocalSettings],
  );

  const handleModeSelect = useCallback(
    (mode: InputMode) => {
      onContextChange?.({
        ...context,
        mode: getResolvedMode(mode, supportThinking),
        reasoning_effort: mode === "ultra" ? "high" : mode === "pro" ? "medium" : mode === "thinking" ? "low" : "minimal",
      });
    },
    [onContextChange, context, supportThinking],
  );

  const handleReasoningEffortSelect = useCallback(
    (effort: "minimal" | "low" | "medium" | "high") => {
      onContextChange?.({
        ...context,
        reasoning_effort: effort,
      });
    },
    [onContextChange, context],
  );

  const handleSubmit = useCallback(
    async (message: PromptInputMessage) => {
      if (status === "streaming") {
        onStop?.();
        return;
      }
      const submissionPayload = buildSubmissionPayload(
        message.text,
        selectedSkills,
        selectedContexts,
        selectedMcpTools,
        selectedCliTools,
      );
      if (!submissionPayload.text) {
        return;
      }
      onSubmit?.({
        ...message,
        text: submissionPayload.text,
        implicitMentions:
          submissionPayload.implicitMentions.length > 0
            ? submissionPayload.implicitMentions
            : undefined,
      });
    },
    [onSubmit, onStop, selectedContexts, selectedMcpTools, selectedCliTools, selectedSkills, status],
  );

  if (!hydrated) {
    return (
      <div
        className={cn(
          "bg-background/5 border-border/70 min-h-24 w-full rounded-xl border px-3 py-3",
          className,
        )}
      />
    );
  }

  const MAX_INLINE_MENTION_SUMMARY_ITEMS = 3;
  const hasAnySelectedMentions =
    selectedContexts.length > 0
    || selectedSkills.length > 0
    || selectedMcpTools.length > 0
    || selectedCliTools.length > 0;

  const mentionSummaryGroups: Array<{ id: string; node: ReactNode }> = [];

  if (selectedContexts.length > 0) {
    const previewContexts = selectedContexts.slice(0, MAX_INLINE_MENTION_SUMMARY_ITEMS);
    const hiddenCount = selectedContexts.length - previewContexts.length;
    mentionSummaryGroups.push({
      id: "contexts",
      node: (
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground shrink-0 whitespace-nowrap text-[11px]">
            {mentionLabels?.contextLabel ?? defaultContextLabel}
          </span>
          <div className="flex items-center gap-1">
            {previewContexts.map((context) => (
              <button
                key={context.value}
                type="button"
                className="bg-muted/50 hover:bg-muted text-foreground inline-flex max-w-32 items-center gap-1 rounded-md px-2 py-0.5 text-[11px]"
                title={context.value}
                onClick={() => removeSelectedContext(context.value)}
              >
                {context.kind === "directory" ? (
                  <FolderIcon className="size-3 shrink-0" />
                ) : (
                  <FileIcon className="size-3 shrink-0" />
                )}
                <span className="min-w-0 truncate">{basename(context.value)}</span>
              </button>
            ))}
            {hiddenCount > 0 && (
              <button
                type="button"
                className="bg-muted/30 hover:bg-muted text-muted-foreground hover:text-foreground inline-flex shrink-0 items-center rounded-md px-2 py-0.5 text-[11px]"
                onClick={() => setContextSelectorOpen(true)}
              >
                +{hiddenCount}
              </button>
            )}
          </div>
        </div>
      ),
    });
  }

  if (selectedSkills.length > 0) {
    const previewSkills = selectedSkills.slice(0, MAX_INLINE_MENTION_SUMMARY_ITEMS);
    const hiddenCount = selectedSkills.length - previewSkills.length;
    mentionSummaryGroups.push({
      id: "skills",
      node: (
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-[11px]">
            <SparklesIcon className="size-3" />
            {mentionLabels?.skillLabel ?? defaultSkillLabel}
          </span>
          <div className="flex items-center gap-1">
            {previewSkills.map((skill) => (
              <button
                key={skill}
                type="button"
                className="bg-muted/50 hover:bg-muted text-foreground inline-flex max-w-40 items-center gap-1 rounded-md px-2 py-0.5 text-[11px]"
                title={getLocalizedSkillName(skill, locale)}
                onClick={() => removeSelectedSkill(skill)}
              >
                <span className="min-w-0 truncate">{getLocalizedSkillName(skill, locale)}</span>
              </button>
            ))}
            {hiddenCount > 0 && (
              <button
                type="button"
                className="bg-muted/30 hover:bg-muted text-muted-foreground hover:text-foreground inline-flex shrink-0 items-center rounded-md px-2 py-0.5 text-[11px]"
                onClick={() => setSkillSelectorOpen(true)}
              >
                +{hiddenCount}
              </button>
            )}
          </div>
        </div>
      ),
    });
  }

  if (selectedMcpTools.length > 0) {
    const previewTools = selectedMcpTools.slice(0, MAX_INLINE_MENTION_SUMMARY_ITEMS);
    const hiddenCount = selectedMcpTools.length - previewTools.length;
    mentionSummaryGroups.push({
      id: "mcp",
      node: (
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-[11px]">
            <WrenchIcon className="size-3" />
            {mentionLabels?.mcpLabel ?? defaultMcpLabel}
          </span>
          <div className="flex items-center gap-1">
            {previewTools.map((tool) => (
              <button
                key={tool}
                type="button"
                className="bg-muted/50 hover:bg-muted text-foreground inline-flex max-w-32 items-center gap-1 rounded-md px-2 py-0.5 text-[11px]"
                title={tool}
                onClick={() => removeSelectedMcpTool(tool)}
              >
                <span className="min-w-0 truncate">{tool}</span>
              </button>
            ))}
            {hiddenCount > 0 && (
              <button
                type="button"
                className="bg-muted/30 hover:bg-muted text-muted-foreground hover:text-foreground inline-flex shrink-0 items-center rounded-md px-2 py-0.5 text-[11px]"
                onClick={() => setMcpSelectorOpen(true)}
              >
                +{hiddenCount}
              </button>
            )}
          </div>
        </div>
      ),
    });
  }

  if (selectedCliTools.length > 0) {
    const previewTools = selectedCliTools.slice(0, MAX_INLINE_MENTION_SUMMARY_ITEMS);
    const hiddenCount = selectedCliTools.length - previewTools.length;
    mentionSummaryGroups.push({
      id: "cli",
      node: (
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-[11px]">
            <SquareTerminalIcon className="size-3" />
            {mentionLabels?.cliLabel ?? defaultCliLabel}
          </span>
          <div className="flex items-center gap-1">
            {previewTools.map((tool) => (
              <button
                key={tool}
                type="button"
                className="bg-muted/50 hover:bg-muted text-foreground inline-flex max-w-32 items-center gap-1 rounded-md px-2 py-0.5 text-[11px]"
                title={tool}
                onClick={() => removeSelectedCliTool(tool)}
              >
                <span className="min-w-0 truncate">{tool}</span>
              </button>
            ))}
            {hiddenCount > 0 && (
              <button
                type="button"
                className="bg-muted/30 hover:bg-muted text-muted-foreground hover:text-foreground inline-flex shrink-0 items-center rounded-md px-2 py-0.5 text-[11px]"
                onClick={() => setCliSelectorOpen(true)}
              >
                +{hiddenCount}
              </button>
            )}
          </div>
        </div>
      ),
    });
  }

  return (
    <PromptInput
      className={cn(
        "bg-background/85 rounded-2xl backdrop-blur-sm transition-all duration-300 ease-out *:data-[slot='input-group']:rounded-2xl",
        className,
      )}
      disabled={disabled}
      globalDrop
      multiple
      onSubmit={handleSubmit}
      {...props}
    >
      {extraHeader && (
        <div className="absolute top-0 right-0 left-0 z-10">
          <div className="absolute right-0 bottom-0 left-0 flex items-center justify-center">
            {extraHeader}
          </div>
        </div>
      )}
      <PromptInputAttachments>
        {(attachment) => <PromptInputAttachment data={attachment} />}
      </PromptInputAttachments>
      <PromptInputBody className="absolute top-0 right-0 left-0 z-[30]">
        <MentionHighlightOverlay text={textInput.value} mentions={highlightedMentions} />
        <PromptInputTextarea
          className={cn("size-full relative z-10 bg-transparent")}
          disabled={disabled}
          placeholder={t.inputBox.placeholder}
          autoFocus={autoFocus}
          defaultValue={initialValue}
          onKeyDown={handleMentionKeyDown}
        />
      </PromptInputBody>
      {/* Mention autocomplete popup */}
      {mentionState && (
        <div className="absolute right-0 bottom-full left-0 z-[140] pb-2">
          <div className="bg-background border-border mx-2 overflow-hidden rounded-lg border shadow-lg">
            <div className="border-border/70 border-b px-3 py-2">
              <span className="text-muted-foreground text-xs">
                {mentionLabels?.mentionHintSlash ?? "↑↓ select · Enter apply"}
              </span>
            </div>
            {mentionGroups.length === 0 ? (
              <div className="text-muted-foreground px-3 py-2 text-xs">
                {mentionLabels?.noMatches ?? "No matches"}
              </div>
            ) : (
              <div className="max-h-60 overflow-auto p-1">
                {(() => {
                  let optionIndex = -1;
                  return mentionGroups.map((group) => (
                    <div key={group.id} className="pt-1 first:pt-0">
                      <div className="text-muted-foreground px-2 pb-1 text-[10px]">
                        {group.label}
                      </div>
                      <div className="space-y-0.5">
                        {group.options.map((option) => {
                          optionIndex += 1;
                          const active = optionIndex === mentionActiveIndex;
                          return (
                            <button
                              key={option.id}
                              type="button"
                              className={cn(
                                "hover:bg-accent flex w-full items-start gap-2 rounded-md px-2 py-2 text-left transition-colors",
                                active && "bg-accent text-accent-foreground",
                              )}
                              onMouseDown={(event) => {
                                event.preventDefault();
                                applyMentionOption(option);
                              }}
                            >
                              <span className="text-muted-foreground mt-0.5">
                                {option.kind === "directory" && (
                                  <FolderIcon className="size-3.5" />
                                )}
                                {option.kind === "file" && (
                                  <FileIcon className="size-3.5" />
                                )}
                                {option.kind === "skill" && (
                                  <SparklesIcon className="size-3.5" />
                                )}
                                {option.kind === "mcp" && (
                                  <WrenchIcon className="size-3.5" />
                                )}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-xs font-medium">
                                  {option.kind === "skill"
                                    ? `/${option.label}`
                                    : option.kind === "mcp"
                                      ? `@mcp/${option.label}`
                                      : `@${option.label}`}
                                </span>
                                {option.description ? (
                                  <span className="text-muted-foreground block truncate text-[11px]">
                                    {option.description}
                                  </span>
                                ) : null}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ));
                })()}
              </div>
            )}
            <div className="border-border/70 border-t px-3 py-2">
              <div className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-[11px]">
                <kbd className="bg-background border-border/80 text-foreground rounded-md border px-2 py-0.5 font-mono text-[11px] leading-4 shadow-xs">
                  Tab
                </kbd>
                <span>{mentionLabels?.completeLabel ?? "Complete"}</span>
                <kbd className="bg-background border-border/80 text-foreground rounded-md border px-2 py-0.5 font-mono text-[11px] leading-4 shadow-xs">
                  ↑↓
                </kbd>
                <span>{mentionLabels?.navigateLabel ?? "Navigate"}</span>
                <kbd className="bg-background border-border/80 text-foreground rounded-md border px-2 py-0.5 font-mono text-[11px] leading-4 shadow-xs">
                  Enter
                </kbd>
                <span>{mentionLabels?.selectLabel ?? "Select"}</span>
                <kbd className="bg-background border-border/80 text-foreground rounded-md border px-2 py-0.5 font-mono text-[11px] leading-4 shadow-xs">
                  Esc
                </kbd>
                <span>{mentionLabels?.closeLabel ?? "Close"}</span>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Mention summary bar: keep selected references single-line to avoid input height jitter. */}
      {hasAnySelectedMentions && (
        <div className="order-last w-full px-3 pb-1">
          <div className="flex max-w-full flex-nowrap items-center gap-2 overflow-x-auto py-0.5">
            {mentionSummaryGroups.map((group, index) => (
              <Fragment key={group.id}>
                {index > 0 ? (
                  <span
                    aria-hidden="true"
                    className="bg-border/80 h-4 w-px shrink-0"
                  />
                ) : null}
                <div className="shrink-0">{group.node}</div>
              </Fragment>
            ))}
          </div>
        </div>
      )}
      <PromptInputFooter className="flex w-full flex-wrap items-center gap-x-2 gap-y-1">
        <PromptInputTools className="min-w-0 flex-1 basis-full flex-wrap items-center gap-1 sm:basis-auto">
          {extraTools}
          {/* TODO: Add more connectors here
          <PromptInputActionMenu>
            <PromptInputActionMenuTrigger className="px-2!" />
            <PromptInputActionMenuContent>
              <PromptInputActionAddAttachments
                label={t.inputBox.addAttachments}
              />
            </PromptInputActionMenuContent>
          </PromptInputActionMenu> */}
          <AddAttachmentsButton className="px-2!" />
          <DropdownMenu
            open={contextSelectorOpen}
            onOpenChange={(open) => {
              setContextSelectorOpen(open);
              if (!open) setContextSelectorQuery("");
            }}
          >
            <DropdownMenuTrigger asChild>
              <PromptInputButton className="gap-1! px-2! text-xs" disabled={disabled}>
                <span>@</span>
                <span>{mentionLabels?.contextLabel ?? defaultContextLabel}</span>
                {selectedContexts.length > 0 && (
                  <span className="bg-foreground text-background inline-flex min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-4 font-semibold">
                    {selectedContexts.length}
                  </span>
                )}
              </PromptInputButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-96">
              <div className="p-2">
                <input
                  type="text"
                  placeholder={mentionLabels?.contextLabel ?? defaultContextLabel}
                  className="bg-background border-border text-foreground placeholder:text-muted-foreground w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  value={contextSelectorQuery}
                  onChange={(e) => setContextSelectorQuery(e.target.value)}
                />
              </div>
              <div className="max-h-60 overflow-auto">
                {filteredContextSelectorOptions.length === 0 ? (
                  <div className="text-muted-foreground px-3 py-2 text-xs">
                    {mentionLabels?.noMatches ?? "No matches"}
                  </div>
                ) : (
                  filteredContextSelectorOptions.map((option) => (
                    <DropdownMenuItem
                      key={option.id}
                      className="flex items-start gap-2 px-3 py-2"
                      onSelect={(event) => {
                        event.preventDefault();
                        toggleContextOption(option);
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedContexts.some((item) => item.value === option.value)}
                        onChange={() => toggleContextOption(option)}
                        className="mt-0.5"
                      />
                      <div className="flex-1">
                        <div className="text-xs font-medium">{option.label}</div>
                        {option.description && (
                          <div className="text-muted-foreground text-[11px]">
                            {option.description}
                          </div>
                        )}
                      </div>
                    </DropdownMenuItem>
                  ))
                )}
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu
            open={skillSelectorOpen}
            onOpenChange={(open) => {
              setSkillSelectorOpen(open);
              if (!open) setSkillSelectorQuery("");
            }}
          >
            <DropdownMenuTrigger asChild>
              <PromptInputButton className="gap-1! px-2! text-xs" disabled={disabled}>
                <SparklesIcon className="size-3" />
                <span>{mentionLabels?.skillLabel ?? defaultSkillLabel}</span>
                {selectedSkills.length > 0 && (
                  <span className="bg-foreground text-background inline-flex min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-4 font-semibold">
                    {selectedSkills.length}
                  </span>
                )}
              </PromptInputButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-80">
              <div className="p-2">
                <input
                  type="text"
                  placeholder={mentionLabels?.skillLabel ?? defaultSkillLabel}
                  className="bg-background border-border text-foreground placeholder:text-muted-foreground w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  value={skillSelectorQuery}
                  onChange={(e) => setSkillSelectorQuery(e.target.value)}
                />
              </div>
              <div className="max-h-60 overflow-auto">
                {filteredSkillSelectorOptions.length === 0 ? (
                  <div className="text-muted-foreground px-3 py-2 text-xs">
                    {mentionLabels?.noMatches ?? "No matches"}
                  </div>
                ) : (
                  filteredSkillSelectorOptions.map((option) => (
                    <DropdownMenuItem
                      key={option.id}
                      className="flex items-start gap-2 px-3 py-2"
                      onSelect={(event) => {
                        event.preventDefault();
                        toggleSkillOption(option.value);
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedSkills.includes(option.value)}
                        onChange={() => toggleSkillOption(option.value)}
                        className="mt-0.5"
                      />
                      <div className="flex-1">
                        <div className="text-xs font-medium">{option.label}</div>
                        {option.description && (
                          <div className="text-muted-foreground text-[11px]">
                            {option.description}
                          </div>
                        )}
                      </div>
                    </DropdownMenuItem>
                  ))
                )}
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu
            open={mcpSelectorOpen}
            onOpenChange={(open) => {
              setMcpSelectorOpen(open);
              if (!open) setMcpSelectorQuery("");
            }}
          >
            <DropdownMenuTrigger asChild>
              <PromptInputButton className="gap-1! px-2! text-xs" disabled={disabled}>
                <WrenchIcon className="size-3" />
                <span>{mentionLabels?.mcpLabel ?? defaultMcpLabel}</span>
                {selectedMcpTools.length > 0 && (
                  <span className="bg-foreground text-background inline-flex min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-4 font-semibold">
                    {selectedMcpTools.length}
                  </span>
                )}
              </PromptInputButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-80">
              <div className="p-2">
                <input
                  type="text"
                  placeholder={mentionLabels?.searchMcpTools ?? defaultSearchMcpTools}
                  className="bg-background border-border text-foreground placeholder:text-muted-foreground w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  value={mcpSelectorQuery}
                  onChange={(e) => setMcpSelectorQuery(e.target.value)}
                />
              </div>
              <div className="max-h-60 overflow-auto">
                {filteredMcpSelectorOptions.length === 0 ? (
                  <div className="text-muted-foreground px-3 py-2 text-xs">
                    {mentionLabels?.noMcpTools ?? defaultNoMcpTools}
                  </div>
                ) : (
                  filteredMcpSelectorOptions.map((option) => (
                    <DropdownMenuItem
                      key={option.id}
                      className="flex items-start gap-2 px-3 py-2"
                      onSelect={(e) => {
                        e.preventDefault();
                        toggleMcpTool(option.value);
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedMcpTools.includes(option.value)}
                        onChange={() => toggleMcpTool(option.value)}
                        className="mt-0.5"
                      />
                      <div className="flex-1">
                        <div className="text-xs font-medium">{option.label}</div>
                        {option.description && (
                          <div className="text-muted-foreground text-[11px]">
                            {option.description}
                          </div>
                        )}
                      </div>
                    </DropdownMenuItem>
                  ))
                )}
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu
            open={cliSelectorOpen}
            onOpenChange={(open) => {
              setCliSelectorOpen(open);
              if (!open) setCliSelectorQuery("");
            }}
          >
            <DropdownMenuTrigger asChild>
              <PromptInputButton className="gap-1! px-2! text-xs" disabled={disabled}>
                <SquareTerminalIcon className="size-3" />
                <span>{mentionLabels?.cliLabel ?? defaultCliLabel}</span>
                {selectedCliTools.length > 0 && (
                  <span className="bg-foreground text-background inline-flex min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-4 font-semibold">
                    {selectedCliTools.length}
                  </span>
                )}
              </PromptInputButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-80">
              <div className="p-2">
                <input
                  type="text"
                  placeholder={mentionLabels?.searchCliTools ?? defaultSearchCliTools}
                  className="bg-background border-border text-foreground placeholder:text-muted-foreground w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  value={cliSelectorQuery}
                  onChange={(e) => setCliSelectorQuery(e.target.value)}
                />
              </div>
              <div className="max-h-60 overflow-auto">
                {filteredCliSelectorOptions.length === 0 ? (
                  <div className="text-muted-foreground px-3 py-2 text-xs">
                    {mentionLabels?.noCliTools ?? defaultNoCliTools}
                  </div>
                ) : (
                  filteredCliSelectorOptions.map((option) => (
                    <DropdownMenuItem
                      key={option.id}
                      className="flex items-start gap-2 px-3 py-2"
                      onSelect={(e) => {
                        e.preventDefault();
                        toggleCliTool(option.value);
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedCliTools.includes(option.value)}
                        onChange={() => toggleCliTool(option.value)}
                        className="mt-0.5"
                      />
                      <div className="flex-1">
                        <div className="text-xs font-medium">{option.label}</div>
                        {option.description && (
                          <div className="text-muted-foreground text-[11px]">
                            {option.description}
                          </div>
                        )}
                      </div>
                    </DropdownMenuItem>
                  ))
                )}
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
          <PromptInputActionMenu>
            <ModeHoverGuide
              mode={resolvedMode}
            >
              <PromptInputActionMenuTrigger className="gap-1! px-2!">
                <div>
                  {resolvedMode === "flash" && <ZapIcon className="size-3" />}
                  {resolvedMode === "thinking" && (
                    <LightbulbIcon className="size-3" />
                  )}
                  {resolvedMode === "pro" && (
                    <GraduationCapIcon className="size-3" />
                  )}
                  {resolvedMode === "ultra" && (
                    <RocketIcon className="size-3 text-[#dabb5e]" />
                  )}
                </div>
                <div
                  className={cn(
                    "text-xs font-normal",
                    resolvedMode === "ultra" ? "golden-text" : "",
                  )}
                >
                  {(resolvedMode === "flash" && t.inputBox.flashMode) ||
                    (resolvedMode === "thinking" && t.inputBox.reasoningMode) ||
                    (resolvedMode === "pro" && t.inputBox.proMode) ||
                    (resolvedMode === "ultra" && t.inputBox.ultraMode)}
                </div>
              </PromptInputActionMenuTrigger>
            </ModeHoverGuide>
            <PromptInputActionMenuContent className="w-80">
              <DropdownMenuGroup>
                <DropdownMenuLabel className="text-muted-foreground text-xs">
                  {t.inputBox.mode}
                </DropdownMenuLabel>
                <PromptInputActionMenu>
                  <PromptInputActionMenuItem
                    className={cn(
                      resolvedMode === "flash"
                        ? "text-accent-foreground"
                        : "text-muted-foreground/65",
                    )}
                    onSelect={() => handleModeSelect("flash")}
                  >
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center gap-1 font-bold">
                          <ZapIcon
                            className={cn(
                              "mr-2 size-4",
                              resolvedMode === "flash" &&
                              "text-accent-foreground",
                            )}
                          />
                        {t.inputBox.flashMode}
                      </div>
                      <div className="pl-7 text-xs">
                        {t.inputBox.flashModeDescription}
                      </div>
                    </div>
                    {resolvedMode === "flash" ? (
                      <CheckIcon className="ml-auto size-4" />
                    ) : (
                      <div className="ml-auto size-4" />
                    )}
                  </PromptInputActionMenuItem>
                  {supportThinking && (
                    <PromptInputActionMenuItem
                      className={cn(
                        resolvedMode === "thinking"
                          ? "text-accent-foreground"
                          : "text-muted-foreground/65",
                      )}
                      onSelect={() => handleModeSelect("thinking")}
                    >
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-1 font-bold">
                          <LightbulbIcon
                            className={cn(
                              "mr-2 size-4",
                              resolvedMode === "thinking" &&
                              "text-accent-foreground",
                            )}
                          />
                          {t.inputBox.reasoningMode}
                        </div>
                        <div className="pl-7 text-xs">
                          {t.inputBox.reasoningModeDescription}
                        </div>
                      </div>
                      {resolvedMode === "thinking" ? (
                        <CheckIcon className="ml-auto size-4" />
                      ) : (
                        <div className="ml-auto size-4" />
                      )}
                    </PromptInputActionMenuItem>
                  )}
                  {supportThinking && (
                    <PromptInputActionMenuItem
                      className={cn(
                        resolvedMode === "pro"
                          ? "text-accent-foreground"
                          : "text-muted-foreground/65",
                      )}
                      onSelect={() => handleModeSelect("pro")}
                    >
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-1 font-bold">
                            <GraduationCapIcon
                              className={cn(
                                "mr-2 size-4",
                                resolvedMode === "pro" && "text-accent-foreground",
                              )}
                            />
                          {t.inputBox.proMode}
                        </div>
                        <div className="pl-7 text-xs">
                          {t.inputBox.proModeDescription}
                        </div>
                      </div>
                      {resolvedMode === "pro" ? (
                        <CheckIcon className="ml-auto size-4" />
                      ) : (
                        <div className="ml-auto size-4" />
                      )}
                    </PromptInputActionMenuItem>
                  )}
                  {supportThinking && (
                    <PromptInputActionMenuItem
                      className={cn(
                        resolvedMode === "ultra"
                          ? "text-accent-foreground"
                          : "text-muted-foreground/65",
                      )}
                      onSelect={() => handleModeSelect("ultra")}
                    >
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-1 font-bold">
                            <RocketIcon
                              className={cn(
                                "mr-2 size-4",
                                resolvedMode === "ultra" && "text-[#dabb5e]",
                              )}
                            />
                          <div
                            className={cn(
                              resolvedMode === "ultra" && "golden-text",
                            )}
                          >
                            {t.inputBox.ultraMode}
                          </div>
                        </div>
                        <div className="pl-7 text-xs">
                          {t.inputBox.ultraModeDescription}
                        </div>
                      </div>
                      {resolvedMode === "ultra" ? (
                        <CheckIcon className="ml-auto size-4" />
                      ) : (
                        <div className="ml-auto size-4" />
                      )}
                    </PromptInputActionMenuItem>
                  )}
                </PromptInputActionMenu>
              </DropdownMenuGroup>
            </PromptInputActionMenuContent>
          </PromptInputActionMenu>
          {supportReasoningEffort && resolvedMode !== "flash" && (
            <PromptInputActionMenu>
              <PromptInputActionMenuTrigger className="gap-1! px-2!">
                <div className="text-xs font-normal">
                  {t.inputBox.reasoningEffort}:
                  {context.reasoning_effort === "minimal" && " " + t.inputBox.reasoningEffortMinimal}
                  {context.reasoning_effort === "low" && " " + t.inputBox.reasoningEffortLow}
                  {context.reasoning_effort === "medium" && " " + t.inputBox.reasoningEffortMedium}
                  {context.reasoning_effort === "high" && " " + t.inputBox.reasoningEffortHigh}
                </div>
              </PromptInputActionMenuTrigger>
              <PromptInputActionMenuContent className="w-70">
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="text-muted-foreground text-xs">
                    {t.inputBox.reasoningEffort}
                  </DropdownMenuLabel>
                  <PromptInputActionMenu>
                    <PromptInputActionMenuItem
                      className={cn(
                        context.reasoning_effort === "minimal"
                          ? "text-accent-foreground"
                          : "text-muted-foreground/65",
                      )}
                      onSelect={() => handleReasoningEffortSelect("minimal")}
                    >
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-1 font-bold">
                          {t.inputBox.reasoningEffortMinimal}
                        </div>
                        <div className="pl-2 text-xs">
                          {t.inputBox.reasoningEffortMinimalDescription}
                        </div>
                      </div>
                      {context.reasoning_effort === "minimal" ? (
                        <CheckIcon className="ml-auto size-4" />
                      ) : (
                        <div className="ml-auto size-4" />
                      )}
                    </PromptInputActionMenuItem>
                    <PromptInputActionMenuItem
                      className={cn(
                        context.reasoning_effort === "low"
                          ? "text-accent-foreground"
                          : "text-muted-foreground/65",
                      )}
                      onSelect={() => handleReasoningEffortSelect("low")}
                    >
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-1 font-bold">
                          {t.inputBox.reasoningEffortLow}
                        </div>
                        <div className="pl-2 text-xs">
                          {t.inputBox.reasoningEffortLowDescription}
                        </div>
                      </div>
                      {context.reasoning_effort === "low" ? (
                        <CheckIcon className="ml-auto size-4" />
                      ) : (
                        <div className="ml-auto size-4" />
                      )}
                    </PromptInputActionMenuItem>
                    <PromptInputActionMenuItem
                      className={cn(
                        context.reasoning_effort === "medium" || !context.reasoning_effort
                          ? "text-accent-foreground"
                          : "text-muted-foreground/65",
                      )}
                      onSelect={() => handleReasoningEffortSelect("medium")}
                    >
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-1 font-bold">
                          {t.inputBox.reasoningEffortMedium}
                        </div>
                        <div className="pl-2 text-xs">
                          {t.inputBox.reasoningEffortMediumDescription}
                        </div>
                      </div>
                      {context.reasoning_effort === "medium" || !context.reasoning_effort ? (
                        <CheckIcon className="ml-auto size-4" />
                      ) : (
                        <div className="ml-auto size-4" />
                      )}
                    </PromptInputActionMenuItem>
                    <PromptInputActionMenuItem
                      className={cn(
                        context.reasoning_effort === "high"
                          ? "text-accent-foreground"
                          : "text-muted-foreground/65",
                      )}
                      onSelect={() => handleReasoningEffortSelect("high")}
                    >
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-1 font-bold">
                          {t.inputBox.reasoningEffortHigh}
                        </div>
                        <div className="pl-2 text-xs">
                          {t.inputBox.reasoningEffortHighDescription}
                        </div>
                      </div>
                      {context.reasoning_effort === "high" ? (
                        <CheckIcon className="ml-auto size-4" />
                      ) : (
                        <div className="ml-auto size-4" />
                      )}
                    </PromptInputActionMenuItem>
                  </PromptInputActionMenu>
                </DropdownMenuGroup>
              </PromptInputActionMenuContent>
            </PromptInputActionMenu>
          )}
        </PromptInputTools>
        <PromptInputTools className="ml-auto min-w-0 flex w-full flex-wrap items-center justify-end gap-1 sm:w-auto">
          <ModelSelector
            open={modelDialogOpen}
            onOpenChange={setModelDialogOpen}
          >
            <ModelSelectorTrigger asChild>
              <PromptInputButton className="max-w-[170px] gap-2 sm:max-w-[220px]">
                <ModelSelectorName className="truncate text-xs font-normal">
                  {selectedModel?.display_name}
                </ModelSelectorName>
              </PromptInputButton>
            </ModelSelectorTrigger>
            <ModelSelectorContent>
              <ModelSelectorInput placeholder={t.inputBox.searchModels} />
              <ModelSelectorList>
                {recentModels.length > 0 && (
                  <>
                    <ModelSelectorGroupTitle>
                      {mentionLabels?.recentModelsLabel ?? "Recent"}
                    </ModelSelectorGroupTitle>
                    {recentModels.map((m) => (
                      <ModelSelectorItem
                        key={m.name}
                        value={m.name}
                        onSelect={() => handleModelSelect(m.name)}
                      >
                        <ModelSelectorName>{m.display_name}</ModelSelectorName>
                        {m.name === activeModelName && (
                          <ModelSelectorCheck />
                        )}
                      </ModelSelectorItem>
                    ))}
                    {remainingModels.length > 0 && (
                      <ModelSelectorSeparator />
                    )}
                  </>
                )}
                {remainingModels.length > 0 && recentModels.length > 0 && (
                  <ModelSelectorGroupTitle>
                    {mentionLabels?.allModelsLabel ?? "All Models"}
                  </ModelSelectorGroupTitle>
                )}
                {(recentModels.length > 0 ? remainingModels : models).map((m) => (
                  <ModelSelectorItem
                    key={m.name}
                    value={m.name}
                    onSelect={() => handleModelSelect(m.name)}
                  >
                    <ModelSelectorName>{m.display_name}</ModelSelectorName>
                    {m.name === activeModelName && (
                      <ModelSelectorCheck />
                    )}
                  </ModelSelectorItem>
                ))}
              </ModelSelectorList>
            </ModelSelectorContent>
          </ModelSelector>
          <PromptInputSubmit
            className="rounded-full"
            disabled={disabled}
            variant="outline"
            status={status}
          />
        </PromptInputTools>
      </PromptInputFooter>
      {isNewThread &&
        searchParams.get("mode") !== "skill" &&
        searchParams.get("mode") !== "workbench-plugin" &&
        (
          <div className="absolute right-0 -bottom-20 left-0 z-0 flex items-center justify-center">
            <SuggestionList />
          </div>
        )}
      {!isNewThread && (
        followUpSuggestions.length > 0 ? (
          <div className="absolute right-0 -bottom-20 left-0 z-0 flex items-center justify-center">
            <FollowUpSuggestionList
              suggestions={followUpSuggestions}
              loading={followUpLoading}
              onClick={handleFollowUpSuggestionClick}
            />
          </div>
        ) : (
          <div className="bg-background absolute right-0 -bottom-[17px] left-0 z-0 h-4"></div>
        )
      )}
    </PromptInput>
  );
}

function FollowUpSuggestionList({
  suggestions,
  loading,
  onClick,
}: {
  suggestions: string[];
  loading: boolean;
  onClick: (suggestion: string) => void;
}) {
  const { t } = useI18n();
  const loadingText = t.inputBox.generatingFollowUpSuggestions;

  return (
    <Suggestions className="min-h-16 w-fit items-start">
      {loading && (
        <ConfettiButton
          className="text-muted-foreground cursor-default rounded-full px-4 text-xs font-normal"
          variant="outline"
          size="sm"
          disabled
        >
          <SparklesIcon className="size-4" /> {loadingText}
        </ConfettiButton>
      )}
      {suggestions.map((suggestion) => (
        <Suggestion
          key={suggestion}
          icon={LightbulbIcon}
          suggestion={suggestion}
          onClick={() => onClick(suggestion)}
        />
      ))}
    </Suggestions>
  );
}

function SuggestionList() {
  const { t } = useI18n();
  const router = useRouter();
  const { textInput } = usePromptInputController();
  const handleSuggestionClick = useCallback(
    (prompt: string | undefined) => {
      if (!prompt) return;
      textInput.setInput(prompt);
      setTimeout(() => {
        const textarea = document.querySelector<HTMLTextAreaElement>(
          "textarea[name='message']",
        );
        if (textarea) {
          const selStart = prompt.indexOf("[");
          const selEnd = prompt.indexOf("]");
          if (selStart !== -1 && selEnd !== -1) {
            textarea.setSelectionRange(selStart, selEnd + 1);
            textarea.focus();
          }
        }
      }, 500);
    },
    [textInput],
  );
  return (
    <Suggestions className="min-h-16 w-fit items-start">
      <ConfettiButton
        className="text-muted-foreground cursor-pointer rounded-full px-4 text-xs font-normal"
        variant="outline"
        size="sm"
        onClick={() => handleSuggestionClick(t.inputBox.surpriseMePrompt)}
      >
        <SparklesIcon className="size-4" /> {t.inputBox.surpriseMe}
      </ConfettiButton>
      {t.inputBox.suggestions.map((suggestion) => (
        <Suggestion
          key={suggestion.suggestion}
          icon={suggestion.icon}
          suggestion={suggestion.suggestion}
          onClick={() => handleSuggestionClick(suggestion.prompt)}
        />
      ))}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Suggestion icon={PlusIcon} suggestion={t.common.create} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuGroup>
            {t.inputBox.suggestionsCreate.map((suggestion, index) =>
              "type" in suggestion && suggestion.type === "separator" ? (
                <DropdownMenuSeparator key={index} />
              ) : (
                !("type" in suggestion) && (
                  <DropdownMenuItem
                    key={suggestion.suggestion}
                    onClick={() => handleSuggestionClick(suggestion.prompt)}
                  >
                    {suggestion.icon && <suggestion.icon className="size-4" />}
                    {suggestion.suggestion}
                  </DropdownMenuItem>
                )
              ),
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => {
                router.push("/workspace/chats/new?mode=temporary-chat");
              }}
            >
              <RocketIcon className="size-4" />
              {t.inputBox.temporaryChat}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </Suggestions>
  );
}

function AddAttachmentsButton({ className }: { className?: string }) {
  const { t } = useI18n();
  const attachments = usePromptInputAttachments();
  return (
    <Tooltip content={t.inputBox.addAttachments}>
      <PromptInputButton
        className={cn("px-2!", className)}
        onClick={() => attachments.openFileDialog()}
      >
        <PaperclipIcon className="size-3" />
      </PromptInputButton>
    </Tooltip>
  );
}
