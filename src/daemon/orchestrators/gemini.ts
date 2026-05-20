import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DEFAULT_DAEMON_URL,
  execFileAsync,
  hasMcpEntry,
  type ConnectOpts,
  type ConnectResult,
  type OrchestratorDefinition,
  type OrchestratorStatus,
  writeMcpEntry,
} from './shared.js';
import { detectAllClis } from '../../lib/cli-detect.js';

const LEGACY_GEMINI_SETTINGS_PATH = path.join(
  os.homedir(),
  '.gemini',
  'settings.json',
);

function agyPaths(homeDir = os.homedir()): {
  root: string;
  pluginDir: string;
  pluginJsonPath: string;
  mcpConfigPath: string;
} {
  const root = path.join(homeDir, '.gemini', 'antigravity-cli');
  const pluginDir = path.join(root, 'plugins', 'council');
  return {
    root,
    pluginDir,
    pluginJsonPath: path.join(pluginDir, 'plugin.json'),
    mcpConfigPath: path.join(pluginDir, 'mcp_config.json'),
  };
}

function normalizeBinaryName(command: string | undefined): string {
  if (!command) return '';
  return path.basename(command).toLowerCase().replace(/\.(cmd|exe|bat|ps1|js)$/i, '');
}

function detectedGoogleCli(): { found: boolean; path?: string } | undefined {
  return detectAllClis().find((cli) => cli.id === 'gemini-cli');
}

function shouldUseAgy(): boolean {
  const detected = detectedGoogleCli();
  return (
    (detected?.found === true && normalizeBinaryName(detected.path) === 'agy') ||
    fs.existsSync(agyPaths().root)
  );
}

function getGeminiStatus(): OrchestratorStatus {
  if (shouldUseAgy()) {
    const connected = hasAgyMcpServer();
    return {
      name: 'gemini',
      label: 'Antigravity CLI',
      connected,
      approvedTools: connected ? 1 : 0,
      totalTools: 1,
      note: 'Registers Code Council as an Antigravity plugin under ~/.gemini/antigravity-cli/plugins/council/mcp_config.json.',
      supported: true,
      firstCallBehavior: 'prompts_once',
    };
  }

  const detected = fs.existsSync(LEGACY_GEMINI_SETTINGS_PATH);
  const connected = detected && hasGeminiMcpServer();
  return {
    name: 'gemini',
    label: 'Gemini CLI (legacy)',
    connected,
    approvedTools: connected ? 1 : 0,
    totalTools: 1,
    note: "Registers Code Council as a user-scope MCP server in ~/.gemini/settings.json with --trust set so calls don't prompt.",
    supported: detected,
    firstCallBehavior: 'auto',
  };
}

function hasGeminiMcpServer(expectedBinPath?: string): boolean {
  if (!fs.existsSync(LEGACY_GEMINI_SETTINGS_PATH)) return false;
  try {
    const body = JSON.parse(
      fs.readFileSync(LEGACY_GEMINI_SETTINGS_PATH, 'utf-8'),
    ) as Record<string, unknown>;
    const servers = body.mcpServers as Record<string, unknown> | undefined;
    const council = servers?.council as { args?: string[] } | undefined;
    if (!council) return false;
    if (!expectedBinPath) return true;
    return Array.isArray(council.args) && council.args.includes(expectedBinPath);
  } catch {
    return false;
  }
}

function hasAgyMcpServer(expectedBinPath?: string, homeDir = os.homedir()): boolean {
  return hasMcpEntry(agyPaths(homeDir).mcpConfigPath, expectedBinPath);
}

export function registerAgyMcpPlugin(opts: {
  binPath: string;
  daemonUrl?: string;
  homeDir?: string;
}): ConnectResult {
  const paths = agyPaths(opts.homeDir);
  const configRef = 'plugins/council/mcp_config.json';
  if (hasAgyMcpServer(opts.binPath, opts.homeDir)) {
    return {
      added: [],
      alreadyPresent: [configRef],
      configPath: paths.mcpConfigPath,
      slashCommand: 'skipped',
      slashCommandPath: '',
    };
  }

  fs.mkdirSync(paths.pluginDir, { recursive: true });
  let pluginJson: Record<string, unknown> = {};
  if (fs.existsSync(paths.pluginJsonPath)) {
    try {
      pluginJson = JSON.parse(
        fs.readFileSync(paths.pluginJsonPath, 'utf-8'),
      ) as Record<string, unknown>;
    } catch {
      pluginJson = {};
    }
  }
  const nextPluginJson = { ...pluginJson, name: 'council' };
  fs.writeFileSync(
    paths.pluginJsonPath,
    JSON.stringify(nextPluginJson, null, 2) + '\n',
    'utf-8',
  );
  writeMcpEntry({
    filePath: paths.mcpConfigPath,
    binPath: opts.binPath,
    daemonUrl: opts.daemonUrl ?? DEFAULT_DAEMON_URL,
  });

  return {
    added: [configRef],
    alreadyPresent: [],
    configPath: paths.mcpConfigPath,
    slashCommand: 'skipped',
    slashCommandPath: '',
  };
}

/**
 * Register Code Council with Gemini CLI. `gemini mcp add` writes to
 * ~/.gemini/settings.json (or per-project) for us — we use --scope user
 * to make it global. Idempotent: skips when already present.
 */
async function connectGemini(
  opts: { binPath: string; daemonUrl?: string },
): Promise<ConnectResult> {
  if (hasGeminiMcpServer(opts.binPath)) {
    return {
      added: [],
      alreadyPresent: ['mcpServers.council'],
      configPath: LEGACY_GEMINI_SETTINGS_PATH,
      slashCommand: 'skipped',
      slashCommandPath: '',
    };
  }

  // Stale entry with different binPath — remove (user-scope) before re-add.
  if (hasGeminiMcpServer()) {
    try {
      await execFileAsync(
        'gemini',
        ['mcp', 'remove', 'council', '-s', 'user'],
        {
        timeout: 30_000,
        shell: process.platform === 'win32',
      },
      );
    } catch {
      /* best-effort */
    }
  }

  const daemonUrl = opts.daemonUrl ?? DEFAULT_DAEMON_URL;
  try {
    await execFileAsync(
      'gemini',
      [
        'mcp',
        'add',
        'council',
        'node',
        opts.binPath,
        'mcp',
        '-e',
        `COUNCIL_DAEMON_URL=${daemonUrl}`,
        '-s',
        'user',
        '-t',
        'stdio',
        '--trust',
      ],
      {
        timeout: 30_000,
        shell: process.platform === 'win32',
      },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`gemini mcp add failed: ${msg}`);
  }

  return {
    added: ['mcpServers.council'],
    alreadyPresent: [],
    configPath: LEGACY_GEMINI_SETTINGS_PATH,
    slashCommand: 'skipped',
    slashCommandPath: '',
  };
}

export const geminiOrchestrator: OrchestratorDefinition = {
  name: 'gemini',
  label: 'Antigravity CLI',
  getStatus: getGeminiStatus,
  detect: () => shouldUseAgy() || fs.existsSync(LEGACY_GEMINI_SETTINGS_PATH),
  connect: async (opts: ConnectOpts) => {
    if (shouldUseAgy()) {
      const before = hasAgyMcpServer(opts.binPath);
      const full = registerAgyMcpPlugin(opts);
      return {
        registered: !before,
        toolsAdded: 0,
        full,
      };
    }

    const before = hasGeminiMcpServer();
    const full = await connectGemini(opts);
    return { registered: !before, toolsAdded: 0, full };
  },
};

export const _internals = {
  agyPaths,
  hasAgyMcpServer,
};
