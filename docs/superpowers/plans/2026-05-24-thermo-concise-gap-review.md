# Thermo Concise Gap Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Thermo into a concise implementation-gap and merge-risk reviewer that auto-detects Superpowers plans, keeps all review domains visible, and hides low-value reviewer noise from the default report.

**Architecture:** Add plan-contract detection to the git review scope so Thermo can review against a confidently detected `docs/superpowers/plans/*.md` file without user selection. Add `plan_completeness` as a first-class Thermo specialist domain, feed the detected plan to every reviewer/validator/synthesizer prompt, and rewrite the final synthesis contract around verdict, domain coverage, blockers, owner decisions, follow-ups, and verification. Keep raw reviewer outputs as the existing trace artifacts rather than repeating them in the final report.

**Tech Stack:** TypeScript, Fastify daemon routes, existing git diff scope collection, Thermo runner/prompts, Vitest.

---

## File Structure

- Modify `src/lib/git-code-review-scope.ts`
  - Owns automatic Superpowers plan detection for current worktree and current branch.
  - Returns a typed `planContract` on `CodeReviewScope`.
- Modify `src/daemon/routes/code-review.ts`
  - Threads the detected `planContract` into Thermo runner arguments and work text.
- Modify `src/lib/thermo-review-assignment.ts`
  - Adds the `plan_completeness` specialist domain and tighter security validator coverage.
- Modify `src/lib/thermo-run-types.ts`
  - Adds `plan_completeness` so sidecars and the Thermo board can render the new domain.
- Modify `src/daemon/runner/thermo-prompts.ts`
  - Adds a plan contract section to specialist, validation, synthesis, and audit prompts.
  - Replaces the noisy final report contract with the concise decision-grade contract.
- Modify `src/daemon/runner/thermo-code-review.ts`
  - Passes the plan contract to prompt builders.
  - Makes readiness blocking severity-aware.
  - Parses the new `Verdict:` line while preserving old report compatibility.
- Modify `src/components/run-viewer/thermo-domain-board.tsx`
  - Updates copy from six rows to seven domains.
- Test `tests/git-code-review-scope.test.ts`
  - Covers changed-worktree plan detection and branch-plan detection when dirty worktree changes exist.
- Test `tests/thermo-review-assignment.test.ts`
  - Covers the new `plan_completeness` domain and security no-self-validation coverage gap.
- Test `tests/thermo-prompts.test.ts`
  - Covers the concise final report contract and plan contract prompt protection.
- Test `tests/thermo-code-review.test.ts`
  - Covers plan contract propagation, new reviewer counts, new verdict parsing, and warning-only readiness degradation.
- Test `tests/code-review-route.test.ts`
  - Covers route-level plan contract threading into Thermo.

## Task 1: Plan Contract Detection

**Files:**
- Modify: `src/lib/git-code-review-scope.ts`
- Test: `tests/git-code-review-scope.test.ts`

- [x] **Step 1: Add failing tests**

Add tests that create `docs/superpowers/plans/*.md` files and assert:

```ts
expect(scope.planContract).toMatchObject({
  status: "matched",
  path: "docs/superpowers/plans/2026-05-24-example.md",
});
expect(scope.planContract?.status === "matched" ? scope.planContract.content : "")
  .toContain("**Goal:**");
```

Also add a branch test where the plan was committed on the current branch, then dirty worktree code changes exist; `resolveCodeReviewScope()` must still find the branch plan.

- [x] **Step 2: Run failing tests**

Run: `npm test -- tests/git-code-review-scope.test.ts`

Expected: FAIL because `planContract` does not exist yet.

- [x] **Step 3: Implement plan detection**

In `src/lib/git-code-review-scope.ts`, add:

```ts
export type CodeReviewPlanContract =
  | { status: "matched"; path: string; source: "review_scope" | "branch"; content: string }
  | { status: "ambiguous"; source: "review_scope" | "branch"; candidates: string[] }
  | { status: "not_found" };
```

Add a detector that prefers exactly one changed plan file in current scope, then exactly one changed plan file on the current branch. If multiple candidates exist, return `ambiguous`. If none exist, return `not_found`.

- [x] **Step 4: Run tests**

Run: `npm test -- tests/git-code-review-scope.test.ts`

Expected: PASS.

## Task 2: Thermo Plan Domain And Assignment Coverage

**Files:**
- Modify: `src/lib/thermo-review-assignment.ts`
- Modify: `src/lib/thermo-run-types.ts`
- Modify: `src/components/run-viewer/thermo-domain-board.tsx`
- Test: `tests/thermo-review-assignment.test.ts`

- [x] **Step 1: Add failing assignment tests**

Assert the current fleet includes:

```ts
plan_completeness: { primary: "gpt-5.5", validator: "opencode-go/deepseek-v4-pro" }
```

Add a one-model security test:

```ts
const plan = assignThermoReviewDomains({
  voices: [voice("gpt-5.5", { provider: "openai", lineage: "openai", vendor_family: "openai" })],
});
expect(plan.assignments.security.validator).toBeUndefined();
expect(plan.coverageGaps).toContainEqual({
  domain: "security",
  severity: "critical",
  message: "Security has no separate validator after skipped or unavailable models.",
});
```

- [x] **Step 2: Run failing tests**

Run: `npm test -- tests/thermo-review-assignment.test.ts`

Expected: FAIL because the domain and security coverage behavior are missing.

- [x] **Step 3: Implement assignment changes**

Add `plan_completeness` to `ThermoDomain`, `THERMO_REVIEW_DOMAINS`, target assignments, validator policy, validator reason, and sidecar domain parsing. Use A- minimum selection logic like architecture. For security, remove `?? primary` fallback and make missing security validator coverage critical.

- [x] **Step 4: Run tests**

Run: `npm test -- tests/thermo-review-assignment.test.ts`

Expected: PASS.

## Task 3: Concise Thermo Prompt Contract

**Files:**
- Modify: `src/daemon/runner/thermo-prompts.ts`
- Test: `tests/thermo-prompts.test.ts`

- [x] **Step 1: Add failing prompt tests**

Assert synthesis prompts include:

```md
Verdict: safe_to_merge | changes_requested | owner_decision_needed | human_review_required | no_verdict
Run Health: complete | degraded | failed
## Domain Coverage
## Blockers
## Owner Decisions
## Follow-Ups
## Verification
```

Assert they do not ask for `Mostly Valid`, `Noise`, `Coverage Gaps`, or long `Validation` sections in the default report. Assert plan content is delimited as data and the prompt says not to create plan-completeness findings when no plan is matched.

- [x] **Step 2: Run failing tests**

Run: `npm test -- tests/thermo-prompts.test.ts`

Expected: FAIL because the old verbose contract is still present.

- [x] **Step 3: Implement prompt changes**

Add a plan contract formatter and thread it into phase one, validation, synthesis, and audit prompts. Rewrite final synthesis admission rules to require dedupe by root cause, omission of low-impact valid findings, stronger security evidence, concrete-risk-only test findings, and hidden reviewer provenance.

- [x] **Step 4: Run tests**

Run: `npm test -- tests/thermo-prompts.test.ts`

Expected: PASS.

## Task 4: Runner Threading And Verdict Semantics

**Files:**
- Modify: `src/daemon/runner/thermo-code-review.ts`
- Modify: `src/daemon/routes/code-review.ts`
- Test: `tests/thermo-code-review.test.ts`
- Test: `tests/code-review-route.test.ts`

- [x] **Step 1: Add failing runner/route tests**

Add a runner test that passes a matched plan contract and asserts final synthesis ask content contains the plan path and plan body. Update counts from six specialist domains to seven.

Add verdict parsing assertions:

```ts
expect(finalReport({ verdict: "safe_to_merge" })).to map to "approved";
expect(finalReport({ verdict: "owner_decision_needed" })).to map to "request_changes";
```

Add a warning-only readiness test where docs validation is missing and final synthesis still starts.

Add a route test that mocked `resolveCodeReviewScope()` returns `planContract`, and assert `runThermoCodeReview()` receives it.

- [x] **Step 2: Run failing tests**

Run: `npm test -- tests/thermo-code-review.test.ts tests/code-review-route.test.ts`

Expected: FAIL because runner args and synthesis behavior do not handle the new plan contract/contract yet.

- [x] **Step 3: Implement runner and route changes**

Add `planContract` to Thermo runner args, pass it to all prompt builders, include it in Thermo work text, make readiness blocking use only critical gaps, and update `verdictFromFinalReport()` to parse the new `Verdict:` line while preserving old `Valid Blocking` behavior.

- [x] **Step 4: Run tests**

Run: `npm test -- tests/thermo-code-review.test.ts tests/code-review-route.test.ts`

Expected: PASS.

## Task 5: Final Verification

**Files:**
- No additional source files.

- [x] **Step 1: Run focused Thermo tests**

Run:

```bash
npm test -- tests/git-code-review-scope.test.ts tests/thermo-review-assignment.test.ts tests/thermo-prompts.test.ts tests/thermo-code-review.test.ts tests/code-review-route.test.ts
```

Expected: PASS.

- [x] **Step 2: Run typecheck**

Run: `npm run typecheck`

Expected: PASS.

## Self-Review

- Spec coverage: plan auto-detection, regular-review fallback, seven domains including docs, concise report contract, dedupe/admission guidance, hidden trace, severity-aware degradation, and security self-validation are covered.
- Placeholder scan: no TBD/TODO/implement-later instructions remain.
- Type consistency: `CodeReviewPlanContract` is owned by `git-code-review-scope.ts`; prompt builders receive that exact type; Thermo domains include `plan_completeness` in both assignment and run sidecar types.
