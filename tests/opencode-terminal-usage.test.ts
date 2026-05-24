import { describe, expect, it } from "vitest";
import { parseOpenCodeTerminalUsage } from "@/lib/opencode-terminal-usage";

describe("parseOpenCodeTerminalUsage", () => {
  it("parses context tokens and cost from OpenCode TUI footer", () => {
    const usage = parseOpenCodeTerminalUsage(
      "Build · DeepSeek V4 Flash OpenCode Go\n98.8K (10%) · $0.02  ctrl+p commands",
    );

    expect(usage).toEqual({
      contextTokens: 98_800,
      costUsd: 0.02,
    });
  });

  it("uses the last footer when the pane contains multiple redraws", () => {
    const usage = parseOpenCodeTerminalUsage(
      "81.1K (8%) · $0.01\nlater redraw\n114.6K (11%) · $0.02",
    );

    expect(usage).toEqual({
      contextTokens: 114_600,
      costUsd: 0.02,
    });
  });

  it("returns null when no OpenCode footer is present", () => {
    expect(parseOpenCodeTerminalUsage("answer complete")).toBeNull();
  });
});
