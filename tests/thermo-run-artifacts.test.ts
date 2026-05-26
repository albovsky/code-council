import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  inferLegacyThermoMetadata,
  readThermoParticipantMetadata,
  readThermoRunPlan,
} from "../src/lib/server/thermo-run-artifacts";

describe("thermo run artifact helpers", () => {
  it("reads authoritative participant sidecar metadata", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "thermo-meta-"));
    fs.writeFileSync(
      path.join(dir, "_thermo.json"),
      JSON.stringify({
        kind: "thermo",
        phaseGroup: "validation",
        phaseId: "thermo-phase-2-security",
        phaseLabel: "Thermo security validation",
        description: "Validate security findings.",
        check: "Security, auth, authorization, data loss.",
        domain: "security",
        role: "validator",
        voiceId: "voice-openrouter-deepseek-pro",
        provider: "openrouter",
        modelId: "opencode-go/deepseek-v4-pro",
        tier: "A",
      }),
    );

    expect(readThermoParticipantMetadata(dir)?.domain).toBe("security");
    expect(readThermoParticipantMetadata(dir)?.role).toBe("validator");
  });

  it("rejects malformed participant sidecars", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "thermo-bad-meta-"));
    fs.writeFileSync(path.join(dir, "_thermo.json"), JSON.stringify({ kind: "thermo" }));

    expect(readThermoParticipantMetadata(dir)).toBeUndefined();
  });

  it("maps unknown sidecar domains to final synthesis", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "thermo-unknown-domain-"));
    fs.writeFileSync(
      path.join(dir, "_thermo.json"),
      JSON.stringify({
        kind: "thermo",
        phaseGroup: "specialist",
        phaseId: "thermo-phase-1-unknown",
        phaseLabel: "Thermo legacy review",
        description: "Legacy domain.",
        check: "Legacy check.",
        domain: "legacy-domain",
        role: "primary",
        voiceId: "voice-a",
        provider: "openrouter",
        modelId: "opencode-go/deepseek-v4-pro",
        tier: "A",
      }),
    );

    expect(readThermoParticipantMetadata(dir)?.domain).toBe("final_synthesis");
  });

  it("infers legacy phase one specialists from the answer header", () => {
    const answer = [
      "# Thermo Phase 1 Specialist Review - Tests Domain",
      "",
      "## Assignment",
      "Domain: tests",
      "Role: primary",
      "",
      "## Findings",
      "### [high] Missing coverage",
      "",
      "## DONE",
    ].join("\n");

    expect(inferLegacyThermoMetadata(answer, "opencode-go/qwen3.6-plus")).toMatchObject({
      phaseGroup: "specialist",
      role: "primary",
      domain: "tests",
      modelId: "opencode-go/qwen3.6-plus",
    });
  });

  it("maps legacy adversarial_noise headers to final synthesis", () => {
    const answer = [
      "# Thermo Phase 1 Specialist Review - adversarial_noise",
      "",
      "## Assignment",
      "Domain: adversarial_noise",
      "Role: primary",
      "",
      "## Findings",
      "Legacy synthesis adversarial-noise output.",
      "",
      "## DONE",
    ].join("\n");

    expect(inferLegacyThermoMetadata(answer, "gpt-5.5")?.domain).toBe("final_synthesis");
  });

  it("does not infer Thermo metadata from ordinary prose mentioning thermo or validation", () => {
    const answer = [
      "## Findings",
      "This ordinary review mentions thermo behavior and validation, but it is not a Thermo phase output.",
      "",
      "## DONE",
    ].join("\n");

    expect(inferLegacyThermoMetadata(answer, "gpt-5.5")).toBeUndefined();
  });

  it("reads a valid run plan", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "thermo-plan-"));
    fs.writeFileSync(
      path.join(dir, "_thermo-plan.json"),
      JSON.stringify({
        phases: [
          {
            id: "specialist",
            label: "Phase 1",
            title: "Specialist review",
            description: "Primary reviewers check each Thermo domain.",
          },
        ],
        domains: [
          {
            domain: "security",
            check: "Security checks.",
            validatorPolicy: "always",
            validatorReason: "Security requires validation.",
            primary: {
              voiceId: "voice-a",
              provider: "openrouter",
              modelId: "opencode-go/deepseek-v4-pro",
              tier: "A",
            },
            validator: null,
          },
        ],
      }),
    );

    expect(readThermoRunPlan(dir)?.domains[0]?.domain).toBe("security");
  });

  it("maps unknown run plan domains to final synthesis", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "thermo-plan-unknown-domain-"));
    fs.writeFileSync(
      path.join(dir, "_thermo-plan.json"),
      JSON.stringify({
        phases: [],
        domains: [
          {
            domain: "legacy-domain",
            check: "Legacy checks.",
            validatorPolicy: "none",
            validatorReason: "Legacy.",
            primary: null,
            validator: null,
          },
        ],
      }),
    );

    expect(readThermoRunPlan(dir)?.domains[0]?.domain).toBe("final_synthesis");
  });
});
