/**
 * Voices seed + migration logic.
 *
 * Two phases per planning/voices.md:
 *   - Phase 1 (synchronous, pre-listen): seed single-model CLIs +
 *     auto-disable absent CLIs + first-boot migration from
 *     <lineage>.enabled_models settings.
 *   - Phase 2 (background warmup, post-listen): shell out to
 *     `opencode models`, seed gateway-prefixed multi-model voices.
 *     Allowed up to 10s timeout. Daemon doesn't block boot on this.
 *
 * Single-model CLIs use IMMUTABLE IDs. Versioned model upgrades rewrite
 * model_id+label without rotating the row's primary key (gem-2 round 1
 * BLOCKER 3).
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { detectAllClis, type DetectableCli } from './cli-detect.js';
import { settings, voices, type VoiceUpsertInput } from './db/index.js';
import { UI_LINEAGE_AVAILABLE_MODELS } from './lineage-maps.js';

const run = promisify(execFile);

type DaemonLineage = 'anthropic' | 'openai' | 'google' | 'opencode' | 'moonshot';
type UiLineage = 'claude' | 'codex' | 'gemini' | 'opencode' | 'kimi';

/**
 * Daemon-side lineage → UI-side lineage (for UI_LINEAGE_AVAILABLE_MODELS
 * lookup, which is keyed by UI names — per round 2 cdx-1 BLOCKER).
 */
const LINEAGE_TO_UI: Record<DaemonLineage, UiLineage> = {
  anthropic: 'claude',
  openai: 'codex',
  google: 'gemini',
  opencode: 'opencode',
  moonshot: 'kimi',
};

/**
 * Single-model CLIs: each maps to (provider, daemon-lineage). Used by
 * Phase 1 seed. The provider IS the voice's immutable id.
 */
const SINGLE_MODEL_CLIS: ReadonlyArray<{
  cli: DetectableCli;
  provider: string;
  lineage: DaemonLineage;
}> = [
  { cli: 'claude-code', provider: 'claude-code', lineage: 'anthropic' },
  { cli: 'codex-cli', provider: 'codex-cli', lineage: 'openai' },
  { cli: 'gemini-cli', provider: 'gemini-cli', lineage: 'google' },
  { cli: 'kimi-cli', provider: 'kimi-cli', lineage: 'moonshot' },
];

/**
 * OpenCode gateway model name → (lineage, vendor_family). The model name
 * suffix drives the mapping, not the gateway prefix — `opencode-go/kimi-*`
 * and `opencode-zen/kimi-*` are both lineage=moonshot. Diversity scoring
 * reads `lineage`; cost UX reads `vendor_family`.
 */
function classifyOpencodeModel(qualified: string): {
  lineage: DaemonLineage;
  vendor_family: string | null;
} {
  // Strip gateway prefix; everything after the first slash is the model name.
  const slash = qualified.indexOf('/');
  const tail = slash >= 0 ? qualified.slice(slash + 1) : qualified;
  const t = tail.toLowerCase();

  if (t.includes('kimi')) return { lineage: 'moonshot', vendor_family: null };
  if (t.includes('claude')) return { lineage: 'anthropic', vendor_family: null };
  // OpenAI naming includes both `gpt-*` (chat models) and `o1*`/`o3*`/`o4*`
  // (reasoning models — round 1 gem-2 MED). Match the reasoning prefix at
  // a word boundary so `gpt-o-something` isn't false-matched.
  if (t.includes('gpt') || /(?:^|[^a-z])o[1-9](?:$|[^a-z0-9])/.test(t)) {
    return { lineage: 'openai', vendor_family: null };
  }
  if (t.includes('gemini')) return { lineage: 'google', vendor_family: null };
  if (t.includes('deepseek')) return { lineage: 'opencode', vendor_family: 'deepseek' };
  if (t.includes('llama') || t.includes('meta')) return { lineage: 'opencode', vendor_family: 'meta' };
  if (t.includes('mistral') || t.includes('mixtral')) return { lineage: 'opencode', vendor_family: 'mistral' };
  if (t.includes('grok') || t.includes('xai')) return { lineage: 'opencode', vendor_family: 'xai' };
  return { lineage: 'opencode', vendor_family: null };
}

/**
 * Phase 1 — synchronous seed for single-model CLIs.
 *
 * - For each detected single-model CLI: upsert immutable voice row
 *   (id = provider) with the latest model from
 *   UI_LINEAGE_AVAILABLE_MODELS[ui_lineage][0].
 * - For each previously-detected single-model CLI now absent: set
 *   enabled=0 (auto-disable, NOT delete) — phase composition shouldn't
 *   dispatch to a CLI the user uninstalled.
 * - First-boot migration: if voices table is empty AND <lineage>.enabled_models
 *   settings exist, seed disabled rows for non-enabled curated models so
 *   the user's prior toggles are preserved.
 *
 * Returns counts for logging.
 */
export async function seedCliVoices(): Promise<{
  added: number;
  updated: number;
  disabled: number;
}> {
  const detect = detectAllClis();
  const detectedById = new Map(detect.map((d) => [d.id, d]));

  // First-boot migration: only fires when voices table is completely empty
  // AND at least one <lineage>.enabled_models setting exists (i.e. the user
  // is upgrading from v0.7 hardening cycle, not starting fresh).
  const existingVoices = await voices.list();
  const isFirstBoot = existingVoices.length === 0;
  const migrationData = isFirstBoot ? await readMigrationSettings() : null;

  let added = 0;
  let updated = 0;
  let disabled = 0;

  // === Phase 1a: single-model CLIs ===
  // Two cases per CLI:
  //   - DETECTED: upsert the immutable provider row with the latest model
  //     + (on first boot) seed curated non-default rows so fleet cards
  //     can list them.
  //   - NOT DETECTED on first boot but settings exist: migrate anyway
  //     (round 1 cdx-1 BLOCKER — otherwise the user's gemini.enabled_models
  //     would never migrate if gemini-cli isn't installed yet, and once
  //     voices table is non-empty the migration won't re-fire). Rows seed
  //     with the migrated enabled state; later when the CLI installs,
  //     voices.upsert preserves enabled and just rewrites model_id+label.
  //   - NOT DETECTED on regular boot (existing row enabled): auto-disable.
  for (const { cli, provider, lineage } of SINGLE_MODEL_CLIS) {
    const detected = detectedById.get(cli);
    const existingRow = existingVoices.find((v) => v.id === provider);
    const uiLineage = LINEAGE_TO_UI[lineage];
    const models = UI_LINEAGE_AVAILABLE_MODELS[uiLineage] ?? [];
    const latestModel = models[0] ?? `${cli}-default`;
    const label = `${humanLineageLabel(lineage)} (${latestModel})`;

    if (detected?.found) {
      // First-boot migration logic: if migrating, set enabled per the
      // user's prior settings (default model = enabled by default per
      // absent-key semantics; explicit empty array = no model enabled;
      // populated array = check membership).
      const enabledOverride = migrationData
        ? migrationFor(migrationData, uiLineage, latestModel)
        : undefined;

      const before = await voices.getById(provider);
      await voices.upsert({
        id: provider,
        label,
        source: 'cli',
        provider,
        model_id: latestModel,
        lineage,
        ...(enabledOverride !== undefined ? { enabled: enabledOverride } : {}),
      });
      if (before) updated++;
      else added++;

      // First-boot migration: also seed the curated non-default models as
      // disabled (or enabled per user's setting) so the fleet card lists
      // them and the user can flip them on.
      if (migrationData) {
        for (const m of models.slice(1)) {
          const id = `${provider}:${m}`;
          // Skip if already exists (defensive); these are net-new on first boot.
          if (await voices.getById(id)) continue;
          const enabled = migrationFor(migrationData, uiLineage, m) ?? false;
          await voices.upsert({
            id,
            label: `${humanLineageLabel(lineage)} (${m})`,
            source: 'cli',
            provider,
            model_id: m,
            lineage,
            enabled,
          });
          added++;
        }
      }
    } else if (existingRow && existingRow.enabled) {
      // Regular boot, CLI was present last boot but is now absent —
      // auto-disable (not delete). Per round 1 deepseek MED.
      await voices.update(provider, { enabled: false });
      disabled++;
    } else if (isFirstBoot && migrationData && hasMigrationDataFor(migrationData, uiLineage)) {
      // First boot, CLI not currently detected, but the user has a prior
      // <lineage>.enabled_models setting — migrate the rows now so the
      // intent isn't lost. When the CLI later installs, voices.upsert
      // preserves the enabled state. Per round 1 cdx-1 BLOCKER.
      const enabledOverride = migrationFor(migrationData, uiLineage, latestModel);
      await voices.upsert({
        id: provider,
        label,
        source: 'cli',
        provider,
        model_id: latestModel,
        lineage,
        ...(enabledOverride !== undefined ? { enabled: enabledOverride } : {}),
      });
      added++;
      for (const m of models.slice(1)) {
        const id = `${provider}:${m}`;
        const enabled = migrationFor(migrationData, uiLineage, m) ?? false;
        await voices.upsert({
          id,
          label: `${humanLineageLabel(lineage)} (${m})`,
          source: 'cli',
          provider,
          model_id: m,
          lineage,
          enabled,
        });
        added++;
      }
    }
  }

  return { added, updated, disabled };
}

/**
 * Whether the migration data has an EXPLICIT setting (not absent) for
 * this lineage. Empty array still counts — that's the user explicitly
 * disabling everything in v0.7. Absent (undefined value) means the
 * user never touched this lineage; in that case we don't seed anything
 * for an undetected CLI (no migration intent to preserve).
 */
function hasMigrationDataFor(data: MigrationData, ui: UiLineage): boolean {
  return data.byUiLineage.get(ui) !== undefined;
}

/**
 * Phase 2 — background warmup for OpenCode multi-model voices. Called
 * AFTER `fastify.listen()` so a slow/broken `opencode models` shell-out
 * doesn't add up to 10s of boot latency. Best-effort; logs but never
 * crashes the daemon.
 */
export async function seedOpencodeVoicesAsync(): Promise<{
  added: number;
  updated: number;
  disabled: number;
} | null> {
  const detect = detectAllClis();
  const opencode = detect.find((d) => d.id === 'opencode-cli');
  const existingOpencode = await voices.list({ provider: 'opencode-cli' });

  if (!opencode?.found) {
    // CLI not detected — auto-disable any existing opencode voices.
    let disabled = 0;
    for (const v of existingOpencode) {
      if (v.enabled) {
        await voices.update(v.id, { enabled: false });
        disabled++;
      }
    }
    return { added: 0, updated: 0, disabled };
  }

  let modelList: string[];
  try {
    const { stdout } = await run('opencode', ['models'], { timeout: 10_000 });
    modelList = stdout
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
  } catch {
    // Shell-out failed (timeout, ENOENT after path mutation, etc.) — log
    // and skip. Existing voices stay as-is until the next successful boot.
    return null;
  }

  // Default picks for first-install (no migrated settings) — the fleet's
  // chosen subset.
  const FLEET_DEFAULTS = new Set([
    'opencode-go/kimi-k2.6',
    'opencode-go/deepseek-v4-pro',
  ]);

  const migration = await readOpencodeMigration();
  const isFirstBoot = existingOpencode.length === 0;

  let added = 0;
  let updated = 0;
  let disabled = 0;

  const seenIds = new Set<string>();

  // Iterate the FULL discovered list so disabled-but-discoverable models
  // get rows for the user to re-enable (cdx-1 round 1 MED).
  for (const qualified of modelList) {
    const id = `opencode-cli:${qualified}`;
    seenIds.add(id);
    const { lineage, vendor_family } = classifyOpencodeModel(qualified);
    const label = qualified;

    const before = await voices.getById(id);

    // Initial enabled state for first-time-seen rows:
    //   - Migrating from settings: per the user's prior selection.
    //   - First install (no settings): fleet defaults are enabled, others off.
    //   - Already-existing row: voices.upsert preserves enabled; the
    //     `enabled` arg is ignored when the row already exists.
    let initialEnabled: boolean;
    if (migration) {
      initialEnabled = migrationFor(migration, 'opencode', qualified) ?? false;
    } else if (isFirstBoot) {
      initialEnabled = FLEET_DEFAULTS.has(qualified);
    } else {
      // Defensive default for net-new models showing up later — disabled
      // so the user opts in via the fleet card.
      initialEnabled = false;
    }

    await voices.upsert({
      id,
      label,
      source: 'cli',
      provider: 'opencode-cli',
      model_id: qualified,
      lineage,
      vendor_family,
      enabled: initialEnabled,
    });

    if (before) updated++;
    else added++;
  }

  return { added, updated, disabled };
}

// ============================================================
// Migration helpers — read v0.7 <lineage>.enabled_models settings.
// ============================================================

interface MigrationData {
  /** undefined: setting absent (use default-model fallback per cdx-1 MED).
   *  string[]: explicit list (empty = none enabled; populated = exact set). */
  byUiLineage: Map<UiLineage, string[] | undefined>;
}

async function readMigrationSettings(): Promise<MigrationData> {
  const byUiLineage = new Map<UiLineage, string[] | undefined>();
  const lineages: UiLineage[] = ['claude', 'codex', 'gemini', 'kimi', 'opencode'];
  for (const ui of lineages) {
    const raw = await settings.get(`${ui}.enabled_models`);
    if (raw === null || raw === undefined) {
      byUiLineage.set(ui, undefined);
    } else if (Array.isArray(raw)) {
      byUiLineage.set(ui, raw.filter((x): x is string => typeof x === 'string'));
    } else {
      byUiLineage.set(ui, undefined);
    }
  }
  return { byUiLineage };
}

async function readOpencodeMigration(): Promise<MigrationData | null> {
  const raw = await settings.get('opencode.enabled_models');
  if (raw === null || raw === undefined) return null;
  const list = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : undefined;
  const byUiLineage = new Map<UiLineage, string[] | undefined>([['opencode', list]]);
  return { byUiLineage };
}

/**
 * Migration semantics (per cdx-1 round 1 MED):
 *   - Setting absent → undefined → "default model only" (return undefined
 *     here; caller treats undefined as "use the default = enabled").
 *   - Empty array → return false (no models enabled).
 *   - Populated array → return whether `model` is in the list.
 *
 * Special-case for the latest/default model: when the setting is absent,
 * we want default model = enabled and other curated models = disabled. The
 * caller (seedCliVoices) checks `migrationFor(... defaultModel)` separately
 * from non-default models and applies this fallback for the default only.
 */
function migrationFor(
  data: MigrationData,
  uiLineage: UiLineage,
  model: string,
): boolean | undefined {
  const list = data.byUiLineage.get(uiLineage);
  if (list === undefined) {
    // Absent: use the default-model rule. The first model in
    // UI_LINEAGE_AVAILABLE_MODELS[uiLineage] is the default; everything
    // else is disabled. For OpenCode the "default" is determined by the
    // FLEET_DEFAULTS set, not this function — caller handles that.
    if (uiLineage === 'opencode') return undefined;
    const models = UI_LINEAGE_AVAILABLE_MODELS[uiLineage] ?? [];
    return models[0] === model;
  }
  if (list.length === 0) return false;
  return list.includes(model);
}

function humanLineageLabel(l: DaemonLineage): string {
  switch (l) {
    case 'anthropic': return 'Claude';
    case 'openai': return 'Codex';
    case 'google': return 'Gemini';
    case 'opencode': return 'OpenCode';
    case 'moonshot': return 'Kimi';
  }
}

/** @internal — exported for unit tests. */
export const _internals = {
  classifyOpencodeModel,
  migrationFor,
  LINEAGE_TO_UI,
  SINGLE_MODEL_CLIS,
};
