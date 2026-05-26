"use client";

import { Clock3 } from "lucide-react";
import { uiLineageDot } from "@/lib/lineage-maps";
import {
  displayModelName,
  displayTier,
  providerDisplayLabel,
  providerLineageKey,
} from "@/lib/model-display";
import { ParticipantCard } from "./participant-card";
import { StateBadge } from "./state-badge";
import type {
  FallbackSwap,
  ParticipantSnapshot,
  ParticipantState,
  RoundSnapshot,
  ThermoPlanDomain,
  ThermoPlanVoice,
  ThermoRunPlan,
} from "./types";

interface ThermoDomainBoardProps {
  round: RoundSnapshot;
  activeFor: (p: ParticipantSnapshot) => boolean;
  liveTails: Record<string, string>;
  liveDurationFor?: (participant: ParticipantSnapshot) => number | undefined;
  chatTerminal: boolean;
  chatStatus?: string;
  chatId?: string;
  swaps?: FallbackSwap[];
  thermoPlan: ThermoRunPlan | null;
}

/**
 * Thermo run layout. The daemon writes a plan sidecar with seven domain rows;
 * this board maps each domain to a primary slot and a review slot, then
 * attaches live participant artifacts by typed domain + role. Participants
 * outside those lanes, such as synthesis/audit outputs or legacy fallback
 * rows, render in the extras section so no artifact is hidden.
 */
export function ThermoDomainBoard({
  round,
  activeFor,
  liveTails,
  liveDurationFor,
  chatTerminal,
  chatStatus,
  chatId,
  swaps,
  thermoPlan,
}: ThermoDomainBoardProps) {
  const visibleParticipants = round.participants.filter((p) => p.role !== "doer");
  const domains = domainRows(thermoPlan, visibleParticipants);
  const domainNames = new Set(domains.map((domain) => domain.domain));
  const participantsFor = (
    domain: string,
    role: "primary" | "validator",
  ): ParticipantSnapshot[] => {
    return visibleParticipants.filter(
      (p) => p.thermo?.domain === domain && p.thermo.role === role,
    );
  };

  const domainSlots = domains.map((domain) => {
    const primaryCandidates = participantsFor(domain.domain, "primary");
    const validatorCandidates = participantsFor(domain.domain, "validator");
    return {
      domain,
      primaryCandidates,
      validatorCandidates,
      primary: bestParticipant(primaryCandidates, activeFor, liveTails),
      validator: bestParticipant(validatorCandidates, activeFor, liveTails),
    };
  });
  const rendered = new Set(
    domainSlots.flatMap((slot) =>
      [...slot.primaryCandidates, ...slot.validatorCandidates].map((p) => p.participant),
    ),
  );

  const swapsForParticipant = (p: ParticipantSnapshot): FallbackSwap[] => {
    const roundSwaps = (swaps ?? []).filter((s) => s.round === round.round);
    const agentKey = p.participant.replace(/^(reviewer-|doer-)/, "");
    return roundSwaps.filter((s) => s.agent === agentKey);
  };

  const extras = visibleParticipants.filter((p) => {
    if (rendered.has(p.participant)) return false;
    if (!p.thermo) return true;
    return (
      p.thermo.phaseGroup === "synthesis" ||
      p.thermo.phaseGroup === "audit" ||
      !domainNames.has(p.thermo.domain)
    );
  });

  return (
    <div className="space-y-5">
      {domainSlots.map(({ domain, primary, validator, primaryCandidates }) => {
        const primaryDone = primary ? participantHasCompletedResult(primary) : false;
        const fallbackPrimary = primaryCandidates.find((candidate) =>
          candidate.thermo?.phaseId.endsWith("-fallback"),
        );
        const fallbackPrimaryDone = fallbackPrimary
          ? participantHasCompletedResult(fallbackPrimary)
          : false;
        const runEnded = chatStatus === "failed" || chatStatus === "cancelled";
        const usedValidatorAsFallback =
          !validator && Boolean(domain.validator) && fallbackPrimaryDone;
        const waitingSlotState: ParticipantState = usedValidatorAsFallback
          ? "skipped"
          : domain.validator && runEnded
          ? "not_run"
          : "pending";
        const waitingSlotMessage =
          domain.validator
            ? usedValidatorAsFallback
              ? `Skipped: ${displayModelName(
                  fallbackPrimary?.thermo?.modelId ?? domain.validator.modelId,
                )} was used as a fallback primary, so no separate validation review ran.`
              : runEnded
              ? `${chatStatus === "cancelled" ? "Not run: the run was cancelled" : "Not run: the run failed"} before this validation review could start.`
              : primaryDone
              ? "Queued for adversarial review."
              : "Waiting for primary reviewer to finish."
            : domain.validatorReason || "No secondary reviewer assigned.";
        return (
          <section
            key={domain.domain}
            className="rounded-xl border border-border bg-card/35 p-4"
          >
            <div className="mb-4 flex flex-col gap-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-base font-semibold capitalize text-foreground">
                  {formatDomainTitle(domain.domain)}
                </h2>
                <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  Primary + review
                </span>
              </div>
              <p className="max-w-4xl text-sm leading-relaxed text-muted-foreground">
                {domain.check}
              </p>
            </div>

            <div className="grid items-start gap-4 lg:grid-cols-2">
              {primary && shouldRenderParticipant(primary, activeFor, liveTails, chatTerminal) ? (
                <ParticipantCard
                  participant={primary}
                  liveTail={liveTails[primary.participant]}
                  liveDurationMs={liveDurationFor?.(primary)}
                  chatTerminal={chatTerminal}
                  chatStatus={chatStatus}
                  chatId={chatId}
                  reviewOnly
                  swaps={swapsForParticipant(primary)}
                />
              ) : (
                <ThermoWaitingSlot
                  label="Primary"
                  voice={primary ? voiceFromParticipant(primary) : domain.primary}
                  message="Starting primary reviewer..."
                />
              )}

              {validator &&
              shouldRenderParticipant(validator, activeFor, liveTails, chatTerminal) ? (
                <ParticipantCard
                  participant={validator}
                  liveTail={liveTails[validator.participant]}
                  liveDurationMs={liveDurationFor?.(validator)}
                  chatTerminal={chatTerminal}
                  chatStatus={chatStatus}
                  chatId={chatId}
                  reviewOnly
                  swaps={swapsForParticipant(validator)}
                />
              ) : (
                <ThermoWaitingSlot
                  label="Review"
                  voice={validator ? voiceFromParticipant(validator) : domain.validator}
                  state={waitingSlotState}
                  message={waitingSlotMessage}
                />
              )}
            </div>
          </section>
        );
      })}

      {extras.length > 0 && (
        <section className="rounded-xl border border-border bg-card/35 p-4">
          <div className="mb-4">
            <h2 className="text-base font-semibold text-foreground">
              Final synthesis
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Cross-domain consolidation and final audit work.
            </p>
          </div>
          <div className="grid items-start gap-4 lg:grid-cols-2">
            {extras.map((participant) => (
              <ParticipantCard
                key={participant.participant}
                participant={participant}
                liveTail={liveTails[participant.participant]}
                liveDurationMs={liveDurationFor?.(participant)}
                chatTerminal={chatTerminal}
                chatStatus={chatStatus}
                chatId={chatId}
                reviewOnly
                swaps={swapsForParticipant(participant)}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function bestParticipant(
  participants: ParticipantSnapshot[],
  activeFor: (p: ParticipantSnapshot) => boolean,
  liveTails: Record<string, string>,
): ParticipantSnapshot | undefined {
  return [...participants]
    .sort((a, b) => participantScore(b, activeFor, liveTails) - participantScore(a, activeFor, liveTails))
    [0];
}

function participantScore(
  participant: ParticipantSnapshot,
  activeFor: (p: ParticipantSnapshot) => boolean,
  liveTails: Record<string, string>,
): number {
  let score = 0;
  if (participant.hasAnswer) score += 100;
  if (participant.answer?.trim()) score += 20;
  if (activeFor(participant)) score += 10;
  if (liveTails[participant.participant]) score += 10;
  if (participant.thermo?.phaseId.endsWith("-fallback")) score += 5;
  return score;
}

function ThermoWaitingSlot({
  label,
  voice,
  state = "pending",
  message,
}: {
  label: string;
  voice: ThermoPlanVoice | null;
  state?: ParticipantState;
  message: string;
}) {
  return (
    <div className="flex h-[320px] flex-col overflow-hidden rounded-lg border border-border/50 bg-background/45 opacity-75">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-card/50 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2 text-xs leading-none">
          <span className={`h-2 w-2 shrink-0 rounded-full ${uiLineageDot(providerLineageKey(voice?.provider))}`} />
          <span className="font-medium text-foreground">{label}</span>
          <span className="text-muted-foreground">·</span>
          {voice ? (
            <>
              <span className="truncate text-muted-foreground">
                {displayModelName(voice.modelId)}
              </span>
              <span className="text-muted-foreground/60">·</span>
              <span className="shrink-0 rounded bg-primary/10 px-1 py-0.5 font-mono text-[10px] text-primary">
                Tier {displayTier(voice.tier)}
              </span>
            </>
          ) : (
            <span className="truncate text-muted-foreground">unassigned</span>
          )}
        </div>
        <StateBadge state={state} />
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center px-4 py-3 text-center">
        <div className="max-w-sm space-y-2 text-sm text-muted-foreground">
          <Clock3 className="mx-auto h-5 w-5 text-muted-foreground/70" />
          <div>{message}</div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-border bg-card/50 px-4 py-2 font-mono text-[10px] text-muted-foreground">
        <span className="truncate">
          {voice ? providerDisplayLabel(voice.provider) : "not assigned"}
        </span>
        <span>tokens n/a</span>
      </div>
    </div>
  );
}

export function participantHasCompletedResult(
  participant: Pick<ParticipantSnapshot, "hasAnswer">,
): boolean {
  return participant.hasAnswer;
}

function shouldRenderParticipant(
  participant: ParticipantSnapshot,
  activeFor: (p: ParticipantSnapshot) => boolean,
  liveTails: Record<string, string>,
  chatTerminal: boolean,
): boolean {
  if (participant.hasAnswer || participant.answer || chatTerminal) return true;
  return activeFor(participant) || Boolean(liveTails[participant.participant]);
}

function voiceFromParticipant(participant: ParticipantSnapshot): ThermoPlanVoice | null {
  const thermo = participant.thermo;
  if (!thermo) return null;
  return {
    voiceId: thermo.voiceId,
    provider: thermo.provider,
    modelId: thermo.modelId,
    tier: thermo.tier,
  };
}

function domainRows(
  thermoPlan: ThermoRunPlan | null,
  participants: ParticipantSnapshot[],
): ThermoPlanDomain[] {
  if (thermoPlan?.domains && thermoPlan.domains.length > 0) {
    return thermoPlan.domains;
  }

  const seen = new Set<string>();
  const rows: ThermoPlanDomain[] = [];
  for (const participant of participants) {
    const thermo = participant.thermo;
    if (!thermo || seen.has(thermo.domain)) continue;
    seen.add(thermo.domain);
    rows.push({
      domain: thermo.domain,
      check: thermo.check,
      validatorPolicy: "always",
      validatorReason: "Waiting for review assignment.",
      primary: null,
      validator: null,
    });
  }
  return rows;
}

function formatDomainTitle(domain: string): string {
  return domain.replaceAll("_", " ");
}
