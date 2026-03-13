export type CliSource = "managed" | "system" | "custom";

export interface CLIStateConfig extends Record<string, unknown> {
  enabled: boolean;
  source: CliSource;
  exec?: string | null;
}

export interface CLIConfig {
  clis: Record<string, CLIStateConfig>;
}

export type CLIMarketplaceInstallKind = "http" | "uv" | "pipx";

export interface CLIMarketplaceToolListItem {
  id: string;
  name: string;
  author?: string | null;
  category?: string | null;
  description: string;
  tags: string[];
  verified: boolean;
  featured: boolean;
  version: string;
  docsUrl?: string | null;
  installKind?: CLIMarketplaceInstallKind | null;
  detailUrl: string;
}

export interface CLIMarketplaceToolDetail extends Omit<CLIMarketplaceToolListItem, "detailUrl" | "installKind"> {
  readmeMarkdown: string;
  platforms: unknown[];
}

export interface CLIInstallResponse {
  success: boolean;
  message: string;
  toolId: string;
  enabled: boolean;
  bins: string[];
}

export type CLIInstallJobStatus = "pending" | "running" | "succeeded" | "failed";

export interface CLIInstallJobStartResponse {
  success: boolean;
  message: string;
  jobId: string;
  toolId: string;
}

export interface CLIInstallJobStatusResponse {
  success: boolean;
  jobId: string;
  toolId: string;
  status: CLIInstallJobStatus;
  message: string;
  lastLogLine: string;
  logsTail: string[];
  result?: { enabled?: boolean; bins?: string[] } | null;
}

export interface CLIUninstallResponse {
  success: boolean;
  message: string;
  toolId: string;
}

export interface CLIProbeResponse {
  success: boolean;
  message: string;
  installed: boolean;
  toolId: string;
  bins: string[];
}

export interface CLIDiscoveredBin {
  name: string;
  path: string;
}

export interface CLIDiscoveredTool {
  toolId: string;
  bins: CLIDiscoveredBin[];
}

export interface CLIDiscoverResponse {
  tools: CLIDiscoveredTool[];
  candidates: CLIDiscoveredBin[];
}

export interface CLIPrerequisiteStatus {
  available: boolean;
  path?: string | null;
}

export interface CLIPrerequisitesResponse {
  commands: Record<string, CLIPrerequisiteStatus>;
}

export interface CLIToolchainEnsureResponse {
  installed: boolean;
  message: string;
  commands: Record<string, CLIPrerequisiteStatus>;
}

export interface CLISetEnabledResponse {
  success: boolean;
  message: string;
  toolId: string;
  enabled: boolean;
  requiresConfirmation: boolean;
  confirmationToken?: string | null;
}
