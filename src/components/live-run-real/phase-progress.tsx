"use client";

import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { PhaseStepper, type PhaseState } from "@/components/phase-stepper";
import type { TemplatePhase as MockTemplatePhase } from "@/lib/cockpit-types";
import type { Template } from "@/lib/types";
import type { RoundSnapshot, ThermoRunPlan, ThermoPhaseGroup } from "../run-viewer/types.js";

interface PhaseProgressProps {
  template: Template | null;
  status: string;
  totalPhases: number;
  completedPhaseCount: number;
  rounds: RoundSnapshot[];
  enrichedRounds: RoundSnapshot[];
  thermoPlan: ThermoRunPlan | null;
  prUrl: string | undefined;
  shipError: string | undefined;
}

export function PhaseProgress({
  template,
  status,
  totalPhases,
  completedPhaseCount,
  rounds,
  enrichedRounds,
  thermoPlan,
  prUrl,
  shipError,
}: PhaseProgressProps) {
  const isThermo = template?.id === "branch-code-review-thermo" || Boolean(thermoPlan);
  return (
    <div className="border-b border-border bg-card/20 px-4 py-3 sm:px-8">
      <div className="mx-auto flex w-full flex-col gap-3">
        {prUrl && (
          <div className="rounded-md border border-emerald-500/40 bg-emerald-500/5 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-medium text-emerald-300">
                <CheckCircle2 className="h-4 w-4" />
                Pull request opened
              </div>
              <a
                href={prUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 transition hover:bg-emerald-500/20"
              >
                View PR →
              </a>
            </div>
            <p className="mt-1 break-all font-mono text-[11px] text-emerald-200/70">
              {prUrl}
            </p>
          </div>
        )}
        {shipError && !prUrl && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-medium text-amber-300">
              <AlertTriangle className="h-4 w-4" />
              Ship phase blocked
            </div>
            <p className="mt-1 break-words font-mono text-[11px] text-amber-200/80">
              {shipError}
            </p>
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              The reviewers approved the doer&apos;s output, but chorus
              couldn&apos;t open a PR. Resolve the issue above and re-run.
            </p>
          </div>
        )}

        {isThermo ? (
          <ThermoPhaseProgress
            rounds={enrichedRounds}
            thermoPlan={thermoPlan}
            status={status}
          />
        ) : template?.phases && template.phases.length > 0 && (
          <div className="flex justify-center">
            <PhaseStepper
              phases={template.phases as unknown as MockTemplatePhase[]}
              activeIndex={Math.min(completedPhaseCount, totalPhases - 1)}
              states={template.phases.map((_, i): PhaseState => {
                if (status === "approved") return "done";
                if (status === "no_review")
                  return i < completedPhaseCount ? "done" : "blocked";
                if (status === "failed" || status === "cancelled")
                  return i < completedPhaseCount ? "done" : "skipped";
                if (i < completedPhaseCount) return "done";
                if (i === completedPhaseCount) return "active";
                return "pending";
              })}
            />
          </div>
        )}

        {!isThermo && (
          <ProgressStrip
            template={template}
            status={status}
            totalPhases={totalPhases}
            completedPhaseCount={completedPhaseCount}
            rounds={rounds}
            enrichedRounds={enrichedRounds}
          />
        )}
      </div>
    </div>
  );
}

const THERMO_PHASES: Array<{
  id: ThermoPhaseGroup;
  label: string;
  title: string;
  description: string;
}> = [
  {
    id: "specialist",
    label: "Phase 1",
    title: "Specialist review",
    description: "Primary reviewers check each Thermo domain.",
  },
  {
    id: "validation",
    label: "Phase 2",
    title: "Adversarial validation",
    description: "Second reviewers challenge risky-domain findings.",
  },
  {
    id: "synthesis",
    label: "Phase 3",
    title: "Final synthesis",
    description: "Findings are merged into the final report.",
  },
  {
    id: "audit",
    label: "Phase 4",
    title: "Synthesis audit",
    description: "Final report is checked for unsupported claims.",
  },
];

function ThermoPhaseProgress({
  rounds,
  thermoPlan,
  status,
}: {
  rounds: RoundSnapshot[];
  thermoPlan: ThermoRunPlan | null;
  status: string;
}) {
  const participants = rounds.flatMap((round) => round.participants);
  const phases = thermoPlan?.phases ?? THERMO_PHASES;
  const isTerminal =
    status === "approved" ||
    status === "merged" ||
    status === "no_review" ||
    status === "blocked" ||
    status === "failed" ||
    status === "cancelled";

  const phaseStats = phases.map((phase) => {
    const phaseParticipants = participants.filter((p) => p.thermo?.phaseGroup === phase.id);
    const done = phaseParticipants.filter((p) => p.hasAnswer).length;
    const total = expectedThermoPhaseTotal(phase.id, thermoPlan, phaseParticipants.length);
    const started = phaseParticipants.length > 0;
    return { phase, phaseParticipants, done, total, started, complete: false };
  });
  phaseStats.forEach((item, index) => {
    const laterStarted = phaseStats.slice(index + 1).some((later) => later.started);
    item.complete = (item.total > 0 && item.done >= item.total) || laterStarted;
  });
  const activeIndex = Math.max(0, phaseStats.findIndex((item) => !item.complete));
  const completed = phaseStats.filter((item) => item.complete).length;
  const displayCompleted = isTerminal && status !== "failed" && status !== "cancelled"
    ? phases.length
    : completed;

  return (
    <div className="space-y-3">
      <div className="grid gap-2 lg:grid-cols-4">
        {phaseStats.map((item, index) => {
          const isActive = !isTerminal && index === activeIndex;
          const stateLabel = item.complete
            ? "done"
            : isActive || item.started
              ? "active"
              : "queued";
          return (
            <div
              key={item.phase.id}
              className={`rounded-lg border px-3 py-2 ${
                item.complete
                  ? "border-emerald-500/30 bg-emerald-500/5"
                  : isActive || item.started
                    ? "border-primary/40 bg-primary/5"
                    : "border-border bg-card/30"
              }`}
            >
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {item.phase.label} · {stateLabel}
              </div>
              <div className="mt-1 text-sm font-semibold text-foreground">
                {item.phase.title}
              </div>
              <div className="mt-1 text-[11px] leading-snug text-muted-foreground">
                {item.phase.description}
              </div>
              <div className="mt-2 font-mono text-[10px] text-muted-foreground">
                {Math.min(item.done, item.total || item.done)} / {item.total || item.phaseParticipants.length || 1}
              </div>
            </div>
          );
        })}
      </div>

      {thermoPlan?.domains && thermoPlan.domains.length > 0 && (
        <div className="rounded-lg border border-border bg-card/35 p-3">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Thermo domain assignment
          </div>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {thermoPlan.domains.map((domain) => (
              <div key={domain.domain} className="rounded-md border border-border/70 bg-background/30 p-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-semibold capitalize text-foreground">
                    {domain.domain.replaceAll("_", " ")}
                  </div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    {domain.validator ? "primary + review" : "primary"}
                  </div>
                </div>
                <div className="mt-1 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                  {domain.check}
                </div>
                <div className="mt-2 space-y-1 font-mono text-[10px] text-muted-foreground">
                  <div>
                    Main: {formatThermoVoice(domain.primary)}
                  </div>
                  <div>
                    Review: {domain.validator ? formatThermoVoice(domain.validator) : domain.validatorReason}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mx-auto flex w-full max-w-xs items-center gap-2">
        <div className="flex h-1 flex-1 overflow-hidden rounded-full bg-muted">
          <div
            className={`transition-[width] duration-700 ease-out ${
              status === "approved" ? "bg-emerald-400" : "bg-primary"
            }`}
            style={{ width: `${(displayCompleted / phases.length) * 100}%` }}
          />
        </div>
        <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
          {displayCompleted} / {phases.length} phases
        </span>
      </div>
    </div>
  );
}

function expectedThermoPhaseTotal(
  phase: ThermoPhaseGroup,
  thermoPlan: ThermoRunPlan | null,
  actualCount: number,
): number {
  if (phase === "specialist") return thermoPlan?.domains.filter((d) => d.primary).length ?? actualCount;
  if (phase === "validation") return thermoPlan?.domains.filter((d) => d.validator).length ?? actualCount;
  return 1;
}

function formatThermoVoice(voice: { modelId: string; tier: string } | null): string {
  if (!voice) return "none";
  return `${voice.modelId} · Tier ${voice.tier.replace("_PLUS", "+").replace("_MINUS", "-")}`;
}

/**
 * Counts phases for multi-phase templates, rounds for single-phase +
 * multi-round (e.g. bug-diagnose), reviewers for single-phase +
 * single-round + multi-reviewer (tri-review). Hidden when the run is a
 * single shot.
 */
function ProgressStrip({
  template,
  status,
  totalPhases,
  completedPhaseCount,
  rounds,
  enrichedRounds,
}: {
  template: Template | null;
  status: string;
  totalPhases: number;
  completedPhaseCount: number;
  rounds: RoundSnapshot[];
  enrichedRounds: RoundSnapshot[];
}) {
  const maxRounds = template?.maxRounds ?? 1;
  const isTerminal =
    status === "approved" ||
    status === "merged" ||
    status === "no_review" ||
    status === "blocked" ||
    status === "failed" ||
    status === "cancelled";

  const showByPhases = totalPhases > 1;
  const showByRounds = !showByPhases && maxRounds > 1;
  const currentRound = enrichedRounds[enrichedRounds.length - 1];
  // Count reviewers only — the doer (or synthetic `doer-artifact` slot
  // in review-only chats) is its own participant on disk but not part
  // of the "N reviewers complete" mental model. Without this filter a
  // 4-reviewer review-only chat displays "x/5".
  const reviewerParticipants =
    currentRound?.participants.filter((p) => p.role === "reviewer") ?? [];
  const participantTotal = reviewerParticipants.length;
  const participantDone = reviewerParticipants.filter((p) => p.hasAnswer).length;
  const showByParticipants =
    !showByPhases && !showByRounds && participantTotal > 1;
  if (!showByPhases && !showByRounds && !showByParticipants) return null;

  const total = showByPhases
    ? totalPhases
    : showByRounds
      ? maxRounds
      : participantTotal;
  const completed = showByPhases
    ? Math.min(completedPhaseCount, totalPhases)
    : showByRounds
      ? Math.min(Math.max(rounds.length, 1), maxRounds)
      : participantDone;
  const display = showByPhases && isTerminal ? total : completed;
  const label = showByPhases
    ? `${display} / ${total} phases`
    : showByRounds
      ? `Round ${display} / ${total}`
      : `${display} / ${total} complete`;

  return (
    <div className="mx-auto flex w-full max-w-xs items-center gap-2">
      <div className="flex h-1 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className={`transition-[width] duration-700 ease-out ${
            status === "approved" ? "bg-emerald-400" : "bg-primary"
          }`}
          style={{ width: `${(display / total) * 100}%` }}
        />
      </div>
      <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
        {label}
      </span>
    </div>
  );
}
