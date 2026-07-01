"use client";

/**
 * Team Panel — live activity drawer for the swarm.
 *
 * Receives SSE events from the chat page and renders them as a vertical
 * timeline. The events arrive via a callback prop set up by the parent.
 *
 * Event types rendered (per lib/agent-types.ts SSEEvent):
 *   - tool_start, tool_done   → row in the activity list
 *   - handoff                 → row "CoS → <name>"
 *   - agent_message           → row "<from> → <to>: <message>"
 *   - code_run                → code block + stdout
 *   - conflict                → full ConflictCard is rendered separately
 *   - conflict_resolved       → small row "Conflict resolved (…): <winner>"
 *   - error                   → red row
 *   - done                    → small "✓ done" footer row
 *
 * The panel is collapsible. When closed, only a small "Team" button is shown
 * in the chat header.
 */

import { useEffect, useRef, useState } from "react";
import {
  Activity,
  Code2,
  Hand,
  MessageCircle,
  Wrench,
  CheckCircle2,
  XCircle,
  Sparkles,
  ChevronRight,
  ChevronLeft,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SSEEvent } from "@/lib/agent-types";
import { CostWidget } from "@/components/cost-widget";

export interface TeamPanelEntry {
  id: number;
  event: SSEEvent;
}

export interface TeamPanelProps {
  events: TeamPanelEntry[];
  onResolveConflict?: (conflictId: string, choice: string) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const AGENT_COLORS: Record<string, string> = {
  CoS: "bg-indigo-500/20 text-indigo-300 ring-indigo-500/30",
  Memory: "bg-amber-500/20 text-amber-300 ring-amber-500/30",
  Document: "bg-cyan-500/20 text-cyan-300 ring-cyan-500/30",
  Researcher: "bg-sky-500/20 text-sky-300 ring-sky-500/30",
  Planner: "bg-violet-500/20 text-violet-300 ring-violet-500/30",
  Critic: "bg-rose-500/20 text-rose-300 ring-rose-500/30",
  CTO: "bg-emerald-500/20 text-emerald-300 ring-emerald-500/30",
  CFO: "bg-green-500/20 text-green-300 ring-green-500/30",
  CMO: "bg-pink-500/20 text-pink-300 ring-pink-500/30",
  CSO: "bg-orange-500/20 text-orange-300 ring-orange-500/30",
  ADHD: "bg-yellow-500/20 text-yellow-300 ring-yellow-500/30",
  Fitness: "bg-lime-500/20 text-lime-300 ring-lime-500/30",
  Therapist: "bg-teal-500/20 text-teal-300 ring-teal-500/30",
};

function agentClass(name: string) {
  return AGENT_COLORS[name] ?? "bg-slate-500/20 text-slate-300 ring-slate-500/30";
}

export function TeamPanel({
  events,
  onResolveConflict,
  open: controlledOpen,
  onOpenChange,
}: TeamPanelProps) {
  const [internalOpen, setInternalOpen] = useState(true);
  const open = controlledOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events, open]);

  if (!open) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="fixed right-4 top-16 z-30 gap-2"
        aria-label="Open team panel"
      >
        <Activity className="h-4 w-4" />
        Team
        {events.length > 0 && (
          <span className="ml-1 rounded-full bg-primary px-2 text-xs text-primary-foreground">
            {events.length}
          </span>
        )}
        <ChevronLeft className="h-3 w-3" />
      </Button>
    );
  }

  return (
    <aside className="flex h-full w-80 flex-col border-l border-border bg-card/50">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 border-b border-border py-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-4 w-4 text-primary" />
          Team
          <span className="ml-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {events.length}
          </span>
        </CardTitle>
        <div className="flex items-center gap-2">
          <CostWidget />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setOpen(false)}
            aria-label="Close team panel"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>

      <ScrollArea className="flex-1">
        <CardContent className="space-y-2 p-3">
          {events.length === 0 && (
            <div className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
              <Sparkles className="mx-auto mb-2 h-5 w-5 opacity-50" />
              <p>The team is standing by.</p>
              <p className="mt-1 opacity-70">Send a message to see activity.</p>
            </div>
          )}
          {events.map((e) => (
            <Row key={e.id} event={e.event} onResolveConflict={onResolveConflict} />
          ))}
          <div ref={bottomRef} />
        </CardContent>
      </ScrollArea>
    </aside>
  );
}

function Row({
  event,
  onResolveConflict,
}: {
  event: SSEEvent;
  onResolveConflict?: (conflictId: string, choice: string) => void;
}) {
  switch (event.type) {
    case "tool_start":
      return (
        <Card className="border-border bg-muted/30">
          <CardContent className="flex items-start gap-2 p-2.5 text-xs">
            <Wrench className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ring-1",
                    agentClass(event.agent)
                  )}
                >
                  {event.agent}
                </span>
                <span className="font-mono text-muted-foreground">
                  {event.tool}
                </span>
              </div>
              {event.args && (
                <pre className="mt-1 max-h-20 overflow-auto rounded bg-background/50 p-1.5 text-[10px] text-muted-foreground">
                  {JSON.stringify(event.args, null, 2)}
                </pre>
              )}
            </div>
          </CardContent>
        </Card>
      );
    case "tool_done":
      return (
        <Card className="border-border bg-muted/10">
          <CardContent className="flex items-start gap-2 p-2.5 text-xs">
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-green-500" />
            <div className="min-w-0 flex-1">
              <span
                className={cn(
                  "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ring-1",
                  agentClass(event.agent)
                )}
              >
                {event.agent}
              </span>
              <span className="ml-1.5 font-mono text-muted-foreground">
                {event.tool} ✓
              </span>
            </div>
          </CardContent>
        </Card>
      );
    case "handoff":
      return (
        <div className="flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground">
          <Hand className="h-3 w-3" />
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ring-1",
              agentClass(event.from)
            )}
          >
            {event.from}
          </span>
          <span>→</span>
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ring-1",
              agentClass(event.to)
            )}
          >
            {event.to}
          </span>
        </div>
      );
    case "agent_message":
      return (
        <Card className="border-border bg-muted/30">
          <CardContent className="flex items-start gap-2 p-2.5 text-xs">
            <MessageCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-blue-400" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ring-1",
                    agentClass(event.from)
                  )}
                >
                  {event.from}
                </span>
                <span className="text-muted-foreground">→</span>
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ring-1",
                    agentClass(event.to)
                  )}
                >
                  {event.to}
                </span>
              </div>
              <p className="mt-1 text-muted-foreground">{event.message}</p>
              {event.reply && (
                <p className="mt-1.5 border-l-2 border-primary/40 pl-2 text-foreground/90">
                  {event.reply}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      );
    case "code_run":
      return (
        <Card className="border-border bg-zinc-950 text-zinc-100">
          <CardContent className="p-2.5 text-xs">
            <div className="flex items-center gap-1.5 text-zinc-400">
              <Code2 className="h-3.5 w-3.5" />
              <span className="font-mono">{event.agent} ran</span>
            </div>
            <pre className="mt-1.5 overflow-auto rounded bg-zinc-900 p-1.5 text-[10px]">
              {event.snippet}
            </pre>
            {event.stdout && (
              <pre className="mt-1 overflow-auto rounded bg-zinc-900 p-1.5 text-[10px] text-emerald-400">
                {event.stdout}
              </pre>
            )}
            {event.error && (
              <pre className="mt-1 overflow-auto rounded bg-rose-950 p-1.5 text-[10px] text-rose-400">
                {event.error}
              </pre>
            )}
          </CardContent>
        </Card>
      );
    case "conflict":
      // ConflictCard is rendered separately by the parent; here we just
      // surface a small "→ ConflictCard" pointer row.
      return (
        <Card className="border-amber-500/40 bg-amber-500/10">
          <CardContent className="p-2.5 text-xs text-amber-300">
            <div className="font-semibold">⚠ Conflict detected</div>
            <p className="mt-0.5 text-amber-200/80">
              {event.question.length > 80
                ? event.question.slice(0, 80) + "…"
                : event.question}
            </p>
            <p className="mt-1 text-amber-200/60">
              See the picker below to choose.
            </p>
          </CardContent>
        </Card>
      );
    case "conflict_resolved":
      return (
        <Card className="border-emerald-500/40 bg-emerald-500/10">
          <CardContent className="p-2.5 text-xs text-emerald-300">
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span className="font-semibold">Conflict resolved</span>
              <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] uppercase">
                {event.strategy}
              </span>
            </div>
            <p className="mt-1 text-emerald-200/90">
              Winner: <strong>{event.winner}</strong>
            </p>
            <p className="text-emerald-200/70">{event.reason}</p>
          </CardContent>
        </Card>
      );
    case "error":
      return (
        <Card className="border-rose-500/40 bg-rose-500/10">
          <CardContent className="flex items-start gap-2 p-2.5 text-xs text-rose-300">
            <XCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
            <p>{event.message}</p>
          </CardContent>
        </Card>
      );
    case "done":
      return (
        <div className="flex items-center justify-center gap-1.5 py-2 text-[10px] uppercase tracking-wider text-muted-foreground">
          <CheckCircle2 className="h-3 w-3" />
          done
        </div>
      );
    case "meta":
    case "token":
      return null;
  }
}
