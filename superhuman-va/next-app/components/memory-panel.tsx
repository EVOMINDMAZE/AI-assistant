"use client";

import { useEffect, useState } from "react";
import { Trash2, RefreshCw, Brain } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import type { MemoryHit } from "@/lib/types";

export function MemoryPanel() {
  const [items, setItems] = useState<MemoryHit[]>([]);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setBusy(true);
    try {
      const r = await fetch("/api/memories", { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setItems(data.results ?? []);
    } catch (err) {
      toast.error(`Load failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function clearAll() {
    if (!confirm("Forget everything?")) return;
    setBusy(true);
    try {
      const r = await fetch("/api/memories", { method: "DELETE" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      toast.success("Memory cleared");
      setItems([]);
    } catch (err) {
      toast.error(`Clear failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Brain className="h-4 w-4" />
          What I remember ({items.length})
        </div>
        <div className="flex gap-1">
          <Button size="icon" variant="ghost" onClick={refresh} disabled={busy}>
            <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
          </Button>
          <Button size="icon" variant="ghost" onClick={clearAll} disabled={busy}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1 rounded-md border border-border">
        <div className="space-y-2 p-3">
          {items.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No memories yet. Chat with me and I&apos;ll start to remember.
            </p>
          )}
          {items.map((m, i) => (
            <div
              key={m.id ?? i}
              className="rounded-md bg-secondary/50 px-3 py-2 text-xs leading-relaxed"
            >
              {m.memory}
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
