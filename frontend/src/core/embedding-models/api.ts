import { getBackendBaseURL } from "@/core/config";

export type EmbeddingOperationResponse<T = Record<string, unknown>> = {
  status: "ok" | "degraded" | "disabled";
  latency_ms: number;
  error_code: string | null;
  result: T | null;
};

export type EmbeddingProvider = "local" | "openai" | "custom";

export type EmbeddingStatusResult = {
  enabled?: boolean;
  provider?: EmbeddingProvider;
  model?: string;
  device?: string;
  dimension?: number;
  api_base?: string;
  message?: string;
};

export type PresetModel = {
  id: string;
  name: string;
  display_name: string;
  dimension: number;
  size_mb?: number;
  description: string;
  languages?: string[];
};

export type SetActiveModelPayload = {
  provider: EmbeddingProvider;
  model: string;
  api_key?: string;
  api_base?: string;
  dimension?: number;
  device?: string;
};

export type EmbeddingPresetsResult = {
  local?: PresetModel[];
  openai?: PresetModel[];
  message?: string;
};

export type EmbeddingTestResult = {
  model?: string;
  dimension?: number;
  message?: string;
};

export type EmbeddingSetActiveResult = {
  message?: string;
};

export class EmbeddingApiError extends Error {
  status: number;
  detail?: string;

  constructor(message: string, status: number, detail?: string) {
    super(message);
    this.name = "EmbeddingApiError";
    this.status = status;
    this.detail = detail;
  }
}

async function parseResponse<T>(response: Response): Promise<EmbeddingOperationResponse<T>> {
  const data = (await response.json()) as EmbeddingOperationResponse<T> | { detail?: string };
  if (!response.ok) {
    const detail = typeof data === "object" && data && "detail" in data
      ? data.detail
      : undefined;
    throw new EmbeddingApiError(
      detail ?? `Embedding models request failed (${response.status})`,
      response.status,
      detail,
    );
  }
  return data as EmbeddingOperationResponse<T>;
}

export async function loadEmbeddingModelsStatus(): Promise<EmbeddingOperationResponse<EmbeddingStatusResult>> {
  const response = await fetch(`${getBackendBaseURL()}/api/embedding-models/status`);
  return parseResponse<EmbeddingStatusResult>(response);
}

export async function loadEmbeddingPresets(): Promise<EmbeddingOperationResponse<EmbeddingPresetsResult>> {
  const response = await fetch(`${getBackendBaseURL()}/api/embedding-models/presets`);
  return parseResponse<EmbeddingPresetsResult>(response);
}

export async function setActiveEmbeddingModel(payload: SetActiveModelPayload): Promise<EmbeddingOperationResponse<EmbeddingSetActiveResult>> {
  const response = await fetch(`${getBackendBaseURL()}/api/embedding-models/set-active`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  return parseResponse<EmbeddingSetActiveResult>(response);
}

export async function testEmbedding(
  text = "test embedding",
): Promise<EmbeddingOperationResponse<EmbeddingTestResult>> {
  const response = await fetch(`${getBackendBaseURL()}/api/embedding-models/test`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
  });
  return parseResponse<EmbeddingTestResult>(response);
}
