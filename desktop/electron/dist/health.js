"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.waitForPort = waitForPort;
exports.waitForHttp = waitForHttp;
const node_http_1 = __importDefault(require("node:http"));
const node_net_1 = __importDefault(require("node:net"));
async function waitForPort(port, timeoutMs = 30000) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
        try {
            await new Promise((resolve, reject) => {
                const socket = new node_net_1.default.Socket();
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
        }
        catch {
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }
    throw new Error(`Port ${port} not available after ${timeoutMs}ms`);
}
async function waitForHttp(url, timeoutMs = 30000) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
        try {
            await new Promise((resolve, reject) => {
                const req = node_http_1.default.get(url, { timeout: 2000 }, (res) => {
                    if (res.statusCode && res.statusCode >= 200 && res.statusCode < 500) {
                        resolve();
                    }
                    else {
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
        }
        catch {
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }
    throw new Error(`HTTP endpoint ${url} not available after ${timeoutMs}ms`);
}
