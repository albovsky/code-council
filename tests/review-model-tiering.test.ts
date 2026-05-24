import { describe, expect, it } from 'vitest';
import {
  rankReviewVoices,
  type ReviewVoice,
} from '@/lib/review-model-tiering';

function voice(modelId: string, overrides: Partial<ReviewVoice> = {}): ReviewVoice {
  return {
    id: overrides.id ?? modelId,
    provider: overrides.provider ?? modelId.split('/')[0] ?? 'openai',
    model_id: modelId,
    lineage: overrides.lineage ?? 'test',
    vendor_family: overrides.vendor_family ?? null,
    enabled: overrides.enabled ?? true,
  };
}

describe('rankReviewVoices', () => {
  it('orders the current eight-model fleet by explicit tier score', () => {
    const ranked = rankReviewVoices([
      voice('opencode-go/qwen3.6-plus'),
      voice('gemini-3.5-flash', { provider: 'google', lineage: 'antigravity' }),
      voice('opencode-go/deepseek-v4-pro'),
      voice('gpt-5.5', { provider: 'openai', lineage: 'openai' }),
      voice('opencode-go/deepseek-v4-flash'),
      voice('opencode-go/glm-5.1'),
      voice('opencode-go/kimi-k2.6'),
      voice('opencode-go/minimax-m2.7'),
    ]);

    expect(ranked.map((item) => [item.voice.model_id, item.tier, item.score])).toEqual([
      ['gpt-5.5', 'A_PLUS', 1000],
      ['opencode-go/deepseek-v4-pro', 'A', 930],
      ['opencode-go/kimi-k2.6', 'A_MINUS', 880],
      ['opencode-go/glm-5.1', 'B_PLUS', 820],
      ['opencode-go/qwen3.6-plus', 'B_PLUS', 805],
      ['opencode-go/minimax-m2.7', 'B', 760],
      ['opencode-go/deepseek-v4-flash', 'B_MINUS', 690],
      ['gemini-3.5-flash', 'C', 540],
    ]);
  });

  it('uses deterministic heuristic fallback and provider:model_id tie-breaks for unknown models', () => {
    const ranked = rankReviewVoices([
      voice('future-review-pro', { provider: 'zeta' }),
      voice('future-review-pro', { provider: 'alpha' }),
      voice('future-review-flash', { provider: 'beta' }),
    ]);

    expect(ranked.map((item) => `${item.voice.provider}:${item.voice.model_id}`)).toEqual([
      'alpha:future-review-pro',
      'zeta:future-review-pro',
      'beta:future-review-flash',
    ]);
    expect(ranked.map((item) => item.tier)).toEqual(['B_PLUS', 'B_PLUS', 'C']);
    expect(ranked.every((item) => item.reasons.length > 0)).toBe(true);
  });

  it('uses voice id as a final tie-breaker for duplicate provider and model voices', () => {
    const firstOrder = rankReviewVoices([
      voice('future-review-pro', { id: 'voice-b', provider: 'openrouter' }),
      voice('future-review-pro', { id: 'voice-a', provider: 'openrouter' }),
    ]);
    const reversedOrder = rankReviewVoices([
      voice('future-review-pro', { id: 'voice-a', provider: 'openrouter' }),
      voice('future-review-pro', { id: 'voice-b', provider: 'openrouter' }),
    ]);

    expect(firstOrder.map((item) => item.voice.id)).toEqual(['voice-a', 'voice-b']);
    expect(reversedOrder.map((item) => item.voice.id)).toEqual(['voice-a', 'voice-b']);
  });
});
