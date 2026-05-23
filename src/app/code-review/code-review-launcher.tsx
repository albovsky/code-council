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
    <div className="relative">
      <button
        type="button"
        onClick={run}
        disabled={isStarting}
        className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground shadow-sm"
      >
        {isStarting ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <GitPullRequestArrow className="h-4 w-4" />
        )}
        {isStarting ? "Starting Review..." : "Start Review"}
      </button>
      {error && (
        <div className="absolute right-0 top-full z-50 mt-2 w-72 rounded-lg border border-destructive/40 bg-destructive/95 p-3 text-xs text-destructive shadow-lg backdrop-blur-md">
          {error}
        </div>
      )}
    </div>
  );
}
