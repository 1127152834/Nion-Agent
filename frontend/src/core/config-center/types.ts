/**
 * Configuration Center Types
 *
 * Type definitions for configuration management API.
 */

export interface ConfigValidateErrorItem {
  path: string[];
  message: string;
  type: string;
}

export interface ConfigReadResponse {
  version: string;
  source_path: string;
  yaml_text: string;
  config: Record<string, unknown>;
}

export interface ConfigSectionSchema {
  title: string;
  description: string;
}

export interface ConfigSchemaResponse {
  sections: Record<string, ConfigSectionSchema>;
  order: string[];
}

export interface ConfigValidateRequest {
  config?: Record<string, unknown>;
  yaml_text?: string;
}

export interface ConfigValidateResponse {
  valid: boolean;
  errors: ConfigValidateErrorItem[];
  config?: Record<string, unknown> | null;
  yaml_text?: string | null;
}

export interface ConfigUpdateRequest {
  version: string;
  config?: Record<string, unknown>;
  yaml_text?: string;
}

export interface ConfigUpdateResponse {
  version: string;
  source_path: string;
  yaml_text: string;
  config: Record<string, unknown>;
}

export interface ApiErrorDetail {
  message?: string;
  errors?: ConfigValidateErrorItem[];
  current_version?: string;
}

export class ConfigCenterApiError extends Error {
  status: number;
  detail: ApiErrorDetail | string | null;

  constructor(status: number, message: string, detail: ApiErrorDetail | string | null = null) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}
