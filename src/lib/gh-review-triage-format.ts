export interface ReviewerOutputForTriage {
  label: string;
  output: string;
}

export interface BuildGhReviewTriagePromptArgs {
  work: string;
  artifact: string;
  reviewerOutputs: ReviewerOutputForTriage[];
}

const REQUIRED_FORMAT = `**Valid**
- ...

**Mostly Valid, Non-Blocking**
- ...

**Noise**
- ...

**Needs Owner Decision**
- ...

**Fix Plan**
1. ...

**Validation**
- \`command\``;

export function buildGhReviewTriagePrompt(
  args: BuildGhReviewTriagePromptArgs,
): string {
  const reviewerBlocks = args.reviewerOutputs
    .map(
      (reviewer) => `## Reviewer: ${reviewer.label}

${reviewer.output.trim() || '(empty output)'}`,
    )
    .join('\n\n---\n\n');

  return `You are the final code-review triage editor.

Classify each distinct reviewer concern against the supplied diff.
Use the same operating standard as the gh-review-triage workflow:

- Valid: a discrete correctness, data-loss, security, build, runtime, test, or maintainability issue introduced by the diff.
- Mostly Valid, Non-Blocking: technically reasonable cleanup, but not required before merge.
- Noise: incorrect, already handled, stale, purely stylistic, duplicate, or not applicable to this codebase.
- Needs Owner Decision: product/schema/API behavior where the right answer depends on owner intent.

Rules:
- Do not invent findings that no reviewer raised unless the diff plainly proves a blocker.
- De-duplicate overlapping reviewer comments.
- Lead with file:line when a reviewer gives one; otherwise use the closest file path from the diff.
- Keep the output concise and actionable.
- Return exactly these sections:

${REQUIRED_FORMAT}

# Review Brief

${args.work}

# Reviewed Diff

\`\`\`diff
${args.artifact}
\`\`\`

# Reviewer Outputs

${reviewerBlocks}
`;
}

export function verdictFromGhReviewTriage(
  markdown: string,
): 'approved' | 'request_changes' {
  const validMatch =
    /\*\*Valid\*\*\s*([\s\S]*?)(?:\n\*\*Mostly Valid, Non-Blocking\*\*|\n\*\*Noise\*\*|\n\*\*Needs Owner Decision\*\*|\n\*\*Fix Plan\*\*|\n\*\*Validation\*\*|$)/i.exec(
      markdown,
    );
  if (!validMatch) return 'request_changes';

  const body = validMatch[1].trim();
  if (!body) return 'approved';
  const normalized = body.toLowerCase();
  if (/^-?\s*(none|no valid concerns|no valid findings|nothing valid)\.?$/im.test(normalized)) {
    return 'approved';
  }
  return 'request_changes';
}
