"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, Maximize2, Shuffle, X } from "lucide-react";
import { uiLineageDot, uiLineageLabel } from "@/lib/lineage-maps";
import {
  displayModelName,
  displayTier,
  providerDisplayLabel,
} from "@/lib/model-display";
import { parseOpenCodeTerminalUsage } from "@/lib/opencode-terminal-usage";
import { LINEAGE_GRADIENT } from "./lineage-gradient";
import { StateBadge } from "./state-badge";
import { MarkdownReview } from "./markdown-review";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { FallbackSwap, ParticipantSnapshot, ParticipantState } from "./types";
import type { ReviewerLineage } from "@/lib/types";

/**
 * Display lineage = what to colour/label the card by.
 *
 * The slot's nominal lineage (e.g. "kimi") drives diversity scoring on the
 * daemon side. But moonshot has dual transports — standalone `kimi` CLI
 * vs `opencode -m opencode-go/kimi-k2.6`. Users without a Moonshot sub
 * route everything through opencode, so badging the card "KIMI" is
 * actively misleading: it implies a binary they don't have. When the
 * runtime sidecar tells us the binary was `opencode-cli`, badge the card
 * as opencode. The model id (`opencode-go/kimi-k2.6` vs
 * `opencode-go/deepseek-v4-pro`) still distinguishes voices visually.
 */
function displayLineage(p: ParticipantSnapshot): ReviewerLineage {
  if (p.binaryUsed === "opencode-cli") return "opencode";
  return p.lineage;
}

function thermoRoleLabel(role: NonNullable<ParticipantSnapshot["thermo"]>["role"]): string {
  switch (role) {
    case "primary":
      return "Primary";
    case "validator":
      return "Review";
    case "synthesizer":
      return "Synthesis";
    case "auditor":
      return "Audit";
  }
}

/**
 * One reviewer/doer card in the run grid.
 *
 * Card state precedence (most-specific first):
 *   pending  — placeholder synthesised from template, no dir on disk yet
 *   done     — answer.md has non-empty content
 *   working  — chat is mid-run AND (proc is alive OR live tail has bytes)
 *   errored  — chat is in a terminal state but this participant produced 0 B
 *   idle     — fall-through (rare; shouldn't normally render)
 */
export function ParticipantCard({
  participant,
  liveTail,
  liveDurationMs,
  chatTerminal,
  chatStatus,
  chatId,
  reviewOnly,
  swaps,
}: {
  participant: ParticipantSnapshot;
  liveTail?: string;
  liveDurationMs?: number;
  /** Chat itself reached a terminal state — distinguishes "errored (no
   *  output produced even though run finished)" from "still working". */
  chatTerminal: boolean;
  /** Raw chat status. Needed so cancelled runs do not render old in-flight
   *  participant rows as still WORKING. */
  chatStatus?: string;
  /** When provided AND the card is in working state, render a per-card
   *  cancel button. Routes to /chats/:id/participants/:key/cancel.
   *  When omitted (older callers, terminal chats), the button is hidden. */
  chatId?: string;
  /** True when the chat is a review-only template (no doer phase). The
   *  pending-state copy swaps from "runs after the doer" to a generic
   *  "queued" line in that case — there is no doer to wait for. */
  reviewOnly?: boolean;
  /** Fallback swaps that fired on this slot (per-slot model fallback or
   *  cross-lineage). Rendered as inline rows under the header showing
   *  what voice ACTUALLY produced the answer — the slot's identity in
   *  the header stays bound to its primary lineage so cards don't
   *  re-key mid-run. Empty when no swap fired. */
  swaps?: FallbackSwap[];
}) {
  const [cancelling, setCancelling] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // State precedence: pending (synthesised slot) → done (answer on disk) →
  // errored (chat terminal but no answer) → working (the implicit
  // non-terminal mid-flight state). Earlier code gated "working" on isActive
  // or liveTail bytes, but those signals lag behind phase_start replay and
  // would briefly flicker the card to "idle" — making it look frozen
  // between phase_start and the first text_delta. Anchoring on chat status
  // closes that window.
  // When the runner wrote a `## REVIEWER FAILED` summary (PR #11
  // silent-failure preempt), surface its parsed Kind + body in the
  // errored state instead of the generic "didn't produce any output"
  // message. The summary always carries the reason the LLM CLI failed
  // (quota_exhausted, refresh_token_stale, cli_failed, ...).
  const failure = parseFailureSummary(participant.answer);

  // State precedence — `failure` MUST come before "done".
  // The runner writes `## REVIEWER FAILED ...` to answer.md when a CLI
  // dies, but does NOT append `## DONE` (failure summaries aren't
  // successful answers). Without elevating failure here, the non-empty
  // diagnostic body makes the card look DONE even though it failed.
  const hasReviewResult =
    !failure &&
    (participant.hasAnswer || Boolean(participant.answer?.trim()));
  const state: ParticipantState = participant.pending
    ? "pending"
    : failure
      ? "errored"
      : hasReviewResult
        ? "done"
        : chatStatus === "cancelled"
          ? "cancelled"
          : chatTerminal
            ? "errored"
            : "working";
  const hasExpandableResult =
    Boolean(participant.answer?.trim()) &&
    (state === "done" || state === "errored");
  const ui = displayLineage(participant);
  const showAgyQuotaPill = isAntigravityQuotaFailure(participant, failure);
  const thermo = participant.thermo;
  const roleLabel = thermo ? thermoRoleLabel(thermo.role) : participant.role;
  const displayModel = thermo?.modelId ?? participant.modelUsed ?? participant.model;
  const tierLabel = thermo?.tier ? displayTier(thermo.tier) : undefined;
  const participantEvents = [
    ...(participant.events ?? []),
    ...(participant.warnings ?? []),
  ];
  const visibleInfoEvents = participantEvents.filter((warning) => {
    const message = warning.message.trim();
    return (
      message &&
      message !== "(no detail)" &&
      message !== "unknown error" &&
      (warning.severity === "info" ||
        warning.kind === "permission_auto_approved")
    );
  });
  const visibleWarnings = participantEvents.filter((warning) => {
    const message = warning.message.trim();
    return (
      message &&
      message !== "(no detail)" &&
      message !== "unknown error" &&
      warning.severity !== "info" &&
      warning.kind !== "permission_auto_approved"
    );
  });
  const tokenSummary = useMemo(
    () =>
      tokenUsageSummary(
        participant.usage,
        participant.terminalUsage,
        liveTail,
      ),
    [participant.usage, participant.terminalUsage, liveTail],
  );
  const footerMetrics = useMemo(
    () =>
      participantFooterMetrics(
        participant.durationMs ?? liveDurationMs,
        participant.usage?.costUsd ?? participant.terminalUsage?.costUsd,
        tokenSummary,
      ),
    [
      liveDurationMs,
      participant.durationMs,
      participant.terminalUsage?.costUsd,
      participant.usage?.costUsd,
      tokenSummary,
    ],
  );
  const terminalLabel = providerDisplayLabel(
    participant.binaryUsed ?? participant.agentName,
    ui,
  );

  return (
    <div
      className={`relative flex h-[320px] flex-col overflow-hidden rounded-lg border transition-[opacity,border-color] duration-300 ${
        LINEAGE_GRADIENT[ui] ?? "bg-card"
      } ${
        state === "done"
          ? "border-emerald-500/30"
          : state === "working"
            ? "border-border/80"
            : state === "errored"
              ? "border-destructive/40"
              : state === "cancelled"
                ? "border-border/60 opacity-70 grayscale-[0.35]"
              : state === "pending"
                ? "border-border/40 opacity-50 grayscale-[0.6]"
                : "border-border"
      }`}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border bg-card/60 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2 text-xs leading-none">
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${uiLineageDot(ui)}`}
          />
          <span className="font-medium capitalize text-foreground">{roleLabel}</span>
          <span className="text-muted-foreground">·</span>
          {displayModel ? (
            <span className="truncate text-muted-foreground">
              {displayModelName(displayModel)}
            </span>
          ) : (
            <span className="uppercase tracking-wider text-muted-foreground">
              {uiLineageLabel(ui)}
            </span>
          )}
          {tierLabel && (
            <>
              <span className="text-muted-foreground/60">·</span>
              <span className="shrink-0 rounded bg-primary/10 px-1 py-0.5 font-mono text-[10px] text-primary">
                Tier {tierLabel}
              </span>
            </>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {state === "working" && chatId && (
            <button
              type="button"
              disabled={cancelling}
              onClick={async () => {
                if (cancelling) return;
                setCancelling(true);
                try {
                  const res = await fetch(
                    `/api/daemon/chats/${chatId}/participants/${encodeURIComponent(participant.participant)}/cancel`,
                    { method: "POST" },
                  );
                  if (!res.ok) {
                    setCancelling(false);
                    return;
                  }
                  const body = (await res.json()) as {
                    ok: boolean;
                    data?: { aborted?: boolean };
                    error?: { message?: string };
                  };
                  if (!body.ok) {
                    window.alert(
                      `Couldn't cancel: ${body.error?.message ?? "unknown error"}`,
                    );
                    setCancelling(false);
                    return;
                  }
                  // Leave `cancelling=true` until the SSE flips this
                  // card's state away from working — avoids a re-click
                  // before the runner actually exits. The chat-level
                  // SSE handler will re-render with state==='errored'
                  // (no output) once the abort propagates.
                  //
                  // Fallback: if SSE never fires (stalled stream, dead
                  // chat, network drop) the button would otherwise be
                  // disabled forever. Reset after 15s so the user can
                  // retry. Flagged in retroactive PR #24 review by
                  // gemini + opencode-deepseek.
                  setTimeout(() => setCancelling(false), 15_000);
                } catch {
                  setCancelling(false);
                }
              }}
              aria-label="Cancel this reviewer"
              title="Cancel this reviewer (chat continues with others)"
              className="grid h-6 w-6 shrink-0 place-items-center rounded-md border border-border bg-card/40 text-muted-foreground transition hover:border-destructive/40 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-50"
            >
              <X className="h-3 w-3" />
            </button>
          )}
          <StateBadge state={state} />
        </div>
      </div>

      {swaps && swaps.length > 0 && (() => {
        // Only the LAST entry's `to` voice actually produced an answer;
        // intermediate `to` voices were attempted and themselves failed
        // (which is what triggered the next swap). Showing "actually ran"
        // on every row is wrong for chains of length > 1.
        const sorted = swaps.slice().sort((a, b) => a.fallbackIdx - b.fallbackIdx);
        return (
          <div className="space-y-1.5 border-b border-amber-500/30 bg-amber-500/5 px-4 py-2 text-[11px]">
            {sorted.map((s, i) => {
              const isCross = s.reason === "lineage_fallback";
              const isLast = i === sorted.length - 1;
              return (
                <div
                  key={`${s.fromLineage}-${s.fromModel}-${i}`}
                  className="flex items-start gap-2"
                >
                  <Shuffle className="mt-0.5 h-3 w-3 shrink-0 text-amber-300" />
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="font-medium uppercase tracking-wider text-[10px] text-amber-300">
                      {isCross ? "Cross-lineage fallback" : "Model fallback"}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-amber-100/90">
                      <span className="text-amber-100/60 line-through">
                        {s.fromLineage}/{s.fromModel}
                      </span>
                      <ArrowRight className="h-3 w-3 shrink-0 text-amber-300" />
                      <span
                        className={
                          isLast
                            ? "font-medium text-amber-100"
                            : "text-amber-100/60 line-through"
                        }
                      >
                        {s.toLineage}/{s.toModel}
                      </span>
                      {isLast && (
                        <span className="rounded bg-amber-500/15 px-1 py-0.5 font-mono text-[9px] text-amber-200">
                          actually ran
                        </span>
                      )}
                    </div>
                    {s.fromErrorKind && (
                      <div className="text-[10px] text-amber-200/75">
                        <span className="font-mono uppercase tracking-wider text-amber-300/90">
                          {s.fromErrorKind}
                        </span>
                        {s.fromErrorMessage && (
                          <span className="ml-1.5 text-amber-100/80">
                            — {s.fromErrorMessage}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}

      {visibleInfoEvents.length > 0 && (
        <div className="space-y-1 border-b border-emerald-500/20 bg-emerald-500/5 px-4 py-2 text-[11px] text-emerald-100/80">
          {visibleInfoEvents.map((w, i) => (
            <div key={`${w.kind}-${w.ts}-${i}`} className="flex items-start gap-1.5">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400/70" />
              <div className="min-w-0 flex-1">
                <span className="font-medium uppercase tracking-wider text-[10px] text-emerald-300/90">
                  {w.kind}
                </span>
                <div className="mt-0.5 break-words font-mono text-[11px] leading-snug text-emerald-50/75">
                  {w.message}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {visibleWarnings.length > 0 && (
        <div className="space-y-1 border-b border-amber-500/30 bg-amber-500/5 px-4 py-2 text-[11px] text-amber-200/90">
          {visibleWarnings.map((w, i) => (
            <div key={`${w.kind}-${w.ts}-${i}`} className="flex items-start gap-1.5">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-400" />
              <div className="min-w-0 flex-1">
                <span className="font-medium uppercase tracking-wider text-[10px] text-amber-300">
                  {w.kind}
                </span>
                <div className="mt-0.5 break-words font-mono text-[11px] leading-snug text-amber-100/85">
                  {w.message}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 py-3 font-mono text-xs leading-relaxed text-muted-foreground">
        {participant.findingsPreview && participant.findingsPreview.length > 0 ? (
          participant.findingsPreview.map((line, i) => (
            <div key={i} className="py-0.5 text-foreground/90">
              {line}
            </div>
          ))
        ) : state === "working" && liveTail && liveTail.length > 0 ? (
          // Live tail from headless transport — last ~500 chars of streaming
          // output. Gated on state==="working" so a stale tail keyed by
          // role:lineage (e.g. Round 1 reviewer's last text) can't leak
          // into a freshly-pending Round 2 reviewer card.
          //
          // `column-reverse` keeps the most recent output anchored at the
          // bottom and scrolls older output off the top — same visual the
          // user gets from `tail -f` and what production CLI streams expect.
          // The fixed card height (h-[320px] above) means streaming content
          // never grows the card, eliminating the layout shift across cards
          // on the same row.
          <div className="flex min-h-0 flex-1 flex-col-reverse overflow-y-auto">
            <pre className="whitespace-pre-wrap break-words text-foreground/85">
              {liveTail}
            </pre>
          </div>
        ) : state === "working" ? (
          <div className="text-muted-foreground">Thinking…</div>
        ) : state === "pending" ? (
          <div className="text-muted-foreground/70">
            {reviewOnly
              ? "Queued — waiting for an open slot."
              : "Queued — runs after the doer."}
          </div>
        ) : state === "errored" ? (
          failure ? (
            <div className="space-y-1.5 text-destructive/90">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wider">
                  {failure.kind}
                </span>
                {failure.resetAt && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-300">
                    Resets {formatResetAt(failure.resetAt)}
                  </span>
                )}
              </div>
              <div className="whitespace-pre-wrap break-words text-foreground/85">
                {failure.message}
              </div>
              {failure.cta && (
                <div className="text-[11px] text-muted-foreground/80">
                  {failure.cta}
                </div>
              )}
            </div>
          ) : (
            <div className="text-destructive/80">
              The program finished but didn&apos;t produce any output.
            </div>
          )
        ) : state === "cancelled" ? (
          <div className="text-muted-foreground/75">
            Cancelled before this reviewer produced output.
          </div>
        ) : state === "done" && participant.answer ? (
          // DONE state — render the answer inline, top-anchored, with
          // overflow scrolled internally so the card stays at fixed
          // height. Click anywhere on the answer body to expand into a
          // full-screen modal showing the complete output (per user
          // feedback: truncated text on the card means there was no way
          // to read past the fold).
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="group min-h-0 flex-1 cursor-zoom-in overflow-y-auto rounded text-left transition-colors hover:bg-foreground/5 focus:outline-none focus:ring-2 focus:ring-primary/40"
            title="Click to view the full answer"
          >
            <pre className="whitespace-pre-wrap break-words text-foreground/85">
              {participant.answer}
            </pre>
          </button>
        ) : (
          <div className="text-muted-foreground/70">No output yet.</div>
        )}
      </div>

      {hasExpandableResult && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="absolute bottom-11 right-3 z-10 inline-flex h-7 items-center gap-1.5 rounded-full border border-border/80 bg-background/85 px-2.5 text-[11px] font-medium text-foreground/85 shadow-sm backdrop-blur transition-colors hover:border-primary/40 hover:bg-primary/10 hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
          title="View reviewer result"
          aria-label="View reviewer result"
        >
          <Maximize2 className="h-3 w-3" />
          Result
        </button>
      )}

      <div className="flex items-center justify-between gap-3 border-t border-border bg-card/60 px-4 py-2 font-mono text-[10px] text-muted-foreground">
        <span className="truncate">{terminalLabel}</span>
        <span className="flex shrink-0 items-center gap-2">
          {showAgyQuotaPill && (
            <span
              title={failure?.message}
              className="inline-flex items-center gap-1 rounded-full border border-amber-500/35 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-amber-300"
            >
              <AlertTriangle className="h-2.5 w-2.5 shrink-0" />
              quota reached
            </span>
          )}
          {footerMetrics.map((metric, index) => (
            <span key={metric.title} className="inline-flex items-center gap-2">
              {index > 0 && (
                <span aria-hidden="true" className="text-muted-foreground/45">
                  ·
                </span>
              )}
              <span title={metric.title}>{metric.label}</span>
            </span>
          ))}
        </span>
      </div>

      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] !max-w-[1180px] overflow-hidden sm:w-[92vw]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${uiLineageDot(ui)}`}
              />
              <span className="font-medium capitalize">{roleLabel}</span>
              <span className="text-muted-foreground">·</span>
              {displayModel ? (
                <span className="text-muted-foreground">
                  {displayModelName(displayModel)}
                </span>
              ) : (
                <span className="uppercase tracking-wider text-muted-foreground">
                  {uiLineageLabel(ui)}
                </span>
              )}
            </DialogTitle>
          </DialogHeader>
          <div className="max-h-[76vh] overflow-y-auto rounded-md border border-border bg-card/35 px-6 py-5">
            <MarkdownReview content={participant.answer ?? ""} />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const r = Math.round(s - m * 60);
  return `${m}m${r.toString().padStart(2, "0")}s`;
}

function formatCost(usd: number): string {
  if (usd <= 0) return "$0.00";
  if (usd < 0.01) return "<$0.01";
  return `$${usd.toFixed(2)}`;
}

function formatTokens(u: NonNullable<ParticipantSnapshot["usage"]>): string | null {
  const total =
    (u.inputTokens ?? 0) +
    (u.outputTokens ?? 0) +
    (u.cachedInputTokens ?? 0);
  if (total <= 0) return null;
  if (total < 1000) return `${total} tok`;
  return `${(total / 1000).toFixed(1)}k tok`;
}

function formatContextTokens(tokens: number): string {
  if (tokens < 1000) return `${tokens}`;
  return `${(tokens / 1000).toFixed(1)}k`;
}

function participantFooterMetrics(
  durationMs: number | undefined,
  costUsd: number | undefined,
  tokenSummary: { label: string; title: string },
): Array<{ label: string; title: string }> {
  const metrics: Array<{ label: string; title: string }> = [];
  if (durationMs !== undefined) {
    metrics.push({
      label: formatDuration(durationMs),
      title: "Wall-clock time the CLI took to finish.",
    });
  }
  if (costUsd !== undefined) {
    metrics.push({
      label: formatCost(costUsd),
      title: "USD cost reported by the CLI for this run.",
    });
  }
  metrics.push(tokenSummary);
  return metrics;
}

function tokenUsageSummary(
  usage: ParticipantSnapshot["usage"],
  terminalUsage: ParticipantSnapshot["terminalUsage"],
  liveTail: string | undefined,
): { label: string; title: string } {
  if (usage) {
    const formatted = formatTokens(usage);
    if (formatted) {
      return {
        label: formatted,
        title: tokensTitle(usage),
      };
    }
  }

  if (terminalUsage?.contextTokens !== undefined) {
    return {
      label: formatContextTokens(terminalUsage.contextTokens),
      title:
        "OpenCode terminal context usage. Structured token usage was not reported.",
    };
  }

  const terminal = parseOpenCodeTerminalUsage(liveTail);
  if (terminal?.contextTokens !== undefined) {
    return {
      label: formatContextTokens(terminal.contextTokens),
      title:
        "OpenCode terminal context usage. Final token usage is shown when the CLI reports it.",
    };
  }

  return {
    label: "tokens n/a",
    title: "This CLI did not report token usage for this participant.",
  };
}

function tokensTitle(u: NonNullable<ParticipantSnapshot["usage"]>): string {
  const parts: string[] = [];
  if (u.inputTokens !== undefined) parts.push(`in ${u.inputTokens.toLocaleString()}`);
  if (u.outputTokens !== undefined) parts.push(`out ${u.outputTokens.toLocaleString()}`);
  if (u.cachedInputTokens !== undefined)
    parts.push(`cached ${u.cachedInputTokens.toLocaleString()}`);
  return parts.length > 0 ? parts.join(" · ") : "Token usage";
}

/**
 * Extract Kind + message from a `## REVIEWER FAILED` / `## DOER FAILED`
 * summary written by runReviewerHeadless / runDoerHeadless when a CLI
 * subprocess dies before producing content. Returns null when the answer
 * isn't a failure summary.
 *
 * Summary shape (per src/daemon/runner/{reviewer,doer}.ts finally block):
 *   ## REVIEWER FAILED
 *
 *   **Kind:** quota_exhausted
 *   **Lineage:** openai
 *   **Model:** gpt-5.5
 *
 *   ERROR: ...message...
 */
function parseFailureSummary(
  answer: string | undefined,
): { kind: string; message: string; cta?: string; resetAt?: number } | null {
  if (!answer) return null;
  const trimmed = answer.trimStart();
  if (!/^##\s+(?:REVIEWER|DOER)\s+FAILED/i.test(trimmed)) return null;
  const kindMatch = trimmed.match(/\*\*Kind:\*\*\s*(.+?)(?:\n|$)/);
  const kind = kindMatch ? kindMatch[1].trim() : "failed";
  // Optional `**Resets:** <iso-time>` line written by reviewer.ts/doer.ts
  // when cli-health knows when the upstream quota window expires.
  const resetMatch = trimmed.match(/\*\*Resets:\*\*\s*(.+?)(?:\n|$)/);
  let resetAt: number | undefined;
  if (resetMatch) {
    const t = Date.parse(resetMatch[1].trim());
    if (Number.isFinite(t)) resetAt = t;
  }
  // Body = everything after the first blank line that follows the
  // header block. The header block has Kind/Lineage/Model[/Resets] lines.
  const headerEnd = trimmed.search(/\n\n[^*]/);
  const body = headerEnd >= 0 ? trimmed.slice(headerEnd + 2).trim() : "";
  const message = body.length > 0 ? body : "(no error message reported)";
  // Map common kinds to a short call-to-action so the user knows what to do.
  // Pass the message text too so kind-CTAs can match on specific stderr
  // signatures (e.g. Claude's --dangerously-skip-permissions root refusal
  // surfaces as cli_failed but needs a very different remedy than re-auth).
  const cta = ctaForKind(kind, message);
  return {
    kind,
    message,
    ...(cta ? { cta } : {}),
    ...(resetAt ? { resetAt } : {}),
  };
}

function isAntigravityQuotaFailure(
  participant: ParticipantSnapshot,
  failure: ReturnType<typeof parseFailureSummary>,
): boolean {
  if (failure?.kind !== "quota_exhausted") return false;
  return (
    participant.binaryUsed === "antigravity-cli" ||
    participant.agentName === "antigravity-cli"
  );
}

function formatResetAt(ms: number): string {
  const diff = ms - Date.now();
  if (diff <= 0) return "now";
  const sec = Math.round(diff / 1000);
  if (sec < 60) return `in ${sec}s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `in ${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 24) {
    const at = new Date(ms);
    return `at ${at.getHours().toString().padStart(2, "0")}:${at
      .getMinutes()
      .toString()
      .padStart(2, "0")}`;
  }
  const days = Math.round(hr / 24);
  return `in ${days}d`;
}

function ctaForKind(kind: string, message?: string): string | undefined {
  // Specific stderr signatures override the generic per-kind CTAs.
  // Claude CLI refuses --dangerously-skip-permissions when running as
  // root (Anthropic's security policy) — common on WSL where users
  // default to root. The generic "re-auth the CLI" CTA misleads them
  // into wasted login attempts.
  if (
    message &&
    /dangerously-skip-permissions cannot be used with root\/sudo/i.test(message)
  ) {
    return (
      "Claude CLI refuses --dangerously-skip-permissions as root. " +
      "Run Code Council as a non-root user, or disable Claude voices in /connect."
    );
  }
  switch (kind) {
    case "quota_exhausted":
      return "Check your subscription dashboard or swap the account in COUNCIL_CODEX_HOME / Code Council settings.";
    case "stream_failure":
      return "Subprocess died mid-stream — check disk space and CLI version.";
    case "cli_failed":
    case "cli_error":
      return "Re-auth the CLI (codex/gemini/opencode login) and retry.";
    default:
      return undefined;
  }
}
