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
  WrenchIcon,
  XIcon,
  ZapIcon,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ComponentProps,
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
import { useI18n } from "@/core/i18n/hooks";
import { useMCPConfig } from "@/core/mcp/hooks";
import { useModels } from "@/core/models/hooks";
import { getLocalizedSkillDescription } from "@/core/skills/i18n";
import { useSkills } from "@/core/skills/hooks";
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
} from "../ai-elements/model-selector";
import { Suggestion, Suggestions } from "../ai-elements/suggestion";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";

import { ModeHoverGuide } from "./mode-hover-guide";
import { Tooltip } from "./tooltip";

type InputMode = "flash" | "thinking" | "pro" | "ultra";

// Mention system types
type MentionTrigger = "@" | "/";
type MentionAtSource = "context" | "mcp";

interface MentionOption {
  id: string;
  label: string;
  value: string;
  kind: "file" | "directory" | "skill" | "mcp";
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

function dirname(path: string): string {
  const normalized = normalizePath(path).replace(/\/$/, "");
  const index = normalized.lastIndexOf("/");
  if (index <= 0) {
    return "/";
  }
  return normalized.slice(0, index);
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

  // 向前扫描，找到最近的触发字符
  let triggerIndex = -1;
  let trigger: MentionTrigger | null = null;

  for (let i = safeCaret - 1; i >= 0; i--) {
    const char = value.charAt(i);

    // 如果遇到空格或换行，停止扫描（mention 不能包含空格）
    if (char === ' ' || char === '\n') {
      break;
    }

    // 如果找到触发字符
    if (char === '@' || char === '/') {
      // 检查触发字符前面是否是空格或字符串开头
      if (i === 0 || /\s/.test(value.charAt(i - 1))) {
        triggerIndex = i;
        trigger = char as MentionTrigger;
        break;
      }
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

function removeLooseMentionTriggers(value: string): string {
  return value
    .replace(/(^|[\s\n])@(?=$|[\s\n])/g, "$1")
    .replace(/(^|[\s\n])\/(?=$|[\s\n])/g, "$1");
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

export function InputBox({
  className,
  disabled,
  autoFocus,
  status = "ready",
  context,
  extraHeader,
  isNewThread,
  initialValue,
  workspacePaths = [],
  onContextChange,
  onSubmit,
  onStop,
  ...props
}: Omit<ComponentProps<typeof PromptInput>, "onSubmit"> & {
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
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const [modelDialogOpen, setModelDialogOpen] = useState(false);
  const { models } = useModels();

  // Mention system state
  const [mentionState, setMentionState] = useState<MentionState | null>(null);
  const [mentionAtSource, setMentionAtSource] = useState<MentionAtSource>("context");
  const [mentionActiveIndex, setMentionActiveIndex] = useState(0);
  const [selectedContexts, setSelectedContexts] = useState<SelectedContextTag[]>([]);
  const [selectedMcpTools, setSelectedMcpTools] = useState<string[]>([]);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [recentMentions, setRecentMentions] = useState<RecentMentionsState>({
    "@": [],
    "/": [],
  });
  const [mcpSelectorOpen, setMcpSelectorOpen] = useState(false);
  const [mcpSelectorQuery, setMcpSelectorQuery] = useState("");
  const [recentModelNames, setRecentModelNames] = useState<string[]>([]);

  // Load recent models on mount
  useEffect(() => {
    setRecentModelNames(readRecentModels());
  }, []);

  // Fetch data for mention options
  const { skills } = useSkills();
  const { config: mcpConfig } = useMCPConfig();
  const { locale } = useI18n();

  // Build mention options
  const fileMentionOptions = useMemo<MentionOption[]>(
    () => buildPathMentionOptions(workspacePaths),
    [workspacePaths],
  );

  const skillMentionOptions = useMemo<MentionOption[]>(
    () =>
      skills.map((skill) => ({
        id: `skill:${skill.name}`,
        label: skill.name,
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
          description: server.description?.trim() || "MCP tool",
        })),
    [mcpConfig?.mcp_servers],
  );

  // Filter and rank mention options based on query
  const filteredMentionOptions = useMemo(() => {
    if (!mentionState) {
      return [];
    }
    const source =
      mentionState.trigger === "@"
        ? (mentionAtSource === "context" ? fileMentionOptions : mcpMentionOptions)
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
  }, [fileMentionOptions, mcpMentionOptions, mentionAtSource, mentionState, skillMentionOptions]);

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
        label: t.migration.workspace?.inputBox?.recentLabel ?? "Recent",
        options: recentOptions.slice(0, RECENT_MENTION_LIMIT),
      });
    }

    if (mentionState.trigger === "/") {
      if (remaining.length > 0) {
        groups.push({
          id: "skills",
          label: t.migration.workspace?.inputBox?.allSkillsLabel ?? "All skills",
          options: remaining.slice(0, 40),
        });
      }
    } else {
      const directories = remaining.filter((item) => item.kind === "directory");
      const files = remaining.filter((item) => item.kind === "file");
      const mcpTools = remaining.filter((item) => item.kind === "mcp");

      if (directories.length > 0) {
        groups.push({
          id: "directories",
          label: t.migration.workspace?.inputBox?.directoriesLabel ?? "Directories",
          options: directories.slice(0, 20),
        });
      }
      if (files.length > 0) {
        groups.push({
          id: "files",
          label: t.migration.workspace?.inputBox?.filesLabel ?? "Files",
          options: files.slice(0, 20),
        });
      }
      if (mcpTools.length > 0) {
        groups.push({
          id: "mcp",
          label: t.migration.workspace?.inputBox?.mcpToolsLabel ?? "MCP Tools",
          options: mcpTools.slice(0, 20),
        });
      }
    }

    return groups;
  }, [filteredMentionOptions, mentionState, recentMentions, t]);

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

  const toggleMcpTool = useCallback((value: string) => {
    setSelectedMcpTools((prev) => {
      if (prev.includes(value)) {
        return prev.filter((item) => item !== value);
      }
      return [...prev, value];
    });
  }, []);

  // Get text input controller
  const { textInput } = usePromptInputController();

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

  const addSelectedMcpTool = useCallback((value: string) => {
    setSelectedMcpTools((prev) => {
      if (prev.includes(value)) {
        return prev;
      }
      return [...prev, value];
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

      // 插入选中的 mention，保留触发字符
      const mentionText = `${mentionState.trigger}${option.value}`;
      const nextValue = `${prefix}${mentionText} ${suffix}`;
      const nextCaret = prefix.length + mentionText.length + 1;

      textInput.setInput(nextValue);
      pushRecentMention(mentionState.trigger, option.value);
      if (mentionState.trigger === "@") {
        if (option.kind === "mcp") {
          addSelectedMcpTool(option.value);
        } else {
          addSelectedContext(
            option.value,
            option.kind === "directory" ? "directory" : "file",
          );
        }
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
      addSelectedMcpTool,
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

    if (!mentionState) {
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setMentionState(null);
      return;
    }

    if (mentionState.trigger === "@" && event.key === "Tab") {
      event.preventDefault();
      setMentionAtSource((current) => (current === "context" ? "mcp" : "context"));
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
    const currentModel = models.find((m) => m.name === context.model_name);
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
  }, [context, models, onContextChange]);

  const selectedModel = useMemo(() => {
    if (models.length === 0) {
      return undefined;
    }
    return models.find((m) => m.name === context.model_name) ?? models[0];
  }, [context.model_name, models]);

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
      setModelDialogOpen(false);

      // Track recent model
      setRecentModelNames((prev) => {
        const filtered = prev.filter((name) => name !== model_name);
        const next = [model_name, ...filtered].slice(0, RECENT_MODELS_LIMIT);
        writeRecentModels(next);
        return next;
      });
    },
    [onContextChange, context, models],
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
      if (!message.text) {
        return;
      }
      onSubmit?.(message);
    },
    [onSubmit, onStop, status],
  );
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
      <PromptInputBody className="absolute top-0 right-0 left-0 z-3">
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
        <div className="absolute right-0 bottom-full left-0 z-20 pb-2">
          <div className="bg-background border-border mx-2 overflow-hidden rounded-lg border shadow-lg">
            <div className="border-border/70 border-b px-3 py-2">
              <span className="text-muted-foreground text-xs">
                {mentionState.trigger === "@"
                  ? (t.migration.workspace?.inputBox?.mentionHintAt ?? "↑↓ select · Tab switch · Enter apply")
                  : (t.migration.workspace?.inputBox?.mentionHintSlash ?? "↑↓ select · Enter apply")}
              </span>
            </div>
            {mentionState.trigger === "@" && (
              <div className="px-3 pb-1 pt-2">
                <div className="bg-muted/70 inline-flex items-center gap-1 rounded-lg p-1">
                  <button
                    type="button"
                    className={cn(
                      "rounded-md px-2 py-1 text-xs transition-colors",
                      mentionAtSource === "context"
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      setMentionAtSource("context");
                    }}
                  >
                    {t.migration.workspace?.inputBox?.contextLabel ?? "Context"}
                  </button>
                  <button
                    type="button"
                    className={cn(
                      "rounded-md px-2 py-1 text-xs transition-colors",
                      mentionAtSource === "mcp"
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      setMentionAtSource("mcp");
                    }}
                  >
                    MCP
                  </button>
                </div>
              </div>
            )}
            {mentionGroups.length === 0 ? (
              <div className="text-muted-foreground px-3 py-2 text-xs">
                {t.migration.workspace?.inputBox?.noMatches ?? "No matches"}
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
                <span>
                  {mentionState.trigger === "@"
                    ? (t.migration.workspace?.inputBox?.switchLabel ?? "Switch")
                    : (t.migration.workspace?.inputBox?.completeLabel ?? "Complete")}
                </span>
                <kbd className="bg-background border-border/80 text-foreground rounded-md border px-2 py-0.5 font-mono text-[11px] leading-4 shadow-xs">
                  ↑↓
                </kbd>
                <span>{t.migration.workspace?.inputBox?.navigateLabel ?? "Navigate"}</span>
                <kbd className="bg-background border-border/80 text-foreground rounded-md border px-2 py-0.5 font-mono text-[11px] leading-4 shadow-xs">
                  Enter
                </kbd>
                <span>{t.migration.workspace?.inputBox?.selectLabel ?? "Select"}</span>
                <kbd className="bg-background border-border/80 text-foreground rounded-md border px-2 py-0.5 font-mono text-[11px] leading-4 shadow-xs">
                  Esc
                </kbd>
                <span>{t.migration.workspace?.inputBox?.closeLabel ?? "Close"}</span>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Selected skills tags */}
      {selectedSkills.length > 0 && (
        <div className="order-last w-full px-3 pb-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {selectedSkills.map((skill) => (
              <button
                key={skill}
                type="button"
                className="bg-muted/70 text-foreground inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs"
                onClick={() => removeSelectedSkill(skill)}
              >
                <SparklesIcon className="size-3" />
                <span>{skill}</span>
                <XIcon className="text-muted-foreground size-3" />
              </button>
            ))}
          </div>
        </div>
      )}
      {/* Selected contexts tags */}
      {selectedContexts.length > 0 && (
        <div className="order-last w-full px-3 pb-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {selectedContexts.map((context) => (
              <button
                key={context.value}
                type="button"
                className="bg-muted/70 text-foreground inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs"
                onClick={() => removeSelectedContext(context.value)}
              >
                {context.kind === "directory" ? (
                  <FolderIcon className="size-3" />
                ) : (
                  <FileIcon className="size-3" />
                )}
                <span>{basename(context.value)}</span>
                <XIcon className="text-muted-foreground size-3" />
              </button>
            ))}
          </div>
        </div>
      )}
      <PromptInputFooter className="flex">
        <PromptInputTools>
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
          <PromptInputButton
            className="gap-1! px-2! text-xs"
            onClick={() => insertMentionTrigger("@")}
            disabled={disabled}
          >
            <span>@</span>
            <span>{t.migration.workspace?.inputBox?.contextLabel ?? "Context"}</span>
          </PromptInputButton>
          <PromptInputButton
            className="gap-1! px-2! text-xs"
            onClick={() => insertMentionTrigger("/")}
            disabled={disabled}
          >
            <SparklesIcon className="size-3" />
            <span>{t.migration.workspace?.inputBox?.skillLabel ?? "Skill"}</span>
          </PromptInputButton>
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
                <span>MCP</span>
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
                  placeholder={t.migration.workspace?.inputBox?.searchMcpTools ?? "Search MCP tools..."}
                  className="bg-background border-border text-foreground placeholder:text-muted-foreground w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  value={mcpSelectorQuery}
                  onChange={(e) => setMcpSelectorQuery(e.target.value)}
                />
              </div>
              <div className="max-h-60 overflow-auto">
                {filteredMcpSelectorOptions.length === 0 ? (
                  <div className="text-muted-foreground px-3 py-2 text-xs">
                    {t.migration.workspace?.inputBox?.noMcpTools ?? "No MCP tools available"}
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
          <PromptInputActionMenu>
            <ModeHoverGuide
              mode={
                context.mode === "flash" ||
                  context.mode === "thinking" ||
                  context.mode === "pro" ||
                  context.mode === "ultra"
                  ? context.mode
                  : "flash"
              }
            >
              <PromptInputActionMenuTrigger className="gap-1! px-2!">
                <div>
                  {context.mode === "flash" && <ZapIcon className="size-3" />}
                  {context.mode === "thinking" && (
                    <LightbulbIcon className="size-3" />
                  )}
                  {context.mode === "pro" && (
                    <GraduationCapIcon className="size-3" />
                  )}
                  {context.mode === "ultra" && (
                    <RocketIcon className="size-3 text-[#dabb5e]" />
                  )}
                </div>
                <div
                  className={cn(
                    "text-xs font-normal",
                    context.mode === "ultra" ? "golden-text" : "",
                  )}
                >
                  {(context.mode === "flash" && t.inputBox.flashMode) ||
                    (context.mode === "thinking" && t.inputBox.reasoningMode) ||
                    (context.mode === "pro" && t.inputBox.proMode) ||
                    (context.mode === "ultra" && t.inputBox.ultraMode)}
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
                      context.mode === "flash"
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
                            context.mode === "flash" &&
                            "text-accent-foreground",
                          )}
                        />
                        {t.inputBox.flashMode}
                      </div>
                      <div className="pl-7 text-xs">
                        {t.inputBox.flashModeDescription}
                      </div>
                    </div>
                    {context.mode === "flash" ? (
                      <CheckIcon className="ml-auto size-4" />
                    ) : (
                      <div className="ml-auto size-4" />
                    )}
                  </PromptInputActionMenuItem>
                  {supportThinking && (
                    <PromptInputActionMenuItem
                      className={cn(
                        context.mode === "thinking"
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
                              context.mode === "thinking" &&
                              "text-accent-foreground",
                            )}
                          />
                          {t.inputBox.reasoningMode}
                        </div>
                        <div className="pl-7 text-xs">
                          {t.inputBox.reasoningModeDescription}
                        </div>
                      </div>
                      {context.mode === "thinking" ? (
                        <CheckIcon className="ml-auto size-4" />
                      ) : (
                        <div className="ml-auto size-4" />
                      )}
                    </PromptInputActionMenuItem>
                  )}
                  <PromptInputActionMenuItem
                    className={cn(
                      context.mode === "pro"
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
                            context.mode === "pro" && "text-accent-foreground",
                          )}
                        />
                        {t.inputBox.proMode}
                      </div>
                      <div className="pl-7 text-xs">
                        {t.inputBox.proModeDescription}
                      </div>
                    </div>
                    {context.mode === "pro" ? (
                      <CheckIcon className="ml-auto size-4" />
                    ) : (
                      <div className="ml-auto size-4" />
                    )}
                  </PromptInputActionMenuItem>
                  <PromptInputActionMenuItem
                    className={cn(
                      context.mode === "ultra"
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
                            context.mode === "ultra" && "text-[#dabb5e]",
                          )}
                        />
                        <div
                          className={cn(
                            context.mode === "ultra" && "golden-text",
                          )}
                        >
                          {t.inputBox.ultraMode}
                        </div>
                      </div>
                      <div className="pl-7 text-xs">
                        {t.inputBox.ultraModeDescription}
                      </div>
                    </div>
                    {context.mode === "ultra" ? (
                      <CheckIcon className="ml-auto size-4" />
                    ) : (
                      <div className="ml-auto size-4" />
                    )}
                  </PromptInputActionMenuItem>
                </PromptInputActionMenu>
              </DropdownMenuGroup>
            </PromptInputActionMenuContent>
          </PromptInputActionMenu>
          {supportReasoningEffort && context.mode !== "flash" && (
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
        <PromptInputTools>
          <ModelSelector
            open={modelDialogOpen}
            onOpenChange={setModelDialogOpen}
          >
            <ModelSelectorTrigger asChild>
              <PromptInputButton>
                <ModelSelectorName className="text-xs font-normal">
                  {selectedModel?.display_name}
                </ModelSelectorName>
              </PromptInputButton>
            </ModelSelectorTrigger>
            <ModelSelectorContent>
              <ModelSelectorInput placeholder={t.inputBox.searchModels} />
              <ModelSelectorList>
                {recentModels.length > 0 && (
                  <>
                    <DropdownMenuLabel className="text-muted-foreground px-2 py-1.5 text-xs">
                      {t.migration.workspace?.inputBox?.recentModelsLabel ?? "Recent"}
                    </DropdownMenuLabel>
                    {recentModels.map((m) => (
                      <ModelSelectorItem
                        key={m.name}
                        value={m.name}
                        onSelect={() => handleModelSelect(m.name)}
                      >
                        <ModelSelectorName>{m.display_name}</ModelSelectorName>
                        {m.name === context.model_name ? (
                          <CheckIcon className="ml-auto size-4" />
                        ) : (
                          <div className="ml-auto size-4" />
                        )}
                      </ModelSelectorItem>
                    ))}
                    {remainingModels.length > 0 && (
                      <DropdownMenuSeparator />
                    )}
                  </>
                )}
                {remainingModels.length > 0 && recentModels.length > 0 && (
                  <DropdownMenuLabel className="text-muted-foreground px-2 py-1.5 text-xs">
                    {t.migration.workspace?.inputBox?.allModelsLabel ?? "All Models"}
                  </DropdownMenuLabel>
                )}
                {(recentModels.length > 0 ? remainingModels : models).map((m) => (
                  <ModelSelectorItem
                    key={m.name}
                    value={m.name}
                    onSelect={() => handleModelSelect(m.name)}
                  >
                    <ModelSelectorName>{m.display_name}</ModelSelectorName>
                    {m.name === context.model_name ? (
                      <CheckIcon className="ml-auto size-4" />
                    ) : (
                      <div className="ml-auto size-4" />
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
      {isNewThread && searchParams.get("mode") !== "skill" && (
        <div className="absolute right-0 -bottom-20 left-0 z-0 flex items-center justify-center">
          <SuggestionList />
        </div>
      )}
      {!isNewThread && (
        <div className="bg-background absolute right-0 -bottom-[17px] left-0 z-0 h-4"></div>
      )}
    </PromptInput>
  );
}

function SuggestionList() {
  const { t } = useI18n();
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
