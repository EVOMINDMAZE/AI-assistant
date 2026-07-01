"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Brain, FileUp, X } from "lucide-react";
import { Sidebar } from "@/components/sidebar";
import { ChatWindow } from "@/components/chat-window";
import { ChatInput } from "@/components/chat-input";
import { DocumentUploader } from "@/components/document-uploader";
import { MemoryPanel } from "@/components/memory-panel";
import { TeamPanel, type TeamPanelEntry } from "@/components/team-panel";
import { ConflictCard, type ConflictOption } from "@/components/conflict-card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ChatMessage } from "@/lib/types";
import type { SSEEvent } from "@/lib/agent-types";

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
  const [teamOpen, setTeamOpen] = useState(true);
  const [teamEvents, setTeamEvents] = useState<TeamPanelEntry[]>([]);
  const [conflict, setConflict] = useState<{
    conflictId: string;
    question: string;
    options: ConflictOption[];
  } | null>(null);
  const lastEventIdRef = useRef<number>(0);

  function newChat() {
    setConversationId(null);
    setMessages([]);
    setTeamEvents([]);
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
          headers: {
            "Content-Type": "application/json",
            ...(lastEventIdRef.current
              ? { "Last-Event-Id": String(lastEventIdRef.current) }
              : {}),
          },
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
          // Each event may have multiple "id:" and "data:" lines.
          const events = buffer.split("\n\n");
          buffer = events.pop() ?? "";

          for (const evt of events) {
            const lines = evt.split("\n");
            let eventId = 0;
            let dataLine = "";
            for (const line of lines) {
              if (line.startsWith("id:")) {
                eventId = parseInt(line.slice(3).trim(), 10) || 0;
                if (eventId > lastEventIdRef.current) lastEventIdRef.current = eventId;
              } else if (line.startsWith("data:")) {
                dataLine += line.slice(5).trim();
              }
            }
            if (!dataLine || dataLine === "[DONE]") continue;
            try {
              const parsed = JSON.parse(dataLine) as SSEEvent;
              handleEvent(parsed, eventId, assistantId);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [conversationId, streaming]
  );

  const handleEvent = useCallback(
    (event: SSEEvent, eventId: number, assistantId: string) => {
      // Append to team panel
      if (event.type !== "token" && event.type !== "meta") {
        setTeamEvents((prev) => [...prev, { id: eventId, event }]);
      }
      // Handle each event type
      switch (event.type) {
        case "meta":
          setConversationId(event.conversationId);
          break;
        case "token":
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, content: m.content + event.delta }
                : m
            )
          );
          break;
        case "conflict":
          setConflict({
            conflictId: event.conflictId,
            question: event.question,
            options: event.options,
          });
          setStreaming(false);
          break;
        case "conflict_resolved":
          // Clear the conflict picker if shown
          setConflict((c) => (c ? null : c));
          break;
        case "error":
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, content: m.content + `\n\n[error] ${event.message}` }
                : m
            )
          );
          break;
        case "done":
          setStreaming(false);
          break;
        // tool_start, tool_done, handoff, agent_message, code_run are
        // already in the team panel; no extra handling needed.
      }
    },
    []
  );

  const handleConflictResolve = useCallback(
    async (conflictId: string, choice: string) => {
      if (!conversationId) return;
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: "conflict_resolution",
            conversationId,
            conflictId,
            choice,
            userId: USER_ID,
          }),
        });
        if (!res.ok || !res.body) {
          throw new Error(`HTTP ${res.status}`);
        }
        setConflict(null);
        setStreaming(true);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        const assistantId = newId();
        setMessages((prev) => [
          ...prev,
          { id: assistantId, role: "assistant", content: "" },
        ]);
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split("\n\n");
          buffer = events.pop() ?? "";
          for (const evt of events) {
            const lines = evt.split("\n");
            let eventId = 0;
            let dataLine = "";
            for (const line of lines) {
              if (line.startsWith("id:")) {
                eventId = parseInt(line.slice(3).trim(), 10) || 0;
                if (eventId > lastEventIdRef.current) lastEventIdRef.current = eventId;
              } else if (line.startsWith("data:")) {
                dataLine += line.slice(5).trim();
              }
            }
            if (!dataLine || dataLine === "[DONE]") continue;
            try {
              const parsed = JSON.parse(dataLine) as SSEEvent;
              handleEvent(parsed, eventId, assistantId);
            } catch {}
          }
        }
      } catch (err) {
        console.error("conflict resolution failed:", err);
      } finally {
        setStreaming(false);
      }
    },
    [conversationId, handleEvent]
  );

  const handleChangeChoice = useCallback(() => {
    // Just re-open the picker (the choice was already sent but the user
    // wants to reconsider). We re-show the conflict card; the backend
    // already accepted the previous choice, so this is a UI-only reset.
    setConflict((c) => c);
  }, []);

  const handleForgetEverything = useCallback(async () => {
    if (!confirm("Delete ALL your data? This cannot be undone.")) return;
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "forget_everything", userId: USER_ID }),
      });
      const data = await res.json();
      alert(data.message ?? "Purged.");
      setMessages([]);
      setTeamEvents([]);
      setConversationId(null);
    } catch (err) {
      console.error("forget failed:", err);
    }
  }, []);

  const handleSignOut = useCallback(async () => {
    try {
      // Supabase Auth — clears the session cookie.
      const { createBrowserSupabase } = await import("@/lib/supabase/client");
      const sb = createBrowserSupabase();
      await sb.auth.signOut();
    } catch (err) {
      console.warn("sign-out failed:", err);
    } finally {
      // Hard-redirect to /login so all in-memory state is dropped.
      window.location.href = "/login";
    }
  }, []);

  useEffect(() => {
    if (conversationId) {
      setMessages([]);
      setTeamEvents([]);
    }
  }, [conversationId]);

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <Sidebar
        activeId={conversationId}
        onSelect={setConversationId}
        onCreate={newChat}
        userId={USER_ID}
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
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setTeamOpen((o) => !o)}
              title={teamOpen ? "Hide team panel" : "Show team panel"}
            >
              {teamOpen ? <X className="h-4 w-4" /> : "Team"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleForgetEverything}
              title="Forget everything"
            >
              🧹
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSignOut}
              title="Sign out"
            >
              ⏻
            </Button>
          </div>
        </header>

        <div className="flex flex-1 overflow-hidden">
          <div className="flex flex-1 flex-col">
            <ChatWindow messages={messages} />
            {conflict && (
              <div className="border-t border-border bg-muted/30 p-3">
                <ConflictCard
                  conflictId={conflict.conflictId}
                  question={conflict.question}
                  options={conflict.options}
                  onResolve={handleConflictResolve}
                  onDismiss={() => setConflict(null)}
                  onChangeChoice={handleChangeChoice}
                />
              </div>
            )}
            <ChatInput onSend={send} disabled={streaming} />
          </div>
          {teamOpen && (
            <TeamPanel
              events={teamEvents}
              onResolveConflict={handleConflictResolve}
              open={teamOpen}
              onOpenChange={setTeamOpen}
            />
          )}
        </div>
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
