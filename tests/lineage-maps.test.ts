import { describe, it, expect } from 'vitest';
import {
  GOOGLE_AGY_MODELS,
  GOOGLE_LEGACY_GEMINI_MODELS,
  lineageLabel,
  lineageDot,
  uiLineageLabel,
  uiLineageDot,
  uiLineageDefaultModel,
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

  describe('uiLineageLabel', () => {
    it('returns Antigravity CLI for antigravity', () => {
      expect(uiLineageLabel('antigravity')).toBe('Antigravity CLI');
    });

    it('returns Claude for claude', () => {
      expect(uiLineageLabel('claude')).toBe('Claude');
    });

    it('returns unknown string as passthrough fallback for unknown lineages', () => {
      expect(uiLineageLabel('unknown-lineage')).toBe('unknown-lineage');
    });

    it('returns empty string for undefined', () => {
      expect(uiLineageLabel(undefined)).toBe('');
    });
  });

  describe('uiLineageDot', () => {
    it('returns bg-blue-400 for antigravity', () => {
      expect(uiLineageDot('antigravity')).toBe('bg-blue-400');
    });

    it('returns bg-violet-400 for claude', () => {
      expect(uiLineageDot('claude')).toBe('bg-violet-400');
    });

    it('returns bg-muted for unknown lineages', () => {
      expect(uiLineageDot('unknown-lineage')).toBe('bg-muted');
    });

    it('returns bg-muted for undefined', () => {
      expect(uiLineageDot(undefined)).toBe('bg-muted');
    });
  });

  describe('uiLineageDefaultModel', () => {
    it('returns gemini-3.5-flash for antigravity', () => {
      expect(uiLineageDefaultModel('antigravity')).toBe('gemini-3.5-flash');
    });

    it('returns claude-opus-4-7 for claude', () => {
      expect(uiLineageDefaultModel('claude')).toBe('claude-opus-4-7');
    });

    it('returns undefined for unknown lineages', () => {
      expect(uiLineageDefaultModel('unknown-lineage')).toBe(undefined);
    });

    it('returns undefined for undefined', () => {
      expect(uiLineageDefaultModel(undefined)).toBe(undefined);
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

