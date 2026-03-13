import { getBackendBaseURL } from "@/core/config";

import type {
  Agent,
  CreateAgentRequest,
  DefaultAgentConfig,
  UpdateAgentRequest,
  UpdateDefaultAgentConfigRequest,
} from "./types";

async function readApiError(res: Response, fallback: string): Promise<Error> {
  const err = (await res.json().catch(() => ({}))) as { detail?: string };
  return new Error(err.detail ?? fallback);
}

export async function listAgents(): Promise<Agent[]> {
  const res = await fetch(`${getBackendBaseURL()}/api/agents`);
  if (!res.ok) throw new Error(`Failed to load agents: ${res.statusText}`);
  const data = (await res.json()) as { agents: Agent[] };
  return data.agents;
}

export async function getAgent(name: string): Promise<Agent> {
  const res = await fetch(`${getBackendBaseURL()}/api/agents/${name}`);
  if (!res.ok) throw new Error(`Agent '${name}' not found`);
  return res.json() as Promise<Agent>;
}

export async function createAgent(request: CreateAgentRequest): Promise<Agent> {
  const res = await fetch(`${getBackendBaseURL()}/api/agents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!res.ok) {
    throw await readApiError(res, `Failed to create agent: ${res.statusText}`);
  }
  return res.json() as Promise<Agent>;
}

export async function updateAgent(
  name: string,
  request: UpdateAgentRequest,
): Promise<Agent> {
  const res = await fetch(`${getBackendBaseURL()}/api/agents/${name}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!res.ok) {
    throw await readApiError(res, `Failed to update agent: ${res.statusText}`);
  }
  return res.json() as Promise<Agent>;
}

export async function deleteAgent(name: string): Promise<void> {
  const res = await fetch(`${getBackendBaseURL()}/api/agents/${name}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`Failed to delete agent: ${res.statusText}`);
}

export async function checkAgentName(
  name: string,
): Promise<{ available: boolean; name: string }> {
  const res = await fetch(
    `${getBackendBaseURL()}/api/agents/check?name=${encodeURIComponent(name)}`,
  );
  if (!res.ok) {
    throw await readApiError(res, `Failed to check agent name: ${res.statusText}`);
  }
  return res.json() as Promise<{ available: boolean; name: string }>;
}

export async function getDefaultAgentConfig(): Promise<DefaultAgentConfig> {
  const res = await fetch(`${getBackendBaseURL()}/api/default-agent/config`);
  if (!res.ok) {
    throw await readApiError(res, `Failed to load default agent config: ${res.statusText}`);
  }
  return res.json() as Promise<DefaultAgentConfig>;
}

export async function updateDefaultAgentConfig(
  request: UpdateDefaultAgentConfigRequest,
): Promise<DefaultAgentConfig> {
  const res = await fetch(`${getBackendBaseURL()}/api/default-agent/config`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!res.ok) {
    throw await readApiError(res, `Failed to update default agent config: ${res.statusText}`);
  }
  return res.json() as Promise<DefaultAgentConfig>;
}

export async function uploadAgentAvatar(name: string, file: File): Promise<Agent> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${getBackendBaseURL()}/api/agents/${encodeURIComponent(name)}/avatar`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    throw await readApiError(res, `Failed to upload avatar: ${res.statusText}`);
  }
  return res.json() as Promise<Agent>;
}

export async function deleteAgentAvatar(name: string): Promise<Agent> {
  const res = await fetch(`${getBackendBaseURL()}/api/agents/${encodeURIComponent(name)}/avatar`, {
    method: "DELETE",
  });
  if (!res.ok) {
    throw await readApiError(res, `Failed to delete avatar: ${res.statusText}`);
  }
  return res.json() as Promise<Agent>;
}

export async function uploadDefaultAgentAvatar(file: File): Promise<DefaultAgentConfig> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${getBackendBaseURL()}/api/default-agent/avatar`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    throw await readApiError(res, `Failed to upload default avatar: ${res.statusText}`);
  }
  return res.json() as Promise<DefaultAgentConfig>;
}

export async function deleteDefaultAgentAvatar(): Promise<DefaultAgentConfig> {
  const res = await fetch(`${getBackendBaseURL()}/api/default-agent/avatar`, {
    method: "DELETE",
  });
  if (!res.ok) {
    throw await readApiError(res, `Failed to delete default avatar: ${res.statusText}`);
  }
  return res.json() as Promise<DefaultAgentConfig>;
}
