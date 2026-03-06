export type TriggerType = "cron" | "interval" | "once" | "event" | "webhook";

export type TaskStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface TriggerConfig {
  type: TriggerType;
  cron_expression?: string;
  interval_seconds?: number;
  scheduled_time?: string;
  event_type?: string;
  event_filters?: Record<string, unknown>;
  webhook_secret?: string;
  timezone?: string;
}

export interface CompletionCriteria {
  type: "output_contains" | "output_matches" | "no_error";
  pattern?: string;
}

export interface AgentStep {
  agent_name: string;
  agent_config?: Record<string, unknown>;
  prompt: string;
  skill?: string;
  tools?: string[];
  mcp_servers?: string[];
  context_refs?: string[];
  timeout_seconds: number;
  retry_on_failure: boolean;
  max_retries: number;
}

export interface WorkflowStep {
  id: string;
  name: string;
  agents: AgentStep[];
  parallel: boolean;
  depends_on: string[];
  completion_criteria?: CompletionCriteria;
}

export interface RetryPolicy {
  max_attempts: number;
  backoff: "none" | "linear" | "exponential";
}

export interface ScheduledTask {
  id: string;
  name: string;
  description?: string | null;
  mode: "workflow" | "reminder";
  trigger: TriggerConfig;
  steps: WorkflowStep[];
  reminder_title?: string | null;
  reminder_message?: string | null;
  on_complete?: string | null;
  on_failure?: string | null;
  notification_webhook?: string | null;
  max_concurrent_steps: number;
  timeout_seconds: number;
  retry_policy?: RetryPolicy | null;
  enabled: boolean;
  created_by: string;
  created_at: string;
  last_run_at?: string | null;
  next_run_at?: string | null;
  status: TaskStatus;
  last_result?: Record<string, unknown> | null;
  last_error?: string | null;
}

export interface CreateScheduledTaskRequest {
  name: string;
  description?: string;
  mode?: "workflow" | "reminder";
  trigger: TriggerConfig;
  steps: WorkflowStep[];
  reminder_title?: string;
  reminder_message?: string;
  on_complete?: string;
  on_failure?: string;
  notification_webhook?: string;
  max_concurrent_steps?: number;
  timeout_seconds?: number;
  retry_policy?: RetryPolicy;
  enabled?: boolean;
  created_by?: string;
}

export interface UpdateScheduledTaskRequest {
  name: string;
  description?: string;
  mode?: "workflow" | "reminder";
  trigger: TriggerConfig;
  steps: WorkflowStep[];
  reminder_title?: string;
  reminder_message?: string;
  on_complete?: string;
  on_failure?: string;
  notification_webhook?: string;
  max_concurrent_steps?: number;
  timeout_seconds?: number;
  retry_policy?: RetryPolicy;
  enabled?: boolean;
}

export interface TaskExecutionRecord {
  run_id: string;
  task_id: string;
  started_at: string;
  completed_at?: string | null;
  status: TaskStatus;
  success: boolean;
  result?: Record<string, unknown> | null;
  error?: string | null;
}
