"use client";

import {
  LightbulbIcon,
  PlusIcon,
  RocketIcon,
  SparklesIcon,
} from "lucide-react";
import { useCallback } from "react";

import {
  usePromptInputController,
} from "@/components/ai-elements/prompt-input";
import { ConfettiButton } from "@/components/ui/confetti-button";
import {
  DropdownMenuGroup,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/core/i18n/hooks";
import { useAppRouter as useRouter } from "@/core/navigation";

import { Suggestion, Suggestions } from "../../ai-elements/suggestion";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../ui/dropdown-menu";

export function FollowUpSuggestionList({
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

export function SuggestionList() {
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
