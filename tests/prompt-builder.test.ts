import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  buildAsk,
  buildReviewerAsk,
  packAttachedFiles,
} from '../src/daemon/runner/prompt-builder';
import type { Phase } from '../src/lib/template-schema';

function fixturePhase(overrides: Partial<Phase> = {}): Phase {
  return {
    id: 'review',
    kind: 'review',
    title: 'Code Review',
    description: 'Inspect the change for correctness.',
    doer: { lineage: 'anthropic', models: ['claude-opus-4-7'] },
    reviewer: {
      require: 1,
      crossLineage: true,
      candidates: [{ lineage: 'openai', models: ['gpt-5.5'] }],
    },
    inputs: { include: [], exclude: [] },
    iterate: {
      maxRounds: 2,
      onDisagreement: 'continue',
      shareSessionAcrossRounds: false,
      shareSessionAcrossPhases: false,
    },
    ...overrides,
  } as unknown as Phase;
}

describe('buildAsk', () => {
  it('includes phase id, round, role=doer, user request, and DONE sentinel', () => {
    const out = buildAsk(
      fixturePhase(),
      0,
      1,
      'fix the divide-by-zero bug',
      { include: [], exclude: [] },
      '',
    );
    expect(out).toContain('# Chorus task — round 1, phase review');
    expect(out).toContain('## Your role\ndoer');
    expect(out).toContain('## What to do\nCode Review');
    expect(out).toContain('Inspect the change for correctness.');
    expect(out).toContain('fix the divide-by-zero bug');
    expect(out).toContain('## How to respond');
    expect(out).toContain('## DONE');
  });

  it('embeds the filesBlock when provided', () => {
    const filesBlock = '## Attached files\n\n### `a.ts`\n```ts\nconst x = 1\n```';
    const out = buildAsk(
      fixturePhase(),
      0,
      1,
      'work',
      { include: [], exclude: [] },
      filesBlock,
    );
    expect(out).toContain(filesBlock);
  });

  it('prepends a ## Persona block above the task header when given', () => {
    const out = buildAsk(
      fixturePhase(),
      0,
      1,
      'work',
      { include: [], exclude: [] },
      '',
      'You are Architect — bias toward maintainability over cleverness.',
    );
    expect(out).toContain('## Persona');
    expect(out).toContain('You are Architect');
    const personaIdx = out.indexOf('## Persona');
    const headerIdx = out.indexOf('# Chorus task');
    expect(headerIdx).toBeGreaterThan(personaIdx);
  });

  it('omits the persona block when no system prompt is provided', () => {
    const out = buildAsk(
      fixturePhase(),
      0,
      1,
      'work',
      { include: [], exclude: [] },
      '',
    );
    expect(out).not.toContain('## Persona');
  });

  it('lists includes / excludes when present', () => {
    const out = buildAsk(
      fixturePhase(),
      0,
      1,
      'work',
      { include: ['plan'], exclude: ['draft'] },
      '',
    );
    expect(out).toContain('## Inputs (from prior phases)');
    expect(out).toContain('- Phase plan: (link to answer.md)');
    expect(out).toContain('## Excluded (do NOT read)');
    expect(out).toContain('- Phase draft: explicitly blocked');
  });
});

describe('buildReviewerAsk', () => {
  it('preserves outputs under the 256 KB cap verbatim', () => {
    // 50 KB — well above the legacy 2 KB cap, well under the new 256 KB cap.
    // Pins the regression: review-only mode + standard review with real
    // implementation diffs were unusable while the cap was 2000 chars.
    const big = 'x'.repeat(50 * 1024);
    const out = buildReviewerAsk(
      fixturePhase(),
      0,
      1,
      'work',
      big,
      '',
    );
    expect(out).toContain('## Artifact to review');
    expect(out).toContain(big);
    expect(out).not.toContain('truncated');
    expect(out).toContain('## Your verdict');
  });

  it('truncates beyond 256 KB and reports the byte counts', () => {
    const huge = 'x'.repeat(300 * 1024);
    const out = buildReviewerAsk(
      fixturePhase(),
      0,
      1,
      'work',
      huge,
      '',
    );
    expect(out).toContain('## Artifact to review');
    expect(out).toContain('truncated');
    expect(out).toMatch(/full artifact was \d+ bytes, cap is \d+ bytes/);
  });

  it('does not truncate short output', () => {
    const out = buildReviewerAsk(
      fixturePhase(),
      0,
      1,
      'work',
      'short doer answer',
      '',
    );
    expect(out).not.toContain('truncated');
    expect(out).toContain('short doer answer');
  });

  it('prepends the persona system prompt as a ## Persona block when provided', () => {
    const out = buildReviewerAsk(
      fixturePhase(),
      0,
      1,
      'work',
      'doer answer',
      '',
      'You are Sentinel — a security-first reviewer. Audit for OWASP Top 10.',
    );
    expect(out).toContain('## Persona');
    expect(out).toContain('You are Sentinel');
    // Persona block must come before the chorus header so the LLM reads
    // the worldview before the task framing.
    const personaIdx = out.indexOf('## Persona');
    const headerIdx = out.indexOf('# Chorus review');
    expect(personaIdx).toBeGreaterThanOrEqual(0);
    expect(headerIdx).toBeGreaterThan(personaIdx);
  });

  it('omits the ## Persona block when no system prompt is provided', () => {
    const out = buildReviewerAsk(
      fixturePhase(),
      0,
      1,
      'work',
      'doer answer',
      '',
    );
    expect(out).not.toContain('## Persona');
  });

  it('omits the ## Persona block when the system prompt is empty / whitespace', () => {
    const out = buildReviewerAsk(
      fixturePhase(),
      0,
      1,
      'work',
      'doer answer',
      '',
      '   \n\n  ',
    );
    expect(out).not.toContain('## Persona');
  });

  it('truncation walks back to a UTF-8 start byte (no U+FFFD tails)', () => {
    // 256 KB cap means we want a string just over 256 KB whose 256 KB byte
    // boundary lands inside a multi-byte rune. The € sign is 3 bytes
    // (0xE2 0x82 0xAC); padding ASCII to 262143 bytes then writing € makes
    // the cut land on the 0x82 (continuation) byte at index 262144.
    const PAD_BYTES = 256 * 1024 - 1;
    const big = 'a'.repeat(PAD_BYTES) + '€' + 'tail';
    const out = buildReviewerAsk(
      fixturePhase(),
      0,
      1,
      'work',
      big,
      '',
    );
    expect(out).toContain('truncated');
    // No stray U+FFFD replacement chars from a mid-codepoint cut.
    expect(out).not.toContain('�');
  });
});

describe('packAttachedFiles', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chorus-pack-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns empty string when paths is undefined or empty', () => {
    expect(packAttachedFiles(undefined, dir)).toBe('');
    expect(packAttachedFiles([], dir)).toBe('');
  });

  it('inlines an existing file as a fenced code block with extension', () => {
    const file = path.join(dir, 'note.md');
    fs.writeFileSync(file, '# hello\nworld');
    const out = packAttachedFiles(['note.md'], dir);
    expect(out).toContain('## Attached files');
    expect(out).toContain('### `note.md`');
    expect(out).toContain('```md');
    expect(out).toContain('# hello\nworld');
  });

  it('rejects path-traversal escapes', () => {
    // attempt to read /etc/passwd via ../
    const out = packAttachedFiles(['../../../etc/passwd'], dir);
    expect(out).toContain('path traversal rejected');
    expect(out).not.toContain('root:');
  });

  it('rejects absolute paths', () => {
    const out = packAttachedFiles(['/etc/passwd'], dir);
    expect(out).toContain('absolute path rejected');
    expect(out).not.toContain('root:');
  });

  it('rejects symlinks (TOCTOU defence)', () => {
    const target = path.join(dir, 'real.txt');
    const link = path.join(dir, 'link.txt');
    fs.writeFileSync(target, 'real content');
    fs.symlinkSync(target, link);
    const out = packAttachedFiles(['link.txt'], dir);
    expect(out).toContain('symlink rejected');
    expect(out).not.toContain('real content');
  });

  it('skips missing files with a clear marker', () => {
    const out = packAttachedFiles(['ghost.txt'], dir);
    expect(out).toContain('file not found');
  });

  it('truncates oversized files to 64KB and marks them', () => {
    const big = path.join(dir, 'big.log');
    fs.writeFileSync(big, 'x'.repeat(100 * 1024));
    const out = packAttachedFiles(['big.log'], dir);
    expect(out).toContain('truncated to 65536 bytes');
  });

  it('respects 256KB total cap across multiple files', () => {
    // 5 files × 60KB each = 300KB total. Last one(s) should be skipped.
    for (let i = 0; i < 5; i++) {
      fs.writeFileSync(path.join(dir, `f${i}.txt`), 'a'.repeat(60 * 1024));
    }
    const out = packAttachedFiles(
      ['f0.txt', 'f1.txt', 'f2.txt', 'f3.txt', 'f4.txt'],
      dir,
    );
    expect(out).toContain('would exceed');
  });

  it('skips non-regular files (e.g. directories)', () => {
    fs.mkdirSync(path.join(dir, 'subdir'));
    const out = packAttachedFiles(['subdir'], dir);
    expect(out).toContain('not a regular file');
  });
});
