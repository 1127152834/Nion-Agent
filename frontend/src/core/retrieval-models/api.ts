import { getBackendBaseURL } from "@/core/config";

export type RetrievalOperationResponse = {
  status: "ok" | "degraded" | "disabled";
  latency_ms: number;
  error_code: string | null;
  result: Record<string, unknown> | null;
};

export type RetrievalFamily = "embedding" | "rerank";
export type RetrievalProvider = "local_onnx" | "openai_compatible" | "rerank_api";

export type SetActiveModelPayload = {
  family: RetrievalFamily;
  provider: RetrievalProvider;
  model_id?: string;
  model?: string;
};

export type TestProviderConnectionPayload = {
  family: RetrievalFamily;
  provider: "openai_compatible" | "rerank_api";
  model?: string;
};

export class RetrievalApiError extends Error {
  status: number;
  detail?: string;

  constructor(message: string, status: number, detail?: string) {
    super(message);
    this.name = "RetrievalApiError";
    this.status = status;
    this.detail = detail;
  }
}

async function parseResponse(response: Response): Promise<RetrievalOperationResponse> {
  const data = (await response.json()) as RetrievalOperationResponse | { detail?: string };
  if (!response.ok) {
    const detail = typeof data === "object" && data && "detail" in data
      ? data.detail
      : undefined;
    throw new RetrievalApiError(
      detail ?? `Retrieval models request failed (${response.status})`,
      response.status,
      detail,
    );
  }
  return data as RetrievalOperationResponse;
}

export async function loadRetrievalModelsStatus(): Promise<RetrievalOperationResponse> {
  const response = await fetch(`${getBackendBaseURL()}/api/retrieval-models/status`);
  return parseResponse(response);
}

export async function switchRetrievalProfile(profile: string): Promise<RetrievalOperationResponse> {
  const response = await fetch(`${getBackendBaseURL()}/api/retrieval-models/switch-profile`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ profile }),
  });
  return parseResponse(response);
}

export async function setActiveRetrievalModel(payload: SetActiveModelPayload): Promise<RetrievalOperationResponse> {
  const response = await fetch(`${getBackendBaseURL()}/api/retrieval-models/set-active-model`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  return parseResponse(response);
}

export async function testRetrievalProviderConnection(
  payload: TestProviderConnectionPayload,
): Promise<RetrievalOperationResponse> {
  const response = await fetch(`${getBackendBaseURL()}/api/retrieval-models/test-provider-connection`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  return parseResponse(response);
}

export async function testRetrievalEmbedding(
  text: string,
  profile?: string,
): Promise<RetrievalOperationResponse> {
  const response = await fetch(`${getBackendBaseURL()}/api/retrieval-models/test-embedding`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text, profile }),
  });
  return parseResponse(response);
}

export async function testRetrievalRerank(
  query: string,
  documents: string[],
  profile?: string,
): Promise<RetrievalOperationResponse> {
  const response = await fetch(`${getBackendBaseURL()}/api/retrieval-models/test-rerank`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, documents, profile }),
  });
  return parseResponse(response);
}

export async function downloadRetrievalModel(modelId: string): Promise<RetrievalOperationResponse> {
  const response = await fetch(`${getBackendBaseURL()}/api/retrieval-models/download`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model_id: modelId }),
  });
  return parseResponse(response);
}

export type DownloadProgressCallback = (progress: {
  downloaded: number;
  total: number | null;
  percentage: number | null;
}) => void;

export async function downloadRetrievalModelWithProgress(
  modelId: string,
  onProgress?: DownloadProgressCallback,
): Promise<RetrievalOperationResponse> {
  return new Promise((resolve, reject) => {
    const eventSource = new EventSource(
      `${getBackendBaseURL()}/api/retrieval-models/download-stream/${modelId}`,
    );

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        switch (data.type) {
          case "start":
            // Download started
            break;

          case "progress":
            // Progress update
            if (onProgress) {
              onProgress({
                downloaded: data.downloaded,
                total: data.total,
                percentage: data.percentage,
              });
            }
            break;

          case "complete":
            // Download completed
            eventSource.close();
            resolve({
              status: "ok",
              latency_ms: data.latency_ms,
              error_code: null,
              result: data.result,
            });
            break;

          case "error":
            // Download failed
            eventSource.close();
            reject(
              new RetrievalApiError(
                data.message ?? "Download failed",
                500,
                data.error_code,
              ),
            );
            break;

          default:
            console.warn("Unknown event type:", data.type);
        }
      } catch (err) {
        console.error("Failed to parse SSE event:", err);
      }
    };

    eventSource.onerror = (err) => {
      eventSource.close();
      reject(new RetrievalApiError("SSE connection failed", 500));
    };
  });
}

export async function removeRetrievalModel(modelId: string): Promise<RetrievalOperationResponse> {
  const response = await fetch(`${getBackendBaseURL()}/api/retrieval-models/remove`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model_id: modelId }),
  });
  return parseResponse(response);
}

export async function importRetrievalModel(
  modelId: string,
  file: File,
): Promise<RetrievalOperationResponse> {
  const formData = new FormData();
  formData.append("model_id", modelId);
  formData.append("file", file);

  const response = await fetch(`${getBackendBaseURL()}/api/retrieval-models/import`, {
    method: "POST",
    body: formData,
  });
  return parseResponse(response);
}
