import { getBackendBaseURL } from "@/core/config";

import type { HeartbeatSettings, EvolutionSettings } from "./settings-types";

// Heartbeat API
export async function getHeartbeatSettings(agentName: string): Promise<HeartbeatSettings> {
  const res = await fetch(
    `${getBackendBaseURL()}/api/heartbeat/settings?agent_name=${encodeURIComponent(agentName)}`
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { detail?: string };
    throw new Error(err.detail ?? `Failed to load heartbeat settings: ${res.statusText}`);
  }
  return res.json();
}

export async function updateHeartbeatSettings(
  agentName: string,
  settings: HeartbeatSettings
): Promise<HeartbeatSettings> {
  const res = await fetch(
    `${getBackendBaseURL()}/api/heartbeat/settings?agent_name=${encodeURIComponent(agentName)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { detail?: string };
    throw new Error(err.detail ?? `Failed to update heartbeat settings: ${res.statusText}`);
  }
  return res.json();
}

// Evolution API
export async function getEvolutionSettings(agentName: string): Promise<EvolutionSettings> {
  const res = await fetch(
    `${getBackendBaseURL()}/api/evolution/settings?agent_name=${encodeURIComponent(agentName)}`
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { detail?: string };
    throw new Error(err.detail ?? `Failed to load evolution settings: ${res.statusText}`);
  }
  return res.json();
}

export async function updateEvolutionSettings(
  agentName: string,
  settings: EvolutionSettings
): Promise<EvolutionSettings> {
  const res = await fetch(
    `${getBackendBaseURL()}/api/evolution/settings?agent_name=${encodeURIComponent(agentName)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { detail?: string };
    throw new Error(err.detail ?? `Failed to update evolution settings: ${res.statusText}`);
  }
  return res.json();
}
