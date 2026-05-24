import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const execFileSyncMock = vi.hoisted(() =>
  vi.fn(() => "Build · DeepSeek V4 Flash OpenCode Go\n103.2K (10%) · $0.02"),
);

vi.mock("node:child_process", () => ({
  execFileSync: execFileSyncMock,
}));

import { buildParticipantSnapshot } from "../src/lib/server/run-artifacts";

describe("run artifact participant snapshots", () => {
  it("keeps the reviewer index when reading OpenCode tmux usage", () => {
    const participantDir = fs.mkdtempSync(path.join(os.tmpdir(), "run-artifacts-"));
    fs.writeFileSync(
      path.join(participantDir, "_thermo.json"),
      JSON.stringify({
        kind: "thermo",
        phaseGroup: "specialist",
        phaseId: "thermo-phase-1-security",
        phaseLabel: "Security",
        description: "Security review.",
        check: "Security checks.",
        domain: "security",
        role: "primary",
        voiceId: "opencode-deepseek",
        provider: "opencode-cli",
        modelId: "opencode-go/deepseek-v4-flash",
        tier: "B_MINUS",
      }),
    );

    const snapshot = buildParticipantSnapshot({
      chatId: "01TESTCHAT",
      roundNum: 1,
      participantDir,
      participantName: "reviewer-opencode-cli-5",
    });

    expect(snapshot.agentName).toBe("opencode-cli");
    expect(snapshot.terminalUsage).toEqual({
      contextTokens: 103_200,
      costUsd: 0.02,
    });
    expect(execFileSyncMock).toHaveBeenCalledWith(
      "tmux",
      [
        "capture-pane",
        "-pt",
        "council-01TESTCHAT-thermo-phase-1-security-reviewer-opencode-cli-5",
        "-S",
        "-120",
      ],
      expect.any(Object),
    );
  });
});
