export interface OpenCodeTerminalUsage {
  contextTokens?: number;
  costUsd?: number;
}

/**
 * Parse OpenCode's TUI footer, e.g. `98.8K (10%) · $0.02`.
 *
 * This is not the structured JSON token report. It is the live terminal's
 * context-meter display, but it is still useful for tmux runs where OpenCode's
 * JSON stream is not available after completion.
 */
export function parseOpenCodeTerminalUsage(
  text: string | undefined,
): OpenCodeTerminalUsage | null {
  if (!text) return null;
  const matches = [
    ...text.matchAll(/(\d+(?:\.\d+)?)\s*K\s*\(\d+%\)(?:\s*[·•]\s*\$(\d+(?:\.\d+)?))?/gi),
  ];
  const match = matches.at(-1);
  if (!match) return null;

  const usage: OpenCodeTerminalUsage = {};
  const contextK = Number.parseFloat(match[1] ?? "");
  if (Number.isFinite(contextK)) {
    usage.contextTokens = Math.round(contextK * 1000);
  }
  const cost = Number.parseFloat(match[2] ?? "");
  if (Number.isFinite(cost)) {
    usage.costUsd = cost;
  }
  return Object.keys(usage).length > 0 ? usage : null;
}
