import { describe, expect, it } from 'vitest';
import { agyShim } from '../src/daemon/agents/agy';

describe('Antigravity launch command', () => {
  it('places permission flags before --prompt-interactive so they are not sent as prompt text', () => {
    const command = agyShim.buildLaunchCommand({
      sessionName: 'test-agy-session',
      cwd: '/tmp/code-council-test',
      sandbox: 'workspace',
      autoApprove: true,
      networkAccess: true,
    });

    expect(command).toContain('--dangerously-skip-permissions');
    expect(command).toContain('--prompt-interactive');
    expect(command.indexOf('--dangerously-skip-permissions')).toBeLessThan(
      command.indexOf('--prompt-interactive'),
    );
  });
});
