"use client";

import { Client as LangGraphClient } from "@langchain/langgraph-sdk/client";

import { getLangGraphBaseURL } from "../config";

import { sanitizeRunStreamOptions } from "./stream-mode";

const clients = new Map<string, LangGraphClient>();

function createCompatibleClient(apiUrl: string): LangGraphClient {
  const client = new LangGraphClient({ apiUrl });

  // Keep compatibility across LangGraph versions by sanitizing unsupported
  // stream modes before issuing stream/joinStream requests.
  const originalRunStream = client.runs.stream.bind(client.runs);
  client.runs.stream = ((threadId, assistantId, payload) =>
    originalRunStream(
      threadId,
      assistantId,
      sanitizeRunStreamOptions(payload),
    )) as typeof client.runs.stream;

  const originalJoinStream = client.runs.joinStream.bind(client.runs);
  client.runs.joinStream = ((threadId, runId, options) =>
    originalJoinStream(
      threadId,
      runId,
      sanitizeRunStreamOptions(options),
    )) as typeof client.runs.joinStream;

  return client;
}

export function getAPIClient(isMock?: boolean): LangGraphClient {
  const apiUrl = getLangGraphBaseURL(isMock);
  const existing = clients.get(apiUrl);
  if (existing) {
    return existing;
  }

  const client = createCompatibleClient(apiUrl);
  clients.set(apiUrl, client);
  return client;
}
