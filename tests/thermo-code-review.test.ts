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
  'plan_completeness',
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

    const result = await runThermoCodeReview(baseArgs(completePlanWith({
      architecture: { primary: voice('arch', 'openai', 'gpt-5.5', 'A_PLUS'), validator: voice('arch-v', 'opencode', 'opencode-go/kimi-k2.6', 'A_MINUS') },
      security: { primary: voice('sec', 'opencode', 'opencode-go/deepseek-v4-pro', 'A'), validator: voice('sec-v', 'openai', 'gpt-5.5', 'A_PLUS') },
      final_synthesis: { primary: voice('final', 'openai', 'gpt-5.5', 'A_PLUS') },
    })));

    expect(result.completed).toBe(true);
    expect(result.verdict).toBe('approved');
    expect(result.phaseOneOutputs).toHaveLength(7);
    expect(result.validationNotes).toHaveLength(7);
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
    expect(participantCalls.map((call) => call.reviewerIdx)).toEqual([
      0, 1, 2, 3, 4, 5, 6,
      14, 15, 16, 17, 18, 19, 20,
      21,
    ]);
  });

  it('passes a matched plan contract through to final synthesis prompts', async () => {
    runSingleReviewerWithPromptMock.mockImplementation(async (args: ReviewerCallArgs) => {
      if (args.phase.id === 'thermo-final-synthesis') {
        expect(args.askContent).toContain('docs/superpowers/plans/2026-05-24-example.md');
        expect(args.askContent).toContain('Verify the contract');
        return writeParticipantAnswer(args, conciseReport('safe_to_merge'), true);
      }
      return writeParticipantAnswer(args, 'phase output\n\n## DONE', true);
    });

    const result = await runThermoCodeReview(baseArgs(
      completePlanWith({
        final_synthesis: { primary: voice('final', 'openai', 'gpt-5.5', 'A_PLUS') },
      }),
      new AbortController(),
      {
        status: 'matched',
        source: 'review_scope',
        path: 'docs/superpowers/plans/2026-05-24-example.md',
        content: '# Example Plan\n\n**Goal:** Verify the contract.',
      },
    ));

    expect(result.completed).toBe(true);
    expect(result.verdict).toBe('approved');
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
      if (args.phase.id.startsWith('thermo-phase-1-security')) {
        order.push('security-start');
        markSecurityStarted();
        return writeParticipantAnswer(args, 'security output\n\n## DONE', true);
      }
      if (args.phase.id === 'thermo-final-synthesis') {
        return writeParticipantAnswer(args, finalReport({ validBlocking: '- None.', validNonBlocking: '- None.' }), true);
      }
      return writeParticipantAnswer(args, 'phase output\n\n## DONE', true);
    });

    await runThermoCodeReview(baseArgs(completePlanWith({
      architecture: { primary: voice('arch', 'openai', 'gpt-5.5', 'A_PLUS') },
      security: { primary: voice('sec', 'opencode', 'opencode-go/deepseek-v4-pro', 'A') },
      final_synthesis: { primary: voice('final', 'openai', 'gpt-5.5', 'A_PLUS') },
    })));

    expect(order.indexOf('security-start')).toBeLessThan(order.indexOf('architecture-end'));
  });

  it('starts each domain validator as soon as that domain primary finishes', async () => {
    const order: string[] = [];
    let markValidatorStarted: () => void = () => {};
    const validatorStarted = new Promise<void>((resolve) => {
      markValidatorStarted = resolve;
    });

    runSingleReviewerWithPromptMock.mockImplementation(async (args: ReviewerCallArgs) => {
      if (args.phase.id === 'thermo-phase-1-architecture') {
        order.push('architecture-primary-start');
        return writeParticipantAnswer(args, 'architecture output\n\n## DONE', true);
      }
      if (args.phase.id === 'thermo-phase-2-architecture') {
        order.push('architecture-validator-start');
        markValidatorStarted();
        return writeParticipantAnswer(args, 'architecture validation\n\n## DONE', true);
      }
      if (args.phase.id.startsWith('thermo-phase-1-security')) {
        order.push('security-primary-start');
        await Promise.race([validatorStarted, delay(100)]);
        order.push('security-primary-end');
        return writeParticipantAnswer(args, 'security output\n\n## DONE', true);
      }
      if (args.phase.id === 'thermo-final-synthesis') {
        return writeParticipantAnswer(args, finalReport({ validBlocking: '- None.', validNonBlocking: '- None.' }), true);
      }
      return writeParticipantAnswer(args, 'phase output\n\n## DONE', true);
    });

    await runThermoCodeReview(baseArgs(completePlanWith({
      architecture: {
        primary: voice('arch', 'openai', 'gpt-5.5', 'A_PLUS'),
        validator: voice('arch-v', 'opencode', 'opencode-go/kimi-k2.6', 'A_MINUS'),
      },
      security: { primary: voice('sec', 'opencode', 'opencode-go/deepseek-v4-pro', 'A') },
      final_synthesis: { primary: voice('final', 'openai', 'gpt-5.5', 'A_PLUS') },
    })));

    expect(order.indexOf('architecture-validator-start'))
      .toBeLessThan(order.indexOf('security-primary-end'));
  });

  it('blocks synthesis when a domain primary does not complete', async () => {
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

    expect(result.completed).toBe(false);
    expect(result.verdict).toBe('failed');
    expect(result.skippedAgents).toMatchObject([{
      domain: 'architecture',
      role: 'primary',
      voiceId: 'arch',
      reason: 'quota_exhausted',
    }]);
    expect(synthesisCall).toBeUndefined();
    expect(result.answerFile ? fs.readFileSync(result.answerFile, 'utf-8') : '')
      .toContain('thermo_domain_reviews_incomplete');
  });

  it('skips validation after a validator is promoted as primary fallback', async () => {
    runSingleReviewerWithPromptMock.mockImplementation(async (args: ReviewerCallArgs) => {
      if (args.phase.id === 'thermo-phase-1-architecture') {
        const answerFile = participantAnswerFile(args);
        writeAnswer(answerFile, '## REVIEWER FAILED\n\n**Kind:** quota_exhausted\n\nlimit hit\n');
        return { result: null, answerFile };
      }
      if (args.phase.id === 'thermo-phase-1-architecture-fallback') {
        return writeParticipantAnswer(args, 'fallback architecture output\n\n## DONE', true);
      }
      if (args.phase.id === 'thermo-phase-2-architecture') {
        throw new Error('validation should not run after validator fallback promotion');
      }
      if (args.phase.id === 'thermo-final-synthesis') {
        expect(args.askContent).toContain('fallback architecture output');
        expect(args.askContent).toContain('validator was promoted to specialist fallback');
        return writeParticipantAnswer(args, finalReport({ validBlocking: '- None.', validNonBlocking: '- None.' }), true);
      }
      return writeParticipantAnswer(args, 'phase output\n\n## DONE', true);
    });

    const result = await runThermoCodeReview(baseArgs(completePlanWith({
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
    expect(result.phaseOneOutputs.some((output) => (
      output.origin.domain === 'architecture' &&
      output.origin.voiceId === 'arch-v' &&
      output.output.includes('fallback architecture output')
    ))).toBe(true);
    expect(result.validationNotes.some((note) => note.validator.domain === 'architecture')).toBe(false);
    expect(result.coverageGaps).toContainEqual({
      domain: 'architecture',
      severity: 'warning',
      message: 'The architecture validator was promoted to specialist fallback, so no independent validation ran.',
    });
    expect(result.skippedAgents).toMatchObject([{
      domain: 'architecture',
      role: 'primary',
      voiceId: 'arch',
      reason: 'quota_exhausted',
    }]);
    expect(phaseIds).toContain('thermo-phase-1-architecture-fallback');
    expect(phaseIds).not.toContain('thermo-phase-2-architecture');
    expect(phaseIds).toContain('thermo-final-synthesis');
  });

  it('does not approve when critical coverage gaps remain even if synthesis reports no blockers', async () => {
    runSingleReviewerWithPromptMock.mockImplementation(async (args: ReviewerCallArgs) => {
      if (args.phase.id === 'thermo-final-synthesis') {
        return writeParticipantAnswer(args, finalReport({ validBlocking: '- None.', validNonBlocking: '- None.' }), true);
      }
      return writeParticipantAnswer(args, 'phase output\n\n## DONE', true);
    });

    const result = await runThermoCodeReview(baseArgs(completePlanWith(
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

  it('continues to synthesis when only warning-level readiness gaps remain', async () => {
    runSingleReviewerWithPromptMock.mockImplementation(async (args: ReviewerCallArgs) => {
      if (args.phase.id === 'thermo-final-synthesis') {
        return writeParticipantAnswer(args, conciseReport('safe_to_merge'), true);
      }
      return writeParticipantAnswer(args, 'phase output\n\n## DONE', true);
    });

    const result = await runThermoCodeReview(baseArgs(completePlanWith({
      docs: {
        primary: voice('docs', 'opencode', 'opencode-go/deepseek-v4-flash', 'B_MINUS'),
        validator: undefined,
      },
      final_synthesis: { primary: voice('final', 'openai', 'gpt-5.5', 'A_PLUS') },
    })));
    const phaseIds = runSingleReviewerWithPromptMock.mock.calls
      .map(([call]) => (call as ReviewerCallArgs).phase.id);

    expect(result.completed).toBe(true);
    expect(result.verdict).toBe('approved');
    expect(phaseIds).toContain('thermo-final-synthesis');
    expect(result.coverageGaps).toContainEqual({
      domain: 'docs',
      severity: 'warning',
      message: 'No docs review reviewer was assigned.',
    });
  });

  it('blocks synthesis when an assigned validator does not complete', async () => {
    runSingleReviewerWithPromptMock.mockImplementation(async (args: ReviewerCallArgs) => {
      if (args.phase.id === 'thermo-phase-2-correctness') {
        return { result: null, answerFile: participantAnswerFile(args) };
      }
      if (args.phase.id === 'thermo-final-synthesis') {
        return writeParticipantAnswer(args, conciseReport('safe_to_merge'), true);
      }
      return writeParticipantAnswer(args, 'phase output\n\n## DONE', true);
    });

    const result = await runThermoCodeReview(baseArgs(completePlanWith({
      final_synthesis: { primary: voice('final', 'openai', 'gpt-5.5', 'A_PLUS') },
    })));
    const phaseIds = runSingleReviewerWithPromptMock.mock.calls
      .map(([call]) => (call as ReviewerCallArgs).phase.id);

    expect(result.completed).toBe(false);
    expect(result.verdict).toBe('failed');
    expect(phaseIds).toContain('thermo-phase-2-correctness');
    expect(phaseIds).not.toContain('thermo-final-synthesis');
    expect(result.coverageGaps).toContainEqual({
      domain: 'correctness',
      severity: 'critical',
      message: 'No completed correctness validation note was produced at runtime.',
    });
    expect(result.answerFile ? fs.readFileSync(result.answerFile, 'utf-8') : '')
      .toContain('thermo_domain_reviews_incomplete');
  });

  it.each([
    'changes_requested',
    'owner_decision_needed',
    'human_review_required',
    'no_verdict',
  ] as const)('maps concise %s verdicts to request_changes', async (verdict) => {
    runSingleReviewerWithPromptMock.mockImplementation(async (args: ReviewerCallArgs) => {
      if (args.phase.id === 'thermo-final-synthesis') {
        return writeParticipantAnswer(args, conciseReport(verdict), true);
      }
      return writeParticipantAnswer(args, 'phase output\n\n## DONE', true);
    });

    const result = await runThermoCodeReview(baseArgs(completePlanWith({
      final_synthesis: { primary: voice('final', 'openai', 'gpt-5.5', 'A_PLUS') },
    })));

    expect(result.completed).toBe(true);
    expect(result.verdict).toBe('request_changes');
  });

  it.each([
    ['bold verdict key', '**Verdict:** safe_to_merge'],
    ['heading verdict key', '### Verdict: safe_to_merge'],
    ['trailing punctuation', 'Verdict: safe_to_merge.'],
    ['markdown-wrapped value', 'Verdict: `safe_to_merge`'],
  ])('maps formatted safe_to_merge verdict lines to approved: %s', async (_label, verdictLine) => {
    runSingleReviewerWithPromptMock.mockImplementation(async (args: ReviewerCallArgs) => {
      if (args.phase.id === 'thermo-final-synthesis') {
        return writeParticipantAnswer(args, conciseReportWithVerdictLine(verdictLine), true);
      }
      return writeParticipantAnswer(args, 'phase output\n\n## DONE', true);
    });

    const result = await runThermoCodeReview(baseArgs(completePlanWith({
      final_synthesis: { primary: voice('final', 'openai', 'gpt-5.5', 'A_PLUS') },
    })));

    expect(result.completed).toBe(true);
    expect(result.verdict).toBe('approved');
  });

  it('maps compound concise verdict lines to request_changes', async () => {
    runSingleReviewerWithPromptMock.mockImplementation(async (args: ReviewerCallArgs) => {
      if (args.phase.id === 'thermo-final-synthesis') {
        return writeParticipantAnswer(args, [
          'Verdict: safe_to_merge | changes_requested | owner_decision_needed | human_review_required | no_verdict',
          '',
          '## DONE',
        ].join('\n'), true);
      }
      return writeParticipantAnswer(args, 'phase output\n\n## DONE', true);
    });

    const result = await runThermoCodeReview(baseArgs(completePlanWith({
      final_synthesis: { primary: voice('final', 'openai', 'gpt-5.5', 'A_PLUS') },
    })));

    expect(result.completed).toBe(true);
    expect(result.verdict).toBe('request_changes');
  });

  it.each([
    'Verdict: not safe_to_merge',
    'Verdict: safe_to_merge requested',
    'Verdict: this is safe_to_merge',
    'Verdict: safe_to_merge | changes_requested | owner_decision_needed | human_review_required | no_verdict',
  ])('maps unsafe or prose verdict lines to request_changes: %s', async (verdictLine) => {
    runSingleReviewerWithPromptMock.mockImplementation(async (args: ReviewerCallArgs) => {
      if (args.phase.id === 'thermo-final-synthesis') {
        return writeParticipantAnswer(args, conciseReportWithVerdictLine(verdictLine), true);
      }
      return writeParticipantAnswer(args, 'phase output\n\n## DONE', true);
    });

    const result = await runThermoCodeReview(baseArgs(completePlanWith({
      final_synthesis: { primary: voice('final', 'openai', 'gpt-5.5', 'A_PLUS') },
    })));

    expect(result.completed).toBe(true);
    expect(result.verdict).toBe('request_changes');
  });

  it('treats concise-shaped final reports without explicit verdicts as request_changes', async () => {
    runSingleReviewerWithPromptMock.mockImplementation(async (args: ReviewerCallArgs) => {
      if (args.phase.id === 'thermo-final-synthesis') {
        return writeParticipantAnswer(args, conciseReport('safe_to_merge', { includeVerdict: false }), true);
      }
      return writeParticipantAnswer(args, 'phase output\n\n## DONE', true);
    });

    const result = await runThermoCodeReview(baseArgs(completePlanWith({
      final_synthesis: { primary: voice('final', 'openai', 'gpt-5.5', 'A_PLUS') },
    })));

    expect(result.completed).toBe(true);
    expect(result.verdict).toBe('request_changes');
  });

  it('maps legacy final reports with valid blocking findings to request_changes', async () => {
    runSingleReviewerWithPromptMock.mockImplementation(async (args: ReviewerCallArgs) => {
      if (args.phase.id === 'thermo-final-synthesis') {
        return writeParticipantAnswer(args, finalReport({
          validBlocking: '- real blocker.',
          validNonBlocking: '- None.',
        }), true);
      }
      return writeParticipantAnswer(args, 'phase output\n\n## DONE', true);
    });

    const result = await runThermoCodeReview(baseArgs(completePlanWith({
      final_synthesis: { primary: voice('final', 'openai', 'gpt-5.5', 'A_PLUS') },
    })));

    expect(result.completed).toBe(true);
    expect(result.verdict).toBe('request_changes');
  });

  it('turns a runtime critical specialist failure into a blocking coverage gap', async () => {
    runSingleReviewerWithPromptMock.mockImplementation(async (args: ReviewerCallArgs) => {
      if (args.phase.id.startsWith('thermo-phase-1-security')) {
        const answerFile = participantAnswerFile(args);
        writeAnswer(answerFile, '## REVIEWER FAILED\n\n**Kind:** quota_exhausted\n\nlimit hit\n');
        return { result: null, answerFile };
      }
      if (args.phase.id === 'thermo-final-synthesis') {
        return writeParticipantAnswer(args, finalReport({ validBlocking: '- None.', validNonBlocking: '- None.' }), true);
      }
      return writeParticipantAnswer(args, 'phase output\n\n## DONE', true);
    });

    const result = await runThermoCodeReview(baseArgs(completePlanWith({
      architecture: { primary: voice('arch', 'openai', 'gpt-5.5', 'A_PLUS') },
      security: { primary: voice('sec', 'opencode', 'opencode-go/deepseek-v4-pro', 'A') },
      final_synthesis: { primary: voice('final', 'openai', 'gpt-5.5', 'A_PLUS') },
    })));
    const synthesisCall = runSingleReviewerWithPromptMock.mock.calls
      .map(([call]) => call as ReviewerCallArgs)
      .find((call) => call.phase.id === 'thermo-final-synthesis');

    expect(result.completed).toBe(false);
    expect(result.verdict).toBe('failed');
    expect(result.coverageGaps).toContainEqual({
      domain: 'security',
      severity: 'critical',
      message: 'No completed security specialist review was produced at runtime.',
    });
    expect(synthesisCall).toBeUndefined();
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

    const result = await runThermoCodeReview(baseArgs(completePlanWith({
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
        return writeParticipantAnswer(args, conciseReport('safe_to_merge'), true);
      }
      return writeParticipantAnswer(args, 'phase output\n\n## DONE', true);
    });

    const finalPrimary = voice('final', 'openai', 'gpt-5.5', 'A_PLUS');
    const result = await runThermoCodeReview(baseArgs(completePlanWith({
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
      .toContain('Verdict: safe_to_merge');
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
  planContract?: Parameters<typeof runThermoCodeReview>[0]['planContract'],
): Parameters<typeof runThermoCodeReview>[0] {
  return {
    chatDir: tmp,
    chatId: 'thermo-test',
    artifact: 'review artifact',
    work: 'review this diff',
    filesBlock: '',
    planContract,
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

function completePlanWith(
  overrides: Partial<Record<ThermoDomain, { primary?: RankedReviewVoice; validator?: RankedReviewVoice }>>,
  coverageGaps: ThermoCoverageGap[] = [],
): ThermoAssignmentPlan {
  const defaults: Partial<Record<ThermoDomain, { primary?: RankedReviewVoice; validator?: RankedReviewVoice }>> = {
    plan_completeness: {
      primary: voice('default-plan', 'openai', 'gpt-5.5', 'A_PLUS'),
      validator: voice('default-plan-v', 'opencode', 'opencode-go/deepseek-v4-pro', 'A'),
    },
    architecture: {
      primary: voice('default-arch', 'openai', 'gpt-5.5', 'A_PLUS'),
      validator: voice('default-arch-v', 'opencode', 'opencode-go/kimi-k2.6', 'A_MINUS'),
    },
    security: {
      primary: voice('default-sec', 'opencode', 'opencode-go/deepseek-v4-pro', 'A'),
      validator: voice('default-sec-v', 'openai', 'gpt-5.5', 'A_PLUS'),
    },
    correctness: {
      primary: voice('default-correct', 'opencode', 'opencode-go/kimi-k2.6', 'A_MINUS'),
      validator: voice('default-correct-v', 'opencode', 'opencode-go/qwen3.6-plus', 'B_PLUS'),
    },
    tests: {
      primary: voice('default-tests', 'opencode', 'opencode-go/qwen3.6-plus', 'B_PLUS'),
      validator: voice('default-tests-v', 'opencode', 'opencode-go/deepseek-v4-flash', 'B_MINUS'),
    },
    performance: {
      primary: voice('default-perf', 'opencode', 'opencode-go/glm-5.1', 'B_PLUS'),
      validator: voice('default-perf-v', 'opencode', 'opencode-go/deepseek-v4-pro', 'A'),
    },
    docs: {
      primary: voice('default-docs', 'opencode', 'opencode-go/deepseek-v4-flash', 'B_MINUS'),
      validator: voice('default-docs-v', 'google', 'gemini-3.5-flash', 'C'),
    },
    final_synthesis: {
      primary: voice('default-final', 'openai', 'gpt-5.5', 'A_PLUS'),
    },
  };
  const merged = Object.fromEntries(
    domains.map((domain) => [
      domain,
      {
        ...(defaults[domain] ?? {}),
        ...(overrides[domain] ?? {}),
      },
    ]),
  ) as Partial<Record<ThermoDomain, { primary?: RankedReviewVoice; validator?: RankedReviewVoice }>>;
  return planWith(merged, coverageGaps);
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

type ConciseVerdict =
  | 'safe_to_merge'
  | 'changes_requested'
  | 'owner_decision_needed'
  | 'human_review_required'
  | 'no_verdict';

function conciseReport(
  verdict: ConciseVerdict,
  options: { includeVerdict?: boolean } = {},
): string {
  const lines = [
    'Run Health: complete',
    'Plan: not checked',
    '',
    '## Domain Coverage',
    '- Plan Completeness: not checked',
    '- Correctness / Regression: clear',
    '- Security / Privacy: clear',
    '- Performance / Reliability: clear',
    '- Tests / Verification: clear',
    '- Maintainability / Architecture: clear',
    '- Docs / Operator Handoff: clear',
    '',
    '## Verification',
    '- Evidence observed: mocked test output',
    '- Missing verification affecting verdict: none',
    '',
    '## DONE',
  ];
  if (options.includeVerdict !== false) {
    lines.unshift(`Verdict: ${verdict}`);
  }
  return lines.join('\n');
}

function conciseReportWithVerdictLine(verdictLine: string): string {
  return conciseReport('safe_to_merge').replace(/^Verdict: safe_to_merge/m, verdictLine);
}
