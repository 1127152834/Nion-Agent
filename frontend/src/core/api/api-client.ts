"use client";

import { Client as LangGraphClient } from "@langchain/langgraph-sdk/client";

import { getLangGraphBaseURL } from "../config";

const clients = new Map<string, LangGraphClient>();

export function getAPIClient(isMock?: boolean): LangGraphClient {
  const apiUrl = getLangGraphBaseURL(isMock);
  const existing = clients.get(apiUrl);
  if (existing) {
    return existing;
  }

  const client = new LangGraphClient({ apiUrl });
  clients.set(apiUrl, client);
  return client;
}
