# Transitioning Gemini CLI to Antigravity CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transition legacy `gemini-cli` / `gemini` reviewer integration to the new `antigravity-cli` / `antigravity` reviewer integration, matching official Google platform updates, while maintaining absolute backward compatibility.

**Architecture:** We will rename `'gemini-cli'` to `'antigravity-cli'` and update `UILineage` key `"gemini"` to `"antigravity"`. We will rename the agent shim and orchestrator files to `antigravity.ts` while preserving compatibility with legacy settings/database entries via boot-time migration and fallback lookup order (preferring `agy` and falling back to `gemini` binary).

**Tech Stack:** TypeScript, SQLite (LibSQL), Vitest, React, Next.js, Zod

---

### Task 1: Refactor CLI Detection & Paths

**Files:**
- Modify: [cli-detect.ts](file:///Users/albovsky/Projects/code-council/src/lib/cli-detect.ts:21-47)
- Modify: [cli-paths.ts](file:///Users/albovsky/Projects/code-council/src/lib/cli-paths.ts:26-41)
- Test: [cli-detect.test.ts](file:///Users/albovsky/Projects/code-council/tests/cli-detect.test.ts:15-46)

- [ ] **Step 1: Write a failing unit test for Antigravity CLI detection**
  Update the expected IDs in `tests/cli-detect.test.ts` from `'gemini-cli'` to `'antigravity-cli'`.
  ```typescript
  // In tests/cli-detect.test.ts:
  const expectedIds: DetectableCli[] = [
    'claude-code',
    'codex-cli',
    'antigravity-cli',
    'opencode-cli',
    'kimi-cli',
    'grok-cli',
  ];
  ```

- [ ] **Step 2: Run tests to verify the failure**
  Run: `npx vitest tests/cli-detect.test.ts --run`
  Expected: FAIL (Zod schema mismatch or type errors on `gemini-cli` missing/`antigravity-cli` unexpected)

- [ ] **Step 3: Modify cli-detect.ts and cli-paths.ts**
  Rename `'gemini-cli'` to `'antigravity-cli'` in `DetectableCli` and `CliId`.
  ```typescript
  // In src/lib/cli-detect.ts:
  export type DetectableCli =
    | 'claude-code'
    | 'codex-cli'
    | 'antigravity-cli'
    | 'opencode-cli'
    | 'kimi-cli'
    | 'grok-cli';

  const BINARY_NAMES: Record<DetectableCli, readonly string[]> = {
    'claude-code': ['claude'],
    'codex-cli': ['codex'],
    'antigravity-cli': ['agy', 'gemini'],
    'opencode-cli': ['opencode'],
    'kimi-cli': ['kimi'],
    'grok-cli': ['grok'],
  };
  ```
  ```typescript
  // In src/lib/cli-paths.ts:
  export type CliId =
    | 'claude-code'
    | 'codex-cli'
    | 'antigravity-cli'
    | 'opencode-cli'
    | 'kimi-cli'
    | 'grok-cli';

  const ALL_CLI_IDS: readonly CliId[] = [
    'claude-code',
    'codex-cli',
    'antigravity-cli',
    'opencode-cli',
    'kimi-cli',
    'grok-cli',
  ] as const;
  ```

- [ ] **Step 4: Run unit tests to verify they pass**
  Run: `npx vitest tests/cli-detect.test.ts --run`
  Expected: PASS

- [ ] **Step 5: Commit changes**
  ```bash
  git add src/lib/cli-detect.ts src/lib/cli-paths.ts tests/cli-detect.test.ts
  git commit -m "refactor: rename gemini-cli to antigravity-cli in detection"
  ```

---

### Task 2: Refactor Lineage & Brand Maps

**Files:**
- Modify: [lineage-maps.ts](file:///Users/albovsky/Projects/code-council/src/lib/lineage-maps.ts:65-288)
- Test: [lineage-maps.test.ts](file:///Users/albovsky/Projects/code-council/tests/lineage-maps.test.ts)

- [ ] **Step 1: Write a failing unit test for brand mapping**
  Update `tests/lineage-maps.test.ts` to expect `"antigravity"` instead of `"gemini"`.
  ```typescript
  // In tests/lineage-maps.test.ts:
  expect(uiLineageLabel('antigravity')).toBe('Antigravity');
  expect(uiLineageDefaultModel('antigravity')).toBe('gemini-3.5-flash');
  ```

- [ ] **Step 2: Run tests to verify the failure**
  Run: `npx vitest tests/lineage-maps.test.ts --run`
  Expected: FAIL

- [ ] **Step 3: Update lineage-maps.ts**
  Rename the `UILineage` key `"gemini"` to `"antigravity"` and update the label mapping to "Antigravity CLI".
  ```typescript
  // In src/lib/lineage-maps.ts:
  export type UILineage =
    | "claude"
    | "codex"
    | "antigravity"
    | "opencode"
    | "kimi"
    | "openrouter"
    | "local"
    | "grok";

  export const UI_LINEAGE_LABEL: Record<UILineage, string> = {
    claude: "Claude",
    codex: "Codex",
    antigravity: "Antigravity CLI",
    opencode: "OpenCode",
    kimi: "Kimi",
    openrouter: "OpenRouter",
    local: "Local LLM",
    grok: "Grok",
  };

  const UI_LINEAGE_DOT: Record<UILineage, string> = {
    claude: "bg-violet-400",
    codex: "bg-orange-400",
    antigravity: "bg-blue-400",
    opencode: "bg-emerald-400",
    kimi: "bg-pink-400",
    openrouter: "bg-cyan-400",
    local: "bg-teal-400",
    grok: "bg-slate-400",
  };

  export const UI_LINEAGE_DEFAULT_MODEL: Record<UILineage, string> = {
    claude: "claude-opus-4-7",
    codex: "gpt-5.5",
    antigravity: "gemini-3.5-flash",
    opencode: "kimi-k2.6",
    kimi: "kimi-k2.6",
    openrouter: "",
    local: "",
    grok: "grok-build",
  };

  export const UI_LINEAGE_AVAILABLE_MODELS: Partial<Record<UILineage, string[]>> = {
    claude: [
      "claude-opus-4-7",
      "claude-sonnet-4-6",
      "claude-sonnet-4-5",
      "claude-haiku-4-5",
      "claude-opus-4-5",
    ],
    codex: [
      "gpt-5.5",
      "gpt-5.4",
      "gpt-5.4-mini",
      "gpt-5.3-codex",
      "gpt-5.2",
    ],
    antigravity: [...GOOGLE_AGY_MODELS],
    kimi: [
      "kimi-k2.6",
      "kimi-k2-thinking-turbo",
      "kimi-k2-turbo-preview",
      "kimi-k2-thinking",
      "kimi-k2.5",
    ],
    grok: ['grok-build'],
  };

  export const UI_LINEAGE_BRAND: Record<UILineage, LineageBrand> = {
    claude: {
      dot: "bg-violet-400",
      ring: "ring-violet-400/40",
      gradient: "bg-gradient-to-b from-violet-500/15 to-card",
    },
    codex: {
      dot: "bg-orange-400",
      ring: "ring-orange-400/40",
      gradient: "bg-gradient-to-b from-orange-500/15 to-card",
    },
    antigravity: {
      dot: "bg-blue-400",
      ring: "ring-blue-400/40",
      gradient: "bg-gradient-to-b from-blue-500/15 to-card",
    },
    opencode: {
      dot: "bg-emerald-400",
      ring: "ring-emerald-400/40",
      gradient: "bg-gradient-to-b from-emerald-500/15 to-card",
    },
    kimi: {
      dot: "bg-pink-400",
      ring: "ring-pink-400/40",
      gradient: "bg-gradient-to-b from-pink-500/15 to-card",
    },
    openrouter: {
      dot: "bg-cyan-400",
      ring: "ring-cyan-400/40",
      gradient: "bg-gradient-to-b from-cyan-500/15 to-card",
    },
    local: {
      dot: "bg-teal-400",
      ring: "ring-teal-400/40",
      gradient: "bg-gradient-to-b from-teal-500/15 to-card",
    },
    grok: {
      dot: "bg-slate-400",
      ring: "ring-slate-400/40",
      gradient: "bg-gradient-to-b from-slate-500/15 to-card",
    },
  };
  ```

- [ ] **Step 4: Run lineage maps tests and verify they pass**
  Run: `npx vitest tests/lineage-maps.test.ts --run`
  Expected: PASS

- [ ] **Step 5: Commit changes**
  ```bash
  git add src/lib/lineage-maps.ts tests/lineage-maps.test.ts
  git commit -m "refactor: rename gemini lineage to antigravity in lineage-maps"
  ```

---

### Task 3: Database & Settings Boot Migration

**Files:**
- Modify: [connection.ts](file:///Users/albovsky/Projects/code-council/src/lib/db/connection.ts:228-245)
- Modify: [voices.ts](file:///Users/albovsky/Projects/code-council/src/lib/voices.ts:30-44)
- Test: [voices.test.ts](file:///Users/albovsky/Projects/code-council/tests/voices.test.ts)

- [ ] **Step 1: Write a failing database migration test**
  Add a test inside `tests/voices.test.ts` verifying that legacy `'gemini-cli'` voice rows and settings migrate on startup to `'antigravity-cli'`.
  ```typescript
  // In tests/voices.test.ts:
  it('automatically migrates gemini-cli database entries and settings to antigravity-cli', async () => {
    const db = await getDb();
    // seed legacy row
    await db.execute({
      sql: `INSERT INTO voices (id, label, source, provider, model_id, lineage, created_at, updated_at)
            VALUES ('gemini-cli', 'Gemini (gemini-2.5-pro)', 'cli', 'gemini-cli', 'gemini-2.5-pro', 'google', 123, 123)`,
    });
    // trigger migration / boot
    await _resetDbForTests();
    await getDb();

    const migrated = await voices.getById('antigravity-cli');
    expect(migrated).not.toBeNull();
    expect(migrated?.provider).toBe('antigravity-cli');
    
    const legacy = await voices.getById('gemini-cli');
    expect(legacy).toBeNull();
  });
  ```

- [ ] **Step 2: Run database tests to verify failure**
  Run: `npx vitest tests/voices.test.ts --run`
  Expected: FAIL

- [ ] **Step 3: Implement DB migration inside initDb()**
  Add migration queries in `src/lib/db/connection.ts` just after `voices` table schema check.
  ```typescript
  // In src/lib/db/connection.ts:
  // Migrate historical gemini-cli database entries to antigravity-cli
  await db.execute(`
    UPDATE voices
    SET id = REPLACE(id, 'gemini-cli', 'antigravity-cli'),
        provider = 'antigravity-cli'
    WHERE provider = 'gemini-cli'
  `);
  ```

- [ ] **Step 4: Run unit tests to verify they pass**
  Run: `npx vitest tests/voices.test.ts --run`
  Expected: PASS

- [ ] **Step 5: Commit changes**
  ```bash
  git add src/lib/db/connection.ts tests/voices.test.ts
  git commit -m "migration: implement boot migration from gemini-cli to antigravity-cli"
  ```

---

### Task 4: Refactor Voice Seeder

**Files:**
- Modify: [voices.ts](file:///Users/albovsky/Projects/code-council/src/lib/voices.ts:31-62)
- Modify: [voices.ts](file:///Users/albovsky/Projects/code-council/src/lib/voices.ts:516-536)
- Test: [voices-seed.test.ts](file:///Users/albovsky/Projects/code-council/tests/voices-seed.test.ts:323-342)

- [ ] **Step 1: Write failing tests for voice seeding**
  Update `tests/voices-seed.test.ts` to expect `'antigravity'` and `'antigravity-cli'`.
  ```typescript
  // In tests/voices-seed.test.ts:
  expect(googleModelCatalogForCommand('/Users/me/.local/bin/agy')).toEqual([
    'gemini-3.5-flash',
    'gemini-3.1-pro-high',
    'gemini-3.1-pro-low',
    'gemini-3-flash',
  ]);
  ```

- [ ] **Step 2: Run voice seeding tests**
  Run: `npx vitest tests/voices-seed.test.ts --run`
  Expected: FAIL

- [ ] **Step 3: Update voices.ts seeder type and mappings**
  Replace `gemini` with `antigravity` in `UiLineage` type, `LINEAGE_TO_UI` and `SINGLE_MODEL_CLIS` lists. Also, add the settings migration:
  ```typescript
  // In src/lib/voices.ts:
  type UiLineage = 'claude' | 'codex' | 'antigravity' | 'opencode' | 'kimi' | 'grok';

  const LINEAGE_TO_UI: Record<DaemonLineage, UiLineage> = {
    anthropic: 'claude',
    openai: 'codex',
    google: 'antigravity',
    opencode: 'opencode',
    moonshot: 'kimi',
    grok: 'grok',
  };

  const SINGLE_MODEL_CLIS: ReadonlyArray<{
    cli: DetectableCli;
    provider: string;
    lineage: DaemonLineage;
  }> = [
    { cli: 'claude-code', provider: 'claude-code', lineage: 'anthropic' },
    { cli: 'codex-cli', provider: 'codex-cli', lineage: 'openai' },
    { cli: 'antigravity-cli', provider: 'antigravity-cli', lineage: 'google' },
    { cli: 'kimi-cli', provider: 'kimi-cli', lineage: 'moonshot' },
    { cli: 'grok-cli', provider: 'grok-cli', lineage: 'grok' },
  ];
  ```
  Update `readMigrationSettings` to copy legacy `gemini.enabled_models` to `antigravity.enabled_models` if it exists:
  ```typescript
  // In readMigrationSettings inside src/lib/voices.ts:
  const lineages: UiLineage[] = ['claude', 'codex', 'antigravity', 'kimi', 'opencode'];
  
  // Settings key migration
  const legacyModels = await settings.get('gemini.enabled_models');
  if (legacyModels !== null && legacyModels !== undefined) {
    const currentModels = await settings.get('antigravity.enabled_models');
    if (currentModels === null || currentModels === undefined) {
      await settings.set('antigravity.enabled_models', legacyModels);
    }
  }
  ```

- [ ] **Step 4: Run voice seeding tests to verify they pass**
  Run: `npx vitest tests/voices-seed.test.ts --run`
  Expected: PASS

- [ ] **Step 5: Commit changes**
  ```bash
  git add src/lib/voices.ts tests/voices-seed.test.ts
  git commit -m "refactor: update voices seeder & settings migration to antigravity"
  ```

---

### Task 5: Refactor Agent Shim & Orchestrator

**Files:**
- Rename: `src/daemon/agents/gemini.ts` -> `src/daemon/agents/antigravity.ts`
- Modify: `src/daemon/agents/index.ts`
- Rename: `src/daemon/orchestrators/gemini.ts` -> `src/daemon/orchestrators/antigravity.ts`
- Modify: `src/daemon/orchestrators/index.ts`
- Modify: `src/daemon/orchestrators/shared.ts`
- Rename: `tests/gemini-shell-collapse.test.ts` -> `tests/antigravity-shell-collapse.test.ts`
- Rename/Modify: `tests/agy-orchestrator.test.ts`

- [ ] **Step 1: Write failing tests for renamed agents and orchestrators**
  Rename `tests/gemini-shell-collapse.test.ts` to `tests/antigravity-shell-collapse.test.ts` and modify to import `antigravityShim` instead of `geminiShim`. Update `tests/agy-orchestrator.test.ts` to import `registerAgyMcpPlugin` from `@/daemon/orchestrators/antigravity` instead of `gemini`.
  ```typescript
  // In tests/antigravity-shell-collapse.test.ts:
  import { antigravityShim } from '../src/daemon/agents/antigravity';
  ```

- [ ] **Step 2: Run tests and watch them fail / throw compilation error**
  Run: `npx vitest tests/antigravity-shell-collapse.test.ts --run`
  Expected: FAIL (Cannot find module error)

- [ ] **Step 3: Rename and refactor files**
  1. Move `src/daemon/agents/gemini.ts` to `src/daemon/agents/antigravity.ts`.
     Refactor inside `src/daemon/agents/antigravity.ts`:
     - Rename `geminiShim` to `antigravityShim`
     - Update name to `'antigravity-cli'`
     - Change references of `'gemini-cli'` to `'antigravity-cli'`
  2. Update `src/daemon/agents/index.ts`:
     ```typescript
     import { antigravityShim } from './antigravity.js';
     // ...
     const SHIMS: Record<Lineage, AgentShim> = {
       // ...
       google: antigravityShim,
     };
     ```
  3. Move `src/daemon/orchestrators/gemini.ts` to `src/daemon/orchestrators/antigravity.ts`.
     Refactor inside `src/daemon/orchestrators/antigravity.ts`:
     - Rename `geminiOrchestrator` to `antigravityOrchestrator`
     - Change reference of `'gemini-cli'` to `'antigravity-cli'`
     - Change `name` inside `antigravityOrchestrator` status to `'antigravity'`
  4. Update `src/daemon/orchestrators/shared.ts`:
     ```typescript
     export type OrchestratorName =
       | 'claude'
       | 'codex'
       | 'antigravity'
       | 'opencode'
       | 'kimi'
       | 'grok'
       | 'cursor'
       | 'windsurf';
     ```
  5. Update `src/daemon/orchestrators/index.ts`:
     ```typescript
     import { antigravityOrchestrator } from './antigravity.js';
     // ...
     const ORCHESTRATORS: OrchestratorDefinition[] = [
       claudeOrchestrator,
       codexOrchestrator,
       antigravityOrchestrator,
       // ...
     ];
     ```

- [ ] **Step 4: Run tests and verify they pass**
  Run: `npx vitest tests/antigravity-shell-collapse.test.ts tests/agy-orchestrator.test.ts --run`
  Expected: PASS

- [ ] **Step 5: Commit changes**
  ```bash
  git add src/daemon/agents/ src/daemon/orchestrators/ tests/antigravity-shell-collapse.test.ts tests/agy-orchestrator.test.ts
  git commit -m "refactor: rename agent and orchestrator from gemini to antigravity"
  ```

---

### Task 6: Update UI, Onboarding & Frontend Mappings

**Files:**
- Modify: [page.tsx](file:///Users/albovsky/Projects/code-council/src/app/connect/page.tsx:17)
- Modify: [cli-section.tsx](file:///Users/albovsky/Projects/code-council/src/app/onboarding/cli-section.tsx:35-45)
- Modify: [helpers.ts](file:///Users/albovsky/Projects/code-council/src/app/onboarding/helpers.ts:28-99)
- Modify: [cli-status-panel.tsx](file:///Users/albovsky/Projects/code-council/src/components/cli-status-panel.tsx:62)
- Modify: [orchestrator-card.tsx](file:///Users/albovsky/Projects/code-council/src/components/orchestrator-card.tsx:30)
- Modify: [helpers.ts](file:///Users/albovsky/Projects/code-council/src/components/live-run-real/helpers.ts:8)
- Modify: [round-view.tsx](file:///Users/albovsky/Projects/code-council/src/components/run-viewer/round-view.tsx:58)
- Modify: [route.ts](file:///Users/albovsky/Projects/code-council/src/app/api/run-artifacts/[chatId]/route.ts:55)
- Modify: [page.tsx](file:///Users/albovsky/Projects/code-council/src/app/runs/[runId]/page.tsx:51)

- [ ] **Step 1: Modify mappings in connect & onboarding components**
  Update the CLI maps mapping to `'antigravity-cli'` / `'antigravity'`.
  ```typescript
  // In src/app/connect/page.tsx:
  antigravity: "antigravity-cli",
  ```
  ```typescript
  // In src/app/onboarding/cli-section.tsx:
  "antigravity-cli": "antigravity",
  ```
  ```typescript
  // In src/app/onboarding/helpers.ts:
  id: "antigravity-cli",
  // ...
  case "antigravity-cli":
  ```
  ```typescript
  // In src/components/cli-status-panel.tsx:
  antigravity: "antigravity-cli",
  ```
  ```typescript
  // In src/components/orchestrator-card.tsx:
  antigravity: "antigravity-cli",
  ```

- [ ] **Step 2: Modify mappings in run viewer components**
  ```typescript
  // In src/components/live-run-real/helpers.ts:
  antigravity: "antigravity-cli",
  ```
  ```typescript
  // In src/app/api/run-artifacts/[chatId]/route.ts:
  "antigravity-cli": "antigravity",
  ```
  ```typescript
  // In src/app/runs/[runId]/page.tsx:
  "antigravity-cli": "antigravity",
  ```

- [ ] **Step 3: Compile and lint check**
  Run: `npm run build` or type check: `npx tsc --noEmit`
  Expected: Compilation succeeds without type errors.

- [ ] **Step 4: Commit changes**
  ```bash
  git add src/app/ src/components/
  git commit -m "frontend: update gemini to antigravity UI mappings"
  ```

---

### Task 7: Update CLI commands references

**Files:**
- Modify: [doctor.ts](file:///Users/albovsky/Projects/code-council/src/cli/commands/doctor.ts:60)
- Modify: [init.ts](file:///Users/albovsky/Projects/code-council/src/cli/commands/init.ts:35-249)
- Modify: [quickstart.ts](file:///Users/albovsky/Projects/code-council/src/cli/commands/quickstart.ts:195)
- Modify: [connect.ts](file:///Users/albovsky/Projects/code-council/src/cli/connect.ts:26)

- [ ] **Step 1: Update doctor, init, and quickstart commands**
  Update references from `'gemini-cli'` to `'antigravity-cli'` and name mappings from `'gemini'` to `'antigravity'`.
  ```typescript
  // In src/cli/commands/doctor.ts:
  'antigravity-cli': 'agy/gemini',
  ```
  ```typescript
  // In src/cli/commands/init.ts:
  'antigravity-cli': 'agy/gemini',
  ```
  ```typescript
  // In src/cli/connect.ts:
  const ALL_NAMES = ['claude', 'codex', 'antigravity', 'opencode', 'kimi', 'cursor', 'windsurf'] as const;
  ```

- [ ] **Step 2: Run typecheck to verify everything compiles**
  Run: `npx tsc --noEmit`
  Expected: PASS

- [ ] **Step 3: Run full vitest suite**
  Run: `npm test`
  Expected: All tests pass

- [ ] **Step 4: Commit changes**
  ```bash
  git add src/cli/
  git commit -m "cli: rename gemini references in CLI commands to antigravity"
  ```

---

## Verification Plan

### Automated Tests
- Run `npm test` to run all unit tests including modified ones for `cli-detect`, `lineage-maps`, `voices`, and `antigravity-shell-collapse`.
- Run typecheck: `npx tsc --noEmit` to ensure no broken imports or stale type definitions exist.

### Manual Verification
- Start the server using `npm run dev` and navigate to the Connect page in a browser to check that the premium "Antigravity CLI" is displayed properly.
- Run `council doctor` and `council diagnose` in the terminal to verify the detection logic outputs correctly.
