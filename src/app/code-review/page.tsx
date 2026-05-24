import { AppShell } from "@/components/app-shell";
import { CodeReviewLauncher } from "./code-review-launcher";
import { CliStatusPanel } from "@/components/cli-status-panel";
import { DaemonError, getCodeReviewContext, type CodeReviewContext } from "@/lib/api";
import { cookies } from "next/headers";
import {
  CODE_REVIEW_MODE_COOKIE_NAME,
  parseCodeReviewModeSelection,
} from "@/lib/code-review-mode-selection";
import { FolderGit, GitBranch, FileCode, Plus, Minus, AlertCircle } from "lucide-react";

export const dynamic = "force-dynamic";

async function getCodeReviewPageContext(): Promise<CodeReviewContext> {
  try {
    return await getCodeReviewContext();
  } catch (err) {
    return {
      repoPath: "",
      error: {
        code: err instanceof DaemonError ? err.code : "unknown",
        message:
          err instanceof DaemonError
            ? err.message
            : "Failed to load code review context.",
      },
    };
  }
}

export default async function CodeReviewPage() {
  const context = await getCodeReviewPageContext();
  const cookieStore = await cookies();
  const initialMode = parseCodeReviewModeSelection(
    cookieStore.get(CODE_REVIEW_MODE_COOKIE_NAME)?.value,
  );
  const hasRepo = !context.error && !!context.repoRoot;

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8 md:px-8 md:py-10">
        <CodeReviewLauncher initialMode={initialMode} />

        {context.error ? (
          <section className="mb-8 flex items-center gap-3 rounded-xl border border-destructive/50 bg-destructive/10 p-6">
            <AlertCircle className="h-5 w-5 shrink-0 text-destructive" />
            <div>
              <p className="text-sm font-medium text-destructive">Code review unavailable</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {context.error.message}
                {context.error.code === "connection_failed" ? (
                  <>
                    {" "}
                    Start it with <code className="rounded bg-muted/40 px-1 py-0.5 font-mono text-[10px]">council start</code>.
                  </>
                ) : null}
              </p>
            </div>
          </section>
        ) : null}

        {/* Repository & Branch Overview */}
        {hasRepo ? (
          <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* Repository Info Card */}
            <div className="flex items-center gap-4 rounded-xl border border-border bg-card/45 p-4 shadow-sm">
              <div className="grid h-10 w-10 place-items-center rounded-lg bg-primary/10 text-primary">
                <FolderGit className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Active Repository</p>
                <p className="mt-0.5 truncate text-sm font-medium text-foreground">{context.repoRoot?.split("/").pop()}</p>
                <p className="truncate text-xs text-muted-foreground font-mono" title={context.repoRoot}>{context.repoRoot}</p>
              </div>
            </div>

            {/* Branch Info Card */}
            <div className="flex items-center gap-4 rounded-xl border border-border bg-card/45 p-4 shadow-sm">
              <div className="grid h-10 w-10 place-items-center rounded-lg bg-emerald-500/10 text-emerald-400">
                <GitBranch className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Current Branch</p>
                <p className="mt-0.5 truncate text-sm font-medium text-foreground font-mono">{context.headRef}</p>
                {context.baseRef && (
                  <p className="text-xs text-muted-foreground mt-0.5">Comparing against <code className="rounded bg-muted/40 px-1 py-0.5 font-mono text-[10px]">{context.baseRef}</code></p>
                )}
              </div>
            </div>
          </section>
        ) : null}

        {/* Changes Summary Statistics */}
        {hasRepo && context.filesCount !== undefined && context.filesCount > 0 ? (
          <section className="mb-8 rounded-xl border border-border bg-gradient-to-br from-primary/5 via-card to-card p-6">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">Changes Summary</h3>
            <div className="grid grid-cols-3 gap-4">
              {/* Files Modified */}
              <div className="flex flex-col">
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <FileCode className="h-4 w-4" />
                  <span className="text-[10px] font-semibold uppercase tracking-wider">Modified Files</span>
                </div>
                <p className="mt-2 text-2xl font-bold text-foreground">{context.filesCount}</p>
              </div>

              {/* Additions */}
              <div className="flex flex-col">
                <div className="flex items-center gap-1.5 text-emerald-400">
                  <Plus className="h-4 w-4" />
                  <span className="text-[10px] font-semibold uppercase tracking-wider">Lines Added</span>
                </div>
                <p className="mt-2 text-2xl font-bold text-emerald-400">+{context.insertions ?? 0}</p>
              </div>

              {/* Deletions */}
              <div className="flex flex-col">
                <div className="flex items-center gap-1.5 text-rose-400">
                  <Minus className="h-4 w-4" />
                  <span className="text-[10px] font-semibold uppercase tracking-wider">Lines Deleted</span>
                </div>
                <p className="mt-2 text-2xl font-bold text-rose-400">-{context.deletions ?? 0}</p>
              </div>
            </div>
          </section>
        ) : hasRepo ? (
          <section className="mb-8 rounded-xl border border-border bg-card/30 p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-amber-400 shrink-0" />
            <div className="text-sm text-muted-foreground">
              Your repository is clean. No modifications detected in the current worktree or branch.
            </div>
          </section>
        ) : null}

        {/* Reviewer Fleet */}
        <CliStatusPanel />
      </div>
    </AppShell>
  );
}
