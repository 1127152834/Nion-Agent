"use client";

import type { Message } from "@langchain/langgraph-sdk";
import { SendIcon, SquareTerminalIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CLIInteractivePayload } from "@/core/messages/utils";

interface CLIInteractiveCardProps {
  message: Message;
  onSubmitInput?: (input: string) => void | Promise<void>;
}

export function CLIInteractiveCard({ message, onSubmitInput }: CLIInteractiveCardProps) {
  const payload = message.additional_kwargs?.cli_interactive as CLIInteractivePayload | undefined;
  const [input, setInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!payload) return null;

  const isResolved = payload.status === "resolved";
  const isError = payload.status === "error";
  const isPassword = payload.interactive_type === "password";

  const handleSubmit = async () => {
    if (!input.trim() || isSubmitting) return;

    setIsSubmitting(true);
    try {
      await Promise.resolve(onSubmitInput?.(input));
      setInput("");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      {/* 标题 */}
      <div className="flex items-center gap-2">
        <SquareTerminalIcon className="size-4 text-muted-foreground" />
        <span className="font-medium">CLI 交互终端</span>
      </div>

      {/* 命令信息 */}
      <div className="text-sm text-muted-foreground space-y-1">
        <div>
          工具: <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{payload.tool_id}</code>
        </div>
        <div>
          命令: <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{payload.command?.join(" ")}</code>
        </div>
      </div>

      {/* 提示信息 */}
      {payload.prompt && <div className="text-sm">{payload.prompt}</div>}

      {/* 输入区域 */}
      {!isResolved && !isError && (
        <div className="flex gap-2">
          <Input
            type={isPassword ? "password" : "text"}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleSubmit();
              }
            }}
            placeholder={isPassword ? "输入密码..." : "输入内容..."}
            disabled={isSubmitting}
            className="flex-1"
          />
          <Button onClick={handleSubmit} disabled={!input.trim() || isSubmitting} size="sm">
            <SendIcon className="size-4" />
          </Button>
        </div>
      )}

      {/* 执行结果 */}
      {isResolved && payload.result && (
        <div className="mt-3">
          <div className="text-xs text-muted-foreground mb-1">执行结果:</div>
          <pre className="bg-muted p-2 rounded text-xs overflow-x-auto max-h-60 overflow-y-auto">
            {payload.result}
          </pre>
        </div>
      )}

      {/* 错误信息 */}
      {isError && payload.error && (
        <div className="mt-3">
          <div className="text-xs text-destructive mb-1">执行错误:</div>
          <pre className="bg-destructive/10 text-destructive p-2 rounded text-xs overflow-x-auto">
            {payload.error}
          </pre>
        </div>
      )}

      {/* 提示文本 */}
      {!isResolved && !isError && (
        <div className="text-xs text-muted-foreground">输入内容后按 Enter 或点击发送按钮</div>
      )}
    </div>
  );
}
