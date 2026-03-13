import { getBackendBaseURL } from "@/core/config";

import type { ProcesslogExport } from "./types";

async function parseJSONOrNull(response: Response) {
  return response.json().catch(() => null) as Promise<
    | Record<string, unknown>
    | {
        detail?: string;
      }
    | null
  >;
}

function extractErrorDetail(data: unknown): string | undefined {
  if (typeof data !== "object" || data === null) {
    return undefined;
  }
  if ("detail" in data && typeof data.detail === "string") {
    return data.detail;
  }
  return undefined;
}

export async function exportTraceProcesslog(
  traceId: string,
  params?: { limit?: number },
): Promise<ProcesslogExport> {
  const limit = params?.limit ?? 2000;
  const res = await fetch(
    `${getBackendBaseURL()}/api/processlog/trace/${encodeURIComponent(traceId)}/export?limit=${encodeURIComponent(String(limit))}`,
  );
  const payload = await parseJSONOrNull(res);
  if (!res.ok) {
    throw new Error(
      extractErrorDetail(payload) ??
        `Failed to export processlog by trace (${res.status})`,
    );
  }
  return (payload ?? { count: 0, events: [] }) as unknown as ProcesslogExport;
}

