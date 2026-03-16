export const agentKeys = {
  all: ["agents"] as const,
  lists: () => [...agentKeys.all, "list"] as const,
  detail: (name: string) => [...agentKeys.all, name] as const,
  defaultConfig: () => [...agentKeys.all, "default-config"] as const,
  soul: (name: string) => [...agentKeys.all, name, "soul"] as const,
  identity: (name: string) => [...agentKeys.all, name, "identity"] as const,
  heartbeat: {
    all: (name: string) => [...agentKeys.all, name, "heartbeat"] as const,
    settings: (name: string) => [...agentKeys.all, name, "heartbeat", "settings"] as const,
    templates: () => [...agentKeys.all, "heartbeat", "templates"] as const,
    logs: (name: string) => [...agentKeys.all, name, "heartbeat", "logs"] as const,
    log: (name: string, logId: string) => [...agentKeys.all, name, "heartbeat", "log", logId] as const,
    logsList: (name: string, templateId?: string, status?: string, offset?: number) =>
      [...agentKeys.all, name, "heartbeat", "logs", templateId, status, offset] as const,
    status: (name: string) => [...agentKeys.all, name, "heartbeat", "status"] as const,
  },
  evolution: {
    all: (name: string) => [...agentKeys.all, name, "evolution"] as const,
    settings: (name: string) => [...agentKeys.all, name, "evolution", "settings"] as const,
    reports: (name: string) => [...agentKeys.all, name, "evolution", "reports"] as const,
    suggestions: (name: string, status?: string) =>
      [...agentKeys.all, name, "evolution", "suggestions", status] as const,
  },
} as const;
