import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { registerAgyMcpPlugin } from '@/daemon/orchestrators/gemini';

let fakeHome: string;

beforeEach(() => {
  fakeHome = path.join(os.tmpdir(), `chorus-agy-orch-${randomUUID()}`);
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
  it('writes an Antigravity plugin with chorus MCP config', () => {
    const result = registerAgyMcpPlugin({
      homeDir: fakeHome,
      binPath: '/opt/homebrew/lib/node_modules/chorus-codes/bin/chorus.mjs',
      daemonUrl: 'http://127.0.0.1:7707',
    });

    const pluginDir = path.join(fakeHome, '.gemini', 'antigravity-cli', 'plugins', 'chorus');
    expect(result.added).toEqual(['plugins/chorus/mcp_config.json']);
    expect(result.configPath).toBe(path.join(pluginDir, 'mcp_config.json'));

    expect(readJson(path.join(pluginDir, 'plugin.json'))).toEqual({
      name: 'chorus',
    });
    expect(readJson(path.join(pluginDir, 'mcp_config.json'))).toEqual({
      mcpServers: {
        chorus: {
          command: 'node',
          args: ['/opt/homebrew/lib/node_modules/chorus-codes/bin/chorus.mjs', 'mcp'],
          env: {
            CHORUS_DAEMON_URL: 'http://127.0.0.1:7707',
          },
        },
      },
    });
  });

  it('is idempotent when the plugin already points at the same chorus binary', () => {
    const first = registerAgyMcpPlugin({
      homeDir: fakeHome,
      binPath: '/path/to/chorus.mjs',
    });
    const second = registerAgyMcpPlugin({
      homeDir: fakeHome,
      binPath: '/path/to/chorus.mjs',
    });

    expect(first.added).toEqual(['plugins/chorus/mcp_config.json']);
    expect(second.added).toEqual([]);
    expect(second.alreadyPresent).toEqual(['plugins/chorus/mcp_config.json']);
  });
});
