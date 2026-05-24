import { describe, expect, it } from 'vitest';
import { displayModelName } from '../src/lib/model-display';

describe('displayModelName', () => {
  it('formats known model ids without provider prefixes', () => {
    expect(displayModelName('opencode-go/deepseek-v4-flash')).toBe('DeepSeek V4 Flash');
    expect(displayModelName('opencode-go/qwen3.6-plus')).toBe('Qwen3.6 Plus');
    expect(displayModelName('gpt-5.5')).toBe('Codex 5.5');
  });

  it('formats unknown fallback model ids consistently', () => {
    expect(displayModelName('some-vendor/unknown-model-3.0')).toBe('Unknown Model 3.0');
    expect(displayModelName('api-model')).toBe('API Model');
    expect(displayModelName('v2-variant')).toBe('V2 Variant');
  });
});
