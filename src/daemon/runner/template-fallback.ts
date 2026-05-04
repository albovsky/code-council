/**
 * Template-level fallback chain.
 *
 * Per-slot fallback (`candidate.models[]`) handles "if claude-opus fails, try
 * claude-sonnet" — same lineage, same shim, same auth, just a different
 * `--model` argv.
 *
 * Template-level fallback (`template.fallback[]`) is the catch-all that fires
 * when ANY slot exhausts its per-slot chain. The user sets it once at the
 * template root, and chorus applies it to every slot — same lineage chains
 * first, then cross-lineage entries (v0.8: a codex reviewer hitting quota
 * can fall through to a claude or gemini fallback).
 *
 * Strict (lineage, model) dedup:
 *   - Skip a fallback row that matches the slot's own current model — would
 *     just fail again.
 *   - Skip a fallback row that matches ANOTHER active slot in the same
 *     phase. Example: reviewers=[kimi, deepseek] + fallback=[kimi]
 *     should NOT spawn a second kimi reviewer when deepseek fails.
 *   - Cross-lineage fallback dedup uses (lineage, model) tuples so two slots
 *     of different lineages on the same model name (rare) don't collide.
 *
 * v0.8 cross-lineage swap:
 *   When a fallback's lineage differs from the slot's, the runner re-resolves
 *   the shim from the agent registry (`pickShimForVoice(entry.lineage,
 *   entry.model)`) for that one attempt. The slot's identity (agentName,
 *   on-disk dir, participant key) stays bound to the slot's primary lineage
 *   so the cockpit card doesn't re-key mid-run; the runner emits a
 *   `cli_warning` with `reason: 'lineage_fallback'` so the UI can show
 *   "switched to claude-opus-4-7 (cross-lineage)".
 */

interface SlotLike {
  /** Cockpit-side or daemon-side lineage — must compare apples to apples. */
  lineage: string;
  /** Index 0 holds the slot's primary model; subsequent are per-slot fallbacks. */
  models: string[];
}

interface FallbackRow {
  lineage: string;
  models: string[];
}

/**
 * One chain entry — a (lineage, model) tuple to try. The runner picks the
 * shim per entry via `pickShimForVoice`. `model` is undefined when the
 * lineage's CLI default should be used (rare; happens when a slot has no
 * `models` declared at all).
 */
export interface ChainEntry {
  lineage: string;
  model: string | undefined;
}

/**
 * Compose the slot's effective (lineage, model) chain by appending matching
 * template fallbacks (deduped) onto the slot's per-slot chain. The chain
 * mixes the slot's primary lineage with cross-lineage fallbacks at the
 * tail; the runner walks it in order, picking the right shim per entry.
 *
 * Caller is responsible for passing a stable `lineage` value across all
 * slots and template-fallback rows (don't mix cockpit-side and daemon-side
 * names in the same call).
 *
 * @param slot          The slot whose chain we're building (its primary +
 *                      its per-slot fallbacks).
 * @param activeSlots   All slots in the same phase, including `slot`. Used
 *                      to dedup template fallbacks that would duplicate an
 *                      already-running voice.
 * @param templateFallback The template-root `fallback` array (or undefined).
 * @returns Extended (lineage, model) chain — slot.models first, then
 *          deduped template fallbacks (same-lineage and cross-lineage).
 */
export function buildSlotFallbackChain(
  slot: SlotLike,
  activeSlots: readonly SlotLike[],
  templateFallback: readonly FallbackRow[] | undefined,
): ChainEntry[] {
  const chain: ChainEntry[] = (slot.models ?? []).map((m) => ({
    lineage: slot.lineage,
    model: m,
  }));

  // Slot with no models at all: emit one undefined entry so the runner makes
  // exactly one attempt with the lineage default.
  if (chain.length === 0) {
    chain.push({ lineage: slot.lineage, model: undefined });
  }

  if (!templateFallback || templateFallback.length === 0) return chain;

  // Pre-compute the dedup set: every (lineage, model) currently active in
  // this phase, including the slot's own per-slot fallbacks.
  const skipKeys = new Set<string>();
  for (const s of activeSlots) {
    for (const m of s.models ?? []) {
      skipKeys.add(`${s.lineage}:${m}`);
    }
  }

  for (const fb of templateFallback) {
    for (const m of fb.models ?? []) {
      const key = `${fb.lineage}:${m}`;
      if (skipKeys.has(key)) continue;
      skipKeys.add(key);
      chain.push({ lineage: fb.lineage, model: m });
    }
  }
  return chain;
}
