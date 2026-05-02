/**
 * OpenCode agent shim (Kimi/DeepSeek via OpenCode Go plan).
 * Single-line prompts, plain text paths (see feedback_gemini_multiline_prompts.md).
 * Always /clear between rounds (see feedback_opencode_clear_always.md).
 * Never lead with `/` (slash-command) or `@` (file-attach popup).
 */

import type {
  AgentShim,
  AgentSpawnOptions,
  AgentNudgeOptions,
  HeadlessSpawnOptions,
  AgentEvent,
} from './types.js';
import { quotePath, validateValue } from './quote.js';
import { spawnHeadless } from '../headless.js';
import { parseOpencode, parseOpencodeExit } from './parsers.js';
import * as fs from 'fs';
import * as path from 'path';

export const opencodeShim: AgentShim = {
  lineage: 'opencode',
  name: 'opencode-cli',

  // clearKeys are sent by the runner via mgr.sendKeys() before nudging.
  // Pattern: Escape twice to dismiss overlays, then /clear + Enter.
  clearKeys: ['Escape', 'Escape', '/clear', 'Enter'] as const,

  // Auto-recovery for OpenCode's "Always allow" dialog (bash command, file
  // read, subagent spawn — same dialog, different trigger). Default selection
  // is "Allow once"; one Right arrow moves to "Always allow", Enter confirms.
  // The dialog persists across triggers, so this is sufficient for any of the
  // approval prompts (git diff, Read on external path, Task subagent spawn).
  recoverKeys: {
    permission_prompt: ['Right', 'Enter'] as const,
  },

  buildLaunchCommand(opts: AgentSpawnOptions): string {
    validateValue('model', opts.model);

    const cwd = quotePath(opts.cwd);
    let cmd = `cd ${cwd} && opencode`;

    if (opts.model) {
      cmd += ` --model ${opts.model}`;
    }

    return cmd;
  },

  formatPrompt(opts: AgentNudgeOptions): string {
    // CRITICAL: Single-line only. Never lead with `/` or `@`.
    // Plain text path reference: "at /abs/path" form.
    const sentinel = opts.expectDoneSentinel ? ' End with ## DONE.' : '';

    return (
      `Open the file at this absolute path using your read tool: ${opts.promptFile} ` +
      `— follow the <ask> block, write your full answer to ${opts.answerFile}.${sentinel}`
    );
  },

  /**
   * Headless mode (`opencode run --format json "<tiny argv> @prompt.md"`).
   *
   * OpenCode `run` is one-shot — emits a single JSON blob at the end with
   * the final message. parseOpencode returns [] on every line; the on-exit
   * handler parses the full blob into a message_done event. Heartbeat is on
   * so the UI shows the agent is alive during the silent run.
   *
   * Argv-overflow guard: opencode's `run` only accepts the prompt as a
   * positional argv (no stdin support — verified 2026-05-02 with `opencode
   * run --help`). For chorus self-reviews on real PR diffs the prompt
   * crosses 100KB and shell-quoting / ARG_MAX bites. Workaround mirrors
   * the tmux path: write the prompt to `<cwd>/prompt.md` and pass a tiny
   * directive on argv telling opencode to read that file using its read
   * tool. The chat dir is always the cwd, so the relative path resolves
   * inside opencode's allowed workspace.
   */
  runHeadless(opts: HeadlessSpawnOptions): AsyncIterable<AgentEvent> {
    // Sidestep both ARG_MAX and shell-escape pitfalls by stashing the prompt
    // on disk. The chat dir already exists (the runner creates it before
    // spawning), so this never fails on first call.
    const promptPath = path.join(opts.cwd, 'prompt.md');
    fs.writeFileSync(promptPath, opts.promptText, 'utf-8');

    // CRITICAL: Single-line message. Never lead with `/` or `@`.
    // Plain text path reference matches the tmux formatPrompt pattern.
    // Don't tell opencode to write answer.md — the runner captures stdout
    // JSON via parseOpencodeExit and writes the file itself; a tool-side
    // write would race with the runner's clobber on message_done.
    const directive =
      `Open the file at this absolute path using your read tool: ${promptPath} ` +
      `— follow the instructions inside exactly and respond with your full answer in this conversation, ending with ## DONE.`;

    const args = ['run', '--format', 'json'];
    if (opts.model) args.push('--model', opts.model);
    args.push(directive);

    const run = spawnHeadless({
      command: 'opencode',
      args,
      cwd: opts.cwd,
      parseLine: parseOpencode,
      onExit: (fullStdout) => parseOpencodeExit(fullStdout),
      cli: 'opencode',
      timeoutMs: opts.timeoutMs,
      abortSignal: opts.abortSignal,
      heartbeat: true, // one-shot — heartbeat keeps UI alive
    });

    return run.events;
  },

  estimateCostUsd(): number {
    // OpenCode Go subscription plan (Kimi/DeepSeek), not per-call API
    return 0;
  },
};
