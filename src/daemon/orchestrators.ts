/**
 * Orchestrator integrations: pre-approve Chorus's MCP tools in third-party
 * editors / CLIs so users don't get prompted on every tool call.
 *
 * Same logic the `chorus connect` CLI uses, exposed via daemon HTTP so the
 * cockpit's /connect page can do it with one click.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const CHORUS_TOOLS = [
  'mcp__chorus__create_chat',
  'mcp__chorus__wait_for_chat',
  'mcp__chorus__get_chat_status',
  'mcp__chorus__list_blocked',
  'mcp__chorus__resume_chat',
  'mcp__chorus__cancel_chat',
  'mcp__chorus__list_templates',
];

export type OrchestratorName = 'claude' | 'codex' | 'cursor';

export interface OrchestratorStatus {
  name: OrchestratorName;
  label: string;
  /** True when Chorus's MCP tools are pre-approved (all of them). */
  connected: boolean;
  /** How many of CHORUS_TOOLS are pre-approved right now. */
  approvedTools: number;
  /** Total expected (always CHORUS_TOOLS.length for now). */
  totalTools: number;
  /** Human note for "what does connecting do?" UX copy. */
  note: string;
  /** False = we know how to detect/connect; true = stub for future. */
  supported: boolean;
}

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

const CLAUDE_SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.local.json');

function readClaudeSettings(): ClaudeSettings {
  if (!fs.existsSync(CLAUDE_SETTINGS_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(CLAUDE_SETTINGS_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

function getClaudeStatus(): OrchestratorStatus {
  const config = readClaudeSettings();
  const allow = new Set(config.permissions?.allow ?? []);
  const approved = CHORUS_TOOLS.filter((t) => allow.has(t)).length;
  return {
    name: 'claude',
    label: 'Claude Code',
    connected: approved === CHORUS_TOOLS.length,
    approvedTools: approved,
    totalTools: CHORUS_TOOLS.length,
    note: 'Pre-approves the 7 chorus.* tools so Claude Code doesn\'t prompt per-tool.',
    supported: true,
  };
}

/**
 * List all orchestrator statuses for the /connect page.
 */
export function listOrchestrators(): OrchestratorStatus[] {
  return [
    getClaudeStatus(),
    {
      name: 'codex',
      label: 'Codex CLI',
      connected: false,
      approvedTools: 0,
      totalTools: 0,
      note: 'Codex doesn\'t use per-tool gating; nothing to pre-approve. Auto-trust of the chat dir is already handled at spawn.',
      supported: false,
    },
    {
      name: 'cursor',
      label: 'Cursor',
      connected: false,
      approvedTools: 0,
      totalTools: 0,
      note: 'Cursor MCP integration coming.',
      supported: false,
    },
  ];
}

export interface ConnectResult {
  added: string[];
  alreadyPresent: string[];
  configPath: string;
}

/**
 * Patch Claude Code's local settings to whitelist all 7 Chorus MCP tools.
 * Idempotent.
 */
export function connectClaude(): ConnectResult {
  const config = readClaudeSettings();
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
    return { added, alreadyPresent, configPath: CLAUDE_SETTINGS_PATH };
  }

  fs.mkdirSync(path.dirname(CLAUDE_SETTINGS_PATH), { recursive: true });
  const next: ClaudeSettings = {
    ...config,
    permissions: {
      ...permissions,
      allow: Array.from(existing).sort(),
    },
  };
  fs.writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(next, null, 2) + '\n', 'utf-8');

  return { added, alreadyPresent, configPath: CLAUDE_SETTINGS_PATH };
}

export function connectByName(name: string): ConnectResult {
  switch (name) {
    case 'claude':
      return connectClaude();
    default:
      throw new Error(`Connecting '${name}' is not supported yet.`);
  }
}

/**
 * Register Chorus as an MCP server in Claude Code's project config.
 * Patches `~/.claude.json` → projects.<projectDir>.mcpServers.chorus.
 *
 * Idempotent: if chorus is already pointing at the same bin path, returns
 * `{ added: false }`.
 */
export function registerClaudeMcpServer(opts: {
  binPath: string;
  projectDir?: string;
  daemonUrl?: string;
}): { added: boolean; configPath: string; project: string } {
  const configPath = path.join(os.homedir(), '.claude.json');
  const project = opts.projectDir ?? os.homedir();

  let config: Record<string, unknown> = {};
  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch {
      throw new Error(
        `Could not parse ${configPath}. Fix the JSON or remove it and re-run.`,
      );
    }
  }

  const projects = (config.projects && typeof config.projects === 'object'
    ? (config.projects as Record<string, Record<string, unknown>>)
    : {});
  const projectBlock = projects[project] ?? {};
  const mcpServers = (projectBlock.mcpServers && typeof projectBlock.mcpServers === 'object'
    ? (projectBlock.mcpServers as Record<string, unknown>)
    : {});

  const existing = mcpServers.chorus as
    | { command?: string; args?: string[]; env?: Record<string, string> }
    | undefined;
  if (
    existing &&
    Array.isArray(existing.args) &&
    existing.args[0] === opts.binPath &&
    existing.args[1] === 'mcp'
  ) {
    return { added: false, configPath, project };
  }

  mcpServers.chorus = {
    command: 'node',
    args: [opts.binPath, 'mcp'],
    env: { CHORUS_DAEMON_URL: opts.daemonUrl ?? 'http://127.0.0.1:7707' },
  };

  projects[project] = { ...projectBlock, mcpServers };
  fs.writeFileSync(configPath, JSON.stringify({ ...config, projects }, null, 2), 'utf-8');
  return { added: true, configPath, project };
}

// ─── Auto-connect: detect all supported CLIs, wire each one ─────────────────

export interface AutoConnectStep {
  name: OrchestratorName;
  label: string;
  /** Was this CLI's config file present on disk? */
  detected: boolean;
  /** Did we add a new MCP server entry? (false if already registered) */
  registered: boolean;
  /** How many tools were added to the allow-list (0 if all were already there) */
  toolsAdded: number;
  /** True if the CLI was detected but Chorus doesn't know how to wire it yet */
  unsupported?: boolean;
  /** Surfaced when something failed */
  error?: string;
}

export interface AutoConnectResult {
  steps: AutoConnectStep[];
  /** Did we touch at least one CLI? */
  anyConnected: boolean;
}

/**
 * Detect every CLI we know about and connect to all that are present.
 * Currently only Claude Code is fully wired; Codex/Cursor are stubs that
 * report `unsupported: true` if their config dirs are detected.
 */
export function autoConnectAll(opts: {
  binPath: string;
  projectDir?: string;
}): AutoConnectResult {
  const steps: AutoConnectStep[] = [];

  // Claude Code — fully supported.
  const claudeConfig = path.join(os.homedir(), '.claude.json');
  if (fs.existsSync(claudeConfig)) {
    try {
      const reg = registerClaudeMcpServer(opts);
      const conn = connectClaude();
      steps.push({
        name: 'claude',
        label: 'Claude Code',
        detected: true,
        registered: reg.added,
        toolsAdded: conn.added.length,
      });
    } catch (err) {
      steps.push({
        name: 'claude',
        label: 'Claude Code',
        detected: true,
        registered: false,
        toolsAdded: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  } else {
    steps.push({
      name: 'claude',
      label: 'Claude Code',
      detected: false,
      registered: false,
      toolsAdded: 0,
    });
  }

  // Codex CLI — detection only; full wire-up in a later release.
  const codexConfig = path.join(os.homedir(), '.codex', 'config.toml');
  if (fs.existsSync(codexConfig)) {
    steps.push({
      name: 'codex',
      label: 'Codex CLI',
      detected: true,
      registered: false,
      toolsAdded: 0,
      unsupported: true,
    });
  }

  // Cursor — same. Detect via known config locations on Linux/macOS.
  const cursorPaths = [
    path.join(os.homedir(), '.cursor'),
    path.join(os.homedir(), '.config', 'Cursor'),
    path.join(os.homedir(), 'Library', 'Application Support', 'Cursor'),
  ];
  if (cursorPaths.some((p) => fs.existsSync(p))) {
    steps.push({
      name: 'cursor',
      label: 'Cursor',
      detected: true,
      registered: false,
      toolsAdded: 0,
      unsupported: true,
    });
  }

  const anyConnected = steps.some((s) => s.detected && !s.unsupported && !s.error);
  return { steps, anyConnected };
}
