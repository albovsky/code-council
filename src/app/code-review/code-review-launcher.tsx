"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Flame,
  GitPullRequestArrow,
  Loader2,
  SearchCheck,
  ShieldCheck,
  Sparkles,
  UsersRound,
  Zap,
} from "lucide-react";
import { DaemonError } from "@/lib/api";
import {
  getCodeReviewContext,
  startCodeReview,
} from "@/lib/api/code-review";
import { getSettings } from "@/lib/api/settings";
import {
  CODE_REVIEW_MODE_LABELS,
  CODE_REVIEW_MODES,
  DEFAULT_CODE_REVIEW_MODE,
  isCodeReviewMode,
  type CodeReviewMode,
} from "@/lib/code-review-modes";
import {
  CODE_REVIEW_DISABLED_VOICE_IDS_SETTING_KEY,
  readDisabledCodeReviewVoiceIds,
} from "@/lib/code-review-agent-selection";
import {
  writeCodeReviewModeSelection,
} from "@/lib/code-review-mode-selection";
import type { Settings } from "@/lib/types";

export const MODE_META = {
  fast: {
    Icon: Zap,
    tone: "text-sky-400",
    steps: [
      { label: "Capture diff", detail: "worktree scope" },
      { label: "Spawn reviewers", detail: "one pass" },
      { label: "Triage", detail: "merged report" },
    ],
  },
  thermo: {
    Icon: Flame,
    tone: "text-orange-400",
    steps: [
      { label: "Select tiers", detail: "ranked fleet" },
      { label: "Specialists", detail: "7 domains" },
      { label: "Validate", detail: "cross-check notes" },
      { label: "Synthesize", detail: "strict final review" },
    ],
  },
} satisfies Record<
  CodeReviewMode,
  {
    Icon: typeof Zap;
    tone: string;
    steps: Array<{ label: string; detail: string }>;
  }
>;

const STEP_ICONS = [SearchCheck, UsersRound, ShieldCheck, Sparkles] as const;

export function normalizeCodeReviewMode(mode: unknown): CodeReviewMode {
  return isCodeReviewMode(mode) ? mode : DEFAULT_CODE_REVIEW_MODE;
}

export function CodeReviewLauncher({
  initialMode,
}: {
  initialMode: CodeReviewMode;
}) {
  const router = useRouter();
  const [repoPath, setRepoPath] = useState("");
  const [mode, setMode] = useState<CodeReviewMode>(() =>
    normalizeCodeReviewMode(initialMode),
  );
  const [error, setError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);

  useEffect(() => {
    getCodeReviewContext()
      .then((ctx) => {
        setRepoPath(ctx.repoPath);
        if (ctx.error) setError(ctx.error.message);
      })
      .catch(() => setRepoPath(""));
  }, []);

  function selectMode(nextMode: CodeReviewMode) {
    const safeMode = normalizeCodeReviewMode(nextMode);
    setMode(safeMode);
    writeCodeReviewModeSelection(safeMode);
  }

  async function run() {
    setError(null);
    setIsStarting(true);
    try {
      let skippedVoiceIds = readDisabledCodeReviewVoiceIds();
      try {
        const settings = await getSettings();
        const serverSkipped =
          settings[CODE_REVIEW_DISABLED_VOICE_IDS_SETTING_KEY as keyof Settings];
        if (Array.isArray(serverSkipped)) {
          skippedVoiceIds = serverSkipped.filter(
            (item): item is string => typeof item === "string",
          );
        }
      } catch {
        /* local state is good enough if settings cannot be loaded */
      }
      const chat = await startCodeReview(
        repoPath || undefined,
        normalizeCodeReviewMode(mode),
        skippedVoiceIds,
      );
      router.push(`/runs/${chat.slug || chat.id}`);
    } catch (err) {
      setError(err instanceof DaemonError ? err.message : "Code review failed");
    } finally {
      setIsStarting(false);
    }
  }

  const activeModeKey = normalizeCodeReviewMode(mode);
  const activeMode = MODE_META[activeModeKey];

  return (
    <header className="relative mb-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Review
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            Code Review
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Review the current worktree, or compare the current branch against main.
          </p>
        </div>
        <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
          <div className="inline-flex h-10 w-fit rounded-md border border-border bg-muted/40 p-1">
            {CODE_REVIEW_MODES.map((reviewMode) => {
              const { Icon, tone } = MODE_META[reviewMode];
              return (
                <button
                  key={reviewMode}
                  type="button"
                  onClick={() => selectMode(reviewMode)}
                  disabled={isStarting}
                  className={`inline-flex min-w-20 items-center justify-center gap-1.5 rounded-sm px-3 text-sm font-medium transition disabled:cursor-not-allowed ${
                    activeModeKey === reviewMode
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  aria-pressed={activeModeKey === reviewMode}
                >
                  <Icon className={`h-3.5 w-3.5 ${activeModeKey === reviewMode ? tone : ""}`} />
                  {CODE_REVIEW_MODE_LABELS[reviewMode]}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={run}
            disabled={isStarting}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
          >
            {isStarting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <GitPullRequestArrow className="h-4 w-4" />
            )}
            {isStarting ? "Starting Review..." : "Start Review"}
          </button>
        </div>
      </div>
      <div className="mt-6 rounded-md border border-border bg-card/45 px-3 py-2 shadow-sm">
        <div
          className={`grid gap-1.5 ${
            activeMode.steps.length === 4 ? "sm:grid-cols-4" : "sm:grid-cols-3"
          }`}
        >
          {activeMode.steps.map((step, index) => {
            const StepIcon = STEP_ICONS[index] ?? SearchCheck;
            return (
              <div
                key={step.label}
                className="relative flex min-w-0 items-center gap-2 rounded-sm px-1 py-0.5"
              >
                {index < activeMode.steps.length - 1 ? (
                  <ArrowRight className="absolute -right-1 top-1/2 hidden h-3 w-3 -translate-y-1/2 text-muted-foreground/45 sm:block" />
                ) : null}
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md border border-border bg-background/80 text-muted-foreground">
                  <StepIcon className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[11px] font-medium leading-none text-foreground">
                    {step.label}
                  </span>
                  <span className="mt-1 block truncate text-[10px] leading-none text-muted-foreground">
                    {step.detail}
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      </div>
      {error && (
        <div className="absolute right-0 top-full z-50 mt-2 w-72 rounded-lg border border-destructive/40 bg-destructive/95 p-3 text-xs text-destructive shadow-lg backdrop-blur-md">
          {error}
        </div>
      )}
    </header>
  );
}
