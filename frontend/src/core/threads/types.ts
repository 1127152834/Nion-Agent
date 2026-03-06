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

export interface AgentThreadState extends Record<string, unknown> {
  title: string;
  messages: Message[];
  artifacts: string[];
  artifact_groups?: ArtifactGroup[] | null;
  todos?: Todo[];
}

export interface AgentThread extends Thread<AgentThreadState> {}

export interface AgentThreadContext extends Record<string, unknown> {
  thread_id: string;
  model_name: string | undefined;
  thinking_enabled: boolean;
  is_plan_mode: boolean;
  subagent_enabled: boolean;
  reasoning_effort?: "minimal" | "low" | "medium" | "high";
  agent_name?: string;
}
