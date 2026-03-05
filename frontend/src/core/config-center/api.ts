/**
 * Configuration Center API
 *
 * API functions for configuration management.
 */

import { getBackendBaseURL } from "@/core/config";

import type {
  ApiErrorDetail,
  ConfigReadResponse,
  ConfigSchemaResponse,
  ConfigUpdateRequest,
  ConfigUpdateResponse,
  ConfigValidateRequest,
  ConfigValidateResponse,
} from "./types";
import { ConfigCenterApiError } from "./types";

async function parseOrThrow<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");
  const payload = isJson ? await response.json() : await response.text();

  if (!response.ok) {
    const detail = (isJson ? (payload as { detail?: ApiErrorDetail | string }).detail : payload) ?? null;
    const detailMessage =
      typeof detail === "string"
        ? detail
        : detail?.message ?? `Request failed with status ${response.status}`;
    throw new ConfigCenterApiError(response.status, detailMessage, detail);
  }

  return payload as T;
}

export async function loadConfig(): Promise<ConfigReadResponse> {
  const response = await fetch(`${getBackendBaseURL()}/api/config`);
  return parseOrThrow<ConfigReadResponse>(response);
}

export async function loadConfigSchema(): Promise<ConfigSchemaResponse> {
  const response = await fetch(`${getBackendBaseURL()}/api/config/schema`);
  return parseOrThrow<ConfigSchemaResponse>(response);
}

export async function validateConfig(payload: ConfigValidateRequest): Promise<ConfigValidateResponse> {
  const response = await fetch(`${getBackendBaseURL()}/api/config/validate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  return parseOrThrow<ConfigValidateResponse>(response);
}

export async function updateConfig(payload: ConfigUpdateRequest): Promise<ConfigUpdateResponse> {
  const response = await fetch(`${getBackendBaseURL()}/api/config`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  return parseOrThrow<ConfigUpdateResponse>(response);
}
