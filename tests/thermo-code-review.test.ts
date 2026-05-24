import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunnerEvent } from '../src/daemon/runner';
import { runThermoCodeReview } from '../src/daemon/runner/thermo-code-review';
import type { ThermoAssignmentPlan, ThermoCoverageGap, ThermoDomain } from '../src/lib/thermo-review-assignment';
import type { RankedReviewVoice, ReviewModelTier } from '../src/lib/review-model-tiering';

const runSingleReviewerWithPromptMock = vi.hoisted(() => vi.fn());

vi.mock('../src/daemon/runner/reviewer-driver.js', () => ({
  runSingleReviewerWithPrompt: runSingleReviewerWithPromptMock,
}));

const domains: ThermoDomain[] = [
  'architecture',
  'security',
  'correctness',
  'tests',
  'performance',
  'docs',
  'final_synthesis',
  'synthesis_audit',
];

let tmp: string;
let events: RunnerEvent[];

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), `chorus-thermo-${randomUUID()}-`));
  events = [];
  runSingleReviewerWithPromptMock.mockReset();
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('runThermoCodeReview', () => {
  it('runs phase 1, phase 2, and final synthesis, then writes triage answer and completed chat_done', async () => {
    runSingleReviewerWithPromptMock.mockImplementation(async (args: ReviewerCallArgs) => {
      if (args.phase.id.startsWith('thermo-phase-1-')) {
        return writeParticipantAnswer(args, `## Findings\n\n### [medium] ${args.phase.id}\n- Evidence: concrete\n\n## DONE`, false);
      }
      if (args.phase.id.startsWith('thermo-phase-2-')) {
        return writeParticipantAnswer(args, `valid: ${args.phase.id}\n\n## DONE`, true);
      }
      return writeParticipantAnswer(args, finalReport({
        validBlocking: '- None.',
        validNonBlocking: '- Missing regression assertion.',
      }), false);
    });

    const result = await runThermoCodeReview(baseArgs(planWith({
      architecture: { primary: voice('arch', 'openai', 'gpt-5.5', 'A_PLUS'), validator: voice('arch-v', 'opencode', 'opencode-go/kimi-k2.6', 'A_MINUS') },
      security: { primary: voice('sec', 'opencode', 'opencode-go/deepseek-v4-pro', 'A'), validator: voice('sec-v', 'openai', 'gpt-5.5', 'A_PLUS') },
      final_synthesis: { primary: voice('final', 'openai', 'gpt-5.5', 'A_PLUS') },
    })));

    expect(result.completed).toBe(true);
    expect(result.verdict).toBe('approved');
    expect(result.phaseOneOutputs).toHaveLength(2);
    expect(result.validationNotes).toHaveLength(2);
    expect(fs.readFileSync(path.join(tmp, 'round-1', 'triage', 'answer.md'), 'utf-8'))
      .toContain('Missing regression assertion.');
    expect(fs.readFileSync(path.join(tmp, 'round-1', 'doer-artifact', 'answer.md'), 'utf-8'))
      .toMatch(/review artifact\n\n## DONE\n$/);
    expect(events).toContainEqual(expect.objectContaining({
      type: 'chat_done',
      payload: { status: 'completed', verdict: 'approved' },
    }));
    expect(runSingleReviewerWithPromptMock).toHaveBeenCalled();
    const participantCalls = runSingleReviewerWithPromptMock.mock.calls
      .map(([call]) => call as ReviewerCallArgs);
    expect(participantCalls.length).toBeGreaterThan(1);
    expect(participantCalls.every((call) => call.candidateIdx === 0)).toBe(true);
    expect(participantCalls.map((call) => call.reviewerIdx)).toEqual([0, 1, 4, 5, 6]);
  });

  it('dispatches phase 1 specialists concurrently', async () => {
    const order: string[] = [];
    let markSecurityStarted: () => void = () => {};
    const securityStarted = new Promise<void>((resolve) => {
      markSecurityStarted = resolve;
    });
    runSingleReviewerWithPromptMock.mockImplementation(async (args: ReviewerCallArgs) => {
      if (args.phase.id === 'thermo-phase-1-architecture') {
        order.push('architecture-start');
        await Promise.race([securityStarted, delay(50)]);
        order.push('architecture-end');
        return writeParticipantAnswer(args, 'architecture output\n\n## DONE', true);
      }
      if (args.phase.id === 'thermo-phase-1-security') {
        order.push('security-start');
        markSecurityStarted();
        return writeParticipantAnswer(args, 'security output\n\n## DONE', true);
      }
      if (args.phase.id === 'thermo-final-synthesis') {
        return writeParticipantAnswer(args, finalReport({ validBlocking: '- None.', validNonBlocking: '- None.' }), true);
      }
      return writeParticipantAnswer(args, 'phase output\n\n## DONE', true);
    });

    await runThermoCodeReview(baseArgs(planWith({
      architecture: { primary: voice('arch', 'openai', 'gpt-5.5', 'A_PLUS') },
      security: { primary: voice('sec', 'opencode', 'opencode-go/deepseek-v4-pro', 'A') },
      final_synthesis: { primary: voice('final', 'openai', 'gpt-5.5', 'A_PLUS') },
    })));

    expect(order.indexOf('security-start')).toBeLessThan(order.indexOf('architecture-end'));
  });

  it('records null phase 1 participants as skipped and still passes skipped metadata into synthesis', async () => {
    runSingleReviewerWithPromptMock.mockImplementation(async (args: ReviewerCallArgs) => {
      if (args.phase.id === 'thermo-phase-1-architecture') {
        const answerFile = participantAnswerFile(args);
        fs.mkdirSync(path.dirname(answerFile), { recursive: true });
        fs.writeFileSync(
          answerFile,
          '## REVIEWER FAILED\n\n**Kind:** quota_exhausted\n\nlimit hit\n',
        );
        return { result: null, answerFile };
      }
      if (args.phase.id === 'thermo-final-synthesis') {
        return writeParticipantAnswer(args, finalReport({ validBlocking: '- None.', validNonBlocking: '- None.' }), true);
      }
      return writeParticipantAnswer(args, 'phase output\n\n## DONE', true);
    });

    const result = await runThermoCodeReview(baseArgs(planWith({
      architecture: { primary: voice('arch', 'openai', 'gpt-5.5', 'A_PLUS') },
      final_synthesis: { primary: voice('final', 'openai', 'gpt-5.5', 'A_PLUS') },
    })));

    const synthesisCall = runSingleReviewerWithPromptMock.mock.calls
      .map(([call]) => call as ReviewerCallArgs)
      .find((call) => call.phase.id === 'thermo-final-synthesis');

    expect(result.completed).toBe(true);
    expect(result.verdict).toBe('request_changes');
    expect(result.skippedAgents).toMatchObject([{
      domain: 'architecture',
      role: 'primary',
      voiceId: 'arch',
      reason: 'quota_exhausted',
    }]);
    expect(synthesisCall?.askContent).toContain('architecture primary');
    expect(synthesisCall?.askContent).toContain('quota_exhausted');
  });

  it('promotes the validator as a phase 1 fallback and skips same-domain validation', async () => {
    runSingleReviewerWithPromptMock.mockImplementation(async (args: ReviewerCallArgs) => {
      if (args.phase.id === 'thermo-phase-1-architecture') {
        const answerFile = participantAnswerFile(args);
        writeAnswer(answerFile, '## REVIEWER FAILED\n\n**Kind:** quota_exhausted\n\nlimit hit\n');
        return { result: null, answerFile };
      }
      if (args.phase.id === 'thermo-phase-1-architecture-fallback') {
        return writeParticipantAnswer(args, 'fallback architecture output\n\n## DONE', true);
      }
      if (args.phase.id === 'thermo-final-synthesis') {
        expect(args.askContent).toContain('fallback architecture output');
        return writeParticipantAnswer(args, finalReport({ validBlocking: '- None.', validNonBlocking: '- None.' }), true);
      }
      return writeParticipantAnswer(args, 'phase output\n\n## DONE', true);
    });

    const result = await runThermoCodeReview(baseArgs(planWith({
      architecture: {
        primary: voice('arch', 'openai', 'gpt-5.5', 'A_PLUS'),
        validator: voice('arch-v', 'opencode', 'opencode-go/deepseek-v4-pro', 'A'),
      },
      final_synthesis: { primary: voice('final', 'openai', 'gpt-5.5', 'A_PLUS') },
    })));
    const phaseIds = runSingleReviewerWithPromptMock.mock.calls
      .map(([call]) => (call as ReviewerCallArgs).phase.id);

    expect(result.completed).toBe(true);
    expect(result.verdict).toBe('approved');
    expect(result.phaseOneOutputs).toHaveLength(1);
    expect(result.phaseOneOutputs[0].origin.voiceId).toBe('arch-v');
    expect(result.validationNotes).toHaveLength(0);
    expect(result.skippedAgents).toMatchObject([{
      domain: 'architecture',
      role: 'primary',
      voiceId: 'arch',
      reason: 'quota_exhausted',
    }]);
    expect(result.coverageGaps).toContainEqual({
      domain: 'architecture',
      severity: 'warning',
      message: 'The architecture validator was promoted to specialist fallback, so no independent architecture validation ran.',
    });
    expect(phaseIds).toContain('thermo-phase-1-architecture-fallback');
    expect(phaseIds).not.toContain('thermo-phase-2-architecture');
  });

  it('does not approve when critical coverage gaps remain even if synthesis reports no blockers', async () => {
    runSingleReviewerWithPromptMock.mockImplementation(async (args: ReviewerCallArgs) => {
      if (args.phase.id === 'thermo-final-synthesis') {
        return writeParticipantAnswer(args, finalReport({ validBlocking: '- None.', validNonBlocking: '- None.' }), true);
      }
      return writeParticipantAnswer(args, 'phase output\n\n## DONE', true);
    });

    const result = await runThermoCodeReview(baseArgs(planWith(
      {
        architecture: { primary: voice('arch', 'openai', 'gpt-5.5', 'A_PLUS') },
        final_synthesis: { primary: voice('final', 'openai', 'gpt-5.5', 'A_PLUS') },
      },
      [{ domain: 'security', severity: 'critical', message: 'No A-tier security reviewer is available.' }],
    )));

    expect(result.completed).toBe(true);
    expect(result.verdict).toBe('request_changes');
    const synthesisCall = runSingleReviewerWithPromptMock.mock.calls
      .map(([call]) => call as ReviewerCallArgs)
      .find((call) => call.phase.id === 'thermo-final-synthesis');
    expect(synthesisCall?.askContent).toContain('critical: security');
  });

  it('turns a runtime critical specialist failure into a blocking coverage gap', async () => {
    runSingleReviewerWithPromptMock.mockImplementation(async (args: ReviewerCallArgs) => {
      if (args.phase.id === 'thermo-phase-1-security') {
        const answerFile = participantAnswerFile(args);
        writeAnswer(answerFile, '## REVIEWER FAILED\n\n**Kind:** quota_exhausted\n\nlimit hit\n');
        return { result: null, answerFile };
      }
      if (args.phase.id === 'thermo-final-synthesis') {
        return writeParticipantAnswer(args, finalReport({ validBlocking: '- None.', validNonBlocking: '- None.' }), true);
      }
      return writeParticipantAnswer(args, 'phase output\n\n## DONE', true);
    });

    const result = await runThermoCodeReview(baseArgs(planWith({
      architecture: { primary: voice('arch', 'openai', 'gpt-5.5', 'A_PLUS') },
      security: { primary: voice('sec', 'opencode', 'opencode-go/deepseek-v4-pro', 'A') },
      final_synthesis: { primary: voice('final', 'openai', 'gpt-5.5', 'A_PLUS') },
    })));
    const synthesisCall = runSingleReviewerWithPromptMock.mock.calls
      .map(([call]) => call as ReviewerCallArgs)
      .find((call) => call.phase.id === 'thermo-final-synthesis');

    expect(result.completed).toBe(true);
    expect(result.verdict).toBe('request_changes');
    expect(result.coverageGaps).toContainEqual({
      domain: 'security',
      severity: 'critical',
      message: 'No completed security specialist review was produced at runtime.',
    });
    expect(synthesisCall?.askContent).toContain('critical: security');
    expect(synthesisCall?.askContent).toContain('No completed security specialist review');
  });

  it('stops before synthesis and emits cancelled when aborted after specialist phase', async () => {
    const controller = new AbortController();
    runSingleReviewerWithPromptMock.mockImplementation(async (args: ReviewerCallArgs) => {
      const response = writeParticipantAnswer(args, 'phase output\n\n## DONE', true);
      if (args.phase.id === 'thermo-phase-1-architecture') {
        controller.abort();
      }
      return response;
    });

    const result = await runThermoCodeReview(baseArgs(
      planWith({
        architecture: { primary: voice('arch', 'openai', 'gpt-5.5', 'A_PLUS') },
        final_synthesis: { primary: voice('final', 'openai', 'gpt-5.5', 'A_PLUS') },
      }),
      controller,
    ));

    expect(result.completed).toBe(false);
    expect(result.verdict).toBe('failed');
    expect(runSingleReviewerWithPromptMock.mock.calls
      .map(([call]) => (call as ReviewerCallArgs).phase.id))
      .not.toContain('thermo-final-synthesis');
    expect(events).toContainEqual(expect.objectContaining({
      type: 'chat_done',
      payload: { status: 'cancelled', verdict: 'failed' },
    }));
  });

  it('fails the chat and writes a failure summary when final synthesis returns null', async () => {
    runSingleReviewerWithPromptMock.mockImplementation(async (args: ReviewerCallArgs) => {
      if (args.phase.id === 'thermo-final-synthesis') {
        return { result: null, answerFile: participantAnswerFile(args) };
      }
      return writeParticipantAnswer(args, 'phase output\n\n## DONE', true);
    });

    const result = await runThermoCodeReview(baseArgs(planWith({
      architecture: { primary: voice('arch', 'openai', 'gpt-5.5', 'A_PLUS') },
      final_synthesis: { primary: voice('final', 'openai', 'gpt-5.5', 'A_PLUS') },
    })));

    const triageAnswer = fs.readFileSync(path.join(tmp, 'round-1', 'triage', 'answer.md'), 'utf-8');
    expect(result.completed).toBe(false);
    expect(result.verdict).toBe('failed');
    expect(triageAnswer).toContain('## REVIEWER FAILED');
    expect(triageAnswer).toContain('thermo_final_synthesis_failed');
    expect(events).toContainEqual(expect.objectContaining({
      type: 'phase_failed',
      payload: expect.objectContaining({ reason: 'thermo_final_synthesis_failed' }),
    }));
    expect(events).toContainEqual(expect.objectContaining({
      type: 'chat_done',
      payload: { status: 'failed', verdict: 'failed' },
    }));
  });

  it('runs one revision synthesis pass after REQUIRED_REVISIONS even without a final synthesis validator', async () => {
    runSingleReviewerWithPromptMock.mockImplementation(async (args: ReviewerCallArgs) => {
      if (args.phase.id === 'thermo-final-synthesis') {
        return writeParticipantAnswer(args, finalReport({
          validBlocking: '- Unsupported blocker from draft.',
          validNonBlocking: '- None.',
        }), false);
      }
      if (args.phase.id === 'thermo-synthesis-audit') {
        return writeParticipantAnswer(args, 'REQUIRED_REVISIONS\n\nDowngrade unsupported blocker.\n\n## DONE', false);
      }
      if (args.phase.id === 'thermo-final-synthesis-revision') {
        expect(args.askContent).toContain('Synthesis audit required revisions');
        expect(args.askContent).toContain('Downgrade unsupported blocker.');
        return writeParticipantAnswer(args, finalReport({
          validBlocking: '- None.',
          validNonBlocking: '- None.',
        }), true);
      }
      return writeParticipantAnswer(args, 'phase output\n\n## DONE', true);
    });

    const finalPrimary = voice('final', 'openai', 'gpt-5.5', 'A_PLUS');
    const result = await runThermoCodeReview(baseArgs(planWith({
      architecture: { primary: voice('arch', 'openai', 'gpt-5.5', 'A_PLUS') },
      final_synthesis: { primary: finalPrimary },
      synthesis_audit: { primary: voice('audit', 'opencode', 'opencode-go/deepseek-v4-pro', 'A') },
    })));

    const synthesisCalls = runSingleReviewerWithPromptMock.mock.calls
      .map(([call]) => call as ReviewerCallArgs)
      .filter((call) => call.phase.id.startsWith('thermo-final-synthesis'));

    expect(result.completed).toBe(true);
    expect(result.verdict).toBe('approved');
    expect(synthesisCalls.map((call) => call.phase.id)).toEqual([
      'thermo-final-synthesis',
      'thermo-final-synthesis-revision',
    ]);
    expect(synthesisCalls[1].phase.reviewer.candidates[0].models[0]).toBe(finalPrimary.voice.model_id);
    expect(result.validationNotes.at(-1)?.output).toContain('REQUIRED_REVISIONS');
    expect(fs.readFileSync(path.join(tmp, 'round-1', 'triage', 'answer.md'), 'utf-8'))
      .toContain('**Valid Blocking**\n- None.');
    expect(fs.readFileSync(path.join(tmp, 'round-1', 'triage', 'draft-answer.md'), 'utf-8'))
      .toContain('Unsupported blocker from draft.');
    expect(fs.readFileSync(path.join(tmp, 'round-1', 'triage', 'draft-ask.md'), 'utf-8'))
      .toContain('# Thermo Final Synthesis');
  });
});

interface ReviewerCallArgs {
  chatDir: string;
  phase: {
    id: string;
    reviewer: {
      candidates: Array<{
        models: string[];
      }>;
    };
  };
  round: number;
  candidateIdx?: number;
  reviewerIdx: number;
  askContent: string;
}

function baseArgs(
  assignments: ThermoAssignmentPlan,
  controller = new AbortController(),
): Parameters<typeof runThermoCodeReview>[0] {
  return {
    chatDir: tmp,
    chatId: 'thermo-test',
    artifact: 'review artifact',
    work: 'review this diff',
    filesBlock: '',
    assignments,
    tmuxMgr: {} as Parameters<typeof runThermoCodeReview>[0]['tmuxMgr'],
    errorDetector: {} as Parameters<typeof runThermoCodeReview>[0]['errorDetector'],
    onEvent: (event) => events.push(event),
    abortSignal: controller.signal,
  };
}

function planWith(
  overrides: Partial<Record<ThermoDomain, { primary?: RankedReviewVoice; validator?: RankedReviewVoice }>>,
  coverageGaps: ThermoCoverageGap[] = [],
): ThermoAssignmentPlan {
  return {
    assignments: Object.fromEntries(domains.map((domain) => [
      domain,
      { domain, ...overrides[domain] },
    ])) as ThermoAssignmentPlan['assignments'],
    coverageGaps,
    skippedVoiceIds: [],
  };
}

function voice(
  id: string,
  lineage: string,
  modelId: string,
  tier: ReviewModelTier,
): RankedReviewVoice {
  return {
    voice: {
      id,
      provider: lineage,
      model_id: modelId,
      lineage,
      vendor_family: lineage,
      enabled: true,
    },
    tier,
    score: 100,
    reasons: [],
  };
}

function writeAnswer(answerFile: string, body: string): void {
  fs.mkdirSync(path.dirname(answerFile), { recursive: true });
  fs.writeFileSync(answerFile, body);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function participantAnswerFile(args: ReviewerCallArgs): string {
  return path.join(args.chatDir, `round-${args.round}`, `reviewer-test-${args.reviewerIdx}`, 'answer.md');
}

function writeParticipantAnswer(
  args: ReviewerCallArgs,
  body: string,
  result: boolean,
): { result: boolean; answerFile: string } {
  const answerFile = participantAnswerFile(args);
  writeAnswer(answerFile, body);
  return { result, answerFile };
}

function finalReport(input: { validBlocking: string; validNonBlocking: string }): string {
  return [
    '**Valid Blocking**',
    input.validBlocking,
    '**Valid Non-Blocking**',
    input.validNonBlocking,
    '**Mostly Valid**',
    '- None.',
    '**Needs Owner Decision**',
    '- None.',
    '**Noise**',
    '- None.',
    '**Coverage Gaps**',
    '- None.',
    '**Fix Plan**',
    '- None.',
    '**Validation**',
    '- Complete.',
    '',
    '## DONE',
  ].join('\n');
}
