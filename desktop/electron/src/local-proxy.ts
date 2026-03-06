import http, { IncomingMessage, Server, ServerResponse } from "node:http";

interface LocalProxyPorts {
  proxyPort: number;
  frontendPort: number;
  gatewayPort: number;
  langgraphPort: number;
}

interface ProxyTarget {
  port: number;
  path: string;
}

export class LocalProxyServer {
  private server: Server | null = null;

  constructor(private ports: LocalProxyPorts) {}

  async start(): Promise<void> {
    if (this.server) {
      return;
    }

    this.server = http.createServer((req, res) => {
      this.handleRequest(req, res);
    });

    await new Promise<void>((resolve, reject) => {
      this.server?.once("error", reject);
      this.server?.listen(this.ports.proxyPort, "127.0.0.1", () => {
        this.server?.off("error", reject);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }

    const current = this.server;
    this.server = null;
    await new Promise<void>((resolve, reject) => {
      current.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    this.applyCorsHeaders(res);

    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }

    const target = this.resolveTarget(req.url ?? "/");
    const proxyReq = http.request(
      {
        hostname: "127.0.0.1",
        port: target.port,
        method: req.method,
        path: target.path,
        headers: {
          ...req.headers,
          host: `127.0.0.1:${target.port}`,
        },
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode ?? 500, {
          ...proxyRes.headers,
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, OPTIONS",
          "Access-Control-Allow-Headers": "*",
        });
        proxyRes.pipe(res);
      },
    );

    proxyReq.on("error", (error) => {
      res.statusCode = 502;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: "proxy_error", message: String(error) }));
    });

    req.pipe(proxyReq);
  }

  private resolveTarget(requestUrl: string): ProxyTarget {
    if (requestUrl.startsWith("/api/langgraph")) {
      const proxiedPath = requestUrl.replace(/^\/api\/langgraph/, "") || "/";
      return {
        port: this.ports.langgraphPort,
        path: proxiedPath,
      };
    }

    if (requestUrl.startsWith("/api/")) {
      return {
        port: this.ports.gatewayPort,
        path: requestUrl,
      };
    }

    return {
      port: this.ports.frontendPort,
      path: requestUrl,
    };
  }

  private applyCorsHeaders(res: ServerResponse): void {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "*");
  }
}
