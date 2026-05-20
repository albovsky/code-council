"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { GitPullRequestArrow, Loader2 } from "lucide-react";
import { DaemonError } from "@/lib/api";
import {
  getCodeReviewContext,
  startCodeReview,
} from "@/lib/api/code-review";

export function CodeReviewLauncher() {
  const router = useRouter();
  const [repoPath, setRepoPath] = useState("");
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

  async function run() {
    setError(null);
    setIsStarting(true);
    try {
      const chat = await startCodeReview(repoPath || undefined);
      router.push(`/runs/${chat.slug || chat.id}`);
    } catch (err) {
      setError(err instanceof DaemonError ? err.message : "Code review failed");
    } finally {
      setIsStarting(false);
    }
  }

  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight">Code Review</h2>
          <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
            {repoPath || "No repository detected"}
          </p>
        </div>
        <button
          type="button"
          onClick={run}
          disabled={isStarting}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
        >
          {isStarting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <GitPullRequestArrow className="h-4 w-4" />
          )}
          {isStarting ? "Starting review..." : "Code Review"}
        </button>
      </div>
      {error && (
        <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
