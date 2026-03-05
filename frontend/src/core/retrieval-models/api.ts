import { getBackendBaseURL } from "@/core/config";

export type RetrievalFamily = "embedding" | "rerank";

export type RetrievalOperationResponse = {
  status: string;
  latency_ms?: number;
  error_code?: string | null;
  result?: unknown;
};

export class RetrievalApiError extends Error {
  readonly status: number;
  readonly detail: unknown;

  constructor(status: number, message: string, detail: unknown = null) {
    super(message);
    this.name = "RetrievalApiError";
    this.status = status;
    this.detail = detail;
  }
}

async function parseJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return response.json();
  }
  return response.text();
}

function toErrorMessage(detail: unknown, status: number): string {
  if (typeof detail === "string" && detail.trim()) {
    return detail;
  }
  if (detail && typeof detail === "object") {
    const record = detail as Record<string, unknown>;
    const fromDetail = record.detail;
    if (typeof fromDetail === "string" && fromDetail.trim()) {
      return fromDetail;
    }
    const fromMessage = record.message;
    if (typeof fromMessage === "string" && fromMessage.trim()) {
      return fromMessage;
    }
  }
  return `Request failed (${status})`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${getBackendBaseURL()}${path}`, init);
  const payload = await parseJson(response);
  if (!response.ok) {
    throw new RetrievalApiError(
      response.status,
      toErrorMessage(payload, response.status),
      payload,
    );
  }
  return payload as T;
}

export async function loadRetrievalModelsStatus(): Promise<RetrievalOperationResponse> {
  return request<RetrievalOperationResponse>("/api/retrieval-models/status");
}

export async function setActiveRetrievalModel(payload: {
  family: RetrievalFamily;
  provider: "local_onnx" | "openai_compatible" | "rerank_api";
  model_id?: string;
  model?: string;
}): Promise<RetrievalOperationResponse> {
  return request<RetrievalOperationResponse>("/api/retrieval-models/active", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export async function testRetrievalProviderConnection(payload: {
  family: RetrievalFamily;
  provider: "openai_compatible" | "rerank_api";
  model?: string;
}): Promise<RetrievalOperationResponse> {
  return request<RetrievalOperationResponse>(
    "/api/retrieval-models/provider/test-connection",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );
}

export async function testRetrievalEmbedding(query: string): Promise<RetrievalOperationResponse> {
  return request<RetrievalOperationResponse>("/api/retrieval-models/test/embedding", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
}

export async function testRetrievalRerank(
  query: string,
  documents: string[],
): Promise<RetrievalOperationResponse> {
  return request<RetrievalOperationResponse>("/api/retrieval-models/test/rerank", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, documents }),
  });
}
