export interface OpenVikingMemoryItem {
  memory_id: string;
  uri: string;
  summary: string;
  score: number;
  status: string;
  use_count: number;
  last_used_at: string;
  source_thread_id: string;
  created_at: string;
  updated_at: string;
  scope: string;
  tier?: "profile" | "preference" | "episode" | "trace" | string;
  source?: "auto" | "tool" | string;
  quality?: number;
  quality_score?: number;
  decision_reason?: string;
  evidence?: Record<string, unknown>;
  retention_policy?: string;
  ttl?: number | null;
  metadata?: Record<string, unknown>;
  // Backward-compatible fields still used in some UI cards.
  entry_type?: string;
  tags?: string[];
  entity_refs?: string[];
  relations?: {
    type: string;
    target_id: string;
    weight: number;
    evidence: string;
  }[];
  source_refs?: string[];
  confidence?: number;
}

export interface AgentDirectoryCard {
  agent_name: string;
  role: string;
  capability_summary: string;
  persona_summary: string;
  style_hint: string;
  updated_at: string;
}

export interface GovernanceQueueItem {
  decision_id: string;
  memory_id: string;
  action: string;
  status: string;
  reason: string;
  created_at: string;
  decided_at?: string;
  decided_by?: string;
  candidate?: Record<string, unknown>;
}

export interface OpenVikingGovernanceStatus {
  pending_count: number;
  contested_count: number;
  last_run_at: string;
  queue: GovernanceQueueItem[];
  catalog?: AgentDirectoryCard[];
}

export interface OpenVikingRetrievalStatus {
  scope: string;
  retrieval_mode: string;
  rerank_mode: string;
  graph_enabled: boolean;
  local_embedding_configured: boolean;
  local_embedding_model?: string | null;
  embedding_health_ok: boolean;
  embedding_health_message: string;
  index_available: boolean;
  index_count: number;
  ledger_item_count?: number;
  last_fallback_reason?: string;
  graph_stats?: {
    nodes: number;
    edges: number;
    memory_links: number;
  };
}

export interface OpenVikingConfig {
  enabled: boolean;
  provider: string;
  storage_layout: string;
  debounce_seconds: number;
  max_facts: number;
  fact_confidence_threshold: number;
  injection_enabled: boolean;
  max_injection_tokens: number;
  retrieval_mode: string;
  rerank_mode: string;
  graph_enabled: boolean;
  openviking_context_enabled: boolean;
  openviking_context_limit: number;
  openviking_session_commit_enabled: boolean;
}

export interface OpenVikingStatus {
  config: OpenVikingConfig;
  retrieval: OpenVikingRetrievalStatus;
  governance: OpenVikingGovernanceStatus;
}

export interface MemoryActionLogItem {
  scope: string;
  action_id: string;
  trace_id: string;
  chat_id: string;
  memory_id: string;
  action: string;
  reason: string;
  before_content: string;
  after_content: string;
  evidence: Record<string, unknown>;
  created_at: string;
}

export interface MemoryFusionHit {
  memory_id: string;
  content: string;
  sources: string[];
  score: number;
}

export interface MemoryQueryExplain {
  query: string;
  route_taken: string;
  dense_hits: Array<Record<string, unknown>>;
  sparse_hits: Array<Record<string, unknown>>;
  fusion_hits: MemoryFusionHit[];
  fallback_reason: string;
  recent_actions: MemoryActionLogItem[];
}

export interface ProcesslogExport {
  trace_id?: string;
  chat_id?: string;
  count: number;
  events: Array<Record<string, unknown>>;
}
