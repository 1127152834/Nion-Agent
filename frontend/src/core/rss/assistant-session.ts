"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

const THREAD_MAP_STORAGE_KEY = "nion.rss.assistant.thread-map";
const PANEL_STATE_STORAGE_KEY = "nion.rss.assistant.panel-state";

const DEFAULT_PANEL_STATE = {
  visible: false,
  width: 440,
  height: 620,
};

type EntryThreadMap = Record<string, string>;

export interface RSSAssistantPanelState {
  visible: boolean;
  width: number;
  height: number;
}

function readEntryThreadMap(): EntryThreadMap {
  if (typeof window === "undefined") {
    return {};
  }

  const raw = localStorage.getItem(THREAD_MAP_STORAGE_KEY);
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return {};
    }

    const result: EntryThreadMap = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof key === "string" && typeof value === "string" && value.trim()) {
        result[key] = value;
      }
    }
    return result;
  } catch {
    return {};
  }
}

function saveEntryThreadMap(value: EntryThreadMap) {
  if (typeof window === "undefined") {
    return;
  }
  localStorage.setItem(THREAD_MAP_STORAGE_KEY, JSON.stringify(value));
}

function readPanelState(): RSSAssistantPanelState {
  if (typeof window === "undefined") {
    return DEFAULT_PANEL_STATE;
  }

  const raw = localStorage.getItem(PANEL_STATE_STORAGE_KEY);
  if (!raw) {
    return DEFAULT_PANEL_STATE;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<RSSAssistantPanelState>;
    return {
      visible: Boolean(parsed.visible),
      width:
        typeof parsed.width === "number" && parsed.width >= 360 && parsed.width <= 760
          ? parsed.width
          : DEFAULT_PANEL_STATE.width,
      height:
        typeof parsed.height === "number" && parsed.height >= 440 && parsed.height <= 860
          ? parsed.height
          : DEFAULT_PANEL_STATE.height,
    };
  } catch {
    return DEFAULT_PANEL_STATE;
  }
}

function savePanelState(value: RSSAssistantPanelState) {
  if (typeof window === "undefined") {
    return;
  }
  localStorage.setItem(PANEL_STATE_STORAGE_KEY, JSON.stringify(value));
}

export function useRSSEntryThreadSession(entryId: string) {
  const [threadMap, setThreadMap] = useState<EntryThreadMap>({});

  useEffect(() => {
    setThreadMap(readEntryThreadMap());
  }, []);

  const threadId = useMemo(() => threadMap[entryId] ?? null, [entryId, threadMap]);

  const setThreadId = useCallback(
    (nextThreadId: string | null) => {
      setThreadMap((previous) => {
        const next = { ...previous };

        if (!nextThreadId) {
          delete next[entryId];
        } else {
          next[entryId] = nextThreadId;
        }

        saveEntryThreadMap(next);
        return next;
      });
    },
    [entryId],
  );

  return {
    threadId,
    setThreadId,
    clearThread: () => setThreadId(null),
  };
}

export function useRSSAssistantPanelState() {
  const [panelState, setPanelState] = useState<RSSAssistantPanelState>(DEFAULT_PANEL_STATE);

  useEffect(() => {
    setPanelState(readPanelState());
  }, []);

  const updatePanelState = useCallback((patch: Partial<RSSAssistantPanelState>) => {
    setPanelState((previous) => {
      const next = {
        ...previous,
        ...patch,
      };
      savePanelState(next);
      return next;
    });
  }, []);

  return {
    panelState,
    updatePanelState,
  };
}
