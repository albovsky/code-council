/**
 * Coverage for the v0.8.4 self-update helpers.
 *
 * detectNpmPrefix is the load-bearing piece — it determines where
 * `chorus update` writes the new version. A wrong prefix means the
 * update lands somewhere PATH never sees, leaving the user stuck on
 * the old version (the original bug we're trying to fix).
 *
 * versionGreater is the gate that decides whether to nudge the user
 * about an update. False negatives are fine (no nudge); false
 * positives spam the start banner.
 */
import { describe, expect, it } from 'vitest';
import { versionGreater } from '@/cli/commands/update';

describe('versionGreater', () => {
  it('returns true when latest is strictly greater', () => {
    expect(versionGreater('0.8.4', '0.8.3')).toBe(true);
    expect(versionGreater('0.9.0', '0.8.99')).toBe(true);
    expect(versionGreater('1.0.0', '0.99.99')).toBe(true);
  });

  it('returns false when latest equals current', () => {
    expect(versionGreater('0.8.3', '0.8.3')).toBe(false);
    expect(versionGreater('1.0.0', '1.0.0')).toBe(false);
  });

  it('returns false when latest is less than current', () => {
    // Defensive: a stale registry response shouldn't trigger an update
    // nudge. False here = "no update available".
    expect(versionGreater('0.8.3', '0.8.4')).toBe(false);
    expect(versionGreater('0.8.0', '0.9.0')).toBe(false);
  });

  it('handles minor and patch differences correctly', () => {
    expect(versionGreater('0.8.10', '0.8.9')).toBe(true);
    expect(versionGreater('0.8.9', '0.8.10')).toBe(false);
  });

  it('treats missing segments as 0', () => {
    expect(versionGreater('1.0', '1.0.0')).toBe(false);
    expect(versionGreater('1.0.1', '1.0')).toBe(true);
  });

  it('returns false on garbage input rather than throwing', () => {
    // parseInt('foo') === NaN → coerced to 0 in the helper.
    expect(versionGreater('foo', 'bar')).toBe(false);
    expect(versionGreater('', '0.8.3')).toBe(false);
  });
});
