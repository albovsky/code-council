# One Button Code Review Triage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current template-first Chorus review entry point with a primary Code Review flow that reviews the current git changes, then synthesizes all reviewer feedback into the `gh-review-triage` format.

**Architecture:** Add a dedicated git-diff collection layer in the daemon, a `branch-code-review` review-only template with an optional synthesizer slot, and a post-review synthesis runner that reads reviewer answers and writes one consolidated triage artifact. Keep the existing template system intact for advanced flows, but make the home page and sidebar point at a single Code Review button.

**Tech Stack:** Next.js App Router, Fastify daemon routes, TypeScript, Node `child_process.execFile`, existing Chorus review-only runner, existing CLI shim/fallback infrastructure, Vitest.

---

## Investigation Summary

- The installed fork is `/private/tmp/chorus-agy`; `/opt/homebrew/lib/node_modules/chorus-codes` symlinks there.
- Current UI flow is template-first:
  - `src/app/page.tsx` renders "Start your first run" / "New chat" and template cards.
  - `src/app/new/page.tsx` asks the user to paste text and select a template.
- `chorus audit .` is the wrong substrate for branch review:
  - `src/lib/audit-pack.ts` reads source files and caps audits at `AUDIT_MAX_FILES = 50`.
  - It rejects unified diff artifacts because it expects source file extensions.
- Review-only chats already support pasted diffs:
  - `src/daemon/routes/chats.ts` accepts `artifact` for review-only templates.
  - `src/daemon/runner/review-only-phase.ts` writes the artifact as `round-1/doer-artifact/answer.md` and runs reviewers.
- Reviewer outputs already land on disk under `~/.chorus/chats/<chatId>/round-1/reviewer-*/answer.md`.
- The final behavior gap is orchestration:
  - Automatically collect the right git diff.
  - Run reviewers on that exact diff.
  - Run one synthesizer model over the reviewer answers.
  - Render the synthesizer output as the primary result in the existing `gh-review-triage` shape.

## Target User Flow

1. User opens Chorus.
2. Home page shows one primary button: `Code Review`.
3. Clicking it starts a review for the configured/current repository.
4. Backend decides review scope:
   - If the repo has staged, unstaged, or untracked changes: review those current worktree changes.
   - If the repo is clean: review current branch against `main` using `main...HEAD` or `origin/main...HEAD`.
5. Reviewers run on a single artifact containing the exact diff and file list.
6. One synthesizer model produces:

```markdown
**Valid**
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
- `...`
```

7. The run page shows the synthesized triage first, with raw reviewer cards below for auditability.

## File Structure

- Create `src/lib/git-code-review-scope.ts`
  - Pure git scope resolver and artifact builder.
  - Chooses worktree vs branch mode.
  - Produces a review artifact, file list, base ref, branch name, and user-facing title.
- Create `src/lib/gh-review-triage-format.ts`
  - Canonical synthesis prompt builder.
  - Parser that determines `approved` vs `request_changes` from the synthesized `**Valid**` block.
- Modify `src/lib/template-schema.ts`
  - Add optional `synthesizer` block to `ReviewOnlyPhaseSchema`.
  - Keep existing review-only one-phase restriction.
- Create `templates/branch-code-review.yaml`
  - Dedicated built-in template for this one-button flow.
  - Reviewers use connected fleet.
  - Synthesizer uses one model, defaulting to OpenAI/Codex lineage.
- Create `src/daemon/runner/triage-synthesis.ts`
  - Reads completed reviewer answers.
  - Builds the `gh-review-triage` prompt.
  - Runs one model through the existing headless shim path.
  - Writes `round-1/triage/answer.md` and stats.
- Modify `src/daemon/runner/review-only-phase.ts`
  - After reviewers finish, run `runTriageSynthesis()` when `phase.synthesizer` exists.
  - Return synthesized verdict summary to the outer runner.
- Modify `src/daemon/runner.ts`
  - Use synthesis verdict for review-only chats when present.
- Create `src/daemon/routes/code-review.ts`
  - `GET /code-review/context`: returns default repo path and detected git state.
  - `POST /code-review`: resolves git scope, creates a `branch-code-review` chat, and starts it.
- Modify `src/daemon/index.ts`
  - Register the new code-review route.
- Create `src/lib/api/code-review.ts`
  - Client wrapper for `/api/v1/code-review/context` and `/api/v1/code-review`.
- Modify `src/app/page.tsx`
  - Replace primary "new chat/template" flow with a single Code Review action.
  - Keep template browsing secondary.
- Create `src/app/code-review/code-review-launcher.tsx`
  - Client button that calls the new API and routes to `/runs/<slug-or-id>`.
  - Shows a compact repo path/status row and clear errors.
- Modify `src/components/app-sidebar.tsx`
  - Primary CTA becomes `Code Review`; New Chat becomes secondary or removed from primary nav.
- Modify `src/app/api/run-artifacts/[chatId]/route.ts`
  - Include triage artifact from `round-1/triage/answer.md`.
- Modify `src/components/run-viewer/types.ts`, `src/components/live-run-real/index.tsx`
  - Render a `Consolidated Triage` panel above reviewer cards when triage exists.
- Add tests:
  - `tests/git-code-review-scope.test.ts`
  - `tests/gh-review-triage-format.test.ts`
  - `tests/code-review-route.test.ts`
  - `tests/triage-synthesis.test.ts`
  - Update template schema tests for the new optional synthesizer block.

## Task 1: Git Review Scope Resolver

**Files:**
- Create: `src/lib/git-code-review-scope.ts`
- Create: `tests/git-code-review-scope.test.ts`

- [ ] **Step 1: Write tests for dirty worktree mode**

Create `tests/git-code-review-scope.test.ts` with tests using a temporary git repo:

```ts
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { describe, expect, it } from 'vitest';
import {
  resolveCodeReviewScope,
  CodeReviewScopeError,
} from '../src/lib/git-code-review-scope.js';

function sh(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();
}

function makeRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chorus-review-scope-'));
  sh(dir, ['init', '-b', 'main']);
  sh(dir, ['config', 'user.email', 'test@example.com']);
  sh(dir, ['config', 'user.name', 'Test User']);
  fs.writeFileSync(path.join(dir, 'app.ts'), 'export const value = 1;\n');
  sh(dir, ['add', 'app.ts']);
  sh(dir, ['commit', '-m', 'init']);
  return dir;
}

describe('resolveCodeReviewScope', () => {
  it('reviews staged, unstaged, and untracked worktree changes before branch diff', async () => {
    const repo = makeRepo();
    fs.writeFileSync(path.join(repo, 'app.ts'), 'export const value = 2;\n');
    fs.writeFileSync(path.join(repo, 'new-file.ts'), 'export const added = true;\n');

    const scope = await resolveCodeReviewScope(repo);

    expect(scope.mode).toBe('worktree');
    expect(scope.files).toEqual(['app.ts', 'new-file.ts']);
    expect(scope.artifact).toContain('# Code Review: worktree changes');
    expect(scope.artifact).toContain('diff --git a/app.ts b/app.ts');
    expect(scope.artifact).toContain('diff --git a/new-file.ts b/new-file.ts');
    expect(scope.baseRef).toBeUndefined();
  });
});
```

- [ ] **Step 2: Write tests for clean branch mode**

Append:

```ts
it('reviews current clean branch against main', async () => {
  const repo = makeRepo();
  sh(repo, ['checkout', '-b', 'feature/review-me']);
  fs.writeFileSync(path.join(repo, 'app.ts'), 'export const value = 3;\n');
  sh(repo, ['add', 'app.ts']);
  sh(repo, ['commit', '-m', 'change app']);

  const scope = await resolveCodeReviewScope(repo);

  expect(scope.mode).toBe('branch');
  expect(scope.baseRef).toBe('main');
  expect(scope.headRef).toBe('feature/review-me');
  expect(scope.files).toEqual(['app.ts']);
  expect(scope.artifact).toContain('# Code Review: feature/review-me against main');
  expect(scope.artifact).toContain('diff --git a/app.ts b/app.ts');
});
```

- [ ] **Step 3: Write tests for no-reviewable-changes and missing main**

Append:

```ts
it('throws a clear error when there are no worktree or branch changes', async () => {
  const repo = makeRepo();

  await expect(resolveCodeReviewScope(repo)).rejects.toMatchObject({
    code: 'no_changes',
  });
});

it('falls back to origin/main when local main is unavailable', async () => {
  const remote = makeRepo();
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'chorus-review-clone-'));
  sh(repo, ['clone', remote, '.']);
  sh(repo, ['checkout', '-b', 'feature/from-origin']);
  fs.writeFileSync(path.join(repo, 'app.ts'), 'export const value = 4;\n');
  sh(repo, ['add', 'app.ts']);
  sh(repo, ['commit', '-m', 'feature change']);
  sh(repo, ['branch', '-D', 'main']);

  const scope = await resolveCodeReviewScope(repo);

  expect(scope.mode).toBe('branch');
  expect(scope.baseRef).toBe('origin/main');
});
```

- [ ] **Step 4: Run tests to verify failure**

Run:

```bash
pnpm test tests/git-code-review-scope.test.ts
```

Expected: FAIL with module not found for `src/lib/git-code-review-scope.ts`.

- [ ] **Step 5: Implement the resolver**

Create `src/lib/git-code-review-scope.ts` with these exported APIs:

```ts
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execFileAsync = promisify(execFile);

export type CodeReviewScopeMode = 'worktree' | 'branch';

export interface CodeReviewScope {
  repoPath: string;
  repoRoot: string;
  mode: CodeReviewScopeMode;
  baseRef?: string;
  headRef: string;
  files: string[];
  artifact: string;
  title: string;
  totalBytes: number;
}

export class CodeReviewScopeError extends Error {
  constructor(
    readonly code:
      | 'not_git_repo'
      | 'no_changes'
      | 'base_ref_missing'
      | 'artifact_too_large'
      | 'git_failed',
    message: string,
  ) {
    super(message);
    this.name = 'CodeReviewScopeError';
  }
}

async function git(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      encoding: 'utf-8',
      maxBuffer: 8 * 1024 * 1024,
    });
    return stdout.trimEnd();
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; code?: number };
    if (args[0] === 'diff' && args.includes('--no-index') && e.code === 1) {
      return (e.stdout ?? '').trimEnd();
    }
    throw new CodeReviewScopeError(
      'git_failed',
      e.stderr?.trim() || `git ${args.join(' ')} failed`,
    );
  }
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) =>
    a.localeCompare(b),
  );
}

async function changedWorktreeFiles(repoRoot: string): Promise<string[]> {
  const unstagedAndStaged = await git(repoRoot, [
    'diff',
    '--name-only',
    '--diff-filter=ACMRTUXB',
    'HEAD',
    '--',
  ]);
  const untracked = await git(repoRoot, [
    'ls-files',
    '--others',
    '--exclude-standard',
  ]);
  return uniqueSorted([...unstagedAndStaged.split('\n'), ...untracked.split('\n')]);
}

async function resolveBaseRef(repoRoot: string): Promise<string> {
  for (const ref of ['main', 'origin/main', 'master', 'origin/master']) {
    try {
      await git(repoRoot, ['rev-parse', '--verify', `${ref}^{commit}`]);
      return ref;
    } catch {
      continue;
    }
  }
  throw new CodeReviewScopeError(
    'base_ref_missing',
    'Could not find main, origin/main, master, or origin/master for branch comparison.',
  );
}

async function untrackedDiff(repoRoot: string, file: string): Promise<string> {
  const nullPath = process.platform === 'win32' ? 'NUL' : '/dev/null';
  return git(repoRoot, ['diff', '--no-index', '--', nullPath, file]);
}

function heading(scope: {
  mode: CodeReviewScopeMode;
  repoRoot: string;
  headRef: string;
  baseRef?: string;
  files: string[];
}): string {
  const title =
    scope.mode === 'worktree'
      ? 'Code Review: worktree changes'
      : `Code Review: ${scope.headRef} against ${scope.baseRef}`;
  return [
    `# ${title}`,
    '',
    `Repository: \`${scope.repoRoot}\``,
    `Mode: \`${scope.mode}\``,
    `Branch: \`${scope.headRef}\``,
    scope.baseRef ? `Base: \`${scope.baseRef}\`` : undefined,
    '',
    `Changed files (${scope.files.length}):`,
    ...scope.files.map((f) => `- \`${f}\``),
    '',
    '---',
    '',
  ]
    .filter((line): line is string => line !== undefined)
    .join('\n');
}

export async function resolveCodeReviewScope(
  repoPath: string,
  options: { maxBytes?: number } = {},
): Promise<CodeReviewScope> {
  const resolved = path.resolve(repoPath);
  let repoRoot: string;
  try {
    repoRoot = await git(resolved, ['rev-parse', '--show-toplevel']);
  } catch {
    throw new CodeReviewScopeError('not_git_repo', `${resolved} is not a git repository.`);
  }

  const headRef =
    (await git(repoRoot, ['branch', '--show-current'])) ||
    (await git(repoRoot, ['rev-parse', '--short', 'HEAD']));
  const worktreeFiles = await changedWorktreeFiles(repoRoot);

  let mode: CodeReviewScopeMode;
  let baseRef: string | undefined;
  let files: string[];
  let diff: string;

  if (worktreeFiles.length > 0) {
    mode = 'worktree';
    files = worktreeFiles;
    const trackedDiff = await git(repoRoot, [
      'diff',
      '--binary',
      '--no-ext-diff',
      'HEAD',
      '--',
    ]);
    const tracked = new Set(
      (await git(repoRoot, ['ls-files'])).split('\n').filter(Boolean),
    );
    const untracked = files.filter((f) => !tracked.has(f));
    const untrackedBlocks = await Promise.all(
      untracked.map((file) => untrackedDiff(repoRoot, file)),
    );
    diff = [trackedDiff, ...untrackedBlocks].filter(Boolean).join('\n\n');
  } else {
    mode = 'branch';
    baseRef = await resolveBaseRef(repoRoot);
    const names = await git(repoRoot, [
      'diff',
      '--name-only',
      '--diff-filter=ACMRTUXB',
      `${baseRef}...HEAD`,
      '--',
    ]);
    files = uniqueSorted(names.split('\n'));
    if (files.length === 0) {
      throw new CodeReviewScopeError(
        'no_changes',
        `No worktree changes and no branch changes against ${baseRef}.`,
      );
    }
    diff = await git(repoRoot, [
      'diff',
      '--binary',
      '--no-ext-diff',
      `${baseRef}...HEAD`,
      '--',
    ]);
  }

  if (!diff.trim()) {
    throw new CodeReviewScopeError('no_changes', 'No reviewable diff was produced.');
  }

  const prefix = heading({ mode, repoRoot, headRef, baseRef, files });
  const artifact = `${prefix}${diff}\n`;
  const totalBytes = Buffer.byteLength(artifact, 'utf-8');
  const maxBytes = options.maxBytes ?? 1024 * 1024;
  if (totalBytes > maxBytes) {
    throw new CodeReviewScopeError(
      'artifact_too_large',
      `Code review diff is ${totalBytes} bytes; template limit is ${maxBytes} bytes. Split the branch or narrow the diff.`,
    );
  }

  return {
    repoPath: resolved,
    repoRoot,
    mode,
    baseRef,
    headRef,
    files,
    artifact,
    title:
      mode === 'worktree'
        ? `Review worktree changes in ${path.basename(repoRoot)}`
        : `Review ${headRef} against ${baseRef}`,
    totalBytes,
  };
}
```

- [ ] **Step 6: Run tests**

Run:

```bash
pnpm test tests/git-code-review-scope.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/git-code-review-scope.ts tests/git-code-review-scope.test.ts
git commit -m "feat: resolve git scope for code review"
```

## Task 2: Triage Prompt And Verdict Parser

**Files:**
- Create: `src/lib/gh-review-triage-format.ts`
- Create: `tests/gh-review-triage-format.test.ts`

- [ ] **Step 1: Write prompt/parser tests**

Create `tests/gh-review-triage-format.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  buildGhReviewTriagePrompt,
  verdictFromGhReviewTriage,
} from '../src/lib/gh-review-triage-format.js';

describe('gh-review-triage format', () => {
  it('builds the required section contract', () => {
    const prompt = buildGhReviewTriagePrompt({
      work: 'Review feature branch.',
      artifact: 'diff --git a/a.ts b/a.ts',
      reviewerOutputs: [
        { label: 'codex-cli-0', output: 'request changes: real bug' },
        { label: 'gemini-cli-1', output: 'approve' },
      ],
    });

    expect(prompt).toContain('**Valid**');
    expect(prompt).toContain('**Mostly Valid, Non-Blocking**');
    expect(prompt).toContain('**Noise**');
    expect(prompt).toContain('**Needs Owner Decision**');
    expect(prompt).toContain('**Fix Plan**');
    expect(prompt).toContain('**Validation**');
    expect(prompt).toContain('Classify each distinct reviewer concern');
  });

  it('requests changes when the Valid section has findings', () => {
    const verdict = verdictFromGhReviewTriage(`**Valid**
- \`src/a.ts:12\` - Real bug.

**Mostly Valid, Non-Blocking**
- None
`);
    expect(verdict).toBe('request_changes');
  });

  it('approves when the Valid section is empty or none', () => {
    expect(verdictFromGhReviewTriage(`**Valid**
- None

**Mostly Valid, Non-Blocking**
- One follow-up.
`)).toBe('approved');
  });
});
```

- [ ] **Step 2: Implement prompt/parser**

Create `src/lib/gh-review-triage-format.ts`:

```ts
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

export function buildGhReviewTriagePrompt(args: BuildGhReviewTriagePromptArgs): string {
  const reviewerBlocks = args.reviewerOutputs
    .map(
      (r) => `## Reviewer: ${r.label}

${r.output.trim() || '(empty output)'}`,
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

export function verdictFromGhReviewTriage(markdown: string): 'approved' | 'request_changes' {
  const validMatch = /\*\*Valid\*\*\s*([\s\S]*?)(?:\n\*\*Mostly Valid, Non-Blocking\*\*|\n\*\*Noise\*\*|\n\*\*Needs Owner Decision\*\*|\n\*\*Fix Plan\*\*|\n\*\*Validation\*\*|$)/i.exec(markdown);
  if (!validMatch) return 'request_changes';
  const body = validMatch[1].trim();
  if (!body) return 'approved';
  const normalized = body.toLowerCase();
  if (/^-?\s*(none|no valid concerns|no valid findings|nothing valid)\.?$/im.test(normalized)) {
    return 'approved';
  }
  return 'request_changes';
}
```

- [ ] **Step 3: Run tests**

Run:

```bash
pnpm test tests/gh-review-triage-format.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/gh-review-triage-format.ts tests/gh-review-triage-format.test.ts
git commit -m "feat: define review triage synthesis format"
```

## Task 3: Template Schema And Built-In Code Review Template

**Files:**
- Modify: `src/lib/template-schema.ts`
- Create: `templates/branch-code-review.yaml`
- Modify: `tests/template-schema.test.ts`

- [ ] **Step 1: Add schema tests**

Add a test to `tests/template-schema.test.ts` that parses a review-only phase with a synthesizer:

```ts
it('allows a review-only phase to declare one synthesizer voice', () => {
  const parsed = TemplateSchema.parse({
    id: 'branch-code-review',
    name: 'Code Review',
    description: 'Review current git changes and synthesize triage.',
    phases: [
      {
        id: 'review',
        kind: 'review_only',
        title: 'Code Review',
        reviewer: {
          require: 1,
          crossLineage: false,
          candidates: [{ lineage: 'openai', models: ['gpt-5.5'] }],
        },
        synthesizer: {
          lineage: 'openai',
          models: ['gpt-5.5'],
          format: 'gh-review-triage',
        },
      },
    ],
  });

  const phase = parsed.phases[0];
  expect(phase.kind).toBe('review_only');
  if (phase.kind === 'review_only') {
    expect(phase.synthesizer?.format).toBe('gh-review-triage');
  }
});
```

- [ ] **Step 2: Run schema test to verify failure**

Run:

```bash
pnpm test tests/template-schema.test.ts
```

Expected: FAIL because `synthesizer` is not currently part of `ReviewOnlyPhaseSchema`.

- [ ] **Step 3: Extend `ReviewOnlyPhaseSchema`**

In `src/lib/template-schema.ts`, add this object inside `ReviewOnlyPhaseSchema`:

```ts
synthesizer: z
  .object({
    lineage: reviewerLineageEnum,
    models: z.array(z.string()).min(1).optional(),
    format: z.literal('gh-review-triage').default('gh-review-triage'),
  })
  .optional(),
```

This keeps the existing one-phase review-only restriction unchanged.

- [ ] **Step 4: Add built-in template**

Create `templates/branch-code-review.yaml`:

```yaml
id: branch-code-review
name: Code Review
description: Review current git changes, then synthesize all reviewer feedback into Valid / Non-blocking / Noise / Owner Decision triage.
author: chorus
agreementThreshold: 0.66
onThresholdMet: ask
maxRounds: 1
yoloDefault: false
estimatedBaselineTokens: 700
ship:
  enabled: false
phases:
  - id: review
    kind: review_only
    title: Branch Code Review
    description: Reviewers critique the generated git diff independently; one synthesizer consolidates the feedback.
    reviewer:
      require: 2
      crossLineage: true
      candidates:
        - lineage: openai
          models:
            - gpt-5.5
        - lineage: google
          models:
            - gemini-3.5-flash
        - lineage: opencode
          models:
            - opencode-go/kimi-k2.6
        - lineage: opencode
          models:
            - opencode-go/deepseek-v4-flash
    synthesizer:
      lineage: openai
      models:
        - gpt-5.5
      format: gh-review-triage
    artifact:
      label: Git diff
      hint: Generated automatically from the current worktree or current branch against main.
      maxBytes: 1048576
    inputs:
      include: []
      exclude: []
fallback:
  reviewer:
    - lineage: anthropic
      models:
        - claude-sonnet-4-6
```

- [ ] **Step 5: Run schema tests**

Run:

```bash
pnpm test tests/template-schema.test.ts tests/template-adapter.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/template-schema.ts templates/branch-code-review.yaml tests/template-schema.test.ts
git commit -m "feat: add branch code review template"
```

## Task 4: Post-Review Triage Synthesis Runner

**Files:**
- Create: `src/daemon/runner/triage-synthesis.ts`
- Modify: `src/daemon/runner/review-only-phase.ts`
- Modify: `src/daemon/runner.ts`
- Create: `tests/triage-synthesis.test.ts`

- [ ] **Step 1: Write pure output collection tests**

Create `tests/triage-synthesis.test.ts`:

```ts
import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { collectReviewerOutputs } from '../src/daemon/runner/triage-synthesis.js';

describe('triage synthesis', () => {
  it('collects only completed reviewer answers and skips failures', () => {
    const chatDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chorus-triage-'));
    const roundDir = path.join(chatDir, 'round-1');
    fs.mkdirSync(path.join(roundDir, 'reviewer-codex-cli-0'), { recursive: true });
    fs.mkdirSync(path.join(roundDir, 'reviewer-opencode-cli-1'), { recursive: true });
    fs.writeFileSync(
      path.join(roundDir, 'reviewer-codex-cli-0', 'answer.md'),
      'request changes: real issue\n\n## DONE\n',
    );
    fs.writeFileSync(
      path.join(roundDir, 'reviewer-opencode-cli-1', 'answer.md'),
      '## REVIEWER FAILED\n\ncli_failed\n',
    );

    const outputs = collectReviewerOutputs(chatDir, 1);

    expect(outputs).toEqual([
      { label: 'reviewer-codex-cli-0', output: 'request changes: real issue' },
    ]);
  });
});
```

- [ ] **Step 2: Implement output collection and synthesis entry point**

Create `src/daemon/runner/triage-synthesis.ts` with:

```ts
import fs from 'fs';
import path from 'path';
import type { ReviewOnlyPhase, StandardPhase } from '../../lib/template-schema.js';
import {
  buildGhReviewTriagePrompt,
  verdictFromGhReviewTriage,
} from '../../lib/gh-review-triage-format.js';
import { pickShimForVoice } from '../agents/index.js';
import type { ErrorDetector } from '../error-detector.js';
import type { TmuxManager } from '../tmux-types.js';
import { runReviewerHeadless } from './reviewer.js';
import type { RunnerEvent } from './types.js';

export interface TriageSynthesisResult {
  completed: boolean;
  verdict: 'approved' | 'request_changes' | 'failed';
  answerFile?: string;
}

export function collectReviewerOutputs(
  chatDir: string,
  round: number,
): Array<{ label: string; output: string }> {
  const roundDir = path.join(chatDir, `round-${round}`);
  if (!fs.existsSync(roundDir)) return [];
  return fs
    .readdirSync(roundDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith('reviewer-'))
    .flatMap((d) => {
      const answerPath = path.join(roundDir, d.name, 'answer.md');
      if (!fs.existsSync(answerPath)) return [];
      const raw = fs.readFileSync(answerPath, 'utf-8');
      if (raw.startsWith('## REVIEWER FAILED')) return [];
      if (!/\n##\s*DONE\s*\n?$/i.test(raw.trimEnd())) return [];
      const output = raw.replace(/\n##\s*DONE\s*$/i, '').trim();
      if (!output) return [];
      return [{ label: d.name, output }];
    });
}

export async function runTriageSynthesis(args: {
  chatDir: string;
  chatId: string;
  phase: ReviewOnlyPhase;
  phaseIdx: number;
  round: number;
  artifact: string;
  work: string;
  tmuxMgr: TmuxManager;
  errorDetector: ErrorDetector;
  onEvent: (e: RunnerEvent) => void;
  abortSignal: AbortSignal;
}): Promise<TriageSynthesisResult> {
  const synth = args.phase.synthesizer;
  if (!synth) return { completed: true, verdict: 'approved' };

  const reviewerOutputs = collectReviewerOutputs(args.chatDir, args.round);
  if (reviewerOutputs.length === 0) {
    return { completed: false, verdict: 'failed' };
  }

  const roundDir = path.join(args.chatDir, `round-${args.round}`);
  const triageDir = path.join(roundDir, 'triage');
  fs.mkdirSync(triageDir, { recursive: true });
  const askFile = path.join(triageDir, 'ask.md');
  const answerFile = path.join(triageDir, 'answer.md');

  const prompt = buildGhReviewTriagePrompt({
    work: args.work,
    artifact: args.artifact,
    reviewerOutputs,
  });
  fs.writeFileSync(askFile, prompt);

  const shim = pickShimForVoice(synth.lineage, synth.models?.[0]);
  const standardPhase: StandardPhase = {
    id: `${args.phase.id}-triage`,
    kind: 'review',
    title: 'Consolidated Triage',
    description: 'Synthesize reviewer outputs into gh-review-triage format.',
    doer: { lineage: 'any' },
    reviewer: {
      require: 1,
      crossLineage: false,
      candidates: [{ lineage: synth.lineage, models: synth.models }],
    },
    inputs: { include: [], exclude: [] },
    iterate: {
      maxRounds: 1,
      onDisagreement: 'continue',
      shareSessionAcrossRounds: false,
      shareSessionAcrossPhases: false,
    },
    timeoutMs: args.phase.timeoutMs,
  };

  args.onEvent({
    chatId: args.chatId,
    type: 'phase_start',
    payload: {
      phaseId: standardPhase.id,
      phaseIdx: args.phaseIdx,
      kind: 'review',
      round: args.round,
      role: 'reviewer',
      agent: 'triage-0',
    },
    ts: Date.now(),
  });

  const result = await runReviewerHeadless({
    shim,
    chatId: args.chatId,
    phase: standardPhase,
    round: args.round,
    reviewerIdx: 0,
    candidateLineage: synth.lineage,
    candidateModel: synth.models?.[0],
    agentName: 'triage',
    askContent: prompt,
    answerFile,
    reviewerDir: triageDir,
    abortSignal: args.abortSignal,
    onEvent: args.onEvent,
  });

  if (result === null) return { completed: false, verdict: 'failed', answerFile };

  const answer = fs.existsSync(answerFile) ? fs.readFileSync(answerFile, 'utf-8') : '';
  return {
    completed: true,
    verdict: verdictFromGhReviewTriage(answer),
    answerFile,
  };
}
```

- [ ] **Step 3: Wire synthesis after reviewers**

In `src/daemon/runner/review-only-phase.ts`:

1. Import `runTriageSynthesis`.
2. Extend the return type with `triageVerdict?: 'approved' | 'request_changes' | 'failed'`.
3. After `runReviewers(...)`, call `runTriageSynthesis(...)` when `phase.synthesizer` exists.
4. Return `triageVerdict`.

- [ ] **Step 4: Use synthesis verdict in `runner.ts`**

Find the review-only branch in `src/daemon/runner.ts`. When `runReviewOnlyPhase()` returns a `triageVerdict`, use it as the chat-level `verdict`. Preserve `status='approved'` for completed runs and `status='failed'` only when all reviewers or synthesis failed.

- [ ] **Step 5: Run synthesis tests**

Run:

```bash
pnpm test tests/triage-synthesis.test.ts tests/runner-reviewer.test.ts tests/iterate-on-disagreement.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/daemon/runner/triage-synthesis.ts src/daemon/runner/review-only-phase.ts src/daemon/runner.ts tests/triage-synthesis.test.ts
git commit -m "feat: synthesize code review triage"
```

## Task 5: Daemon Code Review Route

**Files:**
- Create: `src/daemon/routes/code-review.ts`
- Modify: `src/daemon/index.ts`
- Create: `tests/code-review-route.test.ts`

- [ ] **Step 1: Write route behavior test**

Create `tests/code-review-route.test.ts` with a mocked resolver and chat create boundary. Follow existing Fastify route test patterns in `tests/voices-route-validation.test.ts`.

Test these cases:

```ts
it('creates a branch-code-review chat from resolved git scope', async () => {
  // POST /api/v1/code-review with { repoPath }
  // expects a 200 response with chat id, slug, mode, files, and title.
});

it('returns validation error when the repo has no changes', async () => {
  // mocked resolveCodeReviewScope throws CodeReviewScopeError('no_changes', ...)
  // expects ok:false and code "no_changes".
});
```

- [ ] **Step 2: Implement the route**

Create `src/daemon/routes/code-review.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { chats, templates } from '../../lib/db/index.js';
import {
  CodeReviewScopeError,
  resolveCodeReviewScope,
} from '../../lib/git-code-review-scope.js';
import { sendError, successResponse, type ApiResponse } from '../api-response.js';

const TEMPLATE_ID = 'branch-code-review';

export function registerCodeReviewRoutes(fastify: FastifyInstance): void {
  fastify.get<{ Reply: ApiResponse<object> }>('/code-review/context', async () => {
    const repoPath = process.env.CHORUS_REPO_PATH || process.cwd();
    return successResponse({ repoPath });
  });

  fastify.post<{
    Body: { repoPath?: string };
    Reply: ApiResponse<object>;
  }>('/code-review', async (request, reply) => {
    const repoPath = request.body.repoPath || process.env.CHORUS_REPO_PATH || process.cwd();
    const template = await templates.getById(TEMPLATE_ID);
    if (!template) {
      return sendError(
        reply,
        'template_missing',
        `Built-in template "${TEMPLATE_ID}" is missing. Run chorus init or restart the daemon after updating.`,
      );
    }

    try {
      const scope = await resolveCodeReviewScope(repoPath);
      const chat = await chats.create({
        work: [
          scope.title,
          '',
          'Review this git diff. At the end, synthesize reviewer feedback into Valid / Mostly Valid / Noise / Needs Owner Decision / Fix Plan / Validation.',
        ].join('\n'),
        template_id: TEMPLATE_ID,
        artifact: scope.artifact,
        attached_files: JSON.stringify(scope.files),
        status: 'drafting',
        current_phase_idx: 0,
        yolo: 0,
      });

      return successResponse({
        ...chat,
        codeReview: {
          mode: scope.mode,
          repoRoot: scope.repoRoot,
          baseRef: scope.baseRef,
          headRef: scope.headRef,
          files: scope.files,
          totalBytes: scope.totalBytes,
        },
      });
    } catch (error) {
      if (error instanceof CodeReviewScopeError) {
        return sendError(reply, error.code, error.message);
      }
      return sendError(
        reply,
        'code_review_failed',
        error instanceof Error ? error.message : String(error),
      );
    }
  });
}
```

- [ ] **Step 3: Ensure route starts the runner**

Match the existing `POST /chats` behavior: after `chats.create`, call the same runner-start function used by `src/daemon/routes/chats.ts`. If that function is not extracted, extract a small helper from `/chats` route:

```ts
async function fireChatRun(chatId: string): Promise<void> {
  queueMicrotask(() => {
    runWithMultiplex({ chatId, tmuxMgr, errorDetector }).catch((err) => {
      logger.error({ err, chatId }, 'code review run failed');
    });
  });
}
```

Use the helper from both `/chats` and `/code-review` to avoid divergent start behavior.

- [ ] **Step 4: Register the route**

In `src/daemon/index.ts`, import and call:

```ts
import { registerCodeReviewRoutes } from './routes/code-review.js';

registerCodeReviewRoutes(fastify);
```

- [ ] **Step 5: Run route tests**

Run:

```bash
pnpm test tests/code-review-route.test.ts tests/db.test.ts tests/cli-event-persistence.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/daemon/routes/code-review.ts src/daemon/index.ts tests/code-review-route.test.ts
git commit -m "feat: add code review daemon route"
```

## Task 6: One Button UI

**Files:**
- Create: `src/lib/api/code-review.ts`
- Create: `src/app/code-review/code-review-launcher.tsx`
- Modify: `src/app/page.tsx`
- Modify: `src/components/app-sidebar.tsx`

- [ ] **Step 1: Add client API wrapper**

Create `src/lib/api/code-review.ts`:

```ts
import { fetchFromDaemon } from './client';
import type { Chat } from '@/lib/types';
import { _testing as chatTesting } from './chats';

export interface CodeReviewContext {
  repoPath: string;
}

export interface CodeReviewResult extends Chat {
  codeReview?: {
    mode: 'worktree' | 'branch';
    repoRoot: string;
    baseRef?: string;
    headRef: string;
    files: string[];
    totalBytes: number;
  };
}

export async function getCodeReviewContext(): Promise<CodeReviewContext> {
  return fetchFromDaemon<CodeReviewContext>('/code-review/context');
}

export async function startCodeReview(repoPath?: string): Promise<CodeReviewResult> {
  const row = await fetchFromDaemon('/code-review', {
    method: 'POST',
    body: JSON.stringify({ repoPath }),
  });
  return chatTesting.fromRow(row as Parameters<typeof chatTesting.fromRow>[0]) as CodeReviewResult;
}
```

If the private `_testing.fromRow` type bridge is too awkward for production imports, extract `fromRow` from `src/lib/api/chats.ts` as an exported `chatFromRow` helper and use that instead.

- [ ] **Step 2: Add Code Review launcher component**

Create `src/app/code-review/code-review-launcher.tsx`:

```tsx
"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { GitPullRequestArrow, Loader2 } from "lucide-react";
import {
  getCodeReviewContext,
  startCodeReview,
} from "@/lib/api/code-review";
import { DaemonError } from "@/lib/api";

export function CodeReviewLauncher() {
  const router = useRouter();
  const [repoPath, setRepoPath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    getCodeReviewContext()
      .then((ctx) => setRepoPath(ctx.repoPath))
      .catch(() => setRepoPath(""));
  }, []);

  function run() {
    setError(null);
    startTransition(async () => {
      try {
        const chat = await startCodeReview(repoPath || undefined);
        router.push(`/runs/${chat.slug || chat.id}`);
      } catch (err) {
        setError(err instanceof DaemonError ? err.message : "Code review failed");
      }
    });
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
          disabled={isPending}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
        >
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitPullRequestArrow className="h-4 w-4" />}
          {isPending ? "Starting review..." : "Code Review"}
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
```

- [ ] **Step 3: Replace home primary action**

In `src/app/page.tsx`:

1. Import `CodeReviewLauncher`.
2. Replace the hero/link primary CTA with `<CodeReviewLauncher />`.
3. Keep `Browse templates` as a secondary link below the primary launcher.
4. Rename the template section heading to `Advanced templates`.

- [ ] **Step 4: Update sidebar CTA**

In `src/components/app-sidebar.tsx`, replace the `New chat` CTA href with:

```tsx
<Link
  href="/"
  onClick={onNavigate}
  aria-label="Code Review"
  className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground transition hover:bg-primary/90"
>
  <GitPullRequestArrow className="h-3.5 w-3.5" />
  <span>Code Review</span>
</Link>
```

Keep `/new` reachable through Templates for power users, but no longer make it the main path.

- [ ] **Step 5: Run UI type checks**

Run:

```bash
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/api/code-review.ts src/app/code-review/code-review-launcher.tsx src/app/page.tsx src/components/app-sidebar.tsx
git commit -m "feat: make code review the primary action"
```

## Task 7: Run Page Consolidated Triage Panel

**Files:**
- Modify: `src/app/api/run-artifacts/[chatId]/route.ts`
- Modify: `src/components/run-viewer/types.ts`
- Modify: `src/components/live-run-real/index.tsx`

- [ ] **Step 1: Extend artifact response**

In `src/app/api/run-artifacts/[chatId]/route.ts`, read `round-1/triage/answer.md`:

```ts
function readTriage(chatId: string): { hasAnswer: boolean; answer?: string } | null {
  const answerPath = path.join(
    os.homedir(),
    ".chorus",
    "chats",
    chatId,
    "round-1",
    "triage",
    "answer.md",
  );
  if (!fs.existsSync(answerPath)) return null;
  const answer = fs.readFileSync(answerPath, "utf-8");
  return {
    hasAnswer: /\n##\s*DONE\s*\n?$/i.test(answer.trimEnd()),
    answer,
  };
}
```

Return it:

```ts
return Response.json({ rounds, swaps, triage: readTriage(chatId) });
```

- [ ] **Step 2: Add client type**

In `src/components/run-viewer/types.ts`, add:

```ts
export interface TriageSnapshot {
  hasAnswer: boolean;
  answer?: string;
}
```

Add `triage?: TriageSnapshot | null` wherever the run artifact response is typed.

- [ ] **Step 3: Render triage above rounds**

In `src/components/live-run-real/index.tsx`:

1. Store `triage` in state from `/api/run-artifacts`.
2. Render above `RoundView`:

```tsx
{triage?.hasAnswer && triage.answer && (
  <section className="mb-6 rounded-lg border border-border bg-card p-4">
    <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      Consolidated Triage
    </div>
    <pre className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
      {triage.answer.replace(/\n##\s*DONE\s*$/i, "").trim()}
    </pre>
  </section>
)}
```

- [ ] **Step 4: Run typecheck**

Run:

```bash
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add 'src/app/api/run-artifacts/[chatId]/route.ts' src/components/run-viewer/types.ts src/components/live-run-real/index.tsx
git commit -m "feat: show consolidated review triage"
```

## Task 8: Validation And Manual Smoke

**Files:**
- Verify all changed files.

- [ ] **Step 1: Run focused tests**

Run:

```bash
pnpm test tests/git-code-review-scope.test.ts tests/gh-review-triage-format.test.ts tests/triage-synthesis.test.ts tests/code-review-route.test.ts tests/template-schema.test.ts tests/template-adapter.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full validation**

Run:

```bash
pnpm typecheck
pnpm lint
pnpm test
```

Expected: PASS.

- [ ] **Step 3: Build**

Run:

```bash
pnpm build
pnpm build:server
```

Expected: PASS.

- [ ] **Step 4: Manual smoke test with dirty worktree**

From a test repository:

```bash
echo "// smoke" >> smoke.ts
chorus stop
CHORUS_REPO_PATH="$PWD" chorus start
```

Open `http://127.0.0.1:5050`, click `Code Review`.

Expected:
- Run is created.
- Artifact heading says `Code Review: worktree changes`.
- Changed file list includes `smoke.ts`.
- Reviewer cards run.
- Consolidated triage appears above raw reviewer cards.

- [ ] **Step 5: Manual smoke test with clean feature branch**

From a clean feature branch with commits ahead of main:

```bash
git status --short
CHORUS_REPO_PATH="$PWD" chorus start
```

Click `Code Review`.

Expected:
- Artifact heading says `<branch> against main` or `<branch> against origin/main`.
- Changed file list matches `git diff --name-only main...HEAD`.

- [ ] **Step 6: Commit validation cleanup**

If any validation fixes were needed:

```bash
git add .
git commit -m "chore: validate one button code review"
```

## Self-Review

- Spec coverage: The plan covers the one main Code Review button, automatic dirty-worktree detection, clean-branch comparison against main, fleet review over changed files, and final synthesized `gh-review-triage` output.
- Scope control: The plan avoids rewriting the general template system. Advanced templates stay available, but the primary path becomes Code Review.
- Data flow: Browser never reads the filesystem. The daemon resolves git state and produces the artifact.
- Failure behavior: No changes, missing main, non-git repo, and artifact-too-large errors are explicit.
- Known product decision: `CHORUS_REPO_PATH` is the deterministic way to define "current worktree" for the browser. If unset, daemon `process.cwd()` is used. This avoids pretending a browser tab can know the user's shell cwd.
- Placeholder scan: No implementation step relies on TBD behavior; every new module has a defined API and validation path.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-20-one-button-code-review-triage.md`.

Two execution options:

1. Subagent-Driven (recommended) - dispatch a fresh subagent per task, review between tasks, fast iteration.
2. Inline Execution - execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints.

Which approach?
