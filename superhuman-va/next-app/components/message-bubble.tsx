"use client";

import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/lib/types";

interface Props {
  message: ChatMessage;
}

export function MessageBubble({ message }: Props) {
  const isUser = message.role === "user";
  return (
    <div
      className={cn(
        "flex w-full",
        isUser ? "justify-end" : "justify-start"
      )}
    >
      <div
        className={cn(
          "max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed shadow-sm",
          isUser
            ? "bg-primary text-primary-foreground rounded-br-sm"
            : "bg-secondary text-secondary-foreground rounded-bl-sm"
        )}
      >
        <div className="whitespace-pre-wrap break-words">
          {message.content || (
            <span className="inline-flex gap-1 text-muted-foreground">
              <span className="animate-bounce [animation-delay:-0.3s]">●</span>
              <span className="animate-bounce [animation-delay:-0.15s]">●</span>
              <span className="animate-bounce">●</span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
