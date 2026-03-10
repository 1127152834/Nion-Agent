"use client";

import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { uuid } from "@/core/utils/uuid";

export function useThreadChat() {
  const { thread_id: threadIdFromPath } = useParams<{ thread_id: string }>();

  const searchParams = useSearchParams();
  const isRouteNewThread = threadIdFromPath === "new";
  const newThreadIdRef = useRef<string | null>(null);
  const [threadId, setThreadId] = useState(() => {
    return isRouteNewThread ? "new" : threadIdFromPath;
  });

  const [isNewThread, setIsNewThread] = useState(() => isRouteNewThread);

  useEffect(() => {
    if (isRouteNewThread) {
      setIsNewThread(true);
      newThreadIdRef.current ??= uuid();
      setThreadId(newThreadIdRef.current);
      return;
    }
    newThreadIdRef.current = null;
    setIsNewThread(false);
    setThreadId(threadIdFromPath);
  }, [isRouteNewThread, threadIdFromPath]);
  const isMock = searchParams.get("mock") === "true";
  return { threadId, setThreadId, isNewThread, setIsNewThread, isMock };
}
