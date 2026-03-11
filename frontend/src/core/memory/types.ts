export interface UserMemory {
  version: string;
  scope?: string;
  storage_layout?: string;
  lastUpdated: string;
  user: {
    workContext: {
      summary: string;
      updatedAt: string;
    };
    personalContext: {
      summary: string;
      updatedAt: string;
    };
    topOfMind: {
      summary: string;
      updatedAt: string;
    };
  };
  history: {
    recentMonths: {
      summary: string;
      updatedAt: string;
    };
    earlierContext: {
      summary: string;
      updatedAt: string;
    };
    longTermBackground: {
      summary: string;
      updatedAt: string;
    };
  };
  facts: {
    id: string;
    content: string;
    category: string;
    confidence: number;
    createdAt: string;
    source: string;
    status?: string;
    entity_refs?: string[];
    relations?: {
      type: string;
      target_id: string;
      weight: number;
      evidence: string;
    }[];
    source_refs?: string[];
  }[];
  agent_catalog?: AgentDirectoryCard[];
}

export interface MemoryItem {
  memory_id: string;
  entry_type: string;
  scope: string;
  source_thread_id?: string | null;
  summary: string;
  tags: string[];
  entity_refs: string[];
  relations: {
    type: string;
    target_id: string;
    weight: number;
    evidence: string;
  }[];
  source_refs: string[];
  confidence: number;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface AgentDirectoryCard {
  agent_name: string;
  role: string;
  capability_summary: string;
  persona_summary: string;
  style_hint: string;
  updated_at: string;
}

export interface GovernanceStatus {
  pending_count: number;
  contested_count: number;
  last_run_at: string;
  queue: {
    decision_id: string;
    source_scope: string;
    status: string;
    reason: string;
    created_at: string;
    decided_at?: string;
    candidate?: Record<string, unknown>;
  }[];
}
