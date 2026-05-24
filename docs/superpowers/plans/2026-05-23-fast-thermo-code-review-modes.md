# Fast And Thermo Code Review Modes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two code review launch modes. Fast keeps the current one-pass reviewer plus synthesizer behavior. Thermo runs a deterministic, high-rigor multi-phase review with specialist reviewers, cross-validation, and final synthesis that separates real blockers from noise.
**Architecture:** Keep the existing `review_only` template runner as the Fast path. Add a separate Thermo orchestration path under the code-review route because the current template schema intentionally supports only one `review_only` phase. Share existing voice discovery, reviewer prompt, persona, CLI semaphore, quota/error detection, artifact storage, and run event persistence.
**Tech Stack:** Next.js App Router, TypeScript, Fastify daemon routes, SQLite-backed chats/voices/personas, existing CLI shims, existing runner event model, Vitest/npm test scripts.

---

## Current Constraints

The current code review route uses `templates/branch-code-review.yaml`, adapts it to the currently enabled voices at launch, validates it with `TemplateSchema`, then calls `runWithMultiplex`. The current `review_only` runner writes a synthetic doer artifact, runs all reviewers once, and optionally runs `runTriageSynthesis`.

Thermo needs three logical phases, so implementing it as another `review_only` template would fight the current schema and hide important state. Use a dedicated Thermo runner that emits the same participant/run events and stores outputs under the same chat directory conventions.

## Review Modes

`fast`

- Default mode.
- Uses current `branch-code-review` behavior.
- Dynamically adapts reviewers from enabled voices when the user clicks Start Review.
- Runs one reviewer pass.
- Runs one triage synthesizer.

`thermo`

- Opt-in mode.
- Builds assignments from the enabled fleet at click time.
- Runs specialist reviewers in phase 1.
- Runs cross-validation reviewers in phase 2.
- Runs final synthesis plus an audit when an eligible auditor model exists in phase 3.
- Reports coverage gaps when the fleet cannot satisfy a high-risk domain.
- Treats quota-limited/failed agents as skipped, not as blockers for the next phase.

## Deterministic Tiering

Create one shared tiering module. No random assignment.

File: `src/lib/review-model-tiering.ts`

```ts
export type ReviewModelTier =
  | 'A_PLUS'
  | 'A'
  | 'A_MINUS'
  | 'B_PLUS'
  | 'B'
  | 'B_MINUS'
  | 'C';

export interface ReviewVoice {
  id: string;
  provider: string;
  model_id: string;
  lineage: string;
  vendor_family: string | null;
  enabled: boolean;
}

export interface RankedReviewVoice {
  voice: ReviewVoice;
  tier: ReviewModelTier;
  score: number;
  reasons: string[];
}
```

Use explicit overrides for the known fleet first, then heuristics for future models:

```ts
const MODEL_TIER_OVERRIDES = {
  'gpt-5.5': { tier: 'A_PLUS', score: 1000 },
  'opencode-go/deepseek-v4-pro': { tier: 'A', score: 930 },
  'opencode-go/kimi-k2.6': { tier: 'A_MINUS', score: 880 },
  'opencode-go/glm-5.1': { tier: 'B_PLUS', score: 820 },
  'opencode-go/qwen3.6-plus': { tier: 'B_PLUS', score: 805 },
  'opencode-go/minimax-m2.7': { tier: 'B', score: 760 },
  'opencode-go/deepseek-v4-flash': { tier: 'B_MINUS', score: 690 },
  'gemini-3.5-flash': { tier: 'C', score: 540 },
} as const;
```

Tie-break order:

1. Role fit score.
2. Tier score.
3. Prefer unused exact `(lineage, model_id)` in the current phase.
4. Prefer different `vendor_family` for diversity.
5. Stable lexical order by `provider:model_id`.

## Thermo Role Assignment

File: `src/lib/thermo-review-assignment.ts`

Domains:

```ts
export type ThermoDomain =
  | 'architecture'
  | 'security'
  | 'correctness'
  | 'tests'
  | 'performance'
  | 'docs'
  | 'adversarial_noise'
  | 'final_synthesis'
  | 'synthesis_audit';
```

Current fleet target assignment:

| Domain | Primary | Validator |
| --- | --- | --- |
| Architecture and maintainability | `gpt-5.5` | `opencode-go/kimi-k2.6` |
| Security, auth, data loss | `opencode-go/deepseek-v4-pro` | `gpt-5.5` |
| Correctness and regressions | `opencode-go/kimi-k2.6` | `opencode-go/qwen3.6-plus` |
| Tests, fake coverage, gaps | `opencode-go/qwen3.6-plus` | `opencode-go/deepseek-v4-flash` |
| Performance and scaling | `opencode-go/glm-5.1` | `opencode-go/deepseek-v4-pro` |
| Docs, migrations, release notes | `opencode-go/deepseek-v4-flash` | `gemini-3.5-flash` |
| Adversarial noise check | `opencode-go/minimax-m2.7` | `opencode-go/glm-5.1` |
| Final synthesis | `gpt-5.5` | `opencode-go/deepseek-v4-pro` |

Fallback rules:

- Security primary must be Tier A or better when available.
- Architecture primary must be Tier A- or better when available.
- Final synthesis must use the highest available Tier A- or better model.
- Docs and tests can use lower tiers, but final findings from those domains need Tier A-/better validation before they become blocking.
- If no eligible model exists for a critical domain, include a `Coverage Gaps` section in the final report.
- If a selected model fails with quota, timeout, or spawn failure, mark that assignment as skipped and promote the next deterministic fallback for that domain when one exists.

## Thermo Pipeline

File: `src/daemon/runner/thermo-code-review.ts`

Export:

```ts
export async function runThermoCodeReview(args: {
  chatDir: string;
  chatId: string;
  artifact: string;
  work: string;
  filesBlock: string;
  assignments: ThermoAssignmentPlan;
  tmuxMgr: TmuxManager;
  errorDetector: ErrorDetector;
  onEvent: (event: RunnerEvent) => void;
  abortSignal: AbortSignal;
}): Promise<ThermoReviewResult>;
```

Phase 1: specialist review

- Spawn one primary reviewer per domain.
- Use existing `runReviewerHeadless`/reviewer machinery so quota detection, CLI semaphores, fallback files, and participant cards keep working.
- Give each reviewer a domain-specific prompt.
- Store outputs under `round-1/thermo-phase-1/<domain>-primary`.

Phase 2: cross-validation

- Spawn each domain validator with the original artifact plus all phase 1 outputs.
- Validators must classify each finding as `valid`, `mostly_valid`, `noise`, `needs_owner_decision`, or `insufficient_evidence`.
- Store outputs under `round-1/thermo-phase-2/<domain>-validator`.

Phase 3: synthesis and audit

- Run final synthesizer with original artifact, all phase 1 outputs, all phase 2 validation notes, assignment metadata, skipped/quota metadata, and coverage gaps.
- Run audit model on the draft final report when an eligible auditor exists.
- If the auditor finds unsupported blockers, the final synthesizer must revise once.
- Store final at `round-1/triage/answer.md` so existing run display can find the synthesized result.

## Prompts

File: `src/daemon/runner/thermo-prompts.ts`

Add prompt builders instead of hardcoding long strings inside the runner:

```ts
export function buildThermoPhaseOnePrompt(input: ThermoPromptInput): string;
export function buildThermoValidationPrompt(input: ThermoValidationPromptInput): string;
export function buildThermoSynthesisPrompt(input: ThermoSynthesisPromptInput): string;
export function buildThermoAuditPrompt(input: ThermoAuditPromptInput): string;
```

Phase 1 output contract:

```md
## Findings

### [severity] Short title
- Domain:
- Evidence:
- Why it matters:
- Confidence:
- Suggested fix:

## Non-Issues Checked

## Coverage Limits

## DONE
```

Final report sections:

```md
**Valid Blocking**
**Valid Non-Blocking**
**Mostly Valid**
**Needs Owner Decision**
**Noise**
**Coverage Gaps**
**Fix Plan**
**Validation**
```

Admission rules for the final report:

- A blocking finding needs Tier A-/better origin or validation.
- A security/data-loss blocking finding needs Tier A/A+ validation when available.
- If validators disagree, downgrade to `Mostly Valid` or `Needs Owner Decision`.
- Do not include broad style feedback unless tied to a concrete regression risk.
- Include quota/skipped agents only in `Coverage Gaps`, not as review findings.

## API And UI

Files:

- `src/lib/code-review-modes.ts`
- `src/lib/api/code-review.ts`
- `src/daemon/routes/code-review.ts`
- `src/app/code-review/code-review-launcher.tsx`
- `src/app/code-review/page.tsx`

Add:

```ts
export type CodeReviewMode = 'fast' | 'thermo';
```

Route body:

```ts
{
  repoPath?: string;
  mode?: CodeReviewMode;
}
```

Behavior:

- Missing `mode` means `fast`.
- Fast route stays backward-compatible.
- Thermo route creates the chat with `template_id: 'branch-code-review-thermo'`, resolves git scope once, computes assignments from current voices, and starts `runThermoCodeReview`.
- The launcher shows a compact segmented control: `Fast` and `Thermo`.
- Thermo launch preview shows role, selected model, tier, and coverage gaps before start.
- Start Review always refreshes assignments from enabled voices at click time.

## Persistence And Events

Reuse `phase_events` payload shapes where possible:

- `phase_start` and `phase_done` for each Thermo participant.
- `cli_warning` for quota/skipped/fallback selection.
- `phase_failed` only when the entire Thermo pipeline cannot produce a final report.

Add minimal metadata to event payloads:

```ts
{
  thermoPhase?: 'specialist' | 'validation' | 'synthesis' | 'audit';
  domain?: ThermoDomain;
  tier?: ReviewModelTier;
}
```

Keep the participant card rendering mostly unchanged. In this pass, show Thermo phase/domain details through participant labels and status pills instead of adding a new grouped run layout.

## Implementation Steps

- [ ] Add `src/lib/code-review-modes.ts` with `CodeReviewMode`, labels, descriptions, and defaults.
- [ ] Update `src/lib/api/code-review.ts` so `startCodeReview(repoPath, mode)` posts `{ repoPath, mode }`.
- [ ] Update `src/app/code-review/code-review-launcher.tsx` with a Fast/Thermo segmented control and pass the selected mode.
- [ ] Add `src/lib/review-model-tiering.ts` with explicit model overrides, heuristic fallback, stable tie-breaks, and `rankReviewVoices`.
- [ ] Add `tests/review-model-tiering.test.ts` covering the current eight-model fleet and future unknown model fallback.
- [ ] Add `src/lib/thermo-review-assignment.ts` with domain definitions, deterministic assignment, fallback promotion, and coverage gap reporting.
- [ ] Add `tests/thermo-review-assignment.test.ts` covering full fleet, missing A-tier security model, AGY quota skip, and single-model fallback.
- [ ] Add `src/daemon/runner/thermo-prompts.ts` with phase 1, validation, synthesis, and audit prompt builders.
- [ ] Add `tests/thermo-prompts.test.ts` to assert required sections, `## DONE`, domain scoping, and final admission rules.
- [ ] Add `src/daemon/runner/thermo-code-review.ts` and reuse the existing reviewer/headless runner where possible.
- [ ] Update `src/daemon/routes/code-review.ts` to branch on `mode`, keep Fast unchanged, and launch Thermo with current voices and assignments.
- [ ] Do not add a new YAML template for Thermo in this pass. Store `branch-code-review-thermo` as the chat `template_id` from the code review route and keep the multi-phase Thermo pipeline outside `TemplateSchema`.
- [ ] Update run display only where necessary to avoid misleading status labels for Thermo phase 2 and phase 3 participants.
- [ ] Add route tests in `tests/code-review-route.test.ts` for default Fast mode, explicit Thermo mode, dynamic assignment at click time, and invalid mode rejection.
- [ ] Add a focused runner test for quota behavior: a quota-limited Thermo participant becomes skipped, fallback is attempted, and synthesis still starts.
- [ ] Add `docs/code-review-modes.md` explaining Fast vs Thermo behavior, deterministic assignment, and coverage gaps.

## Validation

Run focused tests while building:

```bash
npm test -- tests/review-model-tiering.test.ts tests/thermo-review-assignment.test.ts tests/thermo-prompts.test.ts
npm test -- tests/code-review-route.test.ts
```

Run full validation before PR:

```bash
npm test
npm run lint
```

Manual validation:

- Start Fast review and verify it still launches one adapted reviewer set plus triage synthesis.
- Start Thermo review with the eight-model fleet and verify all domains receive deterministic assignments.
- Disable `gpt-5.5` and verify Thermo reports synthesis/security coverage gaps instead of silently pretending coverage is equivalent.
- Trigger or simulate AGY quota and verify the AGY participant is skipped, not left as `WORKING`, and phase 3 still runs.

## Rollout

- Ship Fast/Thermo mode selection behind the normal code review page, not a hidden setting.
- Keep Fast as the default to preserve existing user behavior.
- Make Thermo visibly slower and stricter in the launcher copy.
- Do not auto-run Thermo based on diff size in this pass. Manual mode selection is the rollout boundary for this implementation.
