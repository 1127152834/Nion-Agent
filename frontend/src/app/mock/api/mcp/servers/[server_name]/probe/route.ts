import type { NextRequest } from "next/server";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ server_name: string }> },
) {
  const serverName = (await params).server_name;
  const known = new Set(["mcp-github-trending", "context7", "feishu-importer"]);
  if (!known.has(serverName)) {
    return Response.json({ detail: `MCP server not found: ${serverName}` }, { status: 404 });
  }

  if (serverName === "feishu-importer") {
    return Response.json({
      success: false,
      message: "Server is disabled",
      tool_count: 0,
      tools: [],
    });
  }

  return Response.json({
    success: true,
    message: "OK",
    tool_count: 3,
    tools: ["tool_alpha", "tool_beta", "tool_gamma"],
  });
}

