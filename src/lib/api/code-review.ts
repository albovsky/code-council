import type { Chat } from "@/lib/types";
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
  reviewable?: boolean;
  error?: {
    code: string;
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

export async function startCodeReview(repoPath?: string): Promise<CodeReviewResult> {
  const row = await fetchFromDaemon<RawCodeReviewResult>("/code-review", {
    method: "POST",
    body: JSON.stringify({ repoPath }),
  });
  return {
    ...chatFromRow(row),
    codeReview: row.codeReview,
  };
}
