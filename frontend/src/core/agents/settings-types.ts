// Heartbeat Types
export interface TemplateConfig {
  template_id: string;
  enabled: boolean;
  cron: string;
  generate_reminder: boolean;
  generate_log: boolean;
  auto_execute: boolean;
}

export interface HeartbeatSettings {
  enabled: boolean;
  timezone: string;
  templates: Record<string, TemplateConfig>;
}

// Evolution Types
export interface EvolutionSettings {
  enabled: boolean;
  interval_hours: number;
  auto_trigger: boolean;
}
