"use client";

/**
 * ConflictCard — the user picker for `values_tradeoff` conflicts.
 *
 * Renders a card with the question, the available options (one per position),
 * and a recommended option. The user clicks an option (or "Other — let me
 * explain") to resume the turn. The pick is sent to /api/chat with
 * { kind: "conflict_resolution", conflictId, choice }.
 *
 * Implements the polish from T2.4:
 *   - "Change your choice" button after a pick
 *   - "Other — let me explain" free-text fallback
 *   - Persists the choice to the agent_messages row (handled by the route)
 */

import { useState } from "react";
import {
  Sparkles,
  Hand,
  ChevronRight,
  X,
  Check,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface ConflictOption {
  id: string;
  label: string;
  recommendation?: boolean;
}

export interface ConflictCardProps {
  conflictId: string;
  question: string;
  options: ConflictOption[];
  onResolve: (conflictId: string, choice: string) => void;
  onDismiss?: () => void;
  onChangeChoice?: () => void;
  onCustomExplanation?: (conflictId: string, explanation: string) => void;
}

export function ConflictCard({
  conflictId,
  question,
  options,
  onResolve,
  onDismiss,
  onChangeChoice,
  onCustomExplanation,
}: ConflictCardProps) {
  const [picked, setPicked] = useState<string | null>(null);
  const [showCustom, setShowCustom] = useState(false);
  const [customText, setCustomText] = useState("");

  const handlePick = (id: string) => {
    setPicked(id);
    onResolve(conflictId, id);
  };

  const handleCustom = () => {
    if (!customText.trim()) return;
    if (onCustomExplanation) onCustomExplanation(conflictId, customText.trim());
    setPicked("custom");
    onResolve(conflictId, `custom: ${customText.trim()}`);
  };

  return (
    <Card className="border-amber-500/40 bg-gradient-to-br from-amber-500/10 to-orange-500/5">
      <CardHeader className="space-y-1.5">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base text-amber-300">
            <Hand className="h-4 w-4" />
            Your team needs your call
          </CardTitle>
          {onDismiss && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onDismiss}
              aria-label="Dismiss conflict"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
        <p className="text-sm font-medium text-foreground/90">{question}</p>
      </CardHeader>
      <CardContent className="space-y-2">
        {options.map((opt) => {
          const isPicked = picked === opt.id;
          return (
            <button
              key={opt.id}
              onClick={() => handlePick(opt.id)}
              disabled={!!picked && !onChangeChoice}
              className={cn(
                "w-full rounded-md border p-3 text-left text-sm transition-colors",
                "hover:border-amber-400 hover:bg-amber-500/10",
                "disabled:cursor-not-allowed disabled:opacity-60",
                opt.recommendation && "border-amber-500/60",
                isPicked && "border-emerald-500 bg-emerald-500/15"
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    {opt.recommendation && (
                      <span className="inline-flex items-center gap-0.5 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-300">
                        <Sparkles className="h-2.5 w-2.5" />
                        CoS recommends
                      </span>
                    )}
                    {isPicked && (
                      <span className="inline-flex items-center gap-0.5 rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-emerald-300">
                        <Check className="h-2.5 w-2.5" />
                        picked
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-foreground/90">{opt.label}</p>
                </div>
                <ChevronRight className="mt-1 h-4 w-4 flex-shrink-0 text-muted-foreground" />
              </div>
            </button>
          );
        })}

        {/* Custom explanation */}
        {showCustom ? (
          <div className="space-y-2 rounded-md border border-border p-3">
            <textarea
              value={customText}
              onChange={(e) => setCustomText(e.target.value)}
              placeholder="Tell me what you want to do…"
              className="min-h-[60px] w-full resize-y rounded border border-input bg-background px-2 py-1 text-sm"
            />
            <div className="flex justify-end gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowCustom(false)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleCustom}
                disabled={!customText.trim()}
              >
                Send
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowCustom(true)}
            className="w-full"
          >
            Other — let me explain
          </Button>
        )}

        {/* Change choice */}
        {picked && onChangeChoice && (
          <div className="flex justify-end pt-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setPicked(null);
                onChangeChoice();
              }}
            >
              <RotateCcw className="mr-1 h-3 w-3" />
              Change your choice
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
