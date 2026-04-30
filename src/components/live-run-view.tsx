"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Pause,
  X,
  CheckCircle2,
  AlertTriangle,
  Eye,
  GitPullRequest,
  Sparkles,
  PartyPopper,
  ExternalLink,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ReviewerCard } from "@/components/reviewer-card";
import { SynthesisCard } from "@/components/synthesis-card";
import { DecisionPanel } from "@/components/decision-panel";
import { DriverPane } from "@/components/driver-pane";
import { PhaseStepper, type PhaseState } from "@/components/phase-stepper";
import { QuestionCard, type AgentQuestion } from "@/components/question-card";
import {
  ROUND_2_REVIEWERS,
  ROUND_2_SYNTHESIS,
  PR_REVIEWERS,
  PR_REVIEW_SYNTHESIS,
  type Project,
  type Reviewer,
  type SynthesizedAnswer,
  type Template,
  type TaskRun,
} from "@/lib/mock-data";

interface LiveRunViewProps {
  run: TaskRun;
  project: Project | undefined;
  template: Template | undefined;
}

type PlanSubState = "running" | "decision";
type ChatPhaseIdx = 0 | 1 | 2 | 3 | 4;
type RunControl = "active" | "paused" | "cancelled";
// 0 = Plan (active during plan/decision)
// 1 = Implement (DriverPane streaming)
// 2 = Open PR (CTA visible, awaiting click)
// 3 = PR review (reviewers stream the diff)
// 4 = Done (everything green)

export function LiveRunView({ run, project, template }: LiveRunViewProps) {
  // ── Phase 0 (Plan) state ──────────────────────────────────────────────
  const [round, setRound] = useState(1);
  const [reviewers, setReviewers] = useState<Reviewer[]>(run.reviewers);
  const [synthesis, setSynthesis] = useState<SynthesizedAnswer | undefined>(
    run.synthesis,
  );
  const [planSubState, setPlanSubState] = useState<PlanSubState>("running");
  const [synthesisVisible, setSynthesisVisible] = useState(false);
  const [round2Resumed, setRound2Resumed] = useState(false);
  const [question, setQuestion] = useState<AgentQuestion | null>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // ── Outer chat phase ──────────────────────────────────────────────────
  const [chatPhaseIdx, setChatPhaseIdx] = useState<ChatPhaseIdx>(0);

  // Pause / Cancel control state
  const [runControl, setRunControl] = useState<RunControl>("active");
  const [questionAnswerToast, setQuestionAnswerToast] = useState<string | null>(
    null,
  );

  // Live cost — climbs as work progresses (mock)
  const [spentUsd, setSpentUsd] = useState(0);

  // ── Phase 3 (PR review) state ─────────────────────────────────────────
  const [prReviewers, setPrReviewers] = useState<Reviewer[]>(
    PR_REVIEWERS.map((r) => ({ ...r })),
  );
  const [prSynthesis, setPrSynthesis] = useState<SynthesizedAnswer | undefined>();
  const [prSynthesisVisible, setPrSynthesisVisible] = useState(false);

  // Threshold info (with safe defaults if template doesn't carry these)
  const threshold = template?.agreementThreshold ?? "unanimous";
  const onMet = template?.onThresholdMet ?? "ask-user";
  const maxRounds = template?.maxRounds ?? 3;
  const costCap = template?.costCapUsd ?? 0;

  function clearAllTimers() {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  }

  // Live cost ticker — runs while work is active.
  useEffect(() => {
    if (runControl !== "active" || chatPhaseIdx >= 4) return;
    const id = setInterval(() => {
      setSpentUsd((prev) => {
        // Different burn rates per phase
        const burn =
          chatPhaseIdx === 0
            ? 0.012 // 3 reviewers in parallel
            : chatPhaseIdx === 1
              ? 0.018 // driver writing code
              : chatPhaseIdx === 3
                ? 0.010 // PR-review reviewers
                : 0; // PR phase = idle
        return Math.min(prev + burn, (costCap || 99) - 0.01);
      });
    }, 600);
    return () => clearInterval(id);
  }, [runControl, chatPhaseIdx, costCap]);

  // ─── Plan-phase round timelines ───────────────────────────────────────
  useEffect(() => {
    if (chatPhaseIdx !== 0) return; // only run while in Plan phase
    if (runControl !== "active") return; // paused or cancelled
    clearAllTimers();

    if (round === 1) {
      const t1 = setTimeout(() => {
        setReviewers((prev) =>
          prev.map((r) =>
            r.id === "r-codex"
              ? {
                  ...r,
                  state: "done",
                  bytes: 4180,
                  elapsedSeconds: 95,
                  verdict: "partial",
                  findingsCount: 2,
                }
              : r,
          ),
        );
      }, 5500);

      const t2 = setTimeout(() => {
        setReviewers((prev) =>
          prev.map((r) =>
            r.id === "r-gemini"
              ? { ...r, state: "done", bytes: 2710, elapsedSeconds: 109 }
              : r,
          ),
        );
      }, 11000);

      const t3 = setTimeout(() => setSynthesisVisible(true), 12500);
      const t4 = setTimeout(() => setPlanSubState("decision"), 13000);

      timersRef.current = [t1, t2, t3, t4];
    } else if (round === 2 && round2Resumed) {
      // Round-2 done timers only fire AFTER the user has answered the question.
      const t1 = setTimeout(() => {
        setReviewers((prev) =>
          prev.map((r) =>
            r.id === "r-codex"
              ? { ...r, state: "done", bytes: 1820, elapsedSeconds: 38 }
              : r,
          ),
        );
      }, 1300);

      const t2 = setTimeout(() => {
        setReviewers((prev) =>
          prev.map((r) =>
            r.id === "r-gemini"
              ? { ...r, state: "done", bytes: 1490, elapsedSeconds: 44 }
              : r,
          ),
        );
      }, 2700);

      const t3 = setTimeout(() => {
        setReviewers((prev) =>
          prev.map((r) =>
            r.id === "r-deepseek"
              ? { ...r, state: "done", bytes: 1610, elapsedSeconds: 49 }
              : r,
          ),
        );
      }, 3700);

      const t4 = setTimeout(() => {
        setSynthesis(ROUND_2_SYNTHESIS);
        setSynthesisVisible(true);
      }, 4400);

      const t5 = setTimeout(() => setPlanSubState("decision"), 4800);

      timersRef.current = [t1, t2, t3, t4, t5];
    }

    return clearAllTimers;
  }, [round, round2Resumed, chatPhaseIdx, runControl]);

  // Question schedule — round 2 only, fires at T+3.2s regardless of resume.
  useEffect(() => {
    if (chatPhaseIdx !== 0 || round !== 2) {
      setQuestion(null);
      return;
    }
    const t = setTimeout(() => {
      setQuestion({
        asker: "codex-1",
        askerKind: "reviewer",
        question:
          "Should the backfill respect existing soft-deleted rows, or skip them entirely?",
        options: [
          "Skip soft-deleted",
          "Include all rows",
          "Backfill into archive table",
        ],
      });
    }, 3200);
    return () => clearTimeout(t);
  }, [round, chatPhaseIdx]);

  function startRound2() {
    setSynthesisVisible(false);
    setSynthesis(undefined);
    setReviewers(ROUND_2_REVIEWERS.map((r) => ({ ...r })));
    setPlanSubState("running");
    setRound2Resumed(false);
    setQuestion(null);
    setRound(2);
  }

  function answerQuestion(answer: string) {
    // Show a brief confirmation chip before resuming work.
    setQuestionAnswerToast(answer);
    setQuestion(null);
    window.setTimeout(() => {
      setQuestionAnswerToast(null);
      setRound2Resumed(true);
    }, 1500);
  }

  function pauseRun() {
    setRunControl(runControl === "paused" ? "active" : "paused");
  }

  function cancelRun() {
    if (runControl === "cancelled") return;
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        "Cancel this run? Reviewers stop, partial output is kept, no further cost.",
      )
    )
      return;
    setRunControl("cancelled");
    clearAllTimers();
  }

  function acceptPlan() {
    setChatPhaseIdx(1); // Plan done → Implement active
  }

  function onDriverComplete() {
    setChatPhaseIdx(2); // Implement done → Open PR active
  }

  function openPR() {
    setChatPhaseIdx(3); // PR done → PR review starts
  }

  // PR-review timeline — fires when entering phase 3.
  useEffect(() => {
    if (chatPhaseIdx !== 3) return;
    const timers: ReturnType<typeof setTimeout>[] = [];

    timers.push(
      setTimeout(
        () =>
          setPrReviewers((prev) =>
            prev.map((r) =>
              r.id === "r-codex"
                ? { ...r, state: "done", bytes: 1140, elapsedSeconds: 28, verdict: "agree" }
                : r,
            ),
          ),
        3500,
      ),
    );
    timers.push(
      setTimeout(
        () =>
          setPrReviewers((prev) =>
            prev.map((r) =>
              r.id === "r-gemini"
                ? { ...r, state: "done", bytes: 1280, elapsedSeconds: 33, verdict: "agree" }
                : r,
            ),
          ),
        5000,
      ),
    );
    timers.push(
      setTimeout(
        () =>
          setPrReviewers((prev) =>
            prev.map((r) =>
              r.id === "r-deepseek"
                ? { ...r, state: "done", bytes: 1410, elapsedSeconds: 38, verdict: "agree" }
                : r,
            ),
          ),
        6300,
      ),
    );
    timers.push(
      setTimeout(() => {
        setPrSynthesis(PR_REVIEW_SYNTHESIS);
        setPrSynthesisVisible(true);
      }, 7000),
    );
    timers.push(setTimeout(() => setChatPhaseIdx(4), 7800));

    return () => timers.forEach(clearTimeout);
  }, [chatPhaseIdx]);

  // ─── Derived state ───────────────────────────────────────────────────
  const totalReviewers = reviewers.length;
  const doneReviewers = reviewers.filter((r) => r.state === "done").length;
  const erroredReviewers = reviewers.filter(
    (r) => r.state === "errored",
  ).length;
  const allDone = doneReviewers === totalReviewers;

  const agreedLineages =
    synthesis?.verdict === "agree"
      ? totalReviewers
      : synthesis?.verdict === "partial"
        ? Math.max(1, Math.floor(totalReviewers / 3))
        : 0;

  const tplPhases = template?.phases ?? [];
  const phaseStates: PhaseState[] = tplPhases.map((_, i) => {
    if (i < chatPhaseIdx) return "done";
    if (i === chatPhaseIdx) return "active";
    return "pending";
  });

  // Header status pill — uses LIZA-style mechanical state vocabulary.
  // DRAFTING (doer working) → SUBMITTED (waiting reviewer) → REVIEWING → APPROVED → MERGED.
  // REVISING when iterating after a reject. BLOCKED on user input.
  const headerStatus =
    chatPhaseIdx === 4
      ? { label: "MERGED · all phases approved", color: "emerald" }
      : chatPhaseIdx === 3
        ? { label: "REVIEWING · PR diff", color: "primary" }
        : chatPhaseIdx === 2
          ? { label: "APPROVED · awaiting PR", color: "amber" }
          : chatPhaseIdx === 1
            ? { label: "DRAFTING · driver writing", color: "primary" }
            : planSubState === "decision"
              ? { label: `SUBMITTED · awaiting verdict · round ${round}`, color: "amber" }
              : round === 2 && !round2Resumed
                ? { label: `BLOCKED · question pending · round ${round}`, color: "amber" }
                : { label: `REVIEWING · round ${round}`, color: "primary" };

  const headerColorMap: Record<string, string> = {
    primary: "text-primary bg-primary",
    amber: "text-amber-400 bg-amber-400",
    emerald: "text-emerald-400 bg-emerald-400",
  };

  // Overall progress: phases done / total phases
  const overallPct =
    tplPhases.length > 0
      ? Math.round(
          (chatPhaseIdx >= tplPhases.length
            ? tplPhases.length
            : chatPhaseIdx) /
            tplPhases.length *
            100,
        )
      : 0;

  return (
    <>
      {/* Sub-header */}
      <div className="border-b border-border bg-card/30 px-8 py-5">
        <div className="mx-auto flex max-w-6xl flex-col gap-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Link
              href={`/projects/${project?.id}`}
              className="flex items-center gap-1 transition hover:text-foreground"
            >
              <ArrowLeft className="h-3 w-3" />
              {project?.emoji} {project?.name}
            </Link>
            <span>/</span>
            <span className="font-mono text-[10px]">{run.id}</span>
          </div>

          <div className="flex items-start justify-between gap-6">
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span
                  className={`h-2 w-2 rounded-full ${headerColorMap[headerStatus.color].split(" ")[1]} ${
                    chatPhaseIdx < 4 ? "animate-pulse-soft" : ""
                  }`}
                />
                <span
                  className={`text-xs font-medium uppercase tracking-wider ${headerColorMap[headerStatus.color].split(" ")[0]}`}
                >
                  {headerStatus.label}
                </span>
                <Badge
                  variant="outline"
                  className="border-border font-mono text-[10px]"
                >
                  {template?.name}
                </Badge>
              </div>
              <h1 className="mt-2 text-xl font-semibold tracking-tight">
                {run.title}
              </h1>
              <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                {run.prompt}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                disabled={chatPhaseIdx >= 4 || runControl === "cancelled"}
                onClick={pauseRun}
                className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
                  runControl === "paused"
                    ? "border-amber-500/40 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20"
                    : "border-border bg-card text-muted-foreground hover:text-foreground"
                }`}
              >
                <Pause className="h-3.5 w-3.5" />
                {runControl === "paused" ? "Resume" : "Pause"}
              </button>
              <button
                type="button"
                disabled={chatPhaseIdx >= 4 || runControl === "cancelled"}
                onClick={cancelRun}
                className="flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:border-destructive/40 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-50"
              >
                <X className="h-3.5 w-3.5" />
                Cancel
              </button>
            </div>
          </div>

          {/* Overall progress strip — by phase */}
          <div className="flex items-center gap-4">
            <div className="flex flex-1 items-center gap-2">
              <div className="flex h-1 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className={`transition-[width] duration-700 ease-out ${
                    chatPhaseIdx === 4 ? "bg-emerald-400" : "bg-primary"
                  }`}
                  style={{ width: `${overallPct}%` }}
                />
              </div>
              <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                {Math.min(chatPhaseIdx, tplPhases.length)} / {tplPhases.length}{" "}
                phases
              </span>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
              {chatPhaseIdx === 0 && (
                <>
                  <span className="flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                    {doneReviewers} / {totalReviewers} reviewers
                  </span>
                  {erroredReviewers > 0 && (
                    <span className="flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3 text-destructive" />
                      {erroredReviewers} errored
                    </span>
                  )}
                  {!allDone && (
                    <span className="flex items-center gap-1">
                      <Eye className="h-3 w-3" />
                      watching
                    </span>
                  )}
                </>
              )}
              <span className="flex items-center gap-1">
                threshold:
                <span className="font-mono uppercase tracking-wide text-foreground/80">
                  {threshold}
                </span>
              </span>
              {/* Live cost meter */}
              {costCap > 0 && (
                <span
                  className={`flex items-center gap-1.5 font-mono ${
                    spentUsd > costCap * 0.8
                      ? "text-amber-300"
                      : spentUsd > costCap
                        ? "text-rose-300"
                        : "text-muted-foreground"
                  }`}
                  title={`${((spentUsd / costCap) * 100).toFixed(0)}% of cap used`}
                >
                  ${spentUsd.toFixed(3)} / ${costCap.toFixed(2)}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Phase stepper */}
      {tplPhases.length > 0 && (
        <div className="border-b border-border bg-card/15 px-8 py-3">
          <div className="mx-auto max-w-6xl">
            <PhaseStepper
              phases={tplPhases}
              activeIndex={Math.min(chatPhaseIdx, tplPhases.length - 1)}
              states={phaseStates}
              onSelect={(i) => {
                // Read-only jump to a done phase: scroll into the relevant section.
                if (i >= chatPhaseIdx) return;
                const targetId =
                  i === 0
                    ? "plan-evidence"
                    : i === 1
                      ? "implement-evidence"
                      : null;
                if (targetId) {
                  document
                    .getElementById(targetId)
                    ?.scrollIntoView({ behavior: "smooth", block: "start" });
                }
              }}
            />
          </div>
        </div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-8 py-8">
        <div className="mx-auto max-w-6xl">
          {/* Question from LLM — top of body during round 2 */}
          {question && chatPhaseIdx === 0 && (
            <QuestionCard q={question} onAnswer={answerQuestion} />
          )}

          {/* Brief confirmation chip after answer */}
          {questionAnswerToast && (
            <div className="mb-4 flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-4 py-2.5 text-xs text-emerald-200">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
              Answered:{" "}
              <span className="font-mono text-emerald-100">
                {questionAnswerToast}
              </span>
              <span className="ml-auto text-[10px] text-emerald-200/70">
                resuming reviewers…
              </span>
            </div>
          )}

          {/* Run-control banner */}
          {runControl === "paused" && (
            <div className="mb-4 flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-200">
              <Pause className="h-3.5 w-3.5" />
              Run paused · timers frozen, no cost accruing
              <button
                type="button"
                onClick={pauseRun}
                className="ml-auto rounded-md bg-amber-500/20 px-3 py-1 text-[11px] font-medium text-amber-100 transition hover:bg-amber-500/30"
              >
                Resume
              </button>
            </div>
          )}
          {runControl === "cancelled" && (
            <div className="mb-4 flex items-center gap-2 rounded-md border border-rose-500/40 bg-rose-500/10 px-4 py-2.5 text-xs text-rose-200">
              <X className="h-3.5 w-3.5" />
              Run cancelled · partial output preserved as evidence below.
              <Link
                href={`/projects/${project?.id}`}
                className="ml-auto rounded-md bg-rose-500/20 px-3 py-1 text-[11px] font-medium text-rose-100 transition hover:bg-rose-500/30"
              >
                Back to project →
              </Link>
            </div>
          )}

          {/* ── PHASE 4 — Done celebration ── */}
          {chatPhaseIdx === 4 && (
            <Card className="mb-6 overflow-hidden border-emerald-500/40 bg-gradient-to-br from-emerald-500/10 via-card to-card p-5">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-md bg-emerald-500/20 text-emerald-300">
                  <PartyPopper className="h-5 w-5" />
                </span>
                <div className="flex-1">
                  <h3 className="text-sm font-semibold text-emerald-200">
                    All 4 phases complete · ready to merge
                  </h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Plan agreed → Driver implemented → PR opened → 3-LLM
                    review approved. Merge button now live.
                  </p>
                </div>
                <a
                  href="#"
                  className="flex items-center gap-1.5 rounded-md bg-emerald-500/20 px-4 py-2 text-xs font-medium text-emerald-100 transition hover:bg-emerald-500/30"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  View PR #1421
                </a>
              </div>
            </Card>
          )}

          {/* ── PHASE 2 — Open PR CTA ── */}
          {chatPhaseIdx === 2 && (
            <Card className="mb-6 overflow-hidden border-primary/40 bg-gradient-to-br from-primary/10 via-card to-card p-0">
              <div className="flex items-start gap-4 px-5 py-4">
                <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-md bg-primary/20 text-primary">
                  <GitPullRequest className="h-5 w-5" />
                </span>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-foreground">
                      Implementation done · ready to open PR
                    </h3>
                    <Badge
                      variant="outline"
                      className="border-emerald-500/30 bg-emerald-500/10 font-mono text-[10px] text-emerald-300"
                    >
                      tests pass
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    4 files changed, +165 −6 LOC. Branch{" "}
                    <code className="font-mono text-foreground/80">
                      mm/aurora-pg17-migration
                    </code>{" "}
                    will open a PR against{" "}
                    <code className="font-mono text-foreground/80">main</code>.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={openPR}
                  className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-xs font-medium text-primary-foreground transition hover:bg-primary/90"
                >
                  <GitPullRequest className="h-3.5 w-3.5" />
                  Open pull request → main
                </button>
              </div>
            </Card>
          )}

          {/* ── PHASE 1 & 2 — Driver pane (still shown in 2 as evidence) ── */}
          {(chatPhaseIdx === 1 || chatPhaseIdx === 2) &&
            template?.driverHandoff !== false && (
              <DriverPane
                driver={template?.driver ?? "claude-code"}
                active={chatPhaseIdx === 1}
                onComplete={onDriverComplete}
              />
            )}

          {/* ── PHASE 0 — Decision panel ── */}
          {chatPhaseIdx === 0 && planSubState === "decision" && synthesis && (
            <DecisionPanel
              verdict={synthesis.verdict}
              threshold={threshold}
              onThresholdMet={onMet}
              agreedLineages={agreedLineages}
              totalLineages={totalReviewers}
              round={round}
              maxRounds={maxRounds}
              onRunNextRound={startRound2}
              onAccept={acceptPlan}
              autoFinalizeIn={null}
            />
          )}

          {/* ── PHASE 3 — PR-review reviewer cards ── */}
          {chatPhaseIdx >= 3 && (
            <div className="mb-6">
              <div className="mb-3 flex items-center gap-2">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                <span className="text-[10px] font-medium uppercase tracking-wider text-foreground">
                  PR review · 3 lineages on the diff
                </span>
                <Badge
                  variant="outline"
                  className="border-primary/30 bg-primary/10 font-mono text-[10px] text-primary"
                >
                  PR #1421
                </Badge>
                <span className="h-px flex-1 bg-border" />
              </div>

              {prSynthesis && (
                <SynthesisCard
                  synthesis={prSynthesis}
                  visible={prSynthesisVisible}
                />
              )}

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                {prReviewers.map((r) => (
                  <div key={`pr-${r.id}`} className="h-[420px]">
                    <ReviewerCard reviewer={r} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── PHASE 0 — Plan-phase synthesis (evidence after accept) ── */}
          {chatPhaseIdx === 0 && synthesis && (
            <SynthesisCard synthesis={synthesis} visible={synthesisVisible} />
          )}
          {chatPhaseIdx > 0 && synthesis && (
            <details
              id="plan-evidence"
              className="mb-4 mt-2 rounded-md border border-border bg-card/40 scroll-mt-32"
            >
              <summary className="cursor-pointer list-none px-4 py-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Plan-phase consensus · evidence ▾
              </summary>
              <div className="border-t border-border p-4">
                <SynthesisCard synthesis={synthesis} visible={true} />
              </div>
            </details>
          )}

          {/* ── PHASE 0 — Per-reviewer cards ── */}
          {chatPhaseIdx === 0 && (
            <>
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Round {round} · per-reviewer details
                </h2>
                {round > 1 && (
                  <Badge
                    variant="outline"
                    className="border-border font-mono text-[10px]"
                  >
                    {question
                      ? "paused on question"
                      : "converging on round 1 disagreement"}
                  </Badge>
                )}
              </div>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                {reviewers.map((r) => (
                  <div key={`${round}-${r.id}`} className="h-[480px]">
                    <ReviewerCard reviewer={r} />
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
