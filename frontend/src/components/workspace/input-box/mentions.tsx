"use client";

import { cn } from "@/lib/utils";

import type { MentionOption, MentionState, SelectedContextTag } from "./utils";

/**
 * Parse text to identify selected mentions for highlighting
 */
export function parseMentions(
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
export function MentionHighlightOverlay({
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

export function resolveMentionState(value: string, caret: number): MentionState | null {
  const safeCaret = Math.max(0, Math.min(caret, value.length));
  if (safeCaret <= 0) {
    return null;
  }

  // Scan backward to find the nearest trigger character.
  let triggerIndex = -1;
  let trigger: MentionState["trigger"] | null = null;

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
      trigger = char as MentionState["trigger"];
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

export function rankMentionOption(option: MentionOption, normalizedQuery: string): number {
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
