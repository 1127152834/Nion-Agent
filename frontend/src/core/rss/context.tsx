"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

export type RSSContextBlockType = "mainEntry" | "mainFeed";

const SPECIAL_BLOCK_TYPES = new Set<RSSContextBlockType>([
  "mainEntry",
  "mainFeed",
]);

const noop = () => undefined;

export interface RSSContextBlock {
  id: string;
  type: RSSContextBlockType;
  value: string;
  metadata?: {
    title?: string;
    url?: string;
    summary?: string;
    feed_id?: string;
  };
}

type RSSContextValue = {
  blocks: RSSContextBlock[];
  addBlock: (block: RSSContextBlock) => void;
  removeBlock: (id: string) => void;
  clearBlocks: () => void;
};

const RSSContext = createContext<RSSContextValue>({
  blocks: [],
  addBlock: noop,
  removeBlock: noop,
  clearBlocks: noop,
});

export function RSSContextProvider({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const [blocks, setBlocks] = useState<RSSContextBlock[]>([]);

  const addBlock = useCallback((block: RSSContextBlock) => {
    setBlocks((previous) => {
      const filtered = SPECIAL_BLOCK_TYPES.has(block.type)
        ? previous.filter((item) => !SPECIAL_BLOCK_TYPES.has(item.type))
        : previous.filter((item) => item.id !== block.id);
      return [...filtered, block];
    });
  }, []);

  const removeBlock = useCallback((id: string) => {
    setBlocks((previous) => previous.filter((item) => item.id !== id));
  }, []);

  const clearBlocks = useCallback(() => {
    setBlocks([]);
  }, []);

  const value = useMemo(
    () => ({
      blocks,
      addBlock,
      removeBlock,
      clearBlocks,
    }),
    [addBlock, blocks, clearBlocks, removeBlock],
  );

  return <RSSContext.Provider value={value}>{children}</RSSContext.Provider>;
}

export function useRSSContext() {
  return useContext(RSSContext);
}
