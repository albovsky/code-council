import { describe, expect, it } from 'vitest';
import { buildTmuxSessionName } from '../src/lib/tmux-session-name';

describe('buildTmuxSessionName', () => {
  it('builds the shared council tmux session name', () => {
    expect(
      buildTmuxSessionName({
        chatId: '01ABC_xyz',
        phaseId: 'thermo-phase-1-security',
        role: 'reviewer',
        agent: 'opencode-cli',
      }),
    ).toBe('council-01ABC_xyz-thermo-phase-1-security-reviewer-opencode-cli');
  });

  it('rejects components outside the tmux-safe character policy', () => {
    expect(() =>
      buildTmuxSessionName({
        chatId: 'chat/1',
        phaseId: 'phase',
        role: 'reviewer',
        agent: 'opencode-cli',
      }),
    ).toThrow(/Invalid chatId/);
  });
});
