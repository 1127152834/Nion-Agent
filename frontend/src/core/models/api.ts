import { getBackendBaseURL } from "../config";

import type {
  Model,
  ModelConnectionTestRequest,
  ModelConnectionTestResponse,
  ModelMetadataRequest,
  ModelMetadataResponse,
  ProviderModelsRequest,
  ProviderModelsResponse,
} from "./types";

export async function loadModels() {
  const response = await fetch(`${getBackendBaseURL()}/api/models`);
  if (!response.ok) {
    throw new Error(`Failed to load models (${response.status})`);
  }
  const { models } = (await response.json()) as { models: Model[] };
  return models;
}

export async function testModelConnection(
  payload: ModelConnectionTestRequest,
): Promise<ModelConnectionTestResponse> {
  const response = await fetch(`${getBackendBaseURL()}/api/models/test-connection`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = (await response.json()) as ModelConnectionTestResponse | { detail?: string };
  if (!response.ok) {
    const detail = typeof data === "object" && data && "detail" in data
      ? data.detail
      : undefined;
    throw new Error(detail ?? `Failed to test model connection (${response.status})`);
  }
  return data as ModelConnectionTestResponse;
}

export async function loadProviderModels(
  payload: ProviderModelsRequest,
): Promise<ProviderModelsResponse> {
  const response = await fetch(`${getBackendBaseURL()}/api/models/provider-models`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = (await response.json()) as ProviderModelsResponse | { detail?: string };
  if (!response.ok) {
    const detail = typeof data === "object" && data && "detail" in data
      ? data.detail
      : undefined;
    throw new Error(detail ?? `Failed to load provider models (${response.status})`);
  }
  return data as ProviderModelsResponse;
}

export async function loadModelMetadata(
  payload: ModelMetadataRequest,
): Promise<ModelMetadataResponse> {
  const response = await fetch(`${getBackendBaseURL()}/api/models/model-metadata`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = (await response.json()) as ModelMetadataResponse | { detail?: string };
  if (!response.ok) {
    const detail = typeof data === "object" && data && "detail" in data
      ? data.detail
      : undefined;
    throw new Error(detail ?? `Failed to inspect model metadata (${response.status})`);
  }
  return data as ModelMetadataResponse;
}
