"use client";

import { PaperclipIcon, SparklesIcon, WrenchIcon, XIcon } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import {
  PromptInput,
  PromptInputAttachment,
  PromptInputAttachments,
  PromptInputBody,
  PromptInputButton,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputAttachments,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/core/i18n/hooks";
import { useMCPConfig } from "@/core/mcp/hooks";
import { useSkills } from "@/core/skills/hooks";
import { getLocalizedSkillDescription } from "@/core/skills/i18n";
import { cn } from "@/lib/utils";

interface AssistantInputProps {
  onSend: (message: PromptInputMessage) => Promise<void> | void;
  isLoading?: boolean;
  placeholder?: string;
  className?: string;
}

type ImplicitMention = NonNullable<PromptInputMessage["implicitMentions"]>[number];

interface MentionOption {
  value: string;
  label: string;
  description?: string;
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
  selectedMcpTools: string[],
): {
  text: string;
  implicitMentions: ImplicitMention[];
} {
  const trimmed = text.trim();
  if (!trimmed) {
    return { text: "", implicitMentions: [] };
  }

  const implicitMentions: ImplicitMention[] = [];
  const seenMentions = new Set<string>();

  const appendImplicitMention = (
    kind: "skill" | "mcp",
    value: string,
    mention: string,
  ) => {
    if (hasInlineMention(trimmed, mention) || seenMentions.has(mention)) {
      return;
    }
    seenMentions.add(mention);
    implicitMentions.push({ kind, value, mention });
  };

  for (const skill of selectedSkills) {
    appendImplicitMention("skill", skill, `/${skill}`);
  }

  for (const tool of selectedMcpTools) {
    appendImplicitMention("mcp", tool, `@${tool}`);
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

function filterMentionOptions(options: MentionOption[], query: string): MentionOption[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return options;
  }
  return options.filter((option) => {
    const label = option.label.toLowerCase();
    const value = option.value.toLowerCase();
    const description = option.description?.toLowerCase() ?? "";
    return (
      label.includes(normalizedQuery) ||
      value.includes(normalizedQuery) ||
      description.includes(normalizedQuery)
    );
  });
}

function AddAttachmentsButton({ className }: { className?: string }) {
  const { t } = useI18n();
  const attachments = usePromptInputAttachments();

  return (
    <PromptInputButton
      className={cn("px-2", className)}
      onClick={() => attachments.openFileDialog()}
      title={t.inputBox.addAttachments}
    >
      <PaperclipIcon className="size-3.5" />
    </PromptInputButton>
  );
}

export function AssistantInput({
  onSend,
  isLoading = false,
  placeholder = "问我任何关于这篇文章的问题...",
  className,
}: AssistantInputProps) {
  const { t, locale } = useI18n();
  const { skills } = useSkills();
  const { config: mcpConfig } = useMCPConfig();

  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [selectedMcpTools, setSelectedMcpTools] = useState<string[]>([]);
  const [skillQuery, setSkillQuery] = useState("");
  const [mcpQuery, setMcpQuery] = useState("");

  const skillOptions = useMemo<MentionOption[]>(
    () =>
      skills
        .filter((skill) => skill.enabled)
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((skill) => ({
          value: skill.name,
          label: skill.name,
          description: getLocalizedSkillDescription(skill, locale),
        })),
    [locale, skills],
  );

  const mcpOptions = useMemo<MentionOption[]>(
    () =>
      Object.entries(mcpConfig?.mcp_servers ?? {})
        .filter(([, server]) => server.enabled)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([serverName, server]) => ({
          value: serverName,
          label: serverName,
          description: server.description?.trim() || "MCP",
        })),
    [mcpConfig?.mcp_servers],
  );

  const filteredSkillOptions = useMemo(
    () => filterMentionOptions(skillOptions, skillQuery),
    [skillOptions, skillQuery],
  );

  const filteredMcpOptions = useMemo(
    () => filterMentionOptions(mcpOptions, mcpQuery),
    [mcpOptions, mcpQuery],
  );

  const toggleSkill = useCallback((value: string) => {
    setSelectedSkills((current) =>
      current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value],
    );
  }, []);

  const toggleMcpTool = useCallback((value: string) => {
    setSelectedMcpTools((current) =>
      current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value],
    );
  }, []);

  const handleSubmit = useCallback(
    async (message: PromptInputMessage) => {
      if (isLoading) {
        return;
      }

      const submissionPayload = buildSubmissionPayload(
        message.text,
        selectedSkills,
        selectedMcpTools,
      );
      if (!submissionPayload.text) {
        return;
      }

      await onSend({
        ...message,
        text: submissionPayload.text,
        implicitMentions:
          submissionPayload.implicitMentions.length > 0
            ? submissionPayload.implicitMentions
            : undefined,
      });
    },
    [isLoading, onSend, selectedMcpTools, selectedSkills],
  );

  return (
    <PromptInput
      className={cn(
        "bg-background rounded-2xl border border-border shadow-sm",
        className,
      )}
      disabled={isLoading}
      multiple
      globalDrop
      onSubmit={handleSubmit}
    >
      <PromptInputAttachments>
        {(attachment) => <PromptInputAttachment data={attachment} />}
      </PromptInputAttachments>

      {selectedSkills.length > 0 && (
        <div className="order-last w-full px-3 pb-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {selectedSkills.map((skill) => (
              <button
                key={skill}
                type="button"
                className="bg-muted/70 text-foreground inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs"
                onClick={() => toggleSkill(skill)}
              >
                <SparklesIcon className="size-3" />
                <span>{skill}</span>
                <XIcon className="size-3 text-muted-foreground" />
              </button>
            ))}
          </div>
        </div>
      )}

      {selectedMcpTools.length > 0 && (
        <div className="order-last w-full px-3 pb-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {selectedMcpTools.map((tool) => (
              <button
                key={tool}
                type="button"
                className="bg-muted/70 text-foreground inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs"
                onClick={() => toggleMcpTool(tool)}
              >
                <WrenchIcon className="size-3" />
                <span>{tool}</span>
                <XIcon className="size-3 text-muted-foreground" />
              </button>
            ))}
          </div>
        </div>
      )}

      <PromptInputBody>
        <PromptInputTextarea
          className="max-h-48 min-h-[68px] border-0 bg-transparent text-sm shadow-none"
          placeholder={placeholder}
          disabled={isLoading}
        />
      </PromptInputBody>

      <PromptInputFooter className="flex">
        <PromptInputTools>
          <AddAttachmentsButton />

          <DropdownMenu
            onOpenChange={(open) => {
              if (!open) {
                setSkillQuery("");
              }
            }}
          >
            <DropdownMenuTrigger asChild>
              <PromptInputButton className="gap-1.5 px-2 text-xs" disabled={isLoading}>
                <SparklesIcon className="size-3" />
                <span>{t.rssReader.aiComposerSkill}</span>
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
                  value={skillQuery}
                  onChange={(event) => setSkillQuery(event.target.value)}
                  placeholder={t.common.search}
                  className="bg-background border-border text-foreground placeholder:text-muted-foreground w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div className="max-h-64 overflow-auto">
                {filteredSkillOptions.length === 0 ? (
                  <div className="text-muted-foreground px-3 py-2 text-xs">
                    {t.rssReader.aiComposerNoSkill}
                  </div>
                ) : (
                  filteredSkillOptions.map((option) => (
                    <DropdownMenuItem
                      key={option.value}
                      className="flex items-start gap-2 px-3 py-2"
                      onSelect={(event) => {
                        event.preventDefault();
                        toggleSkill(option.value);
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedSkills.includes(option.value)}
                        onChange={() => toggleSkill(option.value)}
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
            onOpenChange={(open) => {
              if (!open) {
                setMcpQuery("");
              }
            }}
          >
            <DropdownMenuTrigger asChild>
              <PromptInputButton className="gap-1.5 px-2 text-xs" disabled={isLoading}>
                <WrenchIcon className="size-3" />
                <span>{t.rssReader.aiComposerTool}</span>
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
                  value={mcpQuery}
                  onChange={(event) => setMcpQuery(event.target.value)}
                  placeholder={t.common.search}
                  className="bg-background border-border text-foreground placeholder:text-muted-foreground w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div className="max-h-64 overflow-auto">
                {filteredMcpOptions.length === 0 ? (
                  <div className="text-muted-foreground px-3 py-2 text-xs">
                    {t.rssReader.aiComposerNoTool}
                  </div>
                ) : (
                  filteredMcpOptions.map((option) => (
                    <DropdownMenuItem
                      key={option.value}
                      className="flex items-start gap-2 px-3 py-2"
                      onSelect={(event) => {
                        event.preventDefault();
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
        </PromptInputTools>

        <PromptInputTools>
          <PromptInputSubmit
            className="rounded-full"
            status={isLoading ? "submitted" : "ready"}
            disabled={isLoading}
          />
        </PromptInputTools>
      </PromptInputFooter>

      <div className="text-muted-foreground px-3 pb-3 text-xs">
        Enter 发送 · Shift + Enter 换行
      </div>
    </PromptInput>
  );
}
