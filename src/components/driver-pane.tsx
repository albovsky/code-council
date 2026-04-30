"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, FileText, Sparkles, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface DriverPaneProps {
  driver: string; // e.g. "claude-code"
  /** Trigger animation start. */
  active: boolean;
  /** Fires once the implementation stream finishes. Parent owns the PR CTA. */
  onComplete?: () => void;
}

interface FileEdit {
  path: string;
  added: number;
  removed: number;
  status: "pending" | "writing" | "done";
}

const PLANNED_EDITS: FileEdit[] = [
  {
    path: "src/jobs/process_batch.ts",
    added: 14,
    removed: 6,
    status: "pending",
  },
  {
    path: "supabase/migrations/0042_orders_idx.sql",
    added: 23,
    removed: 0,
    status: "pending",
  },
  {
    path: "src/migrations/orders_backfill.ts",
    added: 87,
    removed: 0,
    status: "pending",
  },
  {
    path: "tests/process_batch.test.ts",
    added: 41,
    removed: 0,
    status: "pending",
  },
];

const DRIVER_STREAM = [
  "Reading consensus findings from synthesis…",
  "Plan: 4 file changes, 1 new migration, 1 new test.",
  "[1/4] Writing src/jobs/process_batch.ts — wrapping claim in SELECT … FOR UPDATE SKIP LOCKED.",
  "[2/4] Adding migration 0042_orders_idx.sql — composite index on (account_id, created_at).",
  "[3/4] Generating orders_backfill.ts — chunked 10k rows/batch with pause hook.",
  "[4/4] Adding tests/process_batch.test.ts — concurrent-claim regression case.",
  "Running: pnpm test process_batch — 14 pass, 0 fail.",
  "Running: supabase migration test — clean apply + rollback.",
  "All checks pass. Ready to open PR.",
];

export function DriverPane({ driver, active, onComplete }: DriverPaneProps) {
  const [edits, setEdits] = useState<FileEdit[]>(PLANNED_EDITS);
  const [streamIndex, setStreamIndex] = useState(0);
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    if (!active) return;
    const timers: ReturnType<typeof setTimeout>[] = [];

    // Stream lines one at a time (sped up ~30%)
    DRIVER_STREAM.forEach((_, i) => {
      timers.push(setTimeout(() => setStreamIndex(i + 1), 500 + i * 600));
    });

    // Flip files writing → done in sequence
    edits.forEach((_, i) => {
      timers.push(
        setTimeout(
          () =>
            setEdits((prev) =>
              prev.map((f, idx) =>
                idx === i ? { ...f, status: "writing" } : f,
              ),
            ),
          850 + i * 1200,
        ),
      );
      timers.push(
        setTimeout(
          () =>
            setEdits((prev) =>
              prev.map((f, idx) => (idx === i ? { ...f, status: "done" } : f)),
            ),
          1700 + i * 1200,
        ),
      );
    });

    timers.push(
      setTimeout(() => {
        setCompleted(true);
        onComplete?.();
      }, 6700),
    );

    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const totalAdded = edits.reduce((sum, f) => sum + f.added, 0);
  const totalRemoved = edits.reduce((sum, f) => sum + f.removed, 0);
  const visibleStream = DRIVER_STREAM.slice(0, streamIndex);

  return (
    <Card className="mb-6 overflow-hidden border-emerald-500/30 bg-gradient-to-br from-emerald-500/5 via-card to-card p-0">
      {/* Top stripe */}
      <div className="flex items-center justify-between border-b border-emerald-500/20 bg-emerald-500/5 px-5 py-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 text-emerald-400" />
          <span className="text-[10px] font-medium uppercase tracking-wider text-emerald-300">
            {completed ? "Driver finished" : "Driver implementing"}
          </span>
          <Badge
            variant="outline"
            className="border-emerald-500/30 bg-emerald-500/10 font-mono text-[10px] text-emerald-200"
          >
            {driver}
          </Badge>
        </div>
        <div className="flex items-center gap-3 text-[10px] font-mono text-muted-foreground">
          <span className="text-emerald-400">+{totalAdded}</span>
          <span className="text-rose-400">−{totalRemoved}</span>
          <span>·</span>
          <span>{edits.length} files</span>
        </div>
      </div>

      <div className="grid gap-0 lg:grid-cols-[1fr_360px]">
        {/* Stream */}
        <div className="border-r border-border/50 px-5 py-4">
          <h3 className="mb-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Implementation stream
          </h3>
          <div className="space-y-1.5 font-mono text-[12px] leading-relaxed text-foreground/85">
            {visibleStream.map((line, i) => (
              <div
                key={i}
                className="flex gap-2"
                style={{ animation: "fadeIn 200ms ease-out" }}
              >
                <span className="select-none text-muted-foreground/50">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span>{line}</span>
              </div>
            ))}
            {!completed && streamIndex < DRIVER_STREAM.length && (
              <div className="flex gap-2 text-muted-foreground/70">
                <span className="select-none text-muted-foreground/30">
                  {String(streamIndex + 1).padStart(2, "0")}
                </span>
                <span className="caret">▌</span>
              </div>
            )}
          </div>
        </div>

        {/* File list */}
        <div className="px-5 py-4">
          <h3 className="mb-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Files touched
          </h3>
          <div className="space-y-2">
            {edits.map((f) => (
              <div
                key={f.path}
                className={`group flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs transition ${
                  f.status === "done"
                    ? "border-emerald-500/30 bg-emerald-500/5"
                    : f.status === "writing"
                      ? "border-amber-500/40 bg-amber-500/5"
                      : "border-border/50 bg-card/40 opacity-60"
                }`}
              >
                {f.status === "done" ? (
                  <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-400" />
                ) : f.status === "writing" ? (
                  <Loader2 className="h-3 w-3 shrink-0 animate-spin text-amber-400" />
                ) : (
                  <FileText className="h-3 w-3 shrink-0 text-muted-foreground/50" />
                )}
                <span className="flex-1 truncate font-mono text-[11px] text-foreground/90">
                  {f.path}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                  <span className="text-emerald-400">+{f.added}</span>
                  {f.removed > 0 && (
                    <span className="ml-1 text-rose-400">−{f.removed}</span>
                  )}
                </span>
              </div>
            ))}
          </div>

          {completed && (
            <div className="mt-4 flex items-center gap-2 rounded-md border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-200">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              <span>Implementation complete · open PR above</span>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
