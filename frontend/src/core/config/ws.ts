export function toWebSocketBaseURL(baseURL: string): string {
  const normalized = baseURL.replace(/\/$/, "");

  if (normalized.startsWith("wss://") || normalized.startsWith("ws://")) {
    return normalized;
  }
  if (normalized.startsWith("https://")) {
    return `wss://${normalized.slice("https://".length)}`;
  }
  if (normalized.startsWith("http://")) {
    return `ws://${normalized.slice("http://".length)}`;
  }

  // Fallback: treat unknown input as a host string.
  return `ws://${normalized}`;
}

