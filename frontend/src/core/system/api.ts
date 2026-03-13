import { getBackendBaseURL } from "@/core/config";

export type SandboxPolicy = {
  strict_mode: boolean;
};

export async function fetchSandboxPolicy(): Promise<SandboxPolicy> {
  const response = await fetch(`${getBackendBaseURL()}/api/system/sandbox-policy`);
  if (!response.ok) {
    throw new Error(`Failed to fetch sandbox policy (${response.status})`);
  }

  const payload = (await response.json()) as { strict_mode?: unknown };
  return {
    strict_mode: Boolean(payload.strict_mode),
  };
}

