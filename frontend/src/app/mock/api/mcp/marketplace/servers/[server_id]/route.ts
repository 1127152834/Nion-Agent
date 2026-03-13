import type { NextRequest } from "next/server";

function getDetail(serverId: string) {
  if (serverId === "fetch") {
    return {
      id: "fetch",
      name: "Fetch",
      author: "modelcontextprotocol",
      category: "web",
      description: "Fetch and convert HTML pages to markdown.",
      tags: ["web-fetching", "html-to-markdown", "content-extraction"],
      verified: true,
      featured: true,
      version: "1.0.0",
      docs_url: "https://github.com/modelcontextprotocol/servers/tree/main/src/fetch",
      readme_markdown: "# Fetch\n\nFetch web pages and convert HTML to Markdown.",
      demo_image_urls: [],
      install_options: [
        {
          id: "uvx",
          label: "UVX",
          transport: "stdio",
          prerequisites: ["uv (uvx)"],
          template: {
            enabled: true,
            type: "stdio",
            command: "uvx",
            args: ["mcp-server-fetch"],
            env: {},
            description: "Fetch and convert HTML pages to markdown.",
          },
          inputs: [
            {
              id: "http_proxy",
              label: "HTTP_PROXY",
              type: "string",
              required: false,
              placeholder: "http://127.0.0.1:7890",
              apply: { kind: "env", key: "HTTP_PROXY", format: "{value}" },
            },
          ],
        },
      ],
    };
  }

  if (serverId === "context7") {
    return {
      id: "context7",
      name: "Context7",
      author: "Upstash",
      category: "docs",
      description: "Get up-to-date documentation and code examples into your agent via Context7.",
      tags: ["docs", "retrieval"],
      verified: true,
      featured: false,
      version: "1.0.0",
      docs_url: "https://context7.com/docs/installation",
      readme_markdown: "# Context7\n\nContext7 provides documentation retrieval tools.",
      demo_image_urls: [],
      install_options: [
        {
          id: "npx",
          label: "NPX",
          transport: "stdio",
          prerequisites: ["node", "npx"],
          template: {
            enabled: true,
            type: "stdio",
            command: "npx",
            args: ["-y", "@upstash/context7-mcp@latest"],
            env: {},
            description: "Context7 MCP server (documentation retrieval).",
          },
          inputs: [
            {
              id: "api_key",
              label: "API Key",
              type: "secret",
              required: false,
              placeholder: "ctx_...",
              apply: { kind: "arg_append", args: ["--api-key", "{value}"] },
            },
          ],
        },
        {
          id: "http",
          label: "HTTP (Remote)",
          transport: "http",
          prerequisites: [],
          template: {
            enabled: true,
            type: "http",
            url: "https://mcp.context7.com/mcp",
            headers: {},
            description: "Context7 MCP server (remote HTTP).",
          },
          inputs: [
            {
              id: "api_key",
              label: "API Key",
              type: "secret",
              required: true,
              placeholder: "ctx_...",
              apply: { kind: "header", key: "Authorization", format: "Bearer {value}" },
            },
          ],
        },
      ],
    };
  }

  return null;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ server_id: string }> },
) {
  const serverId = (await params).server_id;
  const detail = getDetail(serverId);
  if (!detail) {
    return Response.json({ detail: `MCP marketplace server not found: ${serverId}` }, { status: 404 });
  }
  return Response.json(detail);
}
