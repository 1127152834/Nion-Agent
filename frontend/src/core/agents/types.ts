export interface Agent {
  name: string;
  display_name?: string | null;
  description: string;
  model: string | null;
  tool_groups: string[] | null;
  heartbeat_enabled?: boolean;
  evolution_enabled?: boolean;
  avatar_url?: string | null;
  soul?: string | null;
}

export interface CreateAgentRequest {
  name: string;
  display_name?: string | null;
  description?: string;
  model?: string | null;
  tool_groups?: string[] | null;
  soul?: string;
}

export interface UpdateAgentRequest {
  display_name?: string | null;
  description?: string | null;
  model?: string | null;
  tool_groups?: string[] | null;
  soul?: string | null;
}

export interface DefaultAgentConfig {
  name: "_default";
  display_name?: string | null;
  description: string;
  model: string | null;
  tool_groups: string[] | null;
  heartbeat_enabled: boolean;
  evolution_enabled: boolean;
  avatar_url?: string | null;
}

export interface UpdateDefaultAgentConfigRequest {
  description?: string | null;
  model?: string | null;
  tool_groups?: string[] | null;
  heartbeat_enabled?: boolean;
  evolution_enabled?: boolean;
}
