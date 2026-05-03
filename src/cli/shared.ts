import fs from 'fs';
import path from 'path';
import { detectRuntimeEnv } from './runtime-env.js';
import { c, sym, tip } from './ui.js';

export const COCKPIT_URL = 'http://127.0.0.1:5050';
export const DAEMON_URL = 'http://127.0.0.1:7707';

/**
 * Absolute path to bin/chorus.mjs. Resolved from __dirname so the path
 * is correct whether the CLI runs via:
 *   - `npm i -g chorus` → /usr/local/lib/node_modules/chorus/dist/cli/index.js
 *   - tsx dev mode      → /home/.../chorus/src/cli/index.ts
 *   - direct dist       → /home/.../chorus/dist/cli/index.js
 *
 * `process.argv[1]` would also work for the npm-installed case, but in
 * tsx dev mode it points at the .ts file which `node` can't execute.
 */
export const CHORUS_BIN_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  'bin',
  'chorus.mjs',
);

/**
 * Read version from the shipped package.json so it can never drift.
 * __dirname is dist/cli (built) or src/cli (tsx dev); ../../package.json
 * resolves to the package root in both layouts.
 */
export const pkg: { version: string; name: string } = (() => {
  try {
    const pkgPath = path.resolve(__dirname, '..', '..', 'package.json');
    const raw = fs.readFileSync(pkgPath, 'utf-8');
    const parsed = JSON.parse(raw) as { version?: string; name?: string };
    return {
      version: parsed.version ?? '0.0.0',
      name: parsed.name ?? 'chorus',
    };
  } catch {
    return { version: '0.0.0', name: 'chorus' };
  }
})();

export function printCockpitAccessHint(): void {
  const env = detectRuntimeEnv();
  console.log('');
  console.log(`   ${c.gray('Open')}  ${c.cyan(COCKPIT_URL)}`);
  if (env.hint) {
    console.log('');
    console.log(tip(env.hint));
  }
  console.log('');
}

export { c, sym };
