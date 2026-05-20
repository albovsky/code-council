import { describe, it, expect } from 'vitest';
import {
  GOOGLE_AGY_MODELS,
  GOOGLE_LEGACY_GEMINI_MODELS,
  lineageLabel,
  lineageDot,
} from '@/lib/lineage-maps';

describe('lineage-maps', () => {
  describe('lineageLabel', () => {
    it('returns Claude for anthropic', () => {
      expect(lineageLabel('anthropic')).toBe('Claude');
    });

    it('returns Codex for openai', () => {
      expect(lineageLabel('openai')).toBe('Codex');
    });

    it('returns Gemini for google', () => {
      expect(lineageLabel('google')).toBe('Gemini');
    });

    it('returns OpenCode for opencode', () => {
      expect(lineageLabel('opencode')).toBe('OpenCode');
    });

    it('returns Kimi for moonshot', () => {
      expect(lineageLabel('moonshot')).toBe('Kimi');
    });

    it('returns unknown string as passthrough fallback for unknown lineages', () => {
      expect(lineageLabel('unknown-lineage')).toBe('unknown-lineage');
    });

    it('returns empty string for undefined', () => {
      expect(lineageLabel(undefined)).toBe('');
    });

    it('returns empty string for null', () => {
      expect(lineageLabel(null as unknown as undefined)).toBe('');
    });
  });

  describe('lineageDot', () => {
    it('returns bg-violet-400 for anthropic', () => {
      expect(lineageDot('anthropic')).toBe('bg-violet-400');
    });

    it('returns bg-orange-400 for openai', () => {
      expect(lineageDot('openai')).toBe('bg-orange-400');
    });

    it('returns bg-blue-400 for google', () => {
      expect(lineageDot('google')).toBe('bg-blue-400');
    });

    it('returns bg-emerald-400 for opencode', () => {
      expect(lineageDot('opencode')).toBe('bg-emerald-400');
    });

    it('returns bg-pink-400 for moonshot', () => {
      expect(lineageDot('moonshot')).toBe('bg-pink-400');
    });

    it('returns bg-muted for unknown lineages', () => {
      expect(lineageDot('unknown-lineage')).toBe('bg-muted');
    });

    it('returns bg-muted for undefined', () => {
      expect(lineageDot(undefined)).toBe('bg-muted');
    });

    it('returns bg-muted for null', () => {
      expect(lineageDot(null as unknown as undefined)).toBe('bg-muted');
    });
  });
});

describe('Google model catalogs', () => {
  it('uses the Antigravity reasoning-model catalog for AGY', () => {
    expect(GOOGLE_AGY_MODELS).toEqual([
      'gemini-3.5-flash',
      'gemini-3.1-pro-high',
      'gemini-3.1-pro-low',
      'gemini-3-flash',
    ]);
  });

  it('keeps the legacy Gemini CLI catalog separate', () => {
    expect(GOOGLE_LEGACY_GEMINI_MODELS).toEqual([
      'gemini-2.5-pro',
      'gemini-3.1-pro-preview',
      'gemini-2.5-flash',
    ]);
  });
});
