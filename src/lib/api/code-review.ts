import type { Chat } from "@/lib/types";
import type { CodeReviewMode } from "@/lib/code-review-modes";
import { fetchFromDaemon } from "./client";
import { chatFromRow, type RawChatRow } from "./chats";

export interface CodeReviewScopeSummary {
  mode: "worktree" | "branch";
  repoRoot: string;
  baseRef?: string;
  headRef: string;
  files: string[];
  totalBytes: number;
}

export interface CodeReviewContext {
  repoPath: string;
  repoRoot?: string;
  headRef?: string;
  mode?: "worktree" | "branch";
  baseRef?: string;
  filesCount?: number;
  insertions?: number;
  deletions?: number;
  error?: {
    code?: string;
    message: string;
  };
}

export interface CodeReviewResult extends Chat {
  codeReview?: CodeReviewScopeSummary;
}

type RawCodeReviewResult = RawChatRow & {
  codeReview?: CodeReviewScopeSummary;
};

export async function getCodeReviewContext(): Promise<CodeReviewContext> {
  return fetchFromDaemon<CodeReviewContext>("/code-review/context");
}

export async function startCodeReview(
  repoPath?: string,
  mode?: CodeReviewMode,
): Promise<CodeReviewResult> {
  const row = await fetchFromDaemon<RawCodeReviewResult>("/code-review", {
    method: "POST",
    body: JSON.stringify({ repoPath, mode }),
  });
  return {
    ...chatFromRow(row),
    codeReview: row.codeReview,
  };
}
