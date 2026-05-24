import { execFileSync } from "node:child_process";
import { parseOpenCodeTerminalUsage } from "@/lib/opencode-terminal-usage";
import { buildTmuxSessionName } from "@/lib/tmux-session-name";

export interface PersistedTerminalUsage {
  contextTokens?: number;
  costUsd?: number;
}

/**
 * Best-effort bridge for OpenCode's terminal footer. Current OpenCode Go
 * builds print cost/context in the tmux pane before structured usage reaches
 * our sidecars; parsing may fail as the CLI footer evolves, in which case the
 * UI intentionally falls back to `tokens n/a` instead of inventing values.
 */
export function readOpenCodeTerminalUsageFromTmux(
  chatId: string,
  phaseId: string,
  role: "doer" | "reviewer",
  agent: string,
): PersistedTerminalUsage | null {
  try {
    const sessionName = buildTmuxSessionName({ chatId, phaseId, role, agent });
    const pane = execFileSync(
      "tmux",
      ["capture-pane", "-pt", sessionName, "-S", "-120"],
      { encoding: "utf-8", timeout: 1000, stdio: ["ignore", "pipe", "ignore"] },
    );
    return parseOpenCodeTerminalUsage(pane);
  } catch {
    return null;
  }
}
