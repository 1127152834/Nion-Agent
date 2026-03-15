import type { MCPMarketplaceServerDetail, MCPServerConfig } from "@/core/mcp/types";
import {
  applyMarketplaceInstallOption,
  normalizeServerKey,
  parseKeyValueText,
  parseMcpClipboardImport,
} from "@/core/mcp/utils";

describe("MCP marketplace utils", () => {
  test("normalizeServerKey lowercases and strips invalid characters", () => {
    expect(normalizeServerKey("  Fetch Server  ")).toBe("fetch-server");
    expect(normalizeServerKey("Demo___Server")).toBe("demo-server");
  });

  test("parseKeyValueText parses env lines and ignores blanks/comments", () => {
    expect(
      parseKeyValueText(
        `
# comment
FOO=bar
HELLO=world

`,
      ),
    ).toEqual({
      FOO: "bar",
      HELLO: "world",
    });
  });

  test("applyMarketplaceInstallOption builds stdio config with dynamic inputs", () => {
    const detail: MCPMarketplaceServerDetail = {
      id: "fetch",
      name: "Fetch",
      author: "modelcontextprotocol",
      category: "web-scraping",
      description: "Fetch pages.",
      tags: ["web-fetching"],
      verified: true,
      featured: true,
      version: "1.0.0",
      docsUrl: "https://example.com",
      readmeMarkdown: "# Fetch",
      demoImageUrls: [],
      fingerprints: [],
      installOptions: [
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
            description: "Fetch pages.",
          },
          inputs: [
            {
              id: "http_proxy",
              label: "HTTP_PROXY",
              type: "string",
              required: false,
              apply: { kind: "env", key: "HTTP_PROXY", format: "{value}" },
            },
            {
              id: "user_agent",
              label: "User Agent",
              type: "string",
              required: false,
              apply: { kind: "arg_append", args: ["--user-agent", "{value}"] },
            },
          ],
        },
      ],
    };

    const built = applyMarketplaceInstallOption({
      detail,
      optionId: "uvx",
      values: {
        http_proxy: "http://127.0.0.1:7890",
        user_agent: "Nion-Agent",
      },
      serverKey: "fetch",
    });

    expect(built.serverKey).toBe("fetch");
    expect(built.config.env).toEqual({
      HTTP_PROXY: "http://127.0.0.1:7890",
    });
    expect(built.config.args).toEqual([
      "mcp-server-fetch",
      "--user-agent",
      "Nion-Agent",
    ]);
    expect(built.config.meta).toMatchObject({
      origin: "marketplace",
      marketplace_id: "fetch",
      marketplace_version: "1.0.0",
      install_option_id: "uvx",
      verified: true,
      featured: true,
    });
  });

  test("parseMcpClipboardImport accepts single config and config maps", () => {
    const single = parseMcpClipboardImport(
      JSON.stringify({
        enabled: true,
        type: "stdio",
        command: "uvx",
        args: ["mcp-server-fetch"],
        env: {},
        description: "Fetch pages.",
      } satisfies MCPServerConfig),
    );
    expect(single).toEqual({
      imported: {
        "imported-server": expect.objectContaining({
          command: "uvx",
        }),
      },
    });

    const mapped = parseMcpClipboardImport(
      JSON.stringify({
        mcpServers: {
          fetch: {
            enabled: true,
            type: "stdio",
            command: "uvx",
            args: ["mcp-server-fetch"],
            env: {},
            description: "Fetch pages.",
          },
        },
      }),
    );
    expect(mapped).toEqual({
      imported: {
        fetch: expect.objectContaining({
          command: "uvx",
        }),
      },
    });
  });
});
