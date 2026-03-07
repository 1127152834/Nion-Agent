import { getBackendBaseURL } from "../config";

import type {
  DeleteMemoryFactResponse,
  MemoryFact,
  MemoryItem,
  UpdateMemoryFactRequest,
  UserMemory,
} from "./types";

function sectionOf(input: unknown): { summary: string; updatedAt: string } {
  const value = input as { summary?: unknown; updatedAt?: unknown } | undefined;
  return {
    summary: typeof value?.summary === "string" ? value.summary : "",
    updatedAt: typeof value?.updatedAt === "string" ? value.updatedAt : "",
  };
}

function normalizeFact(input: unknown): MemoryFact | null {
  const value = input as Record<string, unknown>;
  const id = typeof value?.id === "string" ? value.id : "";
  const content = typeof value?.content === "string" ? value.content : "";
  if (!id || !content) {
    return null;
  }
  return {
    id,
    content,
    category: typeof value.category === "string" ? value.category : "context",
    confidence:
      typeof value.confidence === "number" && Number.isFinite(value.confidence)
        ? value.confidence
        : 0.5,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : "",
    source: typeof value.source === "string" ? value.source : "unknown",
    pinned: Boolean(value.pinned),
    inaccurate: Boolean(value.inaccurate),
  };
}

function normalizeItem(input: unknown): MemoryItem | null {
  const value = input as Record<string, unknown>;
  const id = typeof value?.id === "string" ? value.id : "";
  const content = typeof value?.content === "string" ? value.content : "";
  if (!id || !content) {
    return null;
  }
  return {
    id,
    content,
    category: typeof value.category === "string" ? value.category : undefined,
    confidence:
      typeof value.confidence === "number" && Number.isFinite(value.confidence)
        ? value.confidence
        : undefined,
    created_at:
      typeof value.created_at === "string" ? value.created_at : undefined,
    source: typeof value.source === "string" ? value.source : undefined,
    metadata:
      typeof value.metadata === "object" && value.metadata !== null
        ? (value.metadata as Record<string, unknown>)
        : null,
  };
}

function normalizeMemoryResponse(input: unknown): UserMemory {
  const payload = (input ?? {}) as Record<string, unknown>;
  const legacy =
    typeof payload.legacy === "object" && payload.legacy !== null
      ? (payload.legacy as Record<string, unknown>)
      : null;

  const userPayload =
    (payload.user as Record<string, unknown> | undefined) ??
    ((legacy?.user as Record<string, unknown> | undefined) ?? {});
  const historyPayload =
    (payload.history as Record<string, unknown> | undefined) ??
    ((legacy?.history as Record<string, unknown> | undefined) ?? {});

  const rawFacts =
    (Array.isArray(payload.facts) ? payload.facts : null) ??
    (Array.isArray(legacy?.facts) ? legacy.facts : []);
  const facts = rawFacts.map(normalizeFact).filter(Boolean) as MemoryFact[];

  const items = (Array.isArray(payload.items) ? payload.items : [])
    .map(normalizeItem)
    .filter(Boolean) as MemoryItem[];
  const categoriesRaw =
    typeof payload.categories === "object" && payload.categories !== null
      ? (payload.categories as Record<string, unknown>)
      : {};
  const categories = Object.fromEntries(
    Object.entries(categoriesRaw).map(([category, value]) => {
      const entries = (Array.isArray(value) ? value : [])
        .map(normalizeItem)
        .filter(Boolean) as MemoryItem[];
      return [category, entries];
    }),
  );
  const resources = Array.isArray(payload.resources)
    ? (payload.resources as Array<Record<string, unknown>>)
    : [];

  return {
    version: typeof payload.version === "string" ? payload.version : "2.0",
    lastUpdated:
      typeof payload.lastUpdated === "string"
        ? payload.lastUpdated
        : typeof legacy?.lastUpdated === "string"
          ? legacy.lastUpdated
          : "",
    user: {
      workContext: sectionOf(userPayload.workContext),
      personalContext: sectionOf(userPayload.personalContext),
      topOfMind: sectionOf(userPayload.topOfMind),
    },
    history: {
      recentMonths: sectionOf(historyPayload.recentMonths),
      earlierContext: sectionOf(historyPayload.earlierContext),
      longTermBackground: sectionOf(historyPayload.longTermBackground),
    },
    facts,
    items,
    categories,
    resources,
    legacy,
  };
}

async function assertSuccess(response: Response): Promise<void> {
  if (response.ok) {
    return;
  }
  const fallback = `Request failed with status ${response.status}`;
  try {
    const payload = (await response.json()) as { detail?: unknown };
    if (typeof payload?.detail === "string" && payload.detail.length > 0) {
      throw new Error(payload.detail);
    }
  } catch (error) {
    if (error instanceof Error && error.message !== "Unexpected end of JSON input") {
      throw error;
    }
  }
  throw new Error(fallback);
}

export async function loadMemory() {
  const response = await fetch(`${getBackendBaseURL()}/api/memory`);
  await assertSuccess(response);
  return normalizeMemoryResponse(await response.json());
}

export async function updateMemoryFact(
  factId: string,
  updates: UpdateMemoryFactRequest,
) {
  const response = await fetch(`${getBackendBaseURL()}/api/memory/facts/${factId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(updates),
  });
  await assertSuccess(response);
  const fact = normalizeFact(await response.json());
  if (!fact) {
    throw new Error("Invalid memory fact response.");
  }
  return fact;
}

export async function pinMemoryFact(factId: string, pinned?: boolean) {
  const response = await fetch(
    `${getBackendBaseURL()}/api/memory/facts/${factId}/pin`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        typeof pinned === "boolean" ? { pinned } : {},
      ),
    },
  );
  await assertSuccess(response);
  const fact = normalizeFact(await response.json());
  if (!fact) {
    throw new Error("Invalid memory fact response.");
  }
  return fact;
}

export async function deleteMemoryFact(factId: string) {
  const response = await fetch(`${getBackendBaseURL()}/api/memory/facts/${factId}`, {
    method: "DELETE",
  });
  await assertSuccess(response);
  return (await response.json()) as DeleteMemoryFactResponse;
}
