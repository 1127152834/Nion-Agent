export function GET(request: Request) {
  const url = new URL(request.url);
  const raw = url.searchParams.get("commands") ?? "";
  const commands = raw.split(",").map((item) => item.trim()).filter(Boolean);
  const payload: Record<string, { available: boolean; path?: string | null }> = {};
  for (const name of commands) {
    payload[name] = { available: true, path: `/usr/bin/${name}` };
  }
  return Response.json({ commands: payload });
}
