# Code Review Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove accidental AGY local artifacts, keep Code Review summary stats consistent with generated review artifacts, and clean up small review nits.

**Architecture:** Keep fixes narrowly scoped. Treat AGY files as local generated state via `.gitignore`, and reuse the existing `git()` helper plus `git diff --no-index` so untracked-file stats match the existing untracked diff artifact path. Avoid changing template semantics beyond the incomplete-template dedup guard.

**Tech Stack:** Next.js App Router, TypeScript, Fastify daemon routes, Git CLI, Vitest, ESLint.

---

## Review Triage

Accepted fixes:
- Remove `.antigravitycli/25ee0ce9-59ba-494d-99f3-fa7a3e687a96.json`, `.antigravitycli/8504342c-c9d0-48f3-a8fa-dbd092e39ebf.json`, and `agy_models_output.txt` from the worktree.
- Ignore future AGY local artifacts.
- Update `getCodeReviewContextData()` so worktree stats include untracked files, matching `resolveCodeReviewScope()`.
- Add focused coverage for untracked-file insertion counts.
- Remove misleading numbered section comments in `src/app/code-review/page.tsx`.
- Preserve malformed/incomplete reviewer slots without collapsing all missing-lineage slots to `:`.
- Clarify the `tests/template-adapter.test.ts` comment that currently overstates deterministic slot order.

Owner-decision assumption:
- Use the narrow ignore rule `.antigravitycli/` plus `agy_models_output.txt`. If the owner wants broader probe-output coverage, replace `agy_models_output.txt` with `*_models_output.txt` in Task 1.

## File Structure

- Modify `.gitignore`: project-local ignore rules for AGY transient files.
- Modify `src/lib/git-code-review-scope.ts`: add numstat parsing helpers and include untracked-file stats in worktree context.
- Modify `tests/git-code-review-scope.test.ts`: assert untracked files contribute insertion counts.
- Modify `src/app/code-review/page.tsx`: remove or de-number section comments.
- Modify `src/daemon/template-adapter.ts`: guard dedup for reviewer slots without a lineage.
- Modify `tests/template-adapter.test.ts`: add the missing-lineage dedup regression and clarify the existing comment.

---

### Task 1: Remove and Ignore AGY Local Artifacts

**Files:**
- Modify: `.gitignore`
- Remove from worktree: `.antigravitycli/25ee0ce9-59ba-494d-99f3-fa7a3e687a96.json`
- Remove from worktree: `.antigravitycli/8504342c-c9d0-48f3-a8fa-dbd092e39ebf.json`
- Remove from worktree: `agy_models_output.txt`

- [ ] **Step 1: Verify artifact state**

Run:

```bash
git status --short -- .antigravitycli agy_models_output.txt .gitignore
```

Expected: `.antigravitycli/` and `agy_models_output.txt` appear as untracked or modified local artifacts, not intentional source files.

- [ ] **Step 2: Remove local artifacts**

Run:

```bash
rm -rf .antigravitycli agy_models_output.txt
```

Expected: `git status --short -- .antigravitycli agy_models_output.txt` prints nothing after the ignore rule is added.

- [ ] **Step 3: Add the narrow ignore rule**

Edit `.gitignore` near the other local runtime sections and add:

```gitignore
# Local Antigravity CLI probes and per-run state.
.antigravitycli/
agy_models_output.txt
```

If the owner chooses the broader rule, use this instead:

```gitignore
# Local Antigravity CLI probes and per-run state.
.antigravitycli/
*_models_output.txt
```

- [ ] **Step 4: Verify ignored artifacts**

Run:

```bash
git check-ignore -v .antigravitycli/example.json agy_models_output.txt
git status --short -- .antigravitycli agy_models_output.txt .gitignore
```

Expected: `git check-ignore` points at the new `.gitignore` lines, and `git status` only shows `.gitignore`.

---

### Task 2: Count Untracked Files in Code Review Context Stats

**Files:**
- Modify: `src/lib/git-code-review-scope.ts`
- Test: `tests/git-code-review-scope.test.ts`

- [ ] **Step 1: Write the failing untracked-stats test**

Add this test under `describe('getCodeReviewContextData', ...)` in `tests/git-code-review-scope.test.ts`:

```ts
  it('counts untracked file insertions in worktree statistics', async () => {
    const repo = makeRepo();
    fs.writeFileSync(path.join(repo, 'new-file.ts'), 'hello\nworld\n');

    const data = await getCodeReviewContextData(repo);

    expect(data.error).toBeUndefined();
    expect(data.mode).toBe('worktree');
    expect(data.filesCount).toBe(1);
    expect(data.insertions).toBe(2);
    expect(data.deletions).toBe(0);
  });
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run:

```bash
npm run test -- tests/git-code-review-scope.test.ts
```

Expected before implementation: the new test fails because `insertions` is `0`.

- [ ] **Step 3: Add numstat helpers**

In `src/lib/git-code-review-scope.ts`, add these helpers near `untrackedDiff()`:

```ts
function parseNumstat(stdout: string): { insertions: number; deletions: number } {
  let insertions = 0;
  let deletions = 0;
  for (const line of stdout.split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 2) continue;
    const ins = Number.parseInt(parts[0], 10);
    const del = Number.parseInt(parts[1], 10);
    if (Number.isFinite(ins)) insertions += ins;
    if (Number.isFinite(del)) deletions += del;
  }
  return { insertions, deletions };
}

async function untrackedNumstat(repoRoot: string, file: string): Promise<string> {
  const nullPath = process.platform === 'win32' ? 'NUL' : '/dev/null';
  return git(repoRoot, ['diff', '--numstat', '--no-index', '--', nullPath, file]);
}
```

- [ ] **Step 4: Replace inline stats parsing in `getCodeReviewContextData()`**

Replace the current `// Run diff stats` block with:

```ts
    let insertions = 0;
    let deletions = 0;
    try {
      const statsStdout =
        mode === 'worktree'
          ? await (async () => {
              const trackedStats = await git(repoRoot, ['diff', '--numstat', 'HEAD', '--']);
              const tracked = await trackedFiles(repoRoot);
              const untracked = files.filter((file) => !tracked.has(file));
              const untrackedStats = await Promise.all(
                untracked.map((file) => untrackedNumstat(repoRoot, file)),
              );
              return [trackedStats, ...untrackedStats].filter(Boolean).join('\n');
            })()
          : await git(repoRoot, ['diff', '--numstat', `${baseRef}...HEAD`]);
      const parsedStats = parseNumstat(statsStdout);
      insertions = parsedStats.insertions;
      deletions = parsedStats.deletions;
    } catch {
      // ignore diff stats failures
    }
```

- [ ] **Step 5: Run the focused test and confirm pass**

Run:

```bash
npm run test -- tests/git-code-review-scope.test.ts
```

Expected: all `git-code-review-scope` tests pass.

---

### Task 3: Clean Up Code Review Page Section Comments

**Files:**
- Modify: `src/app/code-review/page.tsx`

- [ ] **Step 1: Remove misleading numbering**

In `src/app/code-review/page.tsx`, replace:

```tsx
        {/* 1. Repository & Branch Overview */}
```

with:

```tsx
        {/* Repository and branch overview */}
```

Replace:

```tsx
        {/* 2. Changes Summary Statistics */}
```

with:

```tsx
        {/* Changes summary statistics */}
```

Replace:

```tsx
        {/* 4. Reviewer Fleet */}
```

with:

```tsx
        {/* Reviewer fleet */}
```

- [ ] **Step 2: Verify no numbered section comments remain**

Run:

```bash
rg -n "\\{\\/\\* [0-9]+\\." src/app/code-review/page.tsx
```

Expected: no matches.

---

### Task 4: Preserve Missing-Lineage Reviewer Slots During Dedup

**Files:**
- Modify: `src/daemon/template-adapter.ts`
- Test: `tests/template-adapter.test.ts`

- [ ] **Step 1: Write the failing regression test**

Add this test under `describe('adaptTemplate — robustness', ...)` in `tests/template-adapter.test.ts`:

```ts
  it('does not collapse malformed reviewer slots that have no lineage', () => {
    const tpl = `id: malformed-reviewers
phases:
  - id: p
    kind: review
    reviewer:
      require: 1
      candidates:
        - models: []
        - models: []
`;
    const result = adaptTemplate(tpl, []);
    const parsed = yaml.parse(result.yaml);
    expect(parsed.phases[0].reviewer.candidates).toHaveLength(2);
  });
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run:

```bash
npm run test -- tests/template-adapter.test.ts
```

Expected before implementation: the new test fails because both malformed slots dedup to the same `:` key.

- [ ] **Step 3: Add the dedup guard**

In `src/daemon/template-adapter.ts`, update the reviewer candidate dedup filter from:

```ts
      const seen = new Set<string>();
      phase.reviewer.candidates = phase.reviewer.candidates.filter((slot) => {
        const key = `${slot.lineage ?? ''}:${(slot.models ?? []).join(',')}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
```

to:

```ts
      const seen = new Set<string>();
      phase.reviewer.candidates = phase.reviewer.candidates.filter((slot) => {
        if (!slot.lineage) return true;
        const key = `${slot.lineage}:${(slot.models ?? []).join(',')}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
```

- [ ] **Step 4: Clarify the diversity-substitution test comment**

In `tests/template-adapter.test.ts`, in the `swaps a missing-lineage slot to a different lineage not yet used in the phase` test, replace this comment block:

```ts
    // Slot 0 (openai): no match → fallback to google (unused) → google.
    // Slot 1 (google): exact match → google — same key as slot 0 → deduplicated out.
    // Slot 2 (moonshot): no match, google used → fallback to anthropic.
    // Result: 2 unique slots: google + anthropic.
```

with:

```ts
    // Slot 0 (openai): no match, so it takes the first unused enabled lineage.
    // Slot 1 (google): exact match wins when still present.
    // Slot 2 (moonshot): no match, so it takes the remaining enabled lineage or
    // dedups if it resolves to a model already assigned earlier.
    // Result: 2 unique reviewer slots, with google first and the second slot
    // allowed to be either enabled lineage depending on assignment order.
```

- [ ] **Step 5: Run the focused test and confirm pass**

Run:

```bash
npm run test -- tests/template-adapter.test.ts
```

Expected: all `template-adapter` tests pass.

---

### Task 5: Full Validation

**Files:**
- No source edits.

- [ ] **Step 1: Run the reviewer-requested focused tests**

Run:

```bash
npm run test -- tests/git-code-review-scope.test.ts tests/template-adapter.test.ts
```

Expected: both suites pass.

- [ ] **Step 2: Run the full test suite**

Run:

```bash
npm test
```

Expected: suite passes. If unrelated pre-existing failures appear, capture exact file/test names and error text before deciding whether they are in scope.

- [ ] **Step 3: Run lint**

Run:

```bash
npm run lint
```

Expected: no errors. Existing warnings may remain if they predate this plan; do not broaden scope to fix unrelated warnings.

- [ ] **Step 4: Review final diff**

Run:

```bash
git diff -- .gitignore src/lib/git-code-review-scope.ts tests/git-code-review-scope.test.ts src/app/code-review/page.tsx src/daemon/template-adapter.ts tests/template-adapter.test.ts
git status --short
```

Expected: only planned files are modified; AGY local artifacts are gone or ignored.

---

## Self-Review

Spec coverage:
- Accidental AGY artifacts: Task 1.
- Ignore owner decision: Task 1 with narrow default and broad alternative.
- Untracked-file stats mismatch: Task 2.
- Focused untracked insertion test: Task 2.
- Section numbering comment: Task 3.
- Missing-lineage dedup clarity: Task 4.
- Template-adapter test comment: Task 4.
- Requested validation commands: Task 5.

Placeholder scan:
- No task uses placeholder markers or deferred-work language.
- Each code-changing task includes exact files, concrete code snippets, and commands.

Type consistency:
- `parseNumstat()` and `untrackedNumstat()` are introduced before use.
- Existing helper names `git()`, `trackedFiles()`, and `uniqueSorted()` are reused without changing public API.
