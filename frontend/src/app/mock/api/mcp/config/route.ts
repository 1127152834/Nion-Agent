type MockMcpConfig = {
  mcp_servers: Record<string, Record<string, unknown>>;
};

let currentConfig: MockMcpConfig = {
  mcp_servers: {
    "mcp-github-trending": {
      enabled: true,
      type: "stdio",
      command: "uvx",
      args: ["mcp-github-trending"],
      env: {},
      url: null,
      headers: {},
      description:
        "A MCP server that provides access to GitHub trending repositories and developers data",
    },
    context7: {
      enabled: true,
      type: "stdio",
      command: "npx",
      args: ["-y", "@upstash/context7-mcp@latest", "--api-key", "ctx_demo_key"],
      env: {},
      url: null,
      headers: {},
      description:
        "Context7 MCP server (mock).",
    },
    "feishu-importer": {
      enabled: false,
      type: "stdio",
      command: "uvx",
      args: ["mcp-feishu-importer"],
      env: {},
      url: null,
      headers: {},
      description: "Import Feishu documents (disabled in mock).",
    },
  },
};

export function GET() {
  return Response.json(currentConfig);
}

export async function PUT(request: Request) {
  const body = (await request.json().catch(() => null)) as unknown;
  if (!body || typeof body !== "object") {
    return Response.json({ detail: "Invalid MCP config payload" }, { status: 400 });
  }
  currentConfig = body as MockMcpConfig;
  return Response.json(currentConfig);
}
