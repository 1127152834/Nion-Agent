import { getBackendBaseURL } from "@/core/config";

export interface EvolutionSuggestion {
  id: string;
  report_id: string;
  type: string;
  target_domain: string;
  content: string;
  evidence_summary: string;
  impact_scope: string;
  confidence: number;
  priority: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface EvolutionReport {
  report_id: string;
  timestamp: string;
  status: string;
  duration_seconds: number;
  input_sources: Record<string, unknown>;
  suggestions: EvolutionSuggestion[];
  summary: string;
  error_message: string | null;
}

export async function getEvolutionReports(
  agentName: string,
  limit = 50
): Promise<EvolutionReport[]> {
  const res = await fetch(
    `${getBackendBaseURL()}/api/evolution/reports?agent_name=${encodeURIComponent(agentName)}&limit=${limit}`
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new Error(err.detail ?? `Failed to load reports: ${res.statusText}`);
  }
  return res.json();
}

export async function getEvolutionSuggestions(
  agentName: string,
  status?: string
): Promise<EvolutionSuggestion[]> {
  const params = new URLSearchParams({ agent_name: agentName });
  if (status) params.set("status", status);

  const res = await fetch(`${getBackendBaseURL()}/api/evolution/suggestions?${params}`);
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new Error(err.detail ?? `Failed to load suggestions: ${res.statusText}`);
  }
  return res.json();
}

export async function dismissSuggestion(
  agentName: string,
  suggestionId: string
): Promise<EvolutionSuggestion> {
  const res = await fetch(
    `${getBackendBaseURL()}/api/evolution/suggestions/${suggestionId}/dismiss?agent_name=${encodeURIComponent(agentName)}`,
    { method: "POST" }
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new Error(err.detail ?? `Failed to dismiss suggestion: ${res.statusText}`);
  }
  return res.json();
}

export async function acceptSuggestion(
  agentName: string,
  suggestionId: string
): Promise<EvolutionSuggestion> {
  const res = await fetch(
    `${getBackendBaseURL()}/api/evolution/suggestions/${suggestionId}/accept?agent_name=${encodeURIComponent(agentName)}`,
    { method: "POST" }
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new Error(err.detail ?? `Failed to accept suggestion: ${res.statusText}`);
  }
  return res.json();
}
