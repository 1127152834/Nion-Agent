import { apiFetch } from "@/core/api";

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
  const { models } = await apiFetch<{ models: Model[] }>("/api/models");
  return models;
}

export async function testModelConnection(
  payload: ModelConnectionTestRequest,
): Promise<ModelConnectionTestResponse> {
  return apiFetch<ModelConnectionTestResponse>("/api/models/test-connection", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export async function loadProviderModels(
  payload: ProviderModelsRequest,
): Promise<ProviderModelsResponse> {
  return apiFetch<ProviderModelsResponse>("/api/models/provider-models", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export async function loadModelMetadata(
  payload: ModelMetadataRequest,
): Promise<ModelMetadataResponse> {
  return apiFetch<ModelMetadataResponse>("/api/models/model-metadata", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}
