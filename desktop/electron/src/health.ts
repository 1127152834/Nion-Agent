import http from "node:http";
import net from "node:net";

export async function isPortInUse(port: number): Promise<boolean> {
  try {
    await new Promise<void>((resolve, reject) => {
      const socket = new net.Socket();
      socket.setTimeout(500);

      socket.once("connect", () => {
        socket.destroy();
        resolve();
      });

      socket.once("timeout", () => {
        socket.destroy();
        reject(new Error("Timeout"));
      });

      socket.once("error", reject);
      socket.connect(port, "127.0.0.1");
    });
    return true;
  } catch {
    return false;
  }
}

export async function waitForPort(
  port: number,
  timeoutMs: number = 30000
): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      await new Promise<void>((resolve, reject) => {
        const socket = new net.Socket();
        socket.setTimeout(1000);

        socket.once("connect", () => {
          socket.destroy();
          resolve();
        });

        socket.once("timeout", () => {
          socket.destroy();
          reject(new Error("Timeout"));
        });

        socket.once("error", reject);

        socket.connect(port, "127.0.0.1");
      });

      return; // 端口可用
    } catch {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  throw new Error(`Port ${port} not available after ${timeoutMs}ms`);
}

export async function waitForHttp(
  url: string,
  timeoutMs: number = 30000
): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      await new Promise<void>((resolve, reject) => {
        const req = http.get(url, { timeout: 2000 }, (res) => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 500) {
            resolve();
          } else {
            reject(new Error(`HTTP ${res.statusCode}`));
          }
        });

        req.on("error", reject);
        req.on("timeout", () => {
          req.destroy();
          reject(new Error("Timeout"));
        });
      });

      return; // HTTP 可用
    } catch {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  throw new Error(`HTTP endpoint ${url} not available after ${timeoutMs}ms`);
}
