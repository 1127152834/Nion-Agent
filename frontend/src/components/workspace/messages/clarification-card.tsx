"use client";

import { useQueryClient } from "@tanstack/react-query";
import { MessageCircleQuestionMarkIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { useOptionalPromptInputController } from "@/components/ai-elements/prompt-input";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/core/i18n/hooks";
import type { ClarificationPayload } from "@/core/messages/utils";
import type { AgentThread } from "@/core/threads/types";

export function ClarificationCard({
  clarification,
  threadId,
  isLoading,
  onSelectOption,
}: {
  clarification: ClarificationPayload;
  threadId: string;
  isLoading: boolean;
  onSelectOption?: (option: string) => void;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const controller = useOptionalPromptInputController();
  const [submittingOption, setSubmittingOption] = useState<string | null>(null);

  const resolveClarificationInCache = useCallback(() => {
    if (clarification.status !== "awaiting_user") {
      return;
    }
    queryClient.setQueriesData(
      {
        queryKey: ["threads", "search"],
        exact: false,
      },
      (oldData: Array<AgentThread> | undefined) => {
        if (!Array.isArray(oldData)) {
          return oldData;
        }
        return oldData.map((threadItem) => {
          if (
            threadItem.thread_id !== threadId
            || threadItem.values?.clarification?.status !== "awaiting_user"
          ) {
            return threadItem;
          }
          return {
            ...threadItem,
            values: {
              ...threadItem.values,
              clarification: {
                ...threadItem.values.clarification,
                status: "resolved",
                resolved_at: new Date().toISOString(),
                resolved_by_message_id: null,
              },
            },
          };
        });
      },
    );
  }, [clarification.status, queryClient, threadId]);

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
                  resolveClarificationInCache();
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
