import { describe, expect, it } from "vitest";
import { participantHasReviewResult } from "../src/components/run-viewer/participant-card";
import { participantHasCompletedResult } from "../src/components/run-viewer/thermo-domain-board";

describe("run viewer participant state helpers", () => {
  it("does not treat partial streamed output as a completed review result", () => {
    expect(
      participantHasReviewResult(
        { hasAnswer: false },
        undefined,
      ),
    ).toBe(false);
  });

  it("requires the durable answer sentinel before handoff to Thermo review", () => {
    expect(participantHasCompletedResult({ hasAnswer: false })).toBe(false);
    expect(participantHasCompletedResult({ hasAnswer: true })).toBe(true);
  });

  it("keeps failed participant output out of done state", () => {
    expect(participantHasReviewResult({ hasAnswer: true }, { kind: "cli_failed" })).toBe(false);
  });
});
