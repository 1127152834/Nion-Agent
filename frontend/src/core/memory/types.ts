export interface MemorySection {
  summary: string;
  updatedAt: string;
}

export interface MemoryFact {
  id: string;
  content: string;
  category: string;
  confidence: number;
  createdAt: string;
  source: string;
  pinned?: boolean;
  inaccurate?: boolean;
}

export interface MemoryItem {
  id: string;
  content: string;
  category?: string;
  confidence?: number;
  created_at?: string;
  source?: string;
  metadata?: Record<string, unknown> | null;
}

export interface UserMemory {
  version: string;
  lastUpdated: string;
  user: {
    workContext: MemorySection;
    personalContext: MemorySection;
    topOfMind: MemorySection;
  };
  history: {
    recentMonths: MemorySection;
    earlierContext: MemorySection;
    longTermBackground: MemorySection;
  };
  facts: MemoryFact[];
  items: MemoryItem[];
  categories: Record<string, MemoryItem[]>;
  resources: Array<Record<string, unknown>>;
  legacy?: Record<string, unknown> | null;
}

export interface UpdateMemoryFactRequest {
  content?: string;
  category?: string;
  confidence?: number;
  pinned?: boolean;
  inaccurate?: boolean;
}

export interface DeleteMemoryFactResponse {
  success: boolean;
  id: string;
}
