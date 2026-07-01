"use client";

/**
 * Sidebar — conversation list + cross-conversation search.
 *
 * The search bar at the top calls /api/search-messages (proxied to the
 * memory service's /search_messages endpoint). Results open the conversation
 * (T2.3).
 */
import { useEffect, useState, useCallback, useRef } from "react";
import { MessageSquarePlus, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Conversation } from "@/lib/types";

interface Props {
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  userId: string;
}

interface SearchHit {
  id: string;
  conversation_id: string;
  message_id: string;
  role: string;
  text: string;
  score: number;
}

export function Sidebar({ activeId, onSelect, onCreate, userId }: Props) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

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

  const runSearch = useCallback(
    async (q: string) => {
      if (!q.trim()) {
        setSearchResults([]);
        return;
      }
      setSearching(true);
      try {
        const r = await fetch("/api/search-messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId, query: q, limit: 8 }),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json();
        setSearchResults(data.results ?? []);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    },
    [userId]
  );

  useEffect(() => {
    refresh();
  }, [activeId]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(query), 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, runSearch]);

  async function handleDelete(id: string) {
    if (!confirm("Delete this conversation? This cannot be undone.")) return;
    try {
      await fetch(`/api/conversations?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (activeId === id) onCreate();
      await refresh();
    } catch (e) {
      console.warn("delete failed", e);
    }
  }

  const showSearchResults = query.trim().length > 0;

  return (
    <aside className="flex h-full w-64 flex-col border-r border-border bg-card/40">
      <div className="space-y-2 border-b border-border p-3">
        <Button className="w-full" onClick={onCreate}>
          <MessageSquarePlus className="mr-2 h-4 w-4" />
          New chat
        </Button>
        <div className="flex items-center gap-1.5 rounded-md border border-input bg-background px-2 py-1">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search messages…"
            className="flex-1 bg-transparent text-xs outline-none"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {showSearchResults ? (
          <div>
            <p className="px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground">
              {searching ? "Searching…" : `${searchResults.length} result${searchResults.length === 1 ? "" : "s"}`}
            </p>
            {searchResults.length === 0 && !searching && (
              <p className="px-2 py-4 text-xs text-muted-foreground">No matches.</p>
            )}
            <ul className="space-y-1">
              {searchResults.map((hit) => (
                <li key={hit.id}>
                  <button
                    onClick={() => onSelect(hit.conversation_id)}
                    className={cn(
                      "w-full rounded-md px-2 py-2 text-left text-xs transition-colors",
                      "hover:bg-secondary/50",
                      activeId === hit.conversation_id && "bg-secondary"
                    )}
                  >
                    <div className="mb-0.5 text-[10px] uppercase text-muted-foreground">
                      {hit.role}
                    </div>
                    <p className="line-clamp-2 text-foreground/90">{hit.text}</p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      score {hit.score.toFixed(2)}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <>
            {busy && conversations.length === 0 && (
              <p className="px-2 py-4 text-xs text-muted-foreground">Loading ...</p>
            )}
            {!busy && conversations.length === 0 && (
              <p className="px-2 py-4 text-xs text-muted-foreground">No conversations yet.</p>
            )}
            <ul className="space-y-1">
              {conversations.map((c) => (
                <li key={c.id} className="group relative">
                  <button
                    onClick={() => onSelect(c.id)}
                    className={cn(
                      "w-full truncate rounded-md px-3 py-2 pr-8 text-left text-sm transition-colors",
                      activeId === c.id
                        ? "bg-secondary text-secondary-foreground"
                        : "hover:bg-secondary/50"
                    )}
                  >
                    {c.title}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(c.id);
                    }}
                    className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground opacity-0 hover:bg-rose-500/20 hover:text-rose-400 group-hover:opacity-100"
                    title="Delete conversation"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </aside>
  );
}
