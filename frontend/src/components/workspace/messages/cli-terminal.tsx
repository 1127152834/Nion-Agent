"""CLI Terminal component with xterm.js integration."""
"use client";

import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { XIcon } from "lucide-react";

import "@xterm/xterm/css/xterm.css";

interface CLITerminalProps {
  sessionId: string;
  toolId: string;
  command: string[];
  onClose?: () => void;
}

export function CLITerminal({ sessionId, toolId, command, onClose }: CLITerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const terminalInstanceRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [status, setStatus] = useState<"connecting" | "connected" | "disconnected">("connecting");

  useEffect(() => {
    if (!terminalRef.current) return;

    // Create terminal instance
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: "#1e1e1e",
        foreground: "#d4d4d4",
        cursor: "#d4d4d4",
        black: "#000000",
        red: "#cd3131",
        green: "#0dbc79",
        yellow: "#e5e510",
        blue: "#2472c8",
        magenta: "#bc3fbc",
        cyan: "#11a8cd",
        white: "#e5e5e5",
        brightBlack: "#666666",
        brightRed: "#f14c4c",
        brightGreen: "#23d18b",
        brightYellow: "#f5f543",
        brightBlue: "#3b8eea",
        brightMagenta: "#d670d6",
        brightCyan: "#29b8db",
        brightWhite: "#e5e5e5",
      },
      rows: 24,
      cols: 80,
    });

    // Add addons
    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);

    // Open terminal
    term.open(terminalRef.current);
    fitAddon.fit();

    terminalInstanceRef.current = term;
    fitAddonRef.current = fitAddon;

    // Connect WebSocket
    const wsUrl = `ws://localhost:8001/api/cli/sessions/${sessionId}/stream`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus("connected");
      // Send initialization message
      ws.send(
        JSON.stringify({
          tool_id: toolId,
          command: command,
        })
      );
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        if (msg.type === "output") {
          // Write output to terminal
          term.write(msg.data);
        } else if (msg.type === "started") {
          term.writeln(`\x1b[32m✓ Session started: ${msg.session_id}\x1b[0m`);
        } else if (msg.type === "terminated") {
          term.writeln("\x1b[33m\r\nSession terminated\x1b[0m");
          setStatus("disconnected");
        } else if (msg.type === "error") {
          term.writeln(`\x1b[31m\r\nError: ${msg.error}\x1b[0m`);
        }
      } catch (e) {
        console.error("Failed to parse WebSocket message:", e);
      }
    };

    ws.onerror = (error) => {
      console.error("WebSocket error:", error);
      term.writeln("\x1b[31m\r\nWebSocket connection error\x1b[0m");
      setStatus("disconnected");
    };

    ws.onclose = () => {
      setStatus("disconnected");
      term.writeln("\x1b[33m\r\nConnection closed\x1b[0m");
    };

    // Handle user input
    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: "input",
            data: data,
          })
        );
      }
    });

    // Handle terminal resize
    const handleResize = () => {
      fitAddon.fit();
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: "resize",
            rows: term.rows,
            cols: term.cols,
          })
        );
      }
    };

    window.addEventListener("resize", handleResize);

    // Cleanup
    return () => {
      window.removeEventListener("resize", handleResize);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "terminate" }));
        ws.close();
      }
      term.dispose();
    };
  }, [sessionId, toolId, command]);

  const handleTerminate = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "terminate" }));
    }
    onClose?.();
  };

  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b bg-muted/50 px-4 py-2">
        <div className="flex items-center gap-2">
          <div
            className={`size-2 rounded-full ${
              status === "connected"
                ? "bg-green-500"
                : status === "connecting"
                  ? "bg-yellow-500 animate-pulse"
                  : "bg-red-500"
            }`}
          />
          <span className="text-sm font-medium">
            {toolId} - {command.join(" ")}
          </span>
        </div>
        <Button variant="ghost" size="sm" onClick={handleTerminate}>
          <XIcon className="size-4" />
        </Button>
      </div>

      {/* Terminal */}
      <div ref={terminalRef} className="p-2" />

      {/* Footer hint */}
      <div className="border-t bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
        提示：直接在终端中输入内容，按 Enter 发送
      </div>
    </div>
  );
}
