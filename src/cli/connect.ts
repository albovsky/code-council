/**
 * `chorus connect [orchestrator]` — patches the orchestrator's permission
 * config so all Chorus MCP tools are pre-approved. Removes the per-tool
 * "Yes, allow for this project?" friction the first time you use Chorus.
 *
 * Idempotent. Same logic exposed at daemon `POST /orchestrators/:name/connect`
 * so the cockpit's /connect page can run it with one click.
 */

import { connectByName, CHORUS_TOOLS } from '../daemon/orchestrators.js';

export function runConnect(orchestrator?: string): void {
  const target = (orchestrator ?? 'claude').toLowerCase();

  if (target !== 'claude') {
    console.error(
      `Unknown orchestrator: '${orchestrator}'. Supported: claude (codex/cursor coming).`,
    );
    process.exit(1);
  }

  console.log(`Connecting Chorus to Claude Code...`);

  try {
    const { added, alreadyPresent, configPath } = connectByName(target);

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
