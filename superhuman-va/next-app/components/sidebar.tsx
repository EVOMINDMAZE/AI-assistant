"use client";

import { useEffect, useState } from "react";
import { MessageSquarePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Conversation } from "@/lib/types";

interface Props {
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
}

export function Sidebar({ activeId, onSelect, onCreate }: Props) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setBusy(true);
    try {
      const r = await fetch("/api/conversations", { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setConversations(data.results ?? []);
    } catch {
      // Quiet: sidebar failures shouldn't break the chat.
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    refresh();
  }, [activeId]);

  return (
    <aside className="flex h-full w-64 flex-col border-r border-border bg-card/40">
      <div className="border-b border-border p-3">
        <Button className="w-full" onClick={onCreate}>
          <MessageSquarePlus className="mr-2 h-4 w-4" />
          New chat
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {busy && conversations.length === 0 && (
          <p className="px-2 py-4 text-xs text-muted-foreground">Loading ...</p>
        )}
        {!busy && conversations.length === 0 && (
          <p className="px-2 py-4 text-xs text-muted-foreground">No conversations yet.</p>
        )}
        <ul className="space-y-1">
          {conversations.map((c) => (
            <li key={c.id}>
              <button
                onClick={() => onSelect(c.id)}
                className={cn(
                  "w-full truncate rounded-md px-3 py-2 text-left text-sm transition-colors",
                  activeId === c.id
                    ? "bg-secondary text-secondary-foreground"
                    : "hover:bg-secondary/50"
                )}
              >
                {c.title}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
