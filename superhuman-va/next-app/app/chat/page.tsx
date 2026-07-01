"use client";

import { useCallback, useEffect, useState } from "react";
import { Brain, FileUp } from "lucide-react";
import { Sidebar } from "@/components/sidebar";
import { ChatWindow } from "@/components/chat-window";
import { ChatInput } from "@/components/chat-input";
import { DocumentUploader } from "@/components/document-uploader";
import { MemoryPanel } from "@/components/memory-panel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ChatMessage } from "@/lib/types";

const USER_ID = "local-user"; // single-user MVP

function newId() {
  return Math.random().toString(36).slice(2, 11);
}

export default function ChatPage() {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [uploaderOpen, setUploaderOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);

  function newChat() {
    setConversationId(null);
    setMessages([]);
  }

  const send = useCallback(
    async (text: string) => {
      if (streaming) return;
      const userMsg: ChatMessage = {
        id: newId(),
        role: "user",
        content: text,
      };
      const assistantId = newId();
      const assistantMsg: ChatMessage = {
        id: assistantId,
        role: "assistant",
        content: "",
      };
      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setStreaming(true);

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: USER_ID,
            conversationId: conversationId ?? undefined,
            message: text,
          }),
        });

        if (!res.ok || !res.body) {
          throw new Error(`HTTP ${res.status}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // SSE events are separated by blank lines.
          const events = buffer.split("\n\n");
          buffer = events.pop() ?? "";

          for (const evt of events) {
            const line = evt.trim();
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (payload === "[DONE]") continue;
            try {
              const parsed = JSON.parse(payload) as
                | { type: "token"; content: string }
                | { type: "meta"; conversationId: string }
                | { type: "error"; content: string };

              if (parsed.type === "meta") {
                setConversationId(parsed.conversationId);
              } else if (parsed.type === "token") {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId
                      ? { ...m, content: m.content + parsed.content }
                      : m
                  )
                );
              } else if (parsed.type === "error") {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId
                      ? { ...m, content: m.content + `\n\n[error] ${parsed.content}` }
                      : m
                  )
                );
              }
            } catch {
              // Ignore malformed events.
            }
          }
        }
      } catch (err) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: `[network error] ${(err as Error).message}` }
              : m
          )
        );
      } finally {
        setStreaming(false);
      }
    },
    [conversationId, streaming]
  );

  // When the user switches conversation, in a fuller app we'd fetch the
  // message history. For the MVP we just clear the local view — the
  // server already has the full transcript.
  useEffect(() => {
    if (conversationId) {
      setMessages([]);
    }
  }, [conversationId]);

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <Sidebar
        activeId={conversationId}
        onSelect={setConversationId}
        onCreate={newChat}
      />

      <main className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-border px-4 py-2">
          <div className="text-sm text-muted-foreground">
            {conversationId
              ? "Chatting · memory + document context active"
              : "New conversation · memory + document context active"}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setUploaderOpen(true)}
            >
              <FileUp className="mr-2 h-4 w-4" />
              Documents
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setMemoryOpen(true)}
            >
              <Brain className="mr-2 h-4 w-4" />
              Memory
            </Button>
          </div>
        </header>

        <ChatWindow messages={messages} />

        <ChatInput onSend={send} disabled={streaming} />
      </main>

      <Dialog open={uploaderOpen} onOpenChange={setUploaderOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upload documents</DialogTitle>
            <DialogDescription>
              Drop a PDF or text file. I&apos;ll chunk, embed, and store it in
              Qdrant so I can search it during chats.
            </DialogDescription>
          </DialogHeader>
          <DocumentUploader />
        </DialogContent>
      </Dialog>

      <Dialog open={memoryOpen} onOpenChange={setMemoryOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Persistent memory</DialogTitle>
            <DialogDescription>
              These are the facts Mem0 has extracted from our past conversations.
            </DialogDescription>
          </DialogHeader>
          <div className="h-[60vh]">
            <MemoryPanel />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
