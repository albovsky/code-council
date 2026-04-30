"use client";

import { useState } from "react";
import { HelpCircle, Send } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export interface AgentQuestion {
  /** Who's asking — reviewer pane name (codex-1 / claude-code etc). */
  asker: string;
  askerKind: "reviewer" | "driver";
  question: string;
  /** Optional preset answers for one-click reply. */
  options?: string[];
}

interface QuestionCardProps {
  q: AgentQuestion;
  onAnswer: (answer: string) => void;
}

export function QuestionCard({ q, onAnswer }: QuestionCardProps) {
  const [custom, setCustom] = useState("");

  return (
    <Card className="mb-4 overflow-hidden border-amber-500/40 bg-amber-500/5 p-0">
      <div className="flex items-start gap-3 px-5 py-3.5">
        <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md bg-amber-500/15 text-amber-300">
          <HelpCircle className="h-4 w-4" />
        </span>
        <div className="flex-1">
          <div className="mb-1.5 flex items-center gap-2">
            <span className="text-[10px] font-medium uppercase tracking-wider text-amber-300">
              {q.askerKind === "driver" ? "Driver" : "Reviewer"} needs your input
            </span>
            <Badge
              variant="outline"
              className="border-amber-500/30 bg-amber-500/10 font-mono text-[10px] text-amber-200"
            >
              {q.asker}
            </Badge>
          </div>
          <p className="text-sm text-foreground/95">{q.question}</p>

          {q.options && q.options.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {q.options.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => onAnswer(opt)}
                  className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-100 transition hover:bg-amber-500/20 hover:border-amber-500/50"
                >
                  {opt}
                </button>
              ))}
            </div>
          )}

          <div className="mt-3 flex items-center gap-2">
            <input
              type="text"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && custom.trim()) {
                  onAnswer(custom.trim());
                  setCustom("");
                }
              }}
              placeholder="Or type a custom answer…"
              className="flex-1 rounded-md border border-amber-500/20 bg-background px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-amber-500/40 focus:outline-none"
            />
            <button
              type="button"
              disabled={!custom.trim()}
              onClick={() => {
                onAnswer(custom.trim());
                setCustom("");
              }}
              className="flex items-center gap-1 rounded-md bg-amber-500/20 px-3 py-1.5 text-xs font-medium text-amber-100 transition hover:bg-amber-500/30 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Send className="h-3 w-3" />
              Send
            </button>
          </div>
        </div>
      </div>
    </Card>
  );
}
