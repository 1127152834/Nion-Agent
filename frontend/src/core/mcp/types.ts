export type MCPServerType = "stdio" | "sse" | "http";

export interface McpOAuthConfig extends Record<string, unknown> {
  enabled?: boolean;
  token_url?: string;
  grant_type?: "client_credentials" | "refresh_token";
  client_id?: string | null;
  client_secret?: string | null;
  refresh_token?: string | null;
  scope?: string | null;
  audience?: string | null;
  token_field?: string;
  token_type_field?: string;
  expires_in_field?: string;
  default_token_type?: string;
  refresh_skew_seconds?: number;
  extra_token_params?: Record<string, string>;
}

export interface McpServerMeta extends Record<string, unknown> {
  display_name?: string;
  origin?: "marketplace" | "custom";
  marketplace_id?: string;
  marketplace_version?: string;
  install_option_id?: string;
  verified?: boolean;
  featured?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface MCPServerConfig extends Record<string, unknown> {
  enabled: boolean;
  type?: MCPServerType | string;
  command?: string | null;
  args?: string[];
  env?: Record<string, string>;
  url?: string | null;
  headers?: Record<string, string>;
  oauth?: McpOAuthConfig | null;
  description?: string;
  meta?: McpServerMeta | null;
}

export interface MCPConfig {
  mcp_servers: Record<string, MCPServerConfig>;
}

export interface MCPServerProbeResponse {
  success: boolean;
  message: string;
  tool_count: number;
  tools: string[];
}

export interface MCPPrerequisiteStatus {
  available: boolean;
  path?: string | null;
}

export interface MCPPrerequisiteResponse {
  commands: Record<string, MCPPrerequisiteStatus>;
}

export interface MCPToolchainEnsureResponse {
  installed: boolean;
  message: string;
  commands: Record<string, MCPPrerequisiteStatus>;
}

export type MCPMarketplaceTransport = MCPServerType;

export type MCPMarketplaceInstallApply =
  | { kind: "env"; key: string; format?: string }
  | { kind: "header"; key: string; format?: string }
  | { kind: "arg_append"; args: string[] }
  | { kind: "url"; format?: string };

export type MCPMarketplaceInstallFingerprint =
  | { transport: "stdio"; command: string; args_prefix: string[] }
  | { transport: "http" | "sse"; url: string };

export interface MCPMarketplaceInstallInput {
  id: string;
  label: string;
  type: "string" | "number" | "boolean" | "secret" | "select";
  required: boolean;
  default?: string | number | boolean;
  placeholder?: string;
  help?: string;
  options?: string[];
  apply: MCPMarketplaceInstallApply;
}

export interface MCPMarketplaceInstallOption {
  id: string;
  label: string;
  transport: MCPMarketplaceTransport;
  prerequisites: string[];
  template: MCPServerConfig;
  inputs: MCPMarketplaceInstallInput[];
}

export interface MCPMarketplaceServerListItem {
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
  detailUrl: string;
  fingerprints: MCPMarketplaceInstallFingerprint[];
}

export interface MCPMarketplaceServerDetail extends Omit<MCPMarketplaceServerListItem, "detailUrl"> {
  docsUrl?: string | null;
  readmeMarkdown: string;
  demoImageUrls: string[];
  installOptions: MCPMarketplaceInstallOption[];
}

export interface MCPDebugInfo {
  pid: number;
  process_start_time: string;
  cwd: string;
  python_executable: string;
  router_file: string;
  router_mtime?: string | null;
  langchain_mcp_adapters_version?: string | null;
  nion_desktop_runtime: boolean;
  app_is_packaged: boolean;
}
