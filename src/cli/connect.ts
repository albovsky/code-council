/**
 * `chorus connect [orchestrator]` — patches the orchestrator's permission
 * config so all Chorus MCP tools are pre-approved. Removes the per-tool
 * "Yes, allow for this project?" friction the first time you use Chorus.
 *
 * Idempotent. Doesn't touch existing permissions.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CHORUS_TOOLS = [
  'mcp__chorus__create_chat',
  'mcp__chorus__wait_for_chat',
  'mcp__chorus__get_chat_status',
  'mcp__chorus__list_blocked',
  'mcp__chorus__resume_chat',
  'mcp__chorus__cancel_chat',
  'mcp__chorus__list_templates',
];

interface ClaudeSettings {
  permissions?: {
    allow?: string[];
    deny?: string[];
    ask?: string[];
    defaultMode?: string;
    additionalDirectories?: string[];
  };
  [key: string]: unknown;
}

function patchClaudeCode(): { added: string[]; alreadyPresent: string[]; configPath: string } {
  const configPath = path.join(os.homedir(), '.claude', 'settings.local.json');
  let config: ClaudeSettings = {};

  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch (err) {
      throw new Error(
        `Could not parse ${configPath}: ${err instanceof Error ? err.message : String(err)}. ` +
          `Fix the JSON syntax and re-run \`chorus connect\`.`,
      );
    }
  } else {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
  }

  const permissions = (config.permissions ?? {}) as NonNullable<ClaudeSettings['permissions']>;
  const existing = new Set(permissions.allow ?? []);

  const added: string[] = [];
  const alreadyPresent: string[] = [];
  for (const tool of CHORUS_TOOLS) {
    if (existing.has(tool)) {
      alreadyPresent.push(tool);
    } else {
      existing.add(tool);
      added.push(tool);
    }
  }

  if (added.length === 0) {
    return { added, alreadyPresent, configPath };
  }

  const next: ClaudeSettings = {
    ...config,
    permissions: {
      ...permissions,
      allow: Array.from(existing).sort(),
    },
  };

  fs.writeFileSync(configPath, JSON.stringify(next, null, 2) + '\n', 'utf-8');
  return { added, alreadyPresent, configPath };
}

export function runConnect(orchestrator?: string): void {
  const target = (orchestrator ?? 'claude').toLowerCase();

  if (target !== 'claude' && target !== 'all') {
    console.error(
      `Unknown orchestrator: '${orchestrator}'. Supported: claude, all (codex/cursor coming).`,
    );
    process.exit(1);
  }

  console.log(`Connecting Chorus to Claude Code...`);

  try {
    const { added, alreadyPresent, configPath } = patchClaudeCode();

    if (added.length === 0) {
      console.log(`✓ All ${CHORUS_TOOLS.length} Chorus tools already pre-approved.`);
      console.log(`  (in ${configPath})`);
    } else {
      console.log(`✓ Added ${added.length} Chorus tool(s) to ${configPath}:`);
      for (const tool of added) console.log(`    + ${tool.replace('mcp__chorus__', 'chorus.')}`);
      if (alreadyPresent.length > 0) {
        console.log(`  (${alreadyPresent.length} already present, left untouched)`);
      }
    }

    console.log('');
    console.log('Restart Claude Code and the per-tool prompts will be gone.');
  } catch (err) {
    console.error(
      `\nFailed to patch Claude config: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }
}
