import { getBackendBaseURL } from "@/core/config";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly detail?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const url = `${getBackendBaseURL()}${path}`;
  const response = await fetch(url, init);
  if (!response.ok) {
    let detail: string | undefined;
    try {
      const body = await response.json();
      detail =
        typeof body?.detail === "string"
          ? body.detail
          : typeof body?.message === "string"
            ? body.message
            : undefined;
    } catch {
      // non-JSON error response
    }
    throw new ApiError(
      detail ?? `Request failed (${response.status})`,
      response.status,
      detail,
    );
  }
  return response.json() as Promise<T>;
}

export async function apiFetchVoid(
  path: string,
  init?: RequestInit,
): Promise<void> {
  const url = `${getBackendBaseURL()}${path}`;
  const response = await fetch(url, init);
  if (!response.ok) {
    let detail: string | undefined;
    try {
      const body = await response.json();
      detail = typeof body?.detail === "string" ? body.detail : undefined;
    } catch {
      // non-JSON error response
    }
    throw new ApiError(
      detail ?? `Request failed (${response.status})`,
      response.status,
      detail,
    );
  }
}
