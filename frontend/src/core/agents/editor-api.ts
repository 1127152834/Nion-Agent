import { getBackendBaseURL } from "@/core/config";

function isDefaultAgent(agentName: string): boolean {
  return agentName === "_default";
}

export async function getAgentSoul(agentName: string): Promise<string> {
  const endpoint = isDefaultAgent(agentName)
    ? `${getBackendBaseURL()}/api/default-agent/soul`
    : `${getBackendBaseURL()}/api/agents/${encodeURIComponent(agentName)}`;

  const res = await fetch(endpoint);
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new Error(err.detail ?? `Failed to load SOUL.md: ${res.statusText}`);
  }
  const data = await res.json();
  return isDefaultAgent(agentName) ? (data.content ?? "") : (data.soul ?? "");
}

export async function updateAgentSoul(
  agentName: string,
  content: string
): Promise<void> {
  const endpoint = isDefaultAgent(agentName)
    ? `${getBackendBaseURL()}/api/default-agent/soul`
    : `${getBackendBaseURL()}/api/agents/${encodeURIComponent(agentName)}`;
  const body = isDefaultAgent(agentName)
    ? JSON.stringify({ content })
    : JSON.stringify({ soul: content });

  const res = await fetch(endpoint, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body,
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new Error(err.detail ?? `Failed to update SOUL.md: ${res.statusText}`);
  }
}

export async function getAgentIdentity(agentName: string): Promise<string> {
  const endpoint = isDefaultAgent(agentName)
    ? `${getBackendBaseURL()}/api/default-agent/identity`
    : `${getBackendBaseURL()}/api/agents/${encodeURIComponent(agentName)}/identity`;

  const res = await fetch(endpoint);
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new Error(err.detail ?? `Failed to load IDENTITY.md: ${res.statusText}`);
  }
  const data = await res.json();
  return data.content ?? "";
}

export async function updateAgentIdentity(
  agentName: string,
  content: string
): Promise<void> {
  const endpoint = isDefaultAgent(agentName)
    ? `${getBackendBaseURL()}/api/default-agent/identity`
    : `${getBackendBaseURL()}/api/agents/${encodeURIComponent(agentName)}/identity`;

  const res = await fetch(endpoint, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new Error(err.detail ?? `Failed to update IDENTITY.md: ${res.statusText}`);
  }
}
