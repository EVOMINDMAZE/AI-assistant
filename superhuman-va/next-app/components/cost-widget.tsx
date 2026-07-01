"use client";

/**
 * CostWidget — shows today's cost, week cost, and per-agent breakdown.
 * Mounted in the Team Panel header.
 */
import { useEffect, useState } from "react";
import { DollarSign, TrendingUp, Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface CostData {
  date: string;
  total_usd: number;
  by_agent: Record<string, number>;
  week: { date: string; total_usd: number }[];
}

const AGENT_COLORS: Record<string, string> = {
  CoS: "bg-indigo-500",
  Memory: "bg-amber-500",
  Document: "bg-cyan-500",
  Researcher: "bg-sky-500",
  Planner: "bg-violet-500",
  Critic: "bg-rose-500",
  CTO: "bg-emerald-500",
  CFO: "bg-green-500",
  CMO: "bg-pink-500",
  CSO: "bg-orange-500",
  ADHD: "bg-yellow-500",
  Fitness: "bg-lime-500",
  Therapist: "bg-teal-500",
};

export function CostWidget() {
  const [data, setData] = useState<CostData | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const fetch_ = () =>
      fetch("/api/cost/today")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!cancelled && d) setData(d);
        })
        .catch(() => {});
    fetch_();
    const id = setInterval(fetch_, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (!data) {
    return (
      <div className="flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground">
        <DollarSign className="h-3 w-3" />
        …
      </div>
    );
  }

  const total = data.total_usd ?? 0;
  const weekTotal = (data.week ?? []).reduce((acc, d) => acc + d.total_usd, 0);
  const sortedAgents = Object.entries(data.by_agent ?? {}).sort((a, b) => b[1] - a[1]);

  return (
    <button
      onClick={() => setExpanded((e) => !e)}
      className="flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1 text-xs hover:bg-muted/30"
      title="Click for per-agent breakdown"
    >
      <DollarSign className="h-3 w-3 text-emerald-500" />
      <span className="font-mono">${total.toFixed(3)}</span>
      <span className="text-muted-foreground">today</span>
      <span className="ml-1 text-muted-foreground">·</span>
      <span className="font-mono text-muted-foreground">${weekTotal.toFixed(2)}</span>
      <span className="text-muted-foreground">7d</span>
      {expanded && (
        <div
          className="absolute right-0 top-full z-40 mt-1 w-64 rounded-md border border-border bg-card p-2 shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-1 flex items-center gap-1 text-[10px] uppercase text-muted-foreground">
            <Users className="h-3 w-3" />
            Per-agent (today)
          </div>
          {sortedAgents.length === 0 ? (
            <p className="text-xs text-muted-foreground">No traces yet.</p>
          ) : (
            <ul className="space-y-1">
              {sortedAgents.map(([name, usd]) => {
                const pct = total > 0 ? (usd / total) * 100 : 0;
                return (
                  <li key={name} className="flex items-center gap-2 text-xs">
                    <span
                      className={cn(
                        "h-2 w-2 rounded-full",
                        AGENT_COLORS[name] ?? "bg-slate-500"
                      )}
                    />
                    <span className="flex-1">{name}</span>
                    <span className="font-mono">${usd.toFixed(3)}</span>
                    <span className="text-muted-foreground">{pct.toFixed(0)}%</span>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="mt-2 flex items-center gap-1 text-[10px] uppercase text-muted-foreground">
            <TrendingUp className="h-3 w-3" />
            Last 7 days
          </div>
          <div className="mt-1 flex items-end gap-0.5">
            {(data.week ?? []).map((d) => {
              const max = Math.max(0.001, ...(data.week ?? []).map((x) => x.total_usd));
              const h = (d.total_usd / max) * 30;
              return (
                <div
                  key={d.date}
                  className="flex-1 rounded-sm bg-emerald-500/40"
                  style={{ height: `${h + 2}px` }}
                  title={`${d.date}: $${d.total_usd.toFixed(3)}`}
                />
              );
            })}
          </div>
        </div>
      )}
    </button>
  );
}
