import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { registerAgyMcpPlugin } from '@/daemon/orchestrators/agy';

let fakeHome: string;

beforeEach(() => {
  fakeHome = path.join(os.tmpdir(), `council-agy-orch-${randomUUID()}`);
  fs.mkdirSync(fakeHome, { recursive: true });
});

afterEach(() => {
  try {
    fs.rmSync(fakeHome, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
}

describe('registerAgyMcpPlugin', () => {
  it('writes an Antigravity plugin with council MCP config', () => {
    const result = registerAgyMcpPlugin({
      homeDir: fakeHome,
      binPath: '/opt/homebrew/lib/node_modules/code-council/bin/council.mjs',
      daemonUrl: 'http://127.0.0.1:7707',
    });

    const pluginDir = path.join(fakeHome, '.gemini', 'antigravity-cli', 'plugins', 'council');
    expect(result.added).toEqual(['plugins/council/mcp_config.json']);
    expect(result.configPath).toBe(path.join(pluginDir, 'mcp_config.json'));

    expect(readJson(path.join(pluginDir, 'plugin.json'))).toEqual({
      name: 'council',
    });
    expect(readJson(path.join(pluginDir, 'mcp_config.json'))).toEqual({
      mcpServers: {
        council: {
          command: 'node',
          args: ['/opt/homebrew/lib/node_modules/code-council/bin/council.mjs', 'mcp'],
          env: {
            COUNCIL_DAEMON_URL: 'http://127.0.0.1:7707',
          },
        },
      },
    });
  });

  it('is idempotent when the plugin already points at the same council binary', () => {
    const first = registerAgyMcpPlugin({
      homeDir: fakeHome,
      binPath: '/path/to/council.mjs',
    });
    const second = registerAgyMcpPlugin({
      homeDir: fakeHome,
      binPath: '/path/to/council.mjs',
    });

    expect(first.added).toEqual(['plugins/council/mcp_config.json']);
    expect(second.added).toEqual([]);
    expect(second.alreadyPresent).toEqual(['plugins/council/mcp_config.json']);
  });
});
