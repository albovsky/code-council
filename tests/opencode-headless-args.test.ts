import { describe, expect, it } from 'vitest';
import { buildOpencodeRunArgs } from '@/daemon/agents/opencode';
import type { HeadlessSpawnOptions } from '@/daemon/agents/types';

const baseOpts: Pick<
  HeadlessSpawnOptions,
  'autoApprove' | 'model' | 'cwd' | 'sandbox'
> = {
  cwd: '/tmp/code-council-chat',
  model: 'opencode-go/deepseek-v4-flash',
  sandbox: 'workspace',
  autoApprove: true,
};

describe('buildOpencodeRunArgs', () => {
  it('adds permission bypass when auto-approve is enabled', () => {
    const args = buildOpencodeRunArgs(baseOpts);

    expect(args).toContain('--dangerously-skip-permissions');
    expect(args).toContain('--model');
    expect(args).toContain('opencode-go/deepseek-v4-flash');
  });

  it('does not add permission bypass when auto-approve is explicitly off', () => {
    const args = buildOpencodeRunArgs({
      ...baseOpts,
      autoApprove: false,
    });

    expect(args).not.toContain('--dangerously-skip-permissions');
  });

  it('adds permission bypass for full sandbox mode', () => {
    const args = buildOpencodeRunArgs({
      ...baseOpts,
      autoApprove: false,
      sandbox: 'full',
    });

    expect(args).toContain('--dangerously-skip-permissions');
  });
});
