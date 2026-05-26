import { describe, expect, it } from "vitest";
import {
  MODE_META,
  normalizeCodeReviewMode,
} from "../src/app/code-review/code-review-launcher";

describe("code review launcher mode normalization", () => {
  it("falls back to fast for stale persisted mode values", () => {
    expect(normalizeCodeReviewMode("worktree")).toBe("fast");
    expect(normalizeCodeReviewMode(undefined)).toBe("fast");
  });

  it("preserves valid modes", () => {
    expect(normalizeCodeReviewMode("fast")).toBe("fast");
    expect(normalizeCodeReviewMode("thermo")).toBe("thermo");
  });
});

describe("code review launcher mode metadata", () => {
  it("describes Thermo specialists as seven domains", () => {
    const thermoStepDetails = MODE_META.thermo.steps
      .map((step) => step.detail)
      .join(" ");

    expect(thermoStepDetails).not.toContain("security, tests, perf");
    expect(thermoStepDetails).toContain("7 domains");
  });
});
