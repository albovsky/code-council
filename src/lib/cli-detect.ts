/**
 * Detect whether each supported CLI is installed and on PATH.
 * Used by the onboarding flow to pre-tick boxes for CLIs the user already has.
 *
 * Cursor and Windsurf are IDEs invoked via MCP, not CLIs on PATH, so they're
 * not part of this probe — onboarding leaves their checkboxes for the user.
 */

import { spawnSync } from 'child_process';

export type DetectableCli =
  | 'claude-code'
  | 'codex-cli'
  | 'gemini-cli'
  | 'opencode-cli'
  | 'kimi-cli';

const BINARY_NAME: Record<DetectableCli, string> = {
  'claude-code': 'claude',
  'codex-cli': 'codex',
  'gemini-cli': 'gemini',
  'opencode-cli': 'opencode',
  'kimi-cli': 'kimi',
};

export interface CliDetection {
  id: DetectableCli;
  found: boolean;
  path?: string;
}

function whichBinary(name: string): string | null {
  const result = spawnSync('which', [name], { encoding: 'utf-8' });
  if (result.status !== 0) return null;
  const path = result.stdout.trim();
  return path.length > 0 ? path : null;
}

export function detectAllClis(): CliDetection[] {
  return (Object.keys(BINARY_NAME) as DetectableCli[]).map((id) => {
    const path = whichBinary(BINARY_NAME[id]);
    return path ? { id, found: true, path } : { id, found: false };
  });
}
