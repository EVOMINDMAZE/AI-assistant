"use client";

import { useEffect, useRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MessageBubble } from "@/components/message-bubble";
import type { ChatMessage } from "@/lib/types";

interface Props {
  messages: ChatMessage[];
}

export function ChatWindow({ messages }: Props) {
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <ScrollArea className="flex-1 h-full">
      <div className="mx-auto flex max-w-3xl flex-col gap-3 p-4">
        {messages.length === 0 && (
          <div className="my-auto py-20 text-center text-muted-foreground">
            <p className="text-lg font-medium">Your superhuman AI VA</p>
            <p className="mt-2 text-sm">
              I remember everything you tell me, and everything you upload.
            </p>
          </div>
        )}
        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  );
}
