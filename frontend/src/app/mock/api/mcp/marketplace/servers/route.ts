export function GET() {
  return Response.json({
    servers: [
      {
        id: "fetch",
        name: "Fetch",
        author: "modelcontextprotocol",
        category: "web",
        description: "Fetch and convert HTML pages to markdown.",
        tags: ["web-fetching", "html-to-markdown"],
        verified: true,
        featured: true,
        version: "1.0.0",
        docs_url: "https://github.com/modelcontextprotocol/servers/tree/main/src/fetch",
        detail_url: "/api/mcp/marketplace/servers/fetch",
      },
      {
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
        detail_url: "/api/mcp/marketplace/servers/context7",
      },
    ],
  });
}

