import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { collectReviewerOutputs } from '../src/daemon/runner/triage-synthesis';

describe('triage synthesis', () => {
  it('collects only completed reviewer answers and skips failures', () => {
    const chatDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chorus-triage-'));
    const roundDir = path.join(chatDir, 'round-1');
    fs.mkdirSync(path.join(roundDir, 'reviewer-codex-cli-0'), { recursive: true });
    fs.mkdirSync(path.join(roundDir, 'reviewer-opencode-cli-1'), { recursive: true });
    fs.writeFileSync(
      path.join(roundDir, 'reviewer-codex-cli-0', 'answer.md'),
      'request changes: real issue\n\n## DONE\n',
    );
    fs.writeFileSync(
      path.join(roundDir, 'reviewer-opencode-cli-1', 'answer.md'),
      '## REVIEWER FAILED\n\ncli_failed\n',
    );

    const outputs = collectReviewerOutputs(chatDir, 1);

    expect(outputs).toEqual([
      { label: 'reviewer-codex-cli-0', output: 'request changes: real issue' },
    ]);
  });
});
