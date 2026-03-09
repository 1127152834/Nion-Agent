import type { Message, Thread } from "@langchain/langgraph-sdk";

import type { Todo } from "../todos";

export interface ArtifactGroupMetadata {
  task_id?: string | null;
  prompt?: string | null;
  tags?: string[] | null;
}

export interface ArtifactGroup {
  id: string;
  name: string;
  description?: string | null;
  artifacts: string[];
  created_at: number;
  metadata?: ArtifactGroupMetadata | null;
}

export type SessionMode = "normal" | "temporary_chat";

export interface ClarificationState {
  status?: "awaiting_user" | "resolved" | string;
  question?: string;
  clarification_type?: string;
  context?: string | null;
  options?: string[];
  requires_choice?: boolean;
  tool_call_id?: string | null;
  asked_at?: string | null;
  resolved_at?: string | null;
  resolved_by_message_id?: string | null;
}

export interface AgentThreadState extends Record<string, unknown> {
  title: string;
  messages: Message[];
  artifacts: string[];
  artifact_groups?: ArtifactGroup[] | null;
  clarification?: ClarificationState | null;
  todos?: Todo[];
  session_mode?: SessionMode;
}

export interface AgentThread extends Thread<AgentThreadState> {}

export interface AgentThreadContext extends Record<string, unknown> {
  thread_id: string;
  model_name: string | undefined;
  thinking_enabled: boolean;
  is_plan_mode: boolean;
  subagent_enabled: boolean;
  memory_read?: boolean;
  memory_write?: boolean;
  session_mode?: SessionMode;
  reasoning_effort?: "minimal" | "low" | "medium" | "high";
  agent_name?: string;
}
