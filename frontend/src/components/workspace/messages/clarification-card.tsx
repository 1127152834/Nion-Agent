"use client";

import { MessageCircleQuestionMarkIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { useOptionalPromptInputController } from "@/components/ai-elements/prompt-input";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/core/i18n/hooks";
import type { ClarificationPayload } from "@/core/messages/utils";

export function ClarificationCard({
  clarification,
  isLoading,
  onSelectOption,
}: {
  clarification: ClarificationPayload;
  isLoading: boolean;
  onSelectOption?: (option: string) => void;
}) {
  const { t } = useI18n();
  const controller = useOptionalPromptInputController();
  const [submittingOption, setSubmittingOption] = useState<string | null>(null);

  useEffect(() => {
    if (!submittingOption || isLoading) {
      return;
    }
    const timer = window.setTimeout(() => {
      setSubmittingOption(null);
    }, 600);
    return () => window.clearTimeout(timer);
  }, [isLoading, submittingOption]);

  const question = clarification.question?.trim() ?? "";
  const options = clarification.options?.filter(Boolean) ?? [];

  if (!question) {
    return null;
  }

  return (
    <div className="bg-background/60 w-full rounded-xl border p-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <MessageCircleQuestionMarkIcon className="text-muted-foreground size-4" />
        <span>{t.toolCalls.needYourHelp}</span>
      </div>
      {clarification.context ? (
        <div className="text-muted-foreground mt-2 text-sm">
          {clarification.context}
        </div>
      ) : null}
      <div className="mt-2 text-sm leading-6 whitespace-pre-wrap">{question}</div>
      {options.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {options.map((option) => {
            const pending = submittingOption === option;
            return (
              <Button
                key={option}
                variant="secondary"
                size="sm"
                disabled={isLoading || pending}
                onClick={() => {
                  setSubmittingOption(option);
                  if (controller?.submitText) {
                    controller.submitText(option);
                  } else {
                    onSelectOption?.(option);
                    setSubmittingOption(null);
                  }
                }}
              >
                {option}
              </Button>
            );
          })}
        </div>
      ) : null}
      <div className="text-muted-foreground mt-3 text-xs">
        {t.toolCalls.clarificationManualHint}
      </div>
    </div>
  );
}
