"use client";

import {
  CheckCircle2,
  AlertTriangle,
  RotateCw,
  ArrowRight,
  ShieldCheck,
} from "lucide-react";
import type {
  AgreementThreshold,
  SynthesizedAnswer,
  ThresholdAction,
} from "@/lib/mock-data";
import { cn } from "@/lib/utils";

interface DecisionPanelProps {
  verdict: SynthesizedAnswer["verdict"];
  threshold: AgreementThreshold;
  onThresholdMet: ThresholdAction;
  agreedLineages: number;
  totalLineages: number;
  round: number;
  maxRounds: number;
  onRunNextRound: () => void;
  onAccept: () => void;
  onOverride?: () => void;
  /** Auto-finalize timer state, in seconds. Null = not auto-finalising. */
  autoFinalizeIn?: number | null;
}

/**
 * Banner shown after a round completes. Tells the user what happened relative
 * to the template's agreement threshold and what action is available next.
 *
 * Three states:
 *   1. threshold met + auto-finalize → green banner, countdown to apply
 *   2. threshold met + ask-user      → green banner, "Accept" primary, "Run another round" secondary
 *   3. threshold NOT met             → amber banner, "Run round N+1" primary
 */
export function DecisionPanel({
  verdict,
  threshold,
  onThresholdMet,
  agreedLineages,
  totalLineages,
  round,
  maxRounds,
  onRunNextRound,
  onAccept,
  onOverride,
  autoFinalizeIn,
}: DecisionPanelProps) {
  const thresholdMet = isThresholdMet(threshold, agreedLineages, totalLineages);
  const canRunMore = round < maxRounds;
  const auto = thresholdMet && onThresholdMet === "auto-finalize";

  return (
    <section
      className={cn(
        "mb-6 overflow-hidden rounded-xl border bg-card",
        thresholdMet ? "border-emerald-500/30" : "border-amber-500/30",
      )}
    >
      <div className="flex items-start gap-4 px-5 py-4">
        <div
          className={cn(
            "grid h-9 w-9 shrink-0 place-items-center rounded-md ring-1",
            thresholdMet
              ? "bg-emerald-500/15 text-emerald-400 ring-emerald-500/30"
              : "bg-amber-500/15 text-amber-400 ring-amber-500/30",
          )}
        >
          {thresholdMet ? (
            <CheckCircle2 className="h-4 w-4" />
          ) : (
            <AlertTriangle className="h-4 w-4" />
          )}
        </div>

        <div className="flex-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <h3
              className={cn(
                "text-[15px] font-semibold tracking-tight",
                thresholdMet ? "text-emerald-300" : "text-amber-300",
              )}
            >
              {thresholdMet
                ? "Consensus reached"
                : "Below agreement threshold"}
            </h3>
            <span className="text-[11px] text-muted-foreground">
              Round {round} of {maxRounds}
            </span>
          </div>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            {thresholdMet ? (
              <>
                <span className="font-medium text-foreground">
                  {agreedLineages} of {totalLineages}
                </span>{" "}
                lineages agree — meets the{" "}
                <ThresholdChip threshold={threshold} /> requirement.
              </>
            ) : (
              <>
                <span className="font-medium text-foreground">
                  {agreedLineages} of {totalLineages}
                </span>{" "}
                lineages agree — does not meet the{" "}
                <ThresholdChip threshold={threshold} /> requirement.
                {canRunMore ? (
                  <>
                    {" "}Run another round to share findings between reviewers
                    and let them converge.
                  </>
                ) : (
                  <>
                    {" "}Max rounds ({maxRounds}) reached — review the per-reviewer
                    findings and decide.
                  </>
                )}
              </>
            )}
          </p>
        </div>
      </div>

      {/* Auto-finalize countdown */}
      {auto && autoFinalizeIn !== null && autoFinalizeIn !== undefined && (
        <div className="flex items-center gap-3 border-t border-emerald-500/20 bg-emerald-500/5 px-5 py-2.5 text-[12px] text-emerald-300">
          <ShieldCheck className="h-3.5 w-3.5" />
          <span className="flex-1">
            Auto-finalising in <span className="font-mono">{autoFinalizeIn}s</span>{" "}
            — template policy is set to apply consensus automatically.
          </span>
          <button
            type="button"
            onClick={onOverride}
            className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-200 transition hover:bg-emerald-500/15"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Action row */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-card/40 px-5 py-3">
        <div className="text-[11px] text-muted-foreground">
          Verdict: <VerdictChip verdict={verdict} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!thresholdMet && canRunMore && (
            <button
              type="button"
              onClick={onRunNextRound}
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground shadow-sm transition hover:bg-primary/90"
            >
              <RotateCw className="h-3.5 w-3.5" />
              Run round {round + 1}
            </button>
          )}
          {thresholdMet && onThresholdMet === "ask-user" && (
            <>
              {canRunMore && (
                <button
                  type="button"
                  onClick={onRunNextRound}
                  className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-sm font-medium text-muted-foreground transition hover:text-foreground"
                >
                  <RotateCw className="h-3.5 w-3.5" />
                  Run another round
                </button>
              )}
              <button
                type="button"
                onClick={onAccept}
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-emerald-500 px-3 text-sm font-medium text-emerald-950 shadow-sm transition hover:bg-emerald-400"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                Accept &amp; finalize
              </button>
            </>
          )}
          {!thresholdMet && !canRunMore && (
            <button
              type="button"
              onClick={onAccept}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 text-sm font-medium text-amber-200 transition hover:bg-amber-500/15"
            >
              Accept anyway
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

function ThresholdChip({ threshold }: { threshold: AgreementThreshold }) {
  return (
    <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wide text-foreground/85">
      {threshold}
    </span>
  );
}

function VerdictChip({
  verdict,
}: {
  verdict: SynthesizedAnswer["verdict"];
}) {
  const cfg = {
    agree: { label: "agree", cls: "text-emerald-400" },
    partial: { label: "partial", cls: "text-amber-400" },
    disagree: { label: "disagree", cls: "text-red-400" },
  }[verdict];
  return <span className={cn("font-mono", cfg.cls)}>{cfg.label}</span>;
}

function isThresholdMet(
  threshold: AgreementThreshold,
  agreed: number,
  total: number,
): boolean {
  if (total === 0) return false;
  switch (threshold) {
    case "unanimous":
      return agreed === total;
    case "majority":
      return agreed * 3 >= total * 2; // ≥ 2/3
    case "any":
      return agreed >= 1;
  }
}
