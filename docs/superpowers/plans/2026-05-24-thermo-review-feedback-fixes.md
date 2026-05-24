# Thermo Review Feedback Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the accepted Thermo review follow-ups by centralizing Thermo artifact metadata handling, removing the stale CLI status gate, and making orphaned Thermo streams viewable without rewriting the run as failed.

**Architecture:** Keep Thermo sidecar metadata authoritative and move legacy inference into one server-side helper. The run page SSR path and `/api/run-artifacts` path should share the same helper so plan reads, sidecar validation, and fallback parsing cannot drift. Stream reattach should replay artifacts/events and emit a clear non-resumable terminal SSE frame without mutating persisted chat status.

**Tech Stack:** Next.js App Router, TypeScript, Fastify daemon routes, filesystem-backed run artifacts, Vitest.

---

## Scope And Decisions

Accepted for this pass:

- Extract canonical Thermo types/helpers and import them in both artifact readers.
- Tighten legacy Thermo inference while extracting it.
- Remove the unused `/orchestrators` render gate from `CliStatusPanel`.
- Change orphaned Thermo stream behavior to surface a clear non-resumable state without blindly overwriting the chat as failed.

Deferred owner decisions:

- Pre-launch Thermo assignment/coverage preview is not required for this merge unless the owner explicitly says it must block.
- Critical Thermo coverage gaps continue to be reported in the review output, not pre-launch blocked, unless the owner chooses stricter gating.
- True Thermo resume/restart after daemon restart is out of scope for this plan; this pass only makes the non-resumable state honest and artifact-preserving.

## File Structure

- Create `src/lib/thermo-run-types.ts`
  - Canonical exported Thermo UI/run metadata types.
  - No Node imports, safe for type-only client imports.

- Create `src/lib/server/thermo-run-artifacts.ts`
  - Server-only filesystem helpers for `_thermo.json` and `_thermo-plan.json`.
  - Legacy answer-text inference.
  - Shape validation for sidecars.

- Modify `src/components/run-viewer/types.ts`
  - Remove local Thermo type definitions.
  - Import/re-export canonical Thermo types using type-only imports.

- Modify `src/app/api/run-artifacts/[chatId]/route.ts`
  - Remove duplicated Thermo interfaces and helper functions.
  - Use `readThermoParticipantMetadata()` and `readThermoRunPlanByChatId()`.

- Modify `src/app/runs/[runId]/page.tsx`
  - Remove duplicated Thermo inference/plan helpers.
  - Use the same server helper as the API route.

- Modify `src/components/cli-status-panel.tsx`
  - Remove `/orchestrators` fetch gate.
  - Load voices and health best-effort; render when enabled voices exist.

- Modify `src/daemon/routes/chats-stream.ts`
  - Stop updating orphaned Thermo chats to `failed`.
  - Emit a replay/non-resumable SSE frame and close the stream after artifact replay.

- Create `tests/thermo-run-artifacts.test.ts`
  - Validate sidecar parsing and legacy inference tightness.

- Update `tests/code-review-route.test.ts` or create a focused stream-route test if stream test harness already exists.
  - Assert orphaned Thermo stream does not persistently rewrite chat status to failed.

## Task 1: Canonical Thermo Types

**Files:**
- Create: `src/lib/thermo-run-types.ts`
- Modify: `src/components/run-viewer/types.ts`

- [ ] **Step 1: Create canonical type module**

Create `src/lib/thermo-run-types.ts`:

```ts
export type ThermoPhaseGroup = "specialist" | "validation" | "synthesis" | "audit";

export type ThermoParticipantRole =
  | "primary"
  | "validator"
  | "synthesizer"
  | "auditor";

export interface ThermoParticipantMetadata {
  kind: "thermo";
  phaseGroup: ThermoPhaseGroup;
  phaseId: string;
  phaseLabel: string;
  description: string;
  check: string;
  domain: string;
  role: ThermoParticipantRole;
  voiceId: string;
  provider: string;
  modelId: string;
  tier: string;
}

export interface ThermoPlanVoice {
  voiceId: string;
  provider: string;
  modelId: string;
  tier: string;
}

export interface ThermoPlanDomain {
  domain: string;
  check: string;
  validatorPolicy: "always" | "conditional" | "none";
  validatorReason: string;
  primary: ThermoPlanVoice | null;
  validator: ThermoPlanVoice | null;
}

export interface ThermoRunPlan {
  phases: Array<{
    id: ThermoPhaseGroup;
    label: string;
    title: string;
    description: string;
  }>;
  domains: ThermoPlanDomain[];
}
```

- [ ] **Step 2: Update run-viewer type exports**

In `src/components/run-viewer/types.ts`, replace the current local Thermo definitions with:

```ts
import type {
  ThermoParticipantMetadata,
  ThermoPhaseGroup,
  ThermoPlanDomain,
  ThermoPlanVoice,
  ThermoRunPlan,
} from "@/lib/thermo-run-types";

export type {
  ThermoParticipantMetadata,
  ThermoPhaseGroup,
  ThermoPlanDomain,
  ThermoPlanVoice,
  ThermoRunPlan,
};
```

Keep `ParticipantSnapshot.thermo?: ThermoParticipantMetadata;` unchanged.

- [ ] **Step 3: Typecheck**

Run:

```bash
npm run typecheck
```

Expected: exit 0.

## Task 2: Shared Server Thermo Artifact Helpers

**Files:**
- Create: `src/lib/server/thermo-run-artifacts.ts`
- Modify: `src/app/api/run-artifacts/[chatId]/route.ts`
- Modify: `src/app/runs/[runId]/page.tsx`
- Test: `tests/thermo-run-artifacts.test.ts`

- [ ] **Step 1: Write tests for sidecar validation and tight legacy inference**

Create `tests/thermo-run-artifacts.test.ts`:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  inferLegacyThermoMetadata,
  readThermoParticipantMetadata,
  readThermoRunPlan,
} from "../src/lib/server/thermo-run-artifacts";

describe("thermo run artifact helpers", () => {
  it("reads authoritative participant sidecar metadata", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "thermo-meta-"));
    fs.writeFileSync(
      path.join(dir, "_thermo.json"),
      JSON.stringify({
        kind: "thermo",
        phaseGroup: "validation",
        phaseId: "thermo-phase-2-security",
        phaseLabel: "Thermo security validation",
        description: "Validate security findings.",
        check: "Security, auth, authorization, data loss.",
        domain: "security",
        role: "validator",
        voiceId: "voice-openrouter-deepseek-pro",
        provider: "openrouter",
        modelId: "opencode-go/deepseek-v4-pro",
        tier: "A",
      }),
    );

    expect(readThermoParticipantMetadata(dir)?.domain).toBe("security");
    expect(readThermoParticipantMetadata(dir)?.role).toBe("validator");
  });

  it("rejects malformed participant sidecars", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "thermo-bad-meta-"));
    fs.writeFileSync(path.join(dir, "_thermo.json"), JSON.stringify({ kind: "thermo" }));

    expect(readThermoParticipantMetadata(dir)).toBeUndefined();
  });

  it("infers legacy phase one specialists from the answer header", () => {
    const answer = [
      "# Thermo Phase 1 Specialist Review — Tests Domain",
      "",
      "## Assignment",
      "Domain: tests",
      "Role: primary",
      "",
      "## Findings",
      "### [high] Missing coverage",
      "",
      "## DONE",
    ].join("\n");

    expect(inferLegacyThermoMetadata(answer, "opencode-go/qwen3.6-plus")).toMatchObject({
      phaseGroup: "specialist",
      role: "primary",
      domain: "tests",
      modelId: "opencode-go/qwen3.6-plus",
    });
  });

  it("does not infer Thermo metadata from ordinary prose mentioning thermo or validation", () => {
    const answer = [
      "## Findings",
      "This ordinary review mentions thermo behavior and validation, but it is not a Thermo phase output.",
      "",
      "## DONE",
    ].join("\n");

    expect(inferLegacyThermoMetadata(answer, "gpt-5.5")).toBeUndefined();
  });

  it("reads a valid run plan", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "thermo-plan-"));
    fs.writeFileSync(
      path.join(dir, "_thermo-plan.json"),
      JSON.stringify({
        phases: [
          {
            id: "specialist",
            label: "Phase 1",
            title: "Specialist review",
            description: "Primary reviewers check each Thermo domain.",
          },
        ],
        domains: [
          {
            domain: "security",
            check: "Security checks.",
            validatorPolicy: "always",
            validatorReason: "Security requires validation.",
            primary: {
              voiceId: "voice-a",
              provider: "openrouter",
              modelId: "opencode-go/deepseek-v4-pro",
              tier: "A",
            },
            validator: null,
          },
        ],
      }),
    );

    expect(readThermoRunPlan(dir)?.domains[0]?.domain).toBe("security");
  });
});
```

- [ ] **Step 2: Run the new tests and verify they fail**

Run:

```bash
npm test -- tests/thermo-run-artifacts.test.ts
```

Expected: fail because `src/lib/server/thermo-run-artifacts.ts` does not exist yet.

- [ ] **Step 3: Implement the shared server helper**

Create `src/lib/server/thermo-run-artifacts.ts`:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  ThermoParticipantMetadata,
  ThermoParticipantRole,
  ThermoPhaseGroup,
  ThermoRunPlan,
} from "@/lib/thermo-run-types";

const THERMO_DOMAINS = [
  "architecture",
  "security",
  "correctness",
  "tests",
  "performance",
  "docs",
  "adversarial_noise",
  "final_synthesis",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function isPhaseGroup(value: unknown): value is ThermoPhaseGroup {
  return value === "specialist" || value === "validation" || value === "synthesis" || value === "audit";
}

function isRole(value: unknown): value is ThermoParticipantRole {
  return value === "primary" || value === "validator" || value === "synthesizer" || value === "auditor";
}

export function parseThermoParticipantMetadata(value: unknown): ThermoParticipantMetadata | undefined {
  if (!isRecord(value)) return undefined;
  if (value.kind !== "thermo") return undefined;
  if (!isPhaseGroup(value.phaseGroup)) return undefined;
  if (!isRole(value.role)) return undefined;

  const requiredStrings = [
    "phaseId",
    "phaseLabel",
    "description",
    "check",
    "domain",
    "voiceId",
    "provider",
    "modelId",
    "tier",
  ] as const;
  for (const key of requiredStrings) {
    if (typeof value[key] !== "string") return undefined;
  }

  return value as unknown as ThermoParticipantMetadata;
}

export function readThermoParticipantMetadata(
  participantDir: string,
  legacyAnswer?: string,
  modelUsed?: string,
): ThermoParticipantMetadata | undefined {
  const thermoPath = path.join(participantDir, "_thermo.json");
  if (fs.existsSync(thermoPath)) {
    try {
      const parsed = parseThermoParticipantMetadata(JSON.parse(fs.readFileSync(thermoPath, "utf-8")));
      if (parsed) return parsed;
    } catch {
      /* malformed sidecar: fall through to legacy inference */
    }
  }

  return legacyAnswer ? inferLegacyThermoMetadata(legacyAnswer, modelUsed) : undefined;
}

export function inferLegacyThermoMetadata(
  answer: string,
  modelUsed?: string,
): ThermoParticipantMetadata | undefined {
  const header = answer.split("\n").slice(0, 24).join("\n");
  if (!/^#\s*Thermo\s+Phase\s+[12]\b|^#\s*Performance Specialist Review\b|^#\s*Thermo\s+(Final Synthesis|Synthesis Audit)\b/im.test(header)) {
    return undefined;
  }

  const phaseGroup = inferLegacyPhaseGroup(header);
  const role = roleForPhaseGroup(phaseGroup);
  const domain = inferLegacyThermoDomain(header);
  const reviewerLine = header.match(/\*\*(?:Reviewer|Validator):\*\*\s*([^\n]+)/i)?.[1] ?? "";
  const tier = reviewerLine.match(/Tier\s+([^)]+)/i)?.[1]?.trim() ?? "";
  const model = reviewerLine
    .replace(/\(Tier[^)]*\)/i, "")
    .replace(/^[^:]+:/, "")
    .trim() || modelUsed || "";
  const phaseLabel = phaseGroup === "validation"
    ? "Thermo adversarial validation"
    : phaseGroup === "synthesis"
      ? "Thermo final synthesis"
      : phaseGroup === "audit"
        ? "Thermo synthesis audit"
        : "Thermo specialist review";

  return {
    kind: "thermo",
    phaseGroup,
    phaseId: `legacy-${phaseGroup}-${domain}`,
    phaseLabel,
    description: phaseLabel,
    check: legacyDomainCheck(domain),
    domain,
    role,
    voiceId: model,
    provider: "",
    modelId: model,
    tier,
  };
}

function inferLegacyPhaseGroup(header: string): ThermoPhaseGroup {
  if (/synthesis audit/i.test(header)) return "audit";
  if (/final synthesis/i.test(header)) return "synthesis";
  if (/phase\s*2|cross-validation|validation|validator/i.test(header)) return "validation";
  return "specialist";
}

function roleForPhaseGroup(phaseGroup: ThermoPhaseGroup): ThermoParticipantRole {
  if (phaseGroup === "audit") return "auditor";
  if (phaseGroup === "synthesis") return "synthesizer";
  if (phaseGroup === "validation") return "validator";
  return "primary";
}

function inferLegacyThermoDomain(header: string): string {
  const explicit = header.match(/(?:\*\*Domain:\*\*|^Domain:|^## Domain\s*\n)\s*([^\n]+)/im)?.[1];
  const heading = header.match(/^#.*?\b(architecture|security|correctness|tests?|performance|docs?|documentation|adversarial_noise)\b/im)?.[1];
  return normalizeLegacyThermoDomain(explicit ?? heading ?? "final_synthesis");
}

function normalizeLegacyThermoDomain(value: string): string {
  const normalized = value.toLowerCase();
  if (normalized.includes("architecture")) return "architecture";
  if (normalized.includes("security")) return "security";
  if (normalized.includes("correctness")) return "correctness";
  if (/\btests?\b/.test(normalized)) return "tests";
  if (normalized.includes("performance")) return "performance";
  if (normalized.includes("documentation") || /\bdocs?\b/.test(normalized)) return "docs";
  if (normalized.includes("adversarial_noise")) return "adversarial_noise";
  return "final_synthesis";
}

function legacyDomainCheck(domain: string): string {
  switch (domain) {
    case "architecture":
      return "Architecture, maintainability, module boundaries, abstractions, and long-term change risk.";
    case "security":
      return "Security, auth, authorization, data loss, secrets, privacy, and tenant isolation.";
    case "correctness":
      return "Functional correctness, regressions, edge cases, state handling, and user-visible behavior.";
    case "tests":
      return "Test coverage, fake coverage, missing assertions, brittle tests, and verification gaps.";
    case "performance":
      return "Performance, scalability, resource usage, concurrency, caching, and avoidable repeated work.";
    case "docs":
      return "Documentation, migrations, release notes, operator handoff, and public-facing behavior notes.";
    default:
      return "Final synthesis of validated review findings.";
  }
}

export function readThermoRunPlan(chatDir: string): ThermoRunPlan | null {
  const planPath = path.join(chatDir, "_thermo-plan.json");
  if (!fs.existsSync(planPath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(planPath, "utf-8")) as ThermoRunPlan;
    if (Array.isArray(parsed.phases) && Array.isArray(parsed.domains)) return parsed;
  } catch {
    /* informational sidecar; ignore parse errors */
  }
  return null;
}

export function readThermoRunPlanByChatId(chatId: string): ThermoRunPlan | null {
  return readThermoRunPlan(path.join(os.homedir(), ".code-council", "chats", chatId));
}
```

- [ ] **Step 4: Replace API route duplication**

In `src/app/api/run-artifacts/[chatId]/route.ts`:

Remove local `ThermoParticipantMetadata`, `ThermoRunPlan`, `inferThermoMetadata`, `inferLegacyThermoDomain`, `normalizeLegacyThermoDomain`, `legacyDomainCheck`, and `readThermoPlan`.

Add imports:

```ts
import type { ThermoParticipantMetadata } from "@/lib/thermo-run-types";
import {
  readThermoParticipantMetadata,
  readThermoRunPlanByChatId,
} from "@/lib/server/thermo-run-artifacts";
```

Replace the participant Thermo block with:

```ts
const thermo = readThermoParticipantMetadata(
  path.join(roundDir, d.name),
  answer,
  modelUsed,
);
```

Replace:

```ts
const thermoPlan = readThermoPlan(chatId);
```

with:

```ts
const thermoPlan = readThermoRunPlanByChatId(chatId);
```

- [ ] **Step 5: Replace run page duplication**

In `src/app/runs/[runId]/page.tsx`:

Remove local `inferThermoMetadata`, `inferLegacyThermoDomain`, `normalizeLegacyThermoDomain`, `legacyDomainCheck`, and `readThermoPlan`.

Add imports:

```ts
import {
  readThermoParticipantMetadata,
  readThermoRunPlanByChatId,
} from "@/lib/server/thermo-run-artifacts";
```

Replace the participant Thermo block with:

```ts
const thermo = readThermoParticipantMetadata(
  path.join(roundDir, d.name),
  answer,
  modelUsed,
);
```

Replace:

```ts
const initialThermoPlan = readThermoPlan(chat.id);
```

with:

```ts
const initialThermoPlan = readThermoRunPlanByChatId(chat.id);
```

- [ ] **Step 6: Run focused tests**

Run:

```bash
npm test -- tests/thermo-run-artifacts.test.ts
```

Expected: all tests pass.

- [ ] **Step 7: Typecheck**

Run:

```bash
npm run typecheck
```

Expected: exit 0.

## Task 3: Remove Stale CLI Status Orchestrator Gate

**Files:**
- Modify: `src/components/cli-status-panel.tsx`

- [ ] **Step 1: Remove unused orchestrator type and gate**

In `src/components/cli-status-panel.tsx`, delete:

```ts
interface OrchestratorStatus {
  name: string;
  label: string;
  connected: boolean;
  supported: boolean;
}
```

Delete this block:

```ts
try {
  await fetchFromDaemon<ListEnvelope<OrchestratorStatus>>(
    "/orchestrators",
  );
} catch {
  return null;
}
```

Update the top comment from:

```ts
 * Server component. Fetches both /orchestrators (connection state) and
 * /cli/health (recent failure state) and merges them.
```

to:

```ts
 * Server component. Fetches voices plus /cli/health and merges them.
 * Voice loading controls rendering; health loading is best-effort.
```

- [ ] **Step 2: Typecheck**

Run:

```bash
npm run typecheck
```

Expected: exit 0.

## Task 4: Non-Resumable Thermo Stream State

**Files:**
- Modify: `src/daemon/routes/chats-stream.ts`
- Test: `tests/code-review-route.test.ts` or a new stream-route test using the existing Fastify route harness.

- [ ] **Step 1: Add a stream test for orphaned Thermo chats**

If `tests/code-review-route.test.ts` already has the easiest Fastify harness, add a test with this behavior:

```ts
it("does not mark an orphaned non-terminal Thermo chat failed on stream reattach", async () => {
  const chat = await chats.create({
    work: "Thermo review this git diff",
    template_id: "branch-code-review-thermo",
    attached_files: "[]",
    repo_path: process.cwd(),
    artifact: "# diff",
    yolo: false,
  });
  await chats.update(chat.id, { status: "running", verdict: null, finished_at: null });

  const response = await app.inject({
    method: "GET",
    url: `/api/v1/chats/${chat.id}/stream`,
  });

  expect(response.payload).toContain("thermo_runner_unavailable");
  expect(response.payload).toContain("non_resumable");

  const after = await chats.getBySlugOrId(chat.id);
  expect(after?.status).toBe("running");
  expect(after?.verdict).toBeNull();
  expect(after?.finished_at).toBeNull();
});
```

If the current stream route test harness cannot consume SSE cleanly, use the existing route registration helper and assert the first emitted line before the socket closes. Keep the persisted chat assertions identical.

- [ ] **Step 2: Run the stream test and verify it fails**

Run:

```bash
npm test -- tests/code-review-route.test.ts
```

Expected: fail because the current route updates the chat to `failed`.

- [ ] **Step 3: Change Thermo orphan behavior**

In `src/daemon/routes/chats-stream.ts`, replace the current Thermo block:

```ts
if (chat.template_id === THERMO_TEMPLATE_ID) {
  await chats.update(chatId, {
    status: 'failed',
    verdict: 'failed',
    finished_at: Date.now(),
  });
  const line = `data: ${JSON.stringify({
    chatId,
    type: 'chat_done',
    payload: {
      status: 'failed',
      verdict: 'failed',
      error: {
        code: 'thermo_runner_unavailable',
        message:
          'Thermo code review cannot be resumed from the placeholder template after the active runner is gone. Start a new Thermo review.',
      },
    },
    ts: Date.now(),
  })}\n\n`;
  subscriber.write(line);
  reply.raw.end();
  return;
}
```

with:

```ts
if (chat.template_id === THERMO_TEMPLATE_ID) {
  const line = `data: ${JSON.stringify({
    chatId,
    type: 'chat_done',
    payload: {
      status: 'non_resumable',
      verdict: chat.verdict ?? 'unknown',
      replay: true,
      error: {
        code: 'thermo_runner_unavailable',
        message:
          'Thermo code review cannot be resumed after the active runner is gone. Existing artifacts remain viewable; start a new Thermo review for fresh execution.',
      },
    },
    ts: Date.now(),
  })}\n\n`;
  subscriber.write(line);
  reply.raw.end();
  return;
}
```

Do not add `non_resumable` to `TERMINAL_STATUSES` yet because persisted chat status remains unchanged. The frame is a stream-only state for the live viewer.

- [ ] **Step 4: Make sure the live viewer treats stream-only non_resumable as terminal**

If `src/components/live-run-real/index.tsx` only treats known persisted statuses as terminal, add `non_resumable` handling in the SSE `chat_done` path so polling stops and the header does not show an active spinner.

Use this shape in the existing status normalization area:

```ts
if (payload.status === "non_resumable") {
  setStatus("failed");
  setVerdict(payload.verdict ?? "unknown");
  setShipError(payload.error?.message ?? "Thermo run is not resumable.");
  return;
}
```

Keep this client-only. Do not persist `failed` from the stream route.

- [ ] **Step 5: Run focused stream test**

Run:

```bash
npm test -- tests/code-review-route.test.ts
```

Expected: the orphaned Thermo test passes and existing route tests pass.

## Task 5: Verification

**Files:**
- No code changes unless verification exposes a regression.

- [ ] **Step 1: Run requested focused suite**

Run:

```bash
npm test -- tests/code-review-route.test.ts tests/thermo-code-review.test.ts tests/thermo-review-assignment.test.ts tests/review-model-tiering.test.ts tests/cli-health.test.ts tests/cli-health-check-route.test.ts tests/thermo-run-artifacts.test.ts
```

Expected: all tests pass.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: exit 0.

- [ ] **Step 3: Run lint**

Run:

```bash
npm run lint
```

Expected: exit 0. Existing warnings may remain; no new errors.

- [ ] **Step 4: Browser smoke check**

With dev server running at `http://127.0.0.1:5050`, open:

```text
http://127.0.0.1:5050/code-review
```

Expected:

- Reviewer fleet renders even if `/orchestrators` would fail.
- Existing Thermo run pages still show phase cards and participant metadata.
- If viewing an orphaned non-terminal Thermo run, existing cards/artifacts remain visible and the page surfaces the non-resumable message instead of pretending a new runner is active.

## Self-Review

Spec coverage:

- Shared Thermo metadata/types/helper duplication: covered by Tasks 1 and 2.
- Broad legacy regex fallback: covered by Task 2 with a negative ordinary-prose test.
- CLI status `/orchestrators` gate: covered by Task 3.
- Thermo stream reattach non-resumable artifact-preserving behavior: covered by Task 4.
- Pre-launch assignment preview and critical-gap gating: explicitly deferred as owner decisions.

Placeholder scan:

- No task uses TBD/TODO/fill-in language.
- The only harness-dependent note is constrained to choosing the existing stream test harness while preserving exact assertions.

Type consistency:

- Thermo types are defined once in `src/lib/thermo-run-types.ts`.
- Server helpers return those canonical types.
- Existing UI type imports continue through `src/components/run-viewer/types.ts`.
