"use client";

import type { Message } from "@langchain/langgraph-sdk";
import {
  A2UIProvider,
  A2UIRenderer,
  type A2UIMessage,
} from "@a2ui-sdk/react/0.8";
import { useMemo } from "react";

import type { A2UIUserAction } from "@/core/a2ui/types";
import { extractA2UISurfacePayload } from "@/core/messages/utils";
import { cn } from "@/lib/utils";

export function A2UICard({
  className,
  message,
  isLoading,
  onAction,
}: {
  className?: string;
  message: Message;
  isLoading: boolean;
  onAction?: (action: A2UIUserAction) => void;
}) {
  const payload = useMemo(() => extractA2UISurfacePayload(message), [message]);
  const operations = payload?.operations ?? null;

  const a2uiMessages = useMemo(() => {
    if (!Array.isArray(operations) || operations.length === 0) {
      return null;
    }
    // The backend treats A2UI operations as untrusted JSON; cast only after basic shaping.
    return operations.filter(
      (item): item is A2UIMessage => typeof item === "object" && item !== null,
    );
  }, [operations]);

  if (!a2uiMessages) {
    return null;
  }

  return (
    <div className={cn("bg-background/60 w-full rounded-xl border p-4", className)}>
      <A2UIProvider messages={a2uiMessages}>
        <A2UIRenderer
          onAction={(action) => {
            if (isLoading) {
              return;
            }
            onAction?.({ ...action, timestamp: new Date().toISOString() } as A2UIUserAction);
          }}
        />
      </A2UIProvider>
    </div>
  );
}
