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
