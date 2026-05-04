/**
 * Tests the template-level fallback chain composition.
 *
 * The runner doesn't need its own retry loop — `runWithChainFallback`
 * walks a (lineage, model) chain and falls through on null.
 * `buildSlotFallbackChain`'s job is to compose that chain correctly:
 * append template-level fallbacks (same- AND cross-lineage as of v0.8)
 * onto the slot's per-slot chain, deduped against every active
 * (lineage, model) in the phase.
 *
 * Critical case from the user spec (2026-05-03):
 *   reviewers=[kimi, deepseek] (both opencode lineage)
 *   template.fallback=[kimi]
 *   When deepseek fails → must NOT spawn a second kimi reviewer.
 */
import { describe, it, expect } from 'vitest';
import { buildSlotFallbackChain } from '../src/daemon/runner/template-fallback';

describe('buildSlotFallbackChain', () => {
  it('returns slot.models as same-lineage entries when no template fallback exists', () => {
    const slot = { lineage: 'opencode', models: ['kimi-k2.6'] };
    const chain = buildSlotFallbackChain(slot, [slot], undefined);
    expect(chain).toEqual([{ lineage: 'opencode', model: 'kimi-k2.6' }]);
  });

  it('returns slot.models unchanged when template fallback is empty array', () => {
    const slot = { lineage: 'opencode', models: ['kimi-k2.6'] };
    const chain = buildSlotFallbackChain(slot, [slot], []);
    expect(chain).toEqual([{ lineage: 'opencode', model: 'kimi-k2.6' }]);
  });

  it('emits a single undefined-model entry when slot has no models', () => {
    // Slot with empty models gets one attempt with the lineage default.
    const slot = { lineage: 'anthropic', models: [] };
    const chain = buildSlotFallbackChain(slot, [slot], undefined);
    expect(chain).toEqual([{ lineage: 'anthropic', model: undefined }]);
  });

  it('appends same-lineage template fallbacks onto the chain', () => {
    const slot = { lineage: 'opencode', models: ['deepseek-v4-pro'] };
    const fallback = [
      { lineage: 'opencode', models: ['kimi-k2.6'] },
      { lineage: 'opencode', models: ['glm-5.1'] },
    ];
    const chain = buildSlotFallbackChain(slot, [slot], fallback);
    expect(chain).toEqual([
      { lineage: 'opencode', model: 'deepseek-v4-pro' },
      { lineage: 'opencode', model: 'kimi-k2.6' },
      { lineage: 'opencode', model: 'glm-5.1' },
    ]);
  });

  it('v0.8: appends cross-lineage template fallbacks at the tail', () => {
    // Codex slot with claude as a cross-lineage fallback — supported as of
    // v0.8, runner picks the right shim per entry.
    const slot = { lineage: 'openai', models: ['gpt-5.5'] };
    const fallback = [
      { lineage: 'openai', models: ['gpt-5.4'] },
      { lineage: 'anthropic', models: ['claude-opus-4-7'] },
    ];
    const chain = buildSlotFallbackChain(slot, [slot], fallback);
    expect(chain).toEqual([
      { lineage: 'openai', model: 'gpt-5.5' },
      { lineage: 'openai', model: 'gpt-5.4' },
      { lineage: 'anthropic', model: 'claude-opus-4-7' },
    ]);
  });

  it('v0.8: cross-lineage fallback is the only entry when slot is exhausted', () => {
    // Slot with one model + one cross-lineage fallback — chain has two
    // entries, one per lineage.
    const slot = { lineage: 'openai', models: ['gpt-5.5'] };
    const fallback = [{ lineage: 'anthropic', models: ['claude-opus-4-7'] }];
    const chain = buildSlotFallbackChain(slot, [slot], fallback);
    expect(chain).toEqual([
      { lineage: 'openai', model: 'gpt-5.5' },
      { lineage: 'anthropic', model: 'claude-opus-4-7' },
    ]);
  });

  it('dedups against the slot itself — never appends the slot model again', () => {
    const slot = { lineage: 'opencode', models: ['kimi-k2.6'] };
    const fallback = [{ lineage: 'opencode', models: ['kimi-k2.6'] }];
    const chain = buildSlotFallbackChain(slot, [slot], fallback);
    expect(chain).toEqual([{ lineage: 'opencode', model: 'kimi-k2.6' }]);
  });

  it('user spec: reviewers=[kimi, deepseek] + fallback=[kimi] does not spawn duplicate kimi', () => {
    const kimiSlot = { lineage: 'opencode', models: ['kimi-k2.6'] };
    const deepseekSlot = { lineage: 'opencode', models: ['deepseek-v4-pro'] };
    const fallback = [{ lineage: 'opencode', models: ['kimi-k2.6'] }];

    const deepseekChain = buildSlotFallbackChain(
      deepseekSlot,
      [kimiSlot, deepseekSlot],
      fallback,
    );
    expect(deepseekChain).toEqual([{ lineage: 'opencode', model: 'deepseek-v4-pro' }]);

    const kimiChain = buildSlotFallbackChain(
      kimiSlot,
      [kimiSlot, deepseekSlot],
      fallback,
    );
    expect(kimiChain).toEqual([{ lineage: 'opencode', model: 'kimi-k2.6' }]);
  });

  it('extended user spec: fallback=[kimi, glm-5.1] with [kimi, deep] → both slots get glm-5.1', () => {
    const kimiSlot = { lineage: 'opencode', models: ['kimi-k2.6'] };
    const deepseekSlot = { lineage: 'opencode', models: ['deepseek-v4-pro'] };
    const fallback = [
      { lineage: 'opencode', models: ['kimi-k2.6'] },
      { lineage: 'opencode', models: ['glm-5.1'] },
    ];

    const deepChain = buildSlotFallbackChain(
      deepseekSlot,
      [kimiSlot, deepseekSlot],
      fallback,
    );
    expect(deepChain).toEqual([
      { lineage: 'opencode', model: 'deepseek-v4-pro' },
      { lineage: 'opencode', model: 'glm-5.1' },
    ]);

    const kimiChain = buildSlotFallbackChain(
      kimiSlot,
      [kimiSlot, deepseekSlot],
      fallback,
    );
    expect(kimiChain).toEqual([
      { lineage: 'opencode', model: 'kimi-k2.6' },
      { lineage: 'opencode', model: 'glm-5.1' },
    ]);
  });

  it('flattens multi-model fallback rows in priority order', () => {
    const slot = { lineage: 'opencode', models: ['deepseek-v4-pro'] };
    const fallback = [
      { lineage: 'opencode', models: ['kimi-k2.6', 'glm-5.1', 'qwen3.6-plus'] },
    ];
    const chain = buildSlotFallbackChain(slot, [slot], fallback);
    expect(chain).toEqual([
      { lineage: 'opencode', model: 'deepseek-v4-pro' },
      { lineage: 'opencode', model: 'kimi-k2.6' },
      { lineage: 'opencode', model: 'glm-5.1' },
      { lineage: 'opencode', model: 'qwen3.6-plus' },
    ]);
  });

  it('dedups within the template fallback list itself (no double-append)', () => {
    const slot = { lineage: 'opencode', models: ['deepseek-v4-pro'] };
    const fallback = [
      { lineage: 'opencode', models: ['kimi-k2.6'] },
      { lineage: 'opencode', models: ['kimi-k2.6'] }, // duplicate row
    ];
    const chain = buildSlotFallbackChain(slot, [slot], fallback);
    expect(chain).toEqual([
      { lineage: 'opencode', model: 'deepseek-v4-pro' },
      { lineage: 'opencode', model: 'kimi-k2.6' },
    ]);
  });

  it('handles a slot with multiple per-slot models (chains both before fallback)', () => {
    const slot = {
      lineage: 'anthropic',
      models: ['claude-opus-4-7', 'claude-sonnet-4-6'],
    };
    const fallback = [
      { lineage: 'anthropic', models: ['claude-haiku-4-5'] },
    ];
    const chain = buildSlotFallbackChain(slot, [slot], fallback);
    expect(chain).toEqual([
      { lineage: 'anthropic', model: 'claude-opus-4-7' },
      { lineage: 'anthropic', model: 'claude-sonnet-4-6' },
      { lineage: 'anthropic', model: 'claude-haiku-4-5' },
    ]);
  });

  it('treats per-slot fallbacks as already-active — template fallback skips them', () => {
    const slot = {
      lineage: 'anthropic',
      models: ['claude-opus-4-7', 'claude-sonnet-4-6'],
    };
    const fallback = [
      { lineage: 'anthropic', models: ['claude-sonnet-4-6'] },
    ];
    const chain = buildSlotFallbackChain(slot, [slot], fallback);
    expect(chain).toEqual([
      { lineage: 'anthropic', model: 'claude-opus-4-7' },
      { lineage: 'anthropic', model: 'claude-sonnet-4-6' },
    ]);
  });

  it('v0.8: cross-lineage dedup uses (lineage, model) tuple — same model name on different lineages is allowed', () => {
    // Highly unusual but valid: a model name shared across lineages stays
    // distinct because the dedup key is (lineage, model).
    const slot = { lineage: 'openai', models: ['shared-model'] };
    const fallback = [{ lineage: 'anthropic', models: ['shared-model'] }];
    const chain = buildSlotFallbackChain(slot, [slot], fallback);
    expect(chain).toEqual([
      { lineage: 'openai', model: 'shared-model' },
      { lineage: 'anthropic', model: 'shared-model' },
    ]);
  });
});
