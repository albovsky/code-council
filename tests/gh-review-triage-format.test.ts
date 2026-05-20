import { describe, expect, it } from 'vitest';
import {
  buildGhReviewTriagePrompt,
  verdictFromGhReviewTriage,
} from '../src/lib/gh-review-triage-format';

describe('gh-review-triage format', () => {
  it('builds the required section contract', () => {
    const prompt = buildGhReviewTriagePrompt({
      work: 'Review feature branch.',
      artifact: 'diff --git a/a.ts b/a.ts',
      reviewerOutputs: [
        { label: 'codex-cli-0', output: 'request changes: real bug' },
        { label: 'gemini-cli-1', output: 'approve' },
      ],
    });

    expect(prompt).toContain('**Valid**');
    expect(prompt).toContain('**Mostly Valid, Non-Blocking**');
    expect(prompt).toContain('**Noise**');
    expect(prompt).toContain('**Needs Owner Decision**');
    expect(prompt).toContain('**Fix Plan**');
    expect(prompt).toContain('**Validation**');
    expect(prompt).toContain('Classify each distinct reviewer concern');
  });

  it('requests changes when the Valid section has findings', () => {
    const verdict = verdictFromGhReviewTriage(`**Valid**
- \`src/a.ts:12\` - Real bug.

**Mostly Valid, Non-Blocking**
- None
`);
    expect(verdict).toBe('request_changes');
  });

  it('approves when the Valid section is empty or none', () => {
    expect(verdictFromGhReviewTriage(`**Valid**
- None

**Mostly Valid, Non-Blocking**
- One follow-up.
`)).toBe('approved');
  });
});
