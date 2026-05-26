# Thermo Review Blockers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve the Thermo final-synthesis blockers around domain drift, readiness severity, unreadable plan contracts, verdict coverage, and operator-facing copy.

**Architecture:** Make `src/lib/thermo-run-types.ts` the single source of truth for Thermo domains, domain checks, labels, and criticality rules. The runner, assignment engine, and artifact reader should import from that shared module instead of each maintaining domain lists or check-copy switches. Plan-contract read failures should become explicit review-scope failures rather than silently degrading to `not_found`.

**Tech Stack:** TypeScript, Fastify daemon routes, Next.js 16 App Router, Vitest, existing Thermo runner and review-assignment modules.

---

## Pending User Decisions

Answer these before execution.

1. **ThermoDomain consolidation scope:** Should this PR consolidate the domain source of truth now?
   - Recommended: **Yes.** The blocker is real because the new `plan_completeness` domain already depends on keeping three lists in sync.
   - Alternative: defer consolidation and only patch severity. This leaves the most likely future drift intact.

2. **`adversarial_noise` handling:** Should `adversarial_noise` be removed from the canonical `ThermoDomain` union?
   - Recommended: **Yes, but keep it as a legacy input alias** in `thermo-run-artifacts.ts` that maps old artifacts to `final_synthesis`.
   - Alternative: keep `adversarial_noise` canonical. This preserves old labels but contradicts the current seven-domain runtime.

3. **Unreadable plan contract behavior:** What should happen when a changed plan file is detected but cannot be read?
   - Recommended: **Fail scope resolution with `plan_contract_unreadable`** and return a clear 400 validation error from `/code-review`.
   - Alternative: add a new `CodeReviewPlanContract` status such as `read_error`. This avoids request failure but expands the public contract and still allows review to proceed without plan checking.

4. **Operator docs:** Should the visible Thermo behavior changes get a migration note in this PR?
   - Recommended: **Yes, add a short `docs/superpowers/migrations/thermo-7-domain-review.md`.**
   - Alternative: defer docs as a follow-up. This keeps the code PR tighter but leaves operators without a handoff for seven domains, `Verdict:` values, and skipped/not-run states.

## File Structure

- Modify `src/lib/thermo-run-types.ts`
  - Own canonical Thermo domains, specialist domains, system domains, assignment domains, labels, domain check text, and criticality helpers.
- Modify `src/lib/thermo-review-assignment.ts`
  - Import `ThermoDomain`, `THERMO_REVIEW_DOMAINS`, `thermoDomainLabel`, and criticality helpers from `thermo-run-types.ts`.
  - Optionally accept `planContractMatched` so assignment coverage gaps can classify missing `plan_completeness` as critical when a plan is matched.
- Modify `src/daemon/runner/thermo-code-review.ts`
  - Replace local `SPECIALIST_DOMAINS` and `domainScope()` with shared constants/helpers.
  - Classify readiness gaps through the shared criticality helper.
  - Treat missing explicit `Verdict:` in the new concise report shape as `request_changes`.
- Modify `src/lib/server/thermo-run-artifacts.ts`
  - Replace `legacyDomainCheck()` with `thermoDomainCheck()`.
  - Keep legacy parser compatibility for old `adversarial_noise` outputs without keeping it canonical.
- Modify `src/lib/git-code-review-scope.ts`
  - Fail loudly on non-ENOENT plan read errors using `CodeReviewScopeError`.
- Modify `src/daemon/routes/code-review.ts`
  - Pass `scope.planContract.status === 'matched'` into assignment, if decision 3 uses the fail-fast path.
  - Map `plan_contract_unreadable` to a clear user-facing validation response.
- Modify `src/app/code-review/code-review-launcher.tsx`
  - Replace stale Thermo step copy `"security, tests, perf"` with seven-domain-safe copy.
- Optional create `docs/superpowers/migrations/thermo-7-domain-review.md`
  - Explain the new seven-domain Thermo workflow, concise verdict line, and skipped/not-run UI states.
- Test `tests/thermo-review-assignment.test.ts`
  - Domain-list parity, no canonical `adversarial_noise`, critical plan-completeness gaps when a plan is matched.
- Test `tests/thermo-run-artifacts.test.ts`
  - Shared check copy and legacy `adversarial_noise` compatibility.
- Test `tests/thermo-code-review.test.ts`
  - Readiness severity edge cases and concise verdict parsing.
- Test `tests/git-code-review-scope.test.ts`
  - Unreadable matched plan files fail explicitly.
- Test `tests/code-review-route.test.ts`
  - Route threads matched-plan state into Thermo assignments and returns a clear error for unreadable plans, if route-level behavior is chosen.
- Test `tests/code-review-launcher.test.ts`
  - Launcher copy reflects actual Thermo coverage.

---

### Task 1: Canonical Thermo Domains

**Files:**
- Modify: `src/lib/thermo-run-types.ts`
- Modify: `src/lib/thermo-review-assignment.ts`
- Modify: `src/daemon/runner/thermo-code-review.ts`
- Modify: `src/lib/server/thermo-run-artifacts.ts`
- Test: `tests/thermo-review-assignment.test.ts`
- Test: `tests/thermo-run-artifacts.test.ts`

- [ ] **Step 1: Write failing domain parity tests**

Add this import to `tests/thermo-review-assignment.test.ts`:

```ts
import {
  THERMO_REVIEW_DOMAINS as CANONICAL_THERMO_REVIEW_DOMAINS,
  THERMO_SPECIALIST_DOMAINS,
} from '@/lib/thermo-run-types';
```

Add these tests inside `describe('assignThermoReviewDomains', () => { ... })`:

```ts
  it('uses the canonical Thermo assignment domain list', () => {
    expect(THERMO_REVIEW_DOMAINS).toEqual(CANONICAL_THERMO_REVIEW_DOMAINS);
    expect(THERMO_SPECIALIST_DOMAINS).toEqual([
      'plan_completeness',
      'architecture',
      'security',
      'correctness',
      'tests',
      'performance',
      'docs',
    ]);
    expect(CANONICAL_THERMO_REVIEW_DOMAINS).not.toContain('adversarial_noise');
  });
```

Add this test to `tests/thermo-run-artifacts.test.ts`:

```ts
  it('maps legacy adversarial_noise answers to final synthesis metadata', () => {
    const answer = [
      '# Thermo Phase 1 Specialist Review - adversarial_noise Domain',
      '',
      'Domain: adversarial_noise',
      '',
      '## Findings',
      '- Legacy noise review.',
      '',
      '## DONE',
    ].join('\n');

    expect(inferLegacyThermoMetadata(answer, 'opencode-go/deepseek-v4-pro')).toMatchObject({
      phaseGroup: 'specialist',
      role: 'primary',
      domain: 'final_synthesis',
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npx vitest run tests/thermo-review-assignment.test.ts tests/thermo-run-artifacts.test.ts
```

Expected: FAIL because `THERMO_SPECIALIST_DOMAINS` is not exported and `adversarial_noise` is still canonical in `thermo-run-types.ts`.

- [ ] **Step 3: Add canonical exports**

Replace the domain declarations in `src/lib/thermo-run-types.ts` with:

```ts
export const THERMO_SPECIALIST_DOMAINS = [
  "plan_completeness",
  "architecture",
  "security",
  "correctness",
  "tests",
  "performance",
  "docs",
] as const;

export const THERMO_SYSTEM_DOMAINS = [
  "final_synthesis",
  "synthesis_audit",
] as const;

export const THERMO_REVIEW_DOMAINS = [
  ...THERMO_SPECIALIST_DOMAINS,
  ...THERMO_SYSTEM_DOMAINS,
] as const;

export type ThermoSpecialistDomain = (typeof THERMO_SPECIALIST_DOMAINS)[number];
export type ThermoDomain = (typeof THERMO_REVIEW_DOMAINS)[number];

const THERMO_DOMAINS = new Set<ThermoDomain>(THERMO_REVIEW_DOMAINS);

export const THERMO_DOMAIN_CHECKS: Record<ThermoDomain, string> = {
  plan_completeness:
    "Plan completeness, missed implementation commitments, and verification promised by the detected Superpowers plan.",
  architecture:
    "Architecture, maintainability, module boundaries, abstractions, and long-term change risk.",
  security:
    "Security, auth, authorization, data loss, secrets, privacy, and tenant isolation.",
  correctness:
    "Functional correctness, regressions, edge cases, state handling, and user-visible behavior.",
  tests:
    "Test coverage, fake coverage, missing assertions, brittle tests, and verification gaps.",
  performance:
    "Performance, scalability, resource usage, concurrency, caching, and avoidable repeated work.",
  docs:
    "Documentation, migrations, release notes, operator handoff, and public-facing behavior notes.",
  final_synthesis:
    "Final synthesis of validated review findings.",
  synthesis_audit:
    "Audit the final synthesis for unsupported blockers and missing downgrades.",
};

export function thermoDomainCheck(domain: ThermoDomain): string {
  return THERMO_DOMAIN_CHECKS[domain];
}

export function thermoDomainLabel(domain: ThermoDomain): string {
  return domain
    .split("_")
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

export function isThermoSpecialistDomain(domain: ThermoDomain): domain is ThermoSpecialistDomain {
  return (THERMO_SPECIALIST_DOMAINS as readonly string[]).includes(domain);
}

export function isCriticalThermoSpecialistDomain(
  domain: ThermoDomain,
  options: { planContractMatched?: boolean } = {},
): boolean {
  if (domain === "plan_completeness") return options.planContractMatched === true;
  return domain === "architecture" ||
    domain === "security" ||
    domain === "correctness" ||
    domain === "tests";
}
```

- [ ] **Step 4: Use shared domains in assignment**

In `src/lib/thermo-review-assignment.ts`, remove the local `ThermoDomain` union, local `THERMO_REVIEW_DOMAINS`, and local `domainLabel()` helper. Add imports:

```ts
import {
  THERMO_REVIEW_DOMAINS,
  isCriticalThermoSpecialistDomain,
  thermoDomainLabel,
  type ThermoDomain,
} from './thermo-run-types';
```

Update label calls:

```ts
message: `${thermoDomainLabel(domain)} has no available reviewer after skipped or unavailable models.`,
```

and:

```ts
message: `${thermoDomainLabel(domain)} has no separate validator after skipped or unavailable models.`,
```

- [ ] **Step 5: Use shared domains in the runner**

In `src/daemon/runner/thermo-code-review.ts`, remove the local `SPECIALIST_DOMAINS` array and `domainScope()` switch. Add imports:

```ts
import {
  THERMO_SPECIALIST_DOMAINS,
  isCriticalThermoSpecialistDomain,
  thermoDomainCheck,
} from '../../lib/thermo-run-types.js';
```

Replace `SPECIALIST_DOMAINS` references with `THERMO_SPECIALIST_DOMAINS`. Replace `domainScope(domain)` and `domainScope(args.metadata.domain)` with `thermoDomainCheck(domain)` and `thermoDomainCheck(args.metadata.domain)`.

- [ ] **Step 6: Use shared checks in artifact reader**

In `src/lib/server/thermo-run-artifacts.ts`, import:

```ts
import {
  parseThermoDomain,
  thermoDomainCheck,
  type ThermoDomain,
  type ThermoParticipantMetadata,
  type ThermoParticipantRole,
  type ThermoPhaseGroup,
  type ThermoRunPlan,
} from "@/lib/thermo-run-types";
```

Replace `legacyDomainCheck(domain)` calls with `thermoDomainCheck(domain)`. Remove the `legacyDomainCheck()` function.

If decision 2 is accepted, change `normalizeLegacyThermoDomain()` so legacy `adversarial_noise` does not stay canonical:

```ts
  if (normalized.includes("adversarial_noise")) return "final_synthesis";
```

- [ ] **Step 7: Run domain tests**

Run:

```bash
npx vitest run tests/thermo-review-assignment.test.ts tests/thermo-run-artifacts.test.ts
```

Expected: PASS.

---

### Task 2: Consistent Critical Readiness Severity

**Files:**
- Modify: `src/lib/thermo-review-assignment.ts`
- Modify: `src/daemon/routes/code-review.ts`
- Modify: `src/daemon/runner/thermo-code-review.ts`
- Test: `tests/thermo-review-assignment.test.ts`
- Test: `tests/thermo-code-review.test.ts`

- [ ] **Step 1: Write failing assignment severity test**

Extend `AssignThermoReviewDomainsInput` only after this test fails. Add to `tests/thermo-review-assignment.test.ts`:

```ts
  it('reports missing plan completeness as critical when a plan contract is matched', () => {
    const plan = assignThermoReviewDomains({
      voices: fullFleet.filter((item) => item.model_id !== 'gpt-5.5'),
      skippedVoiceIds: fullFleet
        .filter((item) => item.model_id !== 'gpt-5.5')
        .map((item) => item.id),
      planContractMatched: true,
    });

    expect(plan.coverageGaps).toContainEqual({
      domain: 'plan_completeness',
      severity: 'critical',
      message: 'Plan Completeness has no available reviewer after skipped or unavailable models.',
    });
  });
```

- [ ] **Step 2: Write failing runner readiness tests**

Add these cases to `tests/thermo-code-review.test.ts`:

```ts
  it('blocks synthesis when correctness has no assigned primary', async () => {
    runSingleReviewerWithPromptMock.mockImplementation(async (args: ReviewerCallArgs) => {
      if (args.phase.id === 'thermo-final-synthesis') {
        return writeParticipantAnswer(args, conciseReport('safe_to_merge'), true);
      }
      return writeParticipantAnswer(args, 'phase output\n\n## DONE', true);
    });

    const assignments = completePlanWith({
      correctness: { primary: undefined, validator: undefined },
      final_synthesis: { primary: voice('final', 'openai', 'gpt-5.5', 'A_PLUS') },
    });

    const result = await runThermoCodeReview(baseArgs(assignments));
    const phaseIds = runSingleReviewerWithPromptMock.mock.calls
      .map(([call]) => (call as ReviewerCallArgs).phase.id);

    expect(result.completed).toBe(false);
    expect(result.verdict).toBe('failed');
    expect(phaseIds).not.toContain('thermo-final-synthesis');
    expect(result.coverageGaps).toContainEqual({
      domain: 'correctness',
      severity: 'critical',
      message: 'No correctness primary reviewer was assigned.',
    });
  });

  it('blocks synthesis when matched-plan plan completeness has no assigned primary', async () => {
    runSingleReviewerWithPromptMock.mockImplementation(async (args: ReviewerCallArgs) => {
      if (args.phase.id === 'thermo-final-synthesis') {
        return writeParticipantAnswer(args, conciseReport('safe_to_merge'), true);
      }
      return writeParticipantAnswer(args, 'phase output\n\n## DONE', true);
    });

    const assignments = completePlanWith({
      plan_completeness: { primary: undefined, validator: undefined },
      final_synthesis: { primary: voice('final', 'openai', 'gpt-5.5', 'A_PLUS') },
    });

    const result = await runThermoCodeReview(baseArgs(assignments, new AbortController(), {
      status: 'matched',
      source: 'review_scope',
      path: 'docs/superpowers/plans/2026-05-24-example.md',
      content: '# Example Plan',
    }));
    const phaseIds = runSingleReviewerWithPromptMock.mock.calls
      .map(([call]) => (call as ReviewerCallArgs).phase.id);

    expect(result.completed).toBe(false);
    expect(result.verdict).toBe('failed');
    expect(phaseIds).not.toContain('thermo-final-synthesis');
    expect(result.coverageGaps).toContainEqual({
      domain: 'plan_completeness',
      severity: 'critical',
      message: 'No plan_completeness primary reviewer was assigned.',
    });
  });
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
npx vitest run tests/thermo-review-assignment.test.ts tests/thermo-code-review.test.ts
```

Expected: FAIL because `planContractMatched` is not accepted and readiness severity still has local critical lists.

- [ ] **Step 4: Implement shared severity in assignment**

In `src/lib/thermo-review-assignment.ts`, extend input:

```ts
export interface AssignThermoReviewDomainsInput {
  voices: ReviewVoice[];
  skippedVoiceIds?: string[];
  changedFiles?: string[];
  planContractMatched?: boolean;
}
```

Change `buildCoverageGaps()` signature:

```ts
function buildCoverageGaps(
  ranked: RankedReviewVoice[],
  assignments: Record<ThermoDomain, ThermoDomainAssignment>,
  options: { planContractMatched?: boolean },
): ThermoCoverageGap[] {
```

Replace primary-gap severity with:

```ts
const criticalPrimary =
  domain === 'final_synthesis' ||
  isCriticalThermoSpecialistDomain(domain, {
    planContractMatched: options.planContractMatched,
  });
```

and:

```ts
severity: criticalPrimary ? 'critical' : 'warning',
```

Call it from `assignThermoReviewDomains()`:

```ts
coverageGaps: buildCoverageGaps(ranked, assignments, {
  planContractMatched: input.planContractMatched,
}),
```

- [ ] **Step 5: Thread matched-plan state from the route**

In `src/daemon/routes/code-review.ts`, update the assignment call:

```ts
const assignments = assignThermoReviewDomains({
  voices: currentVoices,
  skippedVoiceIds,
  changedFiles: scope.files,
  planContractMatched: scope.planContract.status === 'matched',
});
```

- [ ] **Step 6: Implement shared readiness severity in runner**

In `src/daemon/runner/thermo-code-review.ts`, change the readiness call:

```ts
const planContractMatched = args.planContract?.status === 'matched';
const readinessGaps = synthesisReadinessGaps(args.assignments, laneRuns, {
  planContractMatched,
});
```

Change the helper signature:

```ts
function synthesisReadinessGaps(
  assignments: ThermoAssignmentPlan,
  laneRuns: Array<{
    domain: ThermoDomain;
    phaseOneOutput?: ThermoReviewOutput;
    validationOutput?: ThermoValidationOutput;
  }>,
  options: { planContractMatched?: boolean } = {},
): ThermoCoverageGap[] {
```

Replace the no-primary severity block with:

```ts
const criticalPrimary = isCriticalThermoSpecialistDomain(domain, {
  planContractMatched: options.planContractMatched,
});
gaps.push({
  domain,
  severity: criticalPrimary ? 'critical' : 'warning',
  message: `No ${domain} primary reviewer was assigned.`,
});
```

Change runtime gap calls:

```ts
coverageGaps.push(runtimeCoverageGap(args.domain, 'specialist', {
  planContractMatched: args.planContract?.status === 'matched',
}));
```

and:

```ts
coverageGaps.push(runtimeCoverageGap(args.domain, 'validator', {
  planContractMatched: args.planContract?.status === 'matched',
}));
```

Update `runtimeCoverageGap()`:

```ts
function runtimeCoverageGap(
  domain: ThermoDomain,
  role: 'specialist' | 'validator',
  options: { planContractMatched?: boolean } = {},
): ThermoCoverageGap {
  const severity =
    role === 'validator' ||
    isCriticalThermoSpecialistDomain(domain, {
      planContractMatched: options.planContractMatched,
    })
      ? 'critical'
      : 'warning';

  return {
    domain,
    severity,
    message:
      role === 'specialist'
        ? `No completed ${domain} specialist review was produced at runtime.`
        : `No completed ${domain} validation note was produced at runtime.`,
  };
}
```

- [ ] **Step 7: Run readiness tests**

Run:

```bash
npx vitest run tests/thermo-review-assignment.test.ts tests/thermo-code-review.test.ts
```

Expected: PASS.

---

### Task 3: Explicit Plan-Contract Read Failures

**Files:**
- Modify: `src/lib/git-code-review-scope.ts`
- Modify: `src/daemon/routes/code-review.ts`
- Test: `tests/git-code-review-scope.test.ts`
- Test: `tests/code-review-route.test.ts`

- [ ] **Step 1: Write failing unreadable-plan test**

Add this test to `tests/git-code-review-scope.test.ts`:

```ts
  it('throws a clear error when a matched plan file cannot be read', async () => {
    const repo = makeRepo();
    const planFile = writePlan(repo);
    fs.chmodSync(path.join(repo, planFile), 0o000);

    try {
      await expect(resolveCodeReviewScope(repo)).rejects.toMatchObject({
        code: 'plan_contract_unreadable',
      });
    } finally {
      fs.chmodSync(path.join(repo, planFile), 0o600);
    }
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run tests/git-code-review-scope.test.ts
```

Expected: FAIL because unreadable plan files currently become `{ status: 'not_found' }`.

- [ ] **Step 3: Add explicit scope error**

In `src/lib/git-code-review-scope.ts`, extend the error code union:

```ts
export type CodeReviewScopeErrorCode =
  | 'not_git_repo'
  | 'no_changes'
  | 'base_ref_missing'
  | 'artifact_too_large'
  | 'plan_contract_unreadable'
  | 'git_failed';
```

Replace `matchedPlanContract()` with:

```ts
async function matchedPlanContract(
  repoRoot: string,
  file: string,
  source: 'review_scope' | 'branch',
): Promise<CodeReviewPlanContract> {
  try {
    return {
      status: 'matched',
      path: file,
      source,
      content: await fs.promises.readFile(path.join(repoRoot, file), 'utf-8'),
    };
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === 'ENOENT') return { status: 'not_found' };
    throw new CodeReviewScopeError(
      'plan_contract_unreadable',
      `Detected plan contract ${file}, but could not read it: ${nodeError.message}`,
    );
  }
}
```

Update `detectPlanContract()` so branch detection does not swallow this new error:

```ts
  try {
    const branchFiles = await changedBranchFiles(repoRoot, baseRef);
    return planContractFromFiles(repoRoot, branchFiles, 'branch');
  } catch (error) {
    if (error instanceof CodeReviewScopeError && error.code === 'plan_contract_unreadable') {
      throw error;
    }
    return { status: 'not_found' };
  }
```

- [ ] **Step 4: Route error stays user-facing**

In `src/daemon/routes/code-review.ts`, keep `plan_contract_unreadable` in the existing validation-error path by leaving `statusForScopeError()` as:

```ts
function statusForScopeError(code: CodeReviewScopeError['code']): number {
  return code === 'git_failed' ? 500 : 400;
}
```

If decision 3 chooses a new plan-contract status instead of failing scope resolution, skip this task and replace it with a `status: 'read_error'` union update plus prompt/UI copy tests.

- [ ] **Step 5: Run scope tests**

Run:

```bash
npx vitest run tests/git-code-review-scope.test.ts
```

Expected: PASS.

---

### Task 4: Verdict Parser Coverage And Missing-Verdict Safety

**Files:**
- Modify: `src/daemon/runner/thermo-code-review.ts`
- Test: `tests/thermo-code-review.test.ts`

- [ ] **Step 1: Expand the test helper**

In `tests/thermo-code-review.test.ts`, change `conciseReport()` signature:

```ts
function conciseReport(
  verdict: 'safe_to_merge' | 'changes_requested' | 'owner_decision_needed' | 'human_review_required' | 'no_verdict',
): string {
```

- [ ] **Step 2: Add explicit verdict tests**

Add:

```ts
  it.each([
    'changes_requested',
    'owner_decision_needed',
    'human_review_required',
    'no_verdict',
  ] as const)('maps concise %s verdict to request_changes', async (verdict) => {
    runSingleReviewerWithPromptMock.mockImplementation(async (args: ReviewerCallArgs) => {
      if (args.phase.id === 'thermo-final-synthesis') {
        return writeParticipantAnswer(args, conciseReport(verdict), true);
      }
      return writeParticipantAnswer(args, 'phase output\n\n## DONE', true);
    });

    const result = await runThermoCodeReview(baseArgs(completePlanWith({
      final_synthesis: { primary: voice('final', 'openai', 'gpt-5.5', 'A_PLUS') },
    })));

    expect(result.completed).toBe(true);
    expect(result.verdict).toBe('request_changes');
  });
```

- [ ] **Step 3: Add missing concise verdict safety test**

Add:

```ts
  it('treats concise reports without an explicit Verdict line as request_changes', async () => {
    runSingleReviewerWithPromptMock.mockImplementation(async (args: ReviewerCallArgs) => {
      if (args.phase.id === 'thermo-final-synthesis') {
        return writeParticipantAnswer(args, [
          'Run Health: complete',
          'Plan: matched docs/superpowers/plans/example.md',
          '',
          '## Domain Coverage',
          '- Correctness / Regression: clear',
          '',
          '## DONE',
        ].join('\n'), true);
      }
      return writeParticipantAnswer(args, 'phase output\n\n## DONE', true);
    });

    const result = await runThermoCodeReview(baseArgs(completePlanWith({
      final_synthesis: { primary: voice('final', 'openai', 'gpt-5.5', 'A_PLUS') },
    })));

    expect(result.completed).toBe(true);
    expect(result.verdict).toBe('request_changes');
  });
```

- [ ] **Step 4: Run tests to verify failure**

Run:

```bash
npx vitest run tests/thermo-code-review.test.ts
```

Expected: FAIL on the missing concise verdict test because the current fallback approves reports with no explicit verdict and no legacy Valid Blocking section.

- [ ] **Step 5: Implement concise-shape safety**

In `src/daemon/runner/thermo-code-review.ts`, add:

```ts
function looksLikeConciseThermoReport(body: string): boolean {
  return /^Run Health:/im.test(body) || /^Plan:/im.test(body) || /^## Domain Coverage\b/im.test(body);
}
```

Change `verdictFromFinalReport()`:

```ts
function verdictFromFinalReport(body: string): Exclude<ThermoReviewVerdict, 'failed'> {
  const explicit = body.match(/^Verdict:\s*([a-z_]+)/im)?.[1]?.toLowerCase();
  if (explicit) {
    return explicit === 'safe_to_merge' ? 'approved' : 'request_changes';
  }
  if (looksLikeConciseThermoReport(body)) return 'request_changes';
  if (hasMeaningfulSection(body, 'Valid Blocking')) return 'request_changes';
  return 'approved';
}
```

- [ ] **Step 6: Run verdict tests**

Run:

```bash
npx vitest run tests/thermo-code-review.test.ts
```

Expected: PASS.

---

### Task 5: UI Copy And Operator Handoff

**Files:**
- Modify: `src/app/code-review/code-review-launcher.tsx`
- Optional create: `docs/superpowers/migrations/thermo-7-domain-review.md`
- Test: `tests/code-review-launcher.test.ts`

- [ ] **Step 1: Add launcher copy test**

In `tests/code-review-launcher.test.ts`, add or extend the existing launcher metadata test:

```ts
import { describe, expect, it } from 'vitest';
import { MODE_META } from '@/app/code-review/code-review-launcher';

describe('code review launcher mode metadata', () => {
  it('describes Thermo as seven-domain coverage without stale three-domain copy', () => {
    const details = MODE_META.thermo.steps.map((step) => step.detail);

    expect(details).not.toContain('security, tests, perf');
    expect(details).toContain('7 domains');
  });
});
```

If `MODE_META` is not exported, export it:

```ts
export const MODE_META = {
```

- [ ] **Step 2: Run launcher test to verify it fails**

Run:

```bash
npx vitest run tests/code-review-launcher.test.ts
```

Expected: FAIL because `MODE_META` is not exported or because the detail still says `security, tests, perf`.

- [ ] **Step 3: Update launcher copy**

In `src/app/code-review/code-review-launcher.tsx`, change:

```ts
{ label: "Specialists", detail: "security, tests, perf" },
```

to:

```ts
{ label: "Specialists", detail: "7 domains" },
```

- [ ] **Step 4: Add migration note if decision 4 is accepted**

Create `docs/superpowers/migrations/thermo-7-domain-review.md`:

```md
# Thermo Seven-Domain Review Migration

Thermo review now uses seven specialist domains:

- Plan completeness
- Architecture
- Security
- Correctness
- Tests
- Performance
- Docs

Final synthesis reports now start with a required `Verdict:` line. Supported values are:

- `safe_to_merge`
- `changes_requested`
- `owner_decision_needed`
- `human_review_required`
- `no_verdict`

Only `safe_to_merge` maps to an approved run. All other explicit verdicts map to request changes.

Participant cards may show `SKIPPED` when a reviewer was intentionally not run, and `NOT RUN` when a failed or cancelled run ended before that participant could start.
```

- [ ] **Step 5: Run UI/docs test**

Run:

```bash
npx vitest run tests/code-review-launcher.test.ts
```

Expected: PASS.

---

### Task 6: Final Verification

**Files:**
- Verify all touched files.

- [ ] **Step 1: Run focused Thermo tests**

Run:

```bash
npx vitest run tests/thermo-review-assignment.test.ts tests/thermo-run-artifacts.test.ts tests/thermo-code-review.test.ts tests/git-code-review-scope.test.ts tests/code-review-route.test.ts tests/code-review-launcher.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 4: Browser smoke test**

Use the in-app browser at `http://127.0.0.1:5050/code-review`.

Verify:

- Thermo launcher copy says `7 domains`.
- Starting a new Thermo review still creates a run.
- A failed or cancelled run shows `NOT RUN` only for participants that truly never started.
- Synthesis does not start until critical assigned specialists and validators have completed or been explicitly skipped.

## Self-Review

- Spec coverage: covers all three blockers plus the two owner-decision areas from the final synthesis.
- Placeholder scan: no task relies on unspecified files or generic "add tests" instructions.
- Type consistency: all new domain helpers are defined in `thermo-run-types.ts` before downstream modules import them.
