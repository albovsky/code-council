"use client";

import { useEffect, useState, useRef } from "react";
import { CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import type { Reviewer } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

const LINEAGE_DOT: Record<Reviewer["lineage"], string> = {
  codex: "bg-orange-400",
  gemini: "bg-blue-400",
  opencode: "bg-emerald-400",
  claude: "bg-violet-400",
};

const LINEAGE_LABEL: Record<Reviewer["lineage"], string> = {
  codex: "Codex",
  gemini: "Gemini",
  opencode: "OpenCode",
  claude: "Claude",
};

interface ReviewerCardProps {
  reviewer: Reviewer;
}

export function ReviewerCard({ reviewer }: ReviewerCardProps) {
  // Animate the streamed lines: reveal one by one over time, until "done"
  const [revealed, setRevealed] = useState<number>(
    reviewer.state === "done" ? reviewer.streamedLines.length : 1,
  );
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (reviewer.state === "done" || reviewer.state === "errored") {
      setRevealed(reviewer.streamedLines.length);
      return;
    }
    intervalRef.current = setInterval(() => {
      setRevealed((n) => {
        if (n >= reviewer.streamedLines.length) {
          if (intervalRef.current) clearInterval(intervalRef.current);
          return n;
        }
        return n + 1;
      });
    }, 1100);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [reviewer.state, reviewer.streamedLines.length]);

  const isWorking =
    reviewer.state === "working" || reviewer.state === "writing";
  const isDone = reviewer.state === "done";
  const isErrored = reviewer.state === "errored";

  return (
    <div
      className={cn(
        "flex h-full flex-col overflow-hidden rounded-lg border bg-card transition-colors",
        isDone
          ? "border-emerald-500/30"
          : isErrored
            ? "border-destructive/40"
            : "border-border",
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-border bg-card/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "h-2 w-2 rounded-full",
              LINEAGE_DOT[reviewer.lineage],
              isWorking && "animate-pulse-soft",
            )}
          />
          <span className="text-sm font-semibold">{reviewer.name}</span>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {LINEAGE_LABEL[reviewer.lineage]}
          </span>
        </div>
        <StateBadge state={reviewer.state} />
      </div>

      {/* Stream area */}
      <div className="flex-1 overflow-y-auto px-4 py-3 font-mono text-xs leading-relaxed text-muted-foreground">
        {reviewer.streamedLines.slice(0, revealed).map((line, i) => {
          const isLast = i === revealed - 1;
          const showCaret = isLast && isWorking;
          const isFinding = line.trim().startsWith("•");
          const isHeader = /^[A-Z]/.test(line) && !isFinding;
          return (
            <div
              key={i}
              className={cn(
                "py-0.5",
                isFinding && "text-foreground/90 ml-2",
                isHeader && "text-foreground",
                showCaret && "caret",
              )}
            >
              {renderLineWithSeverity(line)}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between gap-3 border-t border-border bg-card/60 px-4 py-2 font-mono text-[10px] text-muted-foreground">
        <span>{reviewer.model}</span>
        <div className="flex items-center gap-3">
          <span>{reviewer.bytes.toLocaleString()} B</span>
          <span>{formatElapsed(reviewer.elapsedSeconds)}</span>
          {reviewer.findingsCount !== undefined && (
            <span>{reviewer.findingsCount} findings</span>
          )}
        </div>
      </div>
    </div>
  );
}

function StateBadge({ state }: { state: Reviewer["state"] }) {
  switch (state) {
    case "done":
      return (
        <span className="flex items-center gap-1 rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400">
          <CheckCircle2 className="h-3 w-3" />
          DONE
        </span>
      );
    case "errored":
      return (
        <span className="flex items-center gap-1 rounded-md bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive">
          <AlertTriangle className="h-3 w-3" />
          ERRORED
        </span>
      );
    case "writing":
      return (
        <span className="flex items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
          <Loader2 className="h-3 w-3 animate-spin" />
          WRITING
        </span>
      );
    case "working":
      return (
        <span className="flex items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
          <Loader2 className="h-3 w-3 animate-spin" />
          WORKING
        </span>
      );
    case "disabled":
      return (
        <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          DISABLED
        </span>
      );
    default:
      return (
        <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          IDLE
        </span>
      );
  }
}

function formatElapsed(s: number): string {
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m${s % 60}s`;
}

const SEVERITY_CLASSES: Record<string, string> = {
  critical:
    "bg-red-500/15 text-red-300 ring-1 ring-inset ring-red-500/30",
  high: "bg-orange-500/15 text-orange-300 ring-1 ring-inset ring-orange-500/30",
  medium:
    "bg-amber-500/15 text-amber-300 ring-1 ring-inset ring-amber-500/30",
  low: "bg-muted text-muted-foreground ring-1 ring-inset ring-border",
};

const SEVERITY_RE = /\[(critical|high|medium|low)\]/g;

/**
 * Render a line, replacing `[critical]` / `[high]` / `[medium]` / `[low]`
 * tokens with colored chips so severity stands out at a glance.
 */
function renderLineWithSeverity(line: string): React.ReactNode {
  if (!SEVERITY_RE.test(line)) return line;
  // Reset regex state since we used .test() above
  SEVERITY_RE.lastIndex = 0;
  const parts: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = SEVERITY_RE.exec(line)) !== null) {
    if (m.index > last) parts.push(line.slice(last, m.index));
    const sev = m[1].toLowerCase();
    parts.push(
      <span
        key={`sev-${key++}`}
        className={cn(
          "mx-0.5 inline-flex items-center rounded px-1 py-px text-[10px] font-semibold uppercase leading-none tracking-wide",
          SEVERITY_CLASSES[sev],
        )}
      >
        {sev}
      </span>,
    );
    last = m.index + m[0].length;
  }
  if (last < line.length) parts.push(line.slice(last));
  return parts;
}
