import { getBackendBaseURL } from "@/core/config";

export type EmbeddingOperationResponse = {
  status: "ok" | "degraded" | "disabled";
  latency_ms: number;
  error_code: string | null;
  result: Record<string, unknown> | null;
};

export type EmbeddingProvider = "local" | "openai" | "custom";

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

async function parseResponse(response: Response): Promise<EmbeddingOperationResponse> {
  const data = (await response.json()) as EmbeddingOperationResponse | { detail?: string };
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
  return data as EmbeddingOperationResponse;
}

export async function loadEmbeddingModelsStatus(): Promise<EmbeddingOperationResponse> {
  const response = await fetch(`${getBackendBaseURL()}/api/embedding-models/status`);
  return parseResponse(response);
}

export async function loadEmbeddingPresets(): Promise<EmbeddingOperationResponse> {
  const response = await fetch(`${getBackendBaseURL()}/api/embedding-models/presets`);
  return parseResponse(response);
}

export async function setActiveEmbeddingModel(payload: SetActiveModelPayload): Promise<EmbeddingOperationResponse> {
  const response = await fetch(`${getBackendBaseURL()}/api/embedding-models/set-active`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  return parseResponse(response);
}

export async function testEmbedding(
  text: string = "test embedding",
): Promise<EmbeddingOperationResponse> {
  const response = await fetch(`${getBackendBaseURL()}/api/embedding-models/test`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
  });
  return parseResponse(response);
}
