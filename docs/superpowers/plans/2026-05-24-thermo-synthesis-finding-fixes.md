# Thermo Synthesis Finding Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the accepted Thermo final-synthesis findings without widening the feature surface. The first pass removes the two blocking architecture problems, then hardens completion/error state, artifact parsing, performance hot spots, and documentation.
**Architecture:** Keep `ParticipantCard` focused on terminal/result presentation, make model/provider display helpers canonical in `src/lib/model-display.ts`, and move reusable server-side artifact logic into shared modules. Treat `_thermo.json`, `_events.jsonl`, `_stats.json`, and `_attempts.jsonl` as versioned sidecars with strict readers and tolerant failure behavior.
**Tech Stack:** Next.js App Router, React 19, TypeScript, Fastify daemon routes, filesystem-backed run artifacts, tmux/OpenCode terminal capture, Vitest.

---

## Scope

### Must Fix

- Extract the custom Markdown review renderer out of `src/components/run-viewer/participant-card.tsx`.
- Consolidate model display, provider label, lineage label, tier label, and logo helpers behind one shared module.
- Fix `terminalShowsDone` so non-OpenCode output cannot mark a Thermo participant done.
- Make `reviewer_spawn_failed` conform to the CLI error/event shape.
- Add tests for the OpenCode completion sentinel and `displayModelName` fallback behavior.

### Should Fix

- Deduplicate server run-artifact parsing between `/api/run-artifacts/[chatId]` and `runs/[runId]`.
- Tighten `_events.jsonl` validation.
- Extract shared tmux session-name construction.
- Add `ErrorDetector.cleanup()` to the daemon lifecycle.
- Reduce redundant artifact filesystem reads where the API polls frequently.

### Nice To Have

- Extract generic persisted-selection cookie/localStorage helper.
- Add operator-facing documentation for `_events.jsonl`, `MarkdownReview`, `ThermoDomainBoard`, and OpenCode terminal usage parsing.
- Memoize low-risk render helpers in `ParticipantCard`.
- Debounce overlapping live artifact fetches.
- Add production-only `Secure` on non-sensitive selection cookies.

### Current State Notes

- `src/lib/thermo-run-types.ts` and `src/lib/server/thermo-run-artifacts.ts` already exist from the previous Thermo feedback pass. This plan should extend those modules instead of recreating them.
- `tests/thermo-run-artifacts.test.ts` already exists. Add cases there instead of making another parallel artifact-helper test file.
- `src/lib/model-display.ts` exists but is not yet the single source of truth because `cli-status-panel.tsx` and `thermo-domain-board.tsx` still define local display helpers.

## Owner Decisions

- [ ] Confirm `lineageForAgent` fallback strategy.
  - Recommended default for this implementation: keep `"local"` in the `ReviewerLineage` union and emit a development warning for unmapped agents. This avoids user-visible fake brands while still prompting maintainers to add mappings.
- [ ] Confirm queued participant visibility.
  - Recommended default for this implementation: emit a visible queued state before CLI-slot acquisition. Thermo review cards should be visible immediately, but terminal work should still wait for the semaphore.

Do not begin the owner-decision-dependent tasks until the owner confirms or the implementer accepts the recommended defaults.

---

## Task 1: Extract Markdown Renderer From ParticipantCard

**Files:**

- Create: `src/components/run-viewer/markdown-review.tsx`
- Modify: `src/components/run-viewer/participant-card.tsx`
- Test: add focused coverage if the existing Vitest setup can render React nodes without adding packages

- [ ] Move `MarkdownReview`, `renderMarkdownBlocks`, `renderMarkdownHeading`, `isMarkdownTable`, `renderMarkdownTable`, `splitMarkdownTableRow`, `renderInlineMarkdown`, and `stripDoneSentinel` from `participant-card.tsx` into `markdown-review.tsx`.
- [ ] Export only the public surface needed by `ParticipantCard`:

```tsx
export function MarkdownReview({ content }: { content: string }) {
  // existing renderer body
}

export function stripDoneSentinel(content: string): string {
  // existing helper body
}
```

- [ ] Add a short module comment explaining the supported Markdown subset:
  - headings
  - fenced code blocks
  - tables
  - bullets and numbered lists
  - bold
  - inline code
  - `## DONE` sentinel stripping
- [ ] Replace the inline usage in `participant-card.tsx` with:

```tsx
import { MarkdownReview, stripDoneSentinel } from "@/components/run-viewer/markdown-review";
```

- [ ] Keep `ParticipantCard` responsible for selecting `answer`, `liveTail`, status, footer metrics, and modal state only.
- [ ] Run:

```bash
npm run typecheck
npx eslint src/components/run-viewer/participant-card.tsx src/components/run-viewer/markdown-review.tsx
```

Expected: both commands exit 0.

## Task 2: Centralize Model, Provider, Tier, And Logo Display

**Files:**

- Modify: `src/lib/model-display.ts`
- Modify: `src/components/cli-status-panel.tsx`
- Modify: `src/components/run-viewer/thermo-domain-board.tsx`
- Modify: `src/components/run-viewer/participant-card.tsx` if helper names change
- Test: `tests/model-display.test.ts`

- [ ] Extend `src/lib/model-display.ts` to export canonical helpers:

```ts
export function displayModelName(modelId: string): string;
export function providerDisplayLabel(provider: string, modelId?: string): string;
export function providerLineageKey(provider: string | undefined): string;
export function displayTier(tier: string): string;
export function modelLogoForVoice(voice: {
  model_id: string;
  provider: string;
  vendor_family?: string | null;
}): ModelLogo;
```

- [ ] Keep the existing canonical label for `gpt-5.5` as `Codex 5.5` unless the owner changes the product wording.
- [ ] Move the LobeHub color-logo mapping out of `cli-status-panel.tsx` into `src/lib/model-display.ts`.
- [ ] Delete local `displayModelName`, `providerLabelForVoice`, and `modelLogoForVoice` from `cli-status-panel.tsx`.
- [ ] Delete local `displayModelName`, `providerLabel`, `providerLineage`, and `formatTier` from `thermo-domain-board.tsx`.
- [ ] Add fallback tests:

```ts
expect(displayModelName("some-vendor/unknown-model-3.0")).toBe("Unknown Model 3.0");
expect(displayModelName("api-model")).toBe("API Model");
expect(displayModelName("v2-variant")).toBe("V2 Variant");
```

- [ ] Run:

```bash
npm test -- tests/model-display.test.ts
npm run typecheck
```

Expected: both commands exit 0.

## Task 3: Fix Completion And Failure State Semantics

**Files:**

- Modify: `src/components/run-viewer/participant-card.tsx`
- Modify: `src/daemon/error-detector.ts`
- Modify: `src/daemon/runner/reviewer-driver.ts`
- Test: `tests/reviewer-driver-pre-spawn-failure.test.ts`
- Test: create `tests/reviewer-opencode-completion.test.ts`

- [ ] Prevent `terminalShowsDone` from applying to non-OpenCode participants.
  - Preferred: remove the `terminalShowsDone` branch from `hasReviewResult` and rely on persisted `hasAnswer`.
  - Acceptable: only call it when `participant.lineage === "opencode"`.
- [ ] Export or test through a small internal surface for:
  - `openCodePaneShowsDone`
  - `ensureDoneSentinel`
- [ ] Add completion tests:

```ts
expect(openCodePaneShowsDone("\nDONE\nBuild · DeepSeek V4 Flash")).toBe(true);
expect(openCodePaneShowsDone("\nDONE\nplain model answer")).toBe(false);
expect(openCodePaneShowsDone("Build · DeepSeek V4 Flash")).toBe(false);
```

- [ ] Add `ensureDoneSentinel` tests for append and idempotency.
- [ ] Add `"reviewer_spawn_failed"` to `CliErrorKind` or move spawn failure to a separate event type.
- [ ] Ensure emitted spawn-failure objects have `kind`, `lineage`, `message`, optional `detail`, and optional `permissionRequest` at the top level.
- [ ] Add an explicit success-path assertion that `phase_start` is emitted after a reviewer successfully acquires a slot and starts.
- [ ] Run:

```bash
npm test -- tests/reviewer-driver-pre-spawn-failure.test.ts tests/reviewer-opencode-completion.test.ts
npm run typecheck
```

Expected: both commands exit 0.

## Task 4: Strengthen Shared Thermo Types And Domain Matching

**Files:**

- Modify: `src/lib/thermo-run-types.ts`
- Modify: `src/lib/thermo-review-assignment.ts`
- Modify: `src/lib/server/thermo-run-artifacts.ts`
- Modify: `src/components/run-viewer/thermo-domain-board.tsx`
- Test: `tests/thermo-run-artifacts.test.ts`
- Test: `tests/thermo-review-assignment.test.ts`

- [ ] Add a shared domain union:

```ts
export type ThermoDomain =
  | "architecture"
  | "security"
  | "correctness"
  | "tests"
  | "performance"
  | "docs"
  | "final_synthesis"
  | "adversarial_noise";
```

- [ ] Change `ThermoParticipantMetadata.domain` and `ThermoPlanDomain.domain` from `string` to `ThermoDomain`.
- [ ] Add `parseThermoDomain(value: unknown): ThermoDomain | undefined`.
- [ ] Use `parseThermoDomain` in sidecar parsing and legacy inference.
- [ ] Update `ThermoDomainBoard` matching to use typed domains instead of raw string comparisons.
- [ ] Keep legacy fallback tolerant: unknown domains should map to `final_synthesis`, not crash the run page.
- [ ] Run:

```bash
npm test -- tests/thermo-run-artifacts.test.ts tests/thermo-review-assignment.test.ts
npm run typecheck
```

Expected: both commands exit 0.

## Task 5: Deduplicate Run Artifact Reading

**Files:**

- Create: `src/lib/server/run-artifacts.ts`
- Modify: `src/app/api/run-artifacts/[chatId]/route.ts`
- Modify: `src/app/runs/[runId]/page.tsx`
- Test: extend existing route/page artifact tests if present

- [ ] Extract shared participant snapshot construction into a server-only module:

```ts
export interface BuildParticipantSnapshotInput {
  chatId: string;
  roundNum: number;
  participantDir: string;
  participantName: string;
}

export function buildParticipantSnapshot(input: BuildParticipantSnapshotInput): ParticipantSnapshot;
```

- [ ] Move duplicated parsing for:
  - `_meta.json`
  - `_stats.json`
  - `_events.jsonl`
  - `answer.md`
  - `hasAnswer`
  - Thermo metadata
- [ ] Let both `readChatRounds` call the shared builder.
- [ ] Exclude `triage` directories in the shared path, not independently in each caller.
- [ ] Cache the top-level chat directory listing once per request and pass it into round/swap readers.
- [ ] Run:

```bash
npm test -- tests/code-review-route.test.ts tests/thermo-run-artifacts.test.ts
npm run typecheck
```

Expected: both commands exit 0.

## Task 6: Tighten Participant Events And Tmux Session Names

**Files:**

- Modify: `src/lib/server/participant-events.ts`
- Create: `src/lib/tmux-session-name.ts`
- Modify: `src/lib/server/opencode-terminal-usage.ts`
- Modify: `src/daemon/tmux.ts`
- Test: `tests/participant-events.test.ts`
- Test: create `tests/tmux-session-name.test.ts`

- [ ] Add JSDoc to `participant-events.ts` describing `_events.jsonl`, severity values, and lifecycle.
- [ ] Replace loose `Partial<ParticipantEvent>` casts with strict manual validation or a Zod schema.
- [ ] Drop malformed optional fields instead of accepting them by cast.
- [ ] Extract shared session-name construction:

```ts
export function buildTmuxSessionName(input: {
  chatId: string;
  phaseId: string;
  role: string;
  agent: string;
}): string;
```

- [ ] Validate components with the same character policy in both daemon and server readers.
- [ ] Use the helper anywhere the current code builds `council-${chatId}-${phaseId}-${role}-${agent}`.
- [ ] Run:

```bash
npm test -- tests/participant-events.test.ts tests/tmux-session-name.test.ts
npm run typecheck
```

Expected: both commands exit 0.

## Task 7: Daemon Reliability And Route Validation

**Files:**

- Modify: `src/daemon/index.ts` or the daemon heartbeat/reaper owner
- Modify: `src/daemon/routes/code-review.ts`
- Modify: `src/lib/code-review-agent-selection.ts`
- Modify: `src/lib/code-review-mode-selection.ts`
- Create: `src/lib/persisted-selection.ts`
- Test: `tests/code-review-route.test.ts`

- [ ] Wire `ErrorDetector.cleanup(maxIdleMs)` into a daemon interval that already owns long-running maintenance. Do not create overlapping timers if a heartbeat/reaper loop exists.
- [ ] Use a route-level request schema or explicit TypeScript boundary for `skippedVoiceIds?: string[]`.
- [ ] Keep the existing parser as defense in depth, but reject malformed payloads before scheduling the run.
- [ ] Extract cookie/localStorage boilerplate into `persisted-selection.ts`:

```ts
export function persistedSelection<T>(config: {
  storageKey: string;
  cookieName: string;
  parse: (value: string | null) => T | undefined;
  serialize: (value: T) => string;
  defaultValue: T;
}): PersistedSelection<T>;
```

- [ ] Add `Secure` to browser-written cookies only when `process.env.NODE_ENV === "production"`.
- [ ] Rebuild `code-review-mode-selection.ts` and `code-review-agent-selection.ts` on the shared factory.
- [ ] Run:

```bash
npm test -- tests/code-review-route.test.ts
npm run typecheck
```

Expected: both commands exit 0.

## Task 8: Polling And Render Performance

**Files:**

- Modify: `src/components/live-run-real/index.tsx`
- Modify: `src/components/run-viewer/participant-card.tsx`
- Modify: `src/app/api/run-artifacts/[chatId]/route.ts`
- Modify: `src/lib/server/run-artifacts.ts`

- [ ] Prevent overlapping artifact fetches in `live-run-real` by sharing an `AbortController` or debouncing SSE-triggered fetches behind one in-flight request.
- [ ] Cache `_attempts.jsonl` reads per round in the artifact route.
- [ ] Cache Thermo `_meta.json` parse results per participant directory for the duration of one request.
- [ ] Memoize `findingsPreview` by answer identity or mtime.
- [ ] Wrap `participantFooterMetrics` and `tokenUsageSummary` in `useMemo`.
- [ ] Avoid reparsing OpenCode terminal usage once the participant is terminal and stable.
- [ ] Run:

```bash
npx eslint src/components/live-run-real/index.tsx src/components/run-viewer/participant-card.tsx src/app/api/run-artifacts/[chatId]/route.ts
npm run typecheck
```

Expected: both commands exit 0.

## Task 9: Documentation

**Files:**

- Modify: `src/lib/server/participant-events.ts`
- Modify: `src/components/run-viewer/markdown-review.tsx`
- Modify: `src/components/run-viewer/thermo-domain-board.tsx`
- Modify or create: `docs/thermo-code-review.md` if project docs already contain runtime/operator notes

- [ ] Add an overview comment to `ThermoDomainBoard` explaining:
  - domain-to-slot construction
  - primary/review pairing
  - fallback participants
  - synthesis/audit extras
  - why `shouldRenderParticipant` exists
- [ ] Add a concise Markdown renderer rationale comment:
  - no package added
  - controlled subset
  - review-output-specific formatting
- [ ] Add OpenCode terminal usage parser notes:
  - parsed from CLI footer
  - best-effort
  - safe-fails to `tokens n/a`
  - verified against the current OpenCode footer shape visible in Thermo runs
- [ ] Run:

```bash
npx eslint src/lib/server/participant-events.ts src/components/run-viewer/markdown-review.tsx src/components/run-viewer/thermo-domain-board.tsx
```

Expected: exit 0.

---

## Validation Matrix

Run targeted tests as each task lands:

```bash
npm test -- tests/model-display.test.ts
npm test -- tests/reviewer-driver-pre-spawn-failure.test.ts tests/reviewer-opencode-completion.test.ts
npm test -- tests/thermo-run-artifacts.test.ts tests/thermo-review-assignment.test.ts
npm test -- tests/participant-events.test.ts tests/tmux-session-name.test.ts
npm test -- tests/code-review-route.test.ts
```

Run full local validation before commit:

```bash
npm test
npm run typecheck
npm run lint
```

Expected:

- No duplicate model display helper definitions remain outside `src/lib/model-display.ts`.
- `ParticipantCard` no longer contains the Markdown parser pipeline.
- Non-OpenCode `DONE` text cannot mark a participant complete.
- Spawn failures produce consistent failed badges and typed error payloads.
- Artifact readers share the same snapshot construction path.
- Thermo runs remain viewable after partial failures.
- Existing dirty worktree changes unrelated to this plan are preserved.

---

## Execution Order

1. Tasks 1-2: remove blocking architecture issues first.
2. Task 3: fix user-visible done/failed status semantics.
3. Tasks 4-6: harden shared types, sidecars, and artifact readers.
4. Task 7: reliability and request-boundary cleanup.
5. Task 8: performance improvements.
6. Task 9: documentation.
7. Full validation.

## Handoff Options

Choose one:

1. **Subagent-Driven (recommended):** Use subagents for independent tracks:
   - UI extraction/display helpers: Tasks 1-2
   - Runtime correctness/tests: Task 3
   - Server artifacts/types/sidecars: Tasks 4-6
   - Reliability/performance/docs: Tasks 7-9
2. **Inline Execution:** Implement tasks sequentially in this session, stopping after each validation group if a test exposes a broader design issue.
