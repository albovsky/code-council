import fs from 'fs';
import path from 'path';
import type {
  RankedReviewVoice,
} from '../../lib/review-model-tiering.js';
import type { CodeReviewPlanContract } from '../../lib/git-code-review-scope.js';
import type {
  ThermoAssignmentPlan,
  ThermoCoverageGap,
} from '../../lib/thermo-review-assignment.js';
import {
  THERMO_SPECIALIST_DOMAINS,
  isCriticalThermoSpecialistDomain,
  thermoDomainCheck,
  type ThermoDomain,
} from '../../lib/thermo-run-types.js';
import type { StandardPhase } from '../../lib/template-schema.js';
import type { ErrorDetector } from '../error-detector.js';
import type { TmuxManager } from '../tmux-types.js';
import {
  buildThermoAuditPrompt,
  buildThermoPhaseOnePrompt,
  buildThermoSynthesisPrompt,
  buildThermoValidationPrompt,
  type ThermoAssignmentMetadata,
  type ThermoReviewOutput,
  type ThermoValidationOutput,
} from './thermo-prompts.js';
import { runSingleReviewerWithPrompt } from './reviewer-driver.js';
import type { RunnerEvent } from './types.js';

const ROUND = 1;
const PHASE_IDX = 0;
type ReviewerLineage = NonNullable<StandardPhase['reviewer']>['candidates'][number]['lineage'];

export type ThermoReviewVerdict = 'approved' | 'request_changes' | 'failed';

export interface ThermoSkippedAgent {
  domain: ThermoDomain;
  role: 'primary' | 'validator' | 'synthesizer' | 'auditor';
  voiceId: string;
  provider: string;
  modelId: string;
  reason: string;
  answerFile?: string;
}

export interface ThermoReviewResult {
  completed: boolean;
  verdict: ThermoReviewVerdict;
  phaseOneOutputs: ThermoReviewOutput[];
  validationNotes: ThermoValidationOutput[];
  skippedAgents: ThermoSkippedAgent[];
  coverageGaps: ThermoCoverageGap[];
  answerFile?: string;
}

export async function runThermoCodeReview(args: {
  chatDir: string;
  chatId: string;
  artifact: string;
  work: string;
  filesBlock: string;
  planContract?: CodeReviewPlanContract;
  assignments: ThermoAssignmentPlan;
  tmuxMgr: TmuxManager;
  errorDetector: ErrorDetector;
  onEvent: (event: RunnerEvent) => void;
  abortSignal: AbortSignal;
}): Promise<ThermoReviewResult> {
  const roundDir = path.join(args.chatDir, `round-${ROUND}`);
  fs.mkdirSync(roundDir, { recursive: true });
  writeSyntheticArtifact(roundDir, args.artifact);
  writeThermoPlan(args.chatDir, args.assignments);

  if (args.abortSignal.aborted) {
    return cancelledResult(args);
  }

  const phaseOneOutputs: ThermoReviewOutput[] = [];
  const validationNotes: ThermoValidationOutput[] = [];
  const skippedAgents: ThermoSkippedAgent[] = [];
  const runtimeCoverageGaps = [...args.assignments.coverageGaps];
  const phaseOneJobs = THERMO_SPECIALIST_DOMAINS
    .map((domain) => {
      const ranked = args.assignments.assignments[domain]?.primary;
      if (!ranked) return null;
      const assignedValidatorRanked = args.assignments.assignments[domain]?.validator;
      const validatorRanked = assignedValidatorRanked?.voice.id === ranked.voice.id
        ? undefined
        : assignedValidatorRanked;
      return {
        domain,
        ranked,
        fallbackRanked: validatorRanked,
        validatorRanked,
      };
    })
    .filter((job): job is NonNullable<typeof job> => job !== null);
  const phaseOneFallbackSlots = phaseOneJobs.filter((job) => job.fallbackRanked).length;
  let nextFallbackIdx = phaseOneJobs.length;
  let nextValidatorIdx = phaseOneJobs.length + phaseOneFallbackSlots;
  const laneJobs = phaseOneJobs.map((job, idx) => {
    const fallbackIdx = job.fallbackRanked ? nextFallbackIdx++ : undefined;
    const validatorIdx = job.validatorRanked ? nextValidatorIdx++ : undefined;
    return {
      ...job,
      reviewerIdx: idx,
      fallbackReviewerIdx: fallbackIdx,
      validatorReviewerIdx: validatorIdx,
    };
  });
  const laneRuns = await Promise.all(laneJobs.map((job) => (
    runThermoDomainLane({
      chatDir: args.chatDir,
      chatId: args.chatId,
      roundDir,
      domain: job.domain,
      ranked: job.ranked,
      fallbackRanked: job.fallbackRanked,
      validatorRanked: job.validatorRanked,
      reviewerIdx: job.reviewerIdx,
      fallbackReviewerIdx: job.fallbackReviewerIdx,
      validatorReviewerIdx: job.validatorReviewerIdx,
      originalWork: args.work,
      filesBlock: args.filesBlock,
      artifact: args.artifact,
      planContract: args.planContract,
      tmuxMgr: args.tmuxMgr,
      errorDetector: args.errorDetector,
      abortSignal: args.abortSignal,
      onEvent: args.onEvent,
    })
  )));

  for (const run of laneRuns) {
    skippedAgents.push(...run.skippedAgents);
    runtimeCoverageGaps.push(...run.coverageGaps);
    if (run.phaseOneOutput) {
      phaseOneOutputs.push(run.phaseOneOutput);
    }
    if (run.validationOutput) {
      validationNotes.push(run.validationOutput);
    }
  }

  const readinessGaps = synthesisReadinessGaps(args.assignments, laneRuns, args.planContract);
  if (readinessGaps.length > 0) {
    runtimeCoverageGaps.push(...readinessGaps);
  }
  const blockingReadinessGaps = readinessGaps.filter((gap) => gap.severity === 'critical');
  if (blockingReadinessGaps.length > 0 && !args.abortSignal.aborted) {
    const answerFile = path.join(roundDir, 'triage', 'answer.md');
    writeFailureSummary(
      answerFile,
      'thermo_domain_reviews_incomplete',
      [
        'Final synthesis was not started because every Thermo domain must have a completed primary review and review note first.',
        '',
        ...blockingReadinessGaps.map((gap) => `- ${gap.domain}: ${gap.message}`),
      ].join('\n'),
    );
    args.onEvent({
      chatId: args.chatId,
      type: 'phase_failed',
      payload: {
        phaseId: 'thermo-final-synthesis',
        phaseIdx: PHASE_IDX,
        kind: 'review',
        round: ROUND,
        role: 'reviewer',
        agent: 'triage-0',
        reason: 'thermo_domain_reviews_incomplete',
      },
      ts: Date.now(),
    });
    args.onEvent({
      chatId: args.chatId,
      type: 'chat_done',
      payload: { status: 'failed', verdict: 'failed' },
      ts: Date.now(),
    });
    return {
      completed: false,
      verdict: 'failed',
      phaseOneOutputs,
      validationNotes,
      skippedAgents,
      coverageGaps: dedupeCoverageGaps(runtimeCoverageGaps),
      answerFile,
    };
  }

  if (args.abortSignal.aborted) {
    return cancelledResult(args, { phaseOneOutputs, validationNotes, skippedAgents });
  }

  const finalSynthesisReviewerIdx = nextValidatorIdx;
  const auditReviewerIdx = finalSynthesisReviewerIdx + 1;
  const revisionReviewerIdx = finalSynthesisReviewerIdx + 2;
  const synthesis = await runSynthesisPass({
    chatDir: args.chatDir,
    chatId: args.chatId,
    roundDir,
    artifact: args.artifact,
    planContract: args.planContract,
    assignments: args.assignments,
    coverageGaps: runtimeCoverageGaps,
    reviewerIdx: finalSynthesisReviewerIdx,
    phaseOneOutputs,
    validationNotes,
    skippedAgents,
    tmuxMgr: args.tmuxMgr,
    errorDetector: args.errorDetector,
    abortSignal: args.abortSignal,
    onEvent: args.onEvent,
  });

  if (args.abortSignal.aborted) {
    return cancelledResult(args, { phaseOneOutputs, validationNotes, skippedAgents, answerFile: synthesis.answerFile });
  }

  if (!synthesis.completed || !synthesis.body) {
    writeFailureSummary(synthesis.answerFile, 'thermo_final_synthesis_failed');
    args.onEvent({
      chatId: args.chatId,
      type: 'phase_failed',
      payload: {
        phaseId: 'thermo-final-synthesis',
        phaseIdx: PHASE_IDX,
        kind: 'review',
        round: ROUND,
        role: 'reviewer',
        agent: 'triage-0',
        reason: 'thermo_final_synthesis_failed',
      },
      ts: Date.now(),
    });
    args.onEvent({
      chatId: args.chatId,
      type: 'chat_done',
      payload: { status: 'failed', verdict: 'failed' },
      ts: Date.now(),
    });
    return {
      completed: false,
      verdict: 'failed',
      phaseOneOutputs,
      validationNotes,
      skippedAgents,
      coverageGaps: runtimeCoverageGaps,
      answerFile: synthesis.answerFile,
    };
  }

  let finalBody = synthesis.body;
  let finalAnswerFile = synthesis.answerFile;

  if (args.abortSignal.aborted) {
    return cancelledResult(args, { phaseOneOutputs, validationNotes, skippedAgents, answerFile: finalAnswerFile });
  }

  const auditRanked = args.assignments.assignments.synthesis_audit?.primary;
  if (auditRanked && !args.abortSignal.aborted) {
    const auditMetadata = metadataFor(auditRanked, 'synthesis_audit', 'auditor');
    const auditPrompt = buildThermoAuditPrompt({
      draftFinalReport: finalBody,
      artifact: args.artifact,
      planContract: args.planContract,
      phaseOneOutputs,
      validationNotes,
      coverageGaps: coverageGapNotes(runtimeCoverageGaps),
      skippedAgents: skippedAgentNotes(skippedAgents),
      quotaNotes: quotaNotes(skippedAgents),
    });
    const auditRun = await runThermoParticipant({
      chatDir: args.chatDir,
      chatId: args.chatId,
      roundDir,
      phaseId: 'thermo-synthesis-audit',
      title: 'Thermo synthesis audit',
      description: 'Audit the thermo final synthesis for unsupported claims.',
      ranked: auditRanked,
      metadata: auditMetadata,
      phaseGroup: 'audit',
      reviewerIdx: auditReviewerIdx,
      prompt: auditPrompt,
      tmuxMgr: args.tmuxMgr,
      errorDetector: args.errorDetector,
      abortSignal: args.abortSignal,
      onEvent: args.onEvent,
    });

    if (args.abortSignal.aborted) {
      return cancelledResult(args, { phaseOneOutputs, validationNotes, skippedAgents, answerFile: finalAnswerFile });
    }

    if (auditRun.result === null) {
      skippedAgents.push(skippedFrom(auditMetadata, auditRun.answerFile, failureReason(auditRun.answerFile)));
    } else {
      const auditOutput = readCompletedAnswer(auditRun.answerFile);
      if (auditOutput.includes('REQUIRED_REVISIONS')) {
        const revisionRanked =
          args.assignments.assignments.final_synthesis?.primary
          ?? args.assignments.assignments.final_synthesis?.validator;
        if (revisionRanked) {
          validationNotes.push({
            validator: auditMetadata,
            output: `Synthesis audit required revisions:\n\n${auditOutput}`,
          });
          const revision = await runSynthesisPass({
            chatDir: args.chatDir,
            chatId: args.chatId,
            roundDir,
            artifact: args.artifact,
            planContract: args.planContract,
            assignments: args.assignments,
            coverageGaps: runtimeCoverageGaps,
            reviewerIdx: revisionReviewerIdx,
            phaseOneOutputs,
            validationNotes,
            skippedAgents,
            tmuxMgr: args.tmuxMgr,
            errorDetector: args.errorDetector,
            abortSignal: args.abortSignal,
            onEvent: args.onEvent,
            ranked: revisionRanked,
            agentSuffix: 1,
          });
          if (args.abortSignal.aborted) {
            return cancelledResult(args, { phaseOneOutputs, validationNotes, skippedAgents, answerFile: revision.answerFile });
          }
          if (revision.completed && revision.body) {
            finalBody = revision.body;
            finalAnswerFile = revision.answerFile;
          } else {
            skippedAgents.push(skippedFrom(
              metadataFor(revisionRanked, 'final_synthesis', 'synthesizer'),
              revision.answerFile,
              'revision_synthesis_failed',
            ));
          }
        }
      }
    }
  }

  const verdict = finalVerdict(finalBody, {
    allSpecialistsFailed: phaseOneJobs.length > 0 && phaseOneOutputs.length === 0,
    hasCriticalCoverageGaps: runtimeCoverageGaps.some((gap) => gap.severity === 'critical'),
  });
  args.onEvent({
    chatId: args.chatId,
    type: 'chat_done',
    payload: { status: 'completed', verdict },
    ts: Date.now(),
  });

  return {
    completed: true,
    verdict,
    phaseOneOutputs,
    validationNotes,
    skippedAgents,
    coverageGaps: runtimeCoverageGaps,
    answerFile: finalAnswerFile,
  };
}

function writeSyntheticArtifact(roundDir: string, artifact: string): void {
  const syntheticDoerDir = path.join(roundDir, 'doer-artifact');
  fs.mkdirSync(syntheticDoerDir, { recursive: true });
  const trimmed = artifact.replace(/\s+$/, '');
  const artifactWithSentinel = /##\s*DONE$/i.test(trimmed)
    ? `${trimmed}\n`
    : `${trimmed}\n\n## DONE\n`;
  fs.writeFileSync(path.join(syntheticDoerDir, 'answer.md'), artifactWithSentinel);
}

function metadataFor(
  ranked: RankedReviewVoice,
  domain: ThermoDomain,
  role: ThermoAssignmentMetadata['role'],
): ThermoAssignmentMetadata {
  return {
    domain,
    role,
    voiceId: ranked.voice.id,
    provider: ranked.voice.provider,
    modelId: ranked.voice.model_id,
    tier: ranked.tier,
  };
}

function standardPhase(
  phaseId: string,
  title: string,
  description: string,
  ranked: RankedReviewVoice,
): StandardPhase {
  return {
    id: phaseId,
    kind: 'review',
    title,
    description,
    doer: { lineage: 'any' },
    reviewer: {
      require: 1,
      crossLineage: false,
      candidates: [{
        lineage: ranked.voice.lineage as ReviewerLineage,
        models: [ranked.voice.model_id],
      }],
    },
    inputs: { include: [], exclude: [] },
    iterate: {
      maxRounds: 1,
      onDisagreement: 'continue',
      shareSessionAcrossRounds: false,
      shareSessionAcrossPhases: false,
    },
  };
}

async function runThermoDomainLane(args: {
  chatDir: string;
  chatId: string;
  roundDir: string;
  domain: ThermoDomain;
  ranked: RankedReviewVoice;
  fallbackRanked?: RankedReviewVoice;
  validatorRanked?: RankedReviewVoice;
  reviewerIdx: number;
  fallbackReviewerIdx?: number;
  validatorReviewerIdx?: number;
  originalWork: string;
  filesBlock: string;
  artifact: string;
  planContract?: CodeReviewPlanContract;
  tmuxMgr: TmuxManager;
  errorDetector: ErrorDetector;
  abortSignal: AbortSignal;
  onEvent: (event: RunnerEvent) => void;
}): Promise<{
  domain: ThermoDomain;
  phaseOneOutput?: ThermoReviewOutput;
  validationOutput?: ThermoValidationOutput;
  validationSkippedForFallback?: boolean;
  skippedAgents: ThermoSkippedAgent[];
  coverageGaps: ThermoCoverageGap[];
}> {
  const skippedAgents: ThermoSkippedAgent[] = [];
  const coverageGaps: ThermoCoverageGap[] = [];
  const phaseOne = await runPhaseOneSpecialist({
    chatDir: args.chatDir,
    chatId: args.chatId,
    roundDir: args.roundDir,
    domain: args.domain,
    ranked: args.ranked,
    fallbackRanked: args.fallbackRanked,
    reviewerIdx: args.reviewerIdx,
    fallbackReviewerIdx: args.fallbackReviewerIdx,
    originalWork: args.originalWork,
    filesBlock: args.filesBlock,
    artifact: args.artifact,
    planContract: args.planContract,
    tmuxMgr: args.tmuxMgr,
    errorDetector: args.errorDetector,
    abortSignal: args.abortSignal,
    onEvent: args.onEvent,
  });

  skippedAgents.push(...phaseOne.skippedAgents);
  if (!phaseOne.output) {
    if (!args.abortSignal.aborted) {
      coverageGaps.push(runtimeCoverageGap(args.domain, 'specialist', args.planContract));
    }
    return { domain: args.domain, skippedAgents, coverageGaps };
  }

  if (args.abortSignal.aborted) {
    return {
      domain: args.domain,
      phaseOneOutput: phaseOne.output,
      skippedAgents,
      coverageGaps,
    };
  }

  if (phaseOne.usedFallback) {
    coverageGaps.push(promotedValidatorCoverageGap(args.domain));
    return {
      domain: args.domain,
      phaseOneOutput: phaseOne.output,
      validationSkippedForFallback: true,
      skippedAgents,
      coverageGaps,
    };
  }

  if (!args.validatorRanked || args.validatorReviewerIdx === undefined) {
    return {
      domain: args.domain,
      phaseOneOutput: phaseOne.output,
      skippedAgents,
      coverageGaps,
    };
  }

  const validation = await runValidationParticipant({
    chatDir: args.chatDir,
    chatId: args.chatId,
    roundDir: args.roundDir,
    domain: args.domain,
    ranked: args.validatorRanked,
    reviewerIdx: args.validatorReviewerIdx,
    artifact: args.artifact,
    planContract: args.planContract,
    phaseOneOutputs: [phaseOne.output],
    tmuxMgr: args.tmuxMgr,
    errorDetector: args.errorDetector,
    abortSignal: args.abortSignal,
    onEvent: args.onEvent,
  });

  skippedAgents.push(...validation.skippedAgents);
  if (validation.output) {
    return {
      domain: args.domain,
      phaseOneOutput: phaseOne.output,
      validationOutput: validation.output,
      skippedAgents,
      coverageGaps,
    };
  }

  if (!args.abortSignal.aborted) {
    coverageGaps.push(runtimeCoverageGap(args.domain, 'validator', args.planContract));
  }
  return {
    domain: args.domain,
    phaseOneOutput: phaseOne.output,
    skippedAgents,
    coverageGaps,
  };
}

async function runPhaseOneSpecialist(args: {
  chatDir: string;
  chatId: string;
  roundDir: string;
  domain: ThermoDomain;
  ranked: RankedReviewVoice;
  fallbackRanked?: RankedReviewVoice;
  reviewerIdx: number;
  fallbackReviewerIdx?: number;
  originalWork: string;
  filesBlock: string;
  artifact: string;
  planContract?: CodeReviewPlanContract;
  tmuxMgr: TmuxManager;
  errorDetector: ErrorDetector;
  abortSignal: AbortSignal;
  onEvent: (event: RunnerEvent) => void;
}): Promise<{
  domain: ThermoDomain;
  output?: ThermoReviewOutput;
  skippedAgents: ThermoSkippedAgent[];
  usedFallback: boolean;
}> {
  const skippedAgents: ThermoSkippedAgent[] = [];
  const primary = await runSpecialistAttempt({
    ...args,
    ranked: args.ranked,
    reviewerIdx: args.reviewerIdx,
  });
  if (primary.output || args.abortSignal.aborted) {
    return {
      domain: args.domain,
      ...(primary.output ? { output: primary.output } : {}),
      skippedAgents,
      usedFallback: false,
    };
  }

  skippedAgents.push(primary.skippedAgent);
  if (!args.fallbackRanked || args.fallbackReviewerIdx === undefined) {
    return { domain: args.domain, skippedAgents, usedFallback: false };
  }

  const fallback = await runSpecialistAttempt({
    ...args,
    ranked: args.fallbackRanked,
    reviewerIdx: args.fallbackReviewerIdx,
    phaseIdSuffix: 'fallback',
  });
  if (fallback.output || args.abortSignal.aborted) {
    return {
      domain: args.domain,
      ...(fallback.output ? { output: fallback.output } : {}),
      skippedAgents,
      usedFallback: Boolean(fallback.output),
    };
  }

  skippedAgents.push(fallback.skippedAgent);
  return { domain: args.domain, skippedAgents, usedFallback: false };
}

async function runSpecialistAttempt(args: {
  chatDir: string;
  chatId: string;
  roundDir: string;
  domain: ThermoDomain;
  ranked: RankedReviewVoice;
  reviewerIdx: number;
  phaseIdSuffix?: string;
  originalWork: string;
  filesBlock: string;
  artifact: string;
  planContract?: CodeReviewPlanContract;
  tmuxMgr: TmuxManager;
  errorDetector: ErrorDetector;
  abortSignal: AbortSignal;
  onEvent: (event: RunnerEvent) => void;
}): Promise<{ output?: ThermoReviewOutput; skippedAgent: ThermoSkippedAgent }> {
  const metadata = metadataFor(args.ranked, args.domain, 'primary');
  const prompt = buildThermoPhaseOnePrompt({
    domainScope: thermoDomainCheck(args.domain),
    originalWork: args.originalWork,
    filesBlock: args.filesBlock,
    artifact: args.artifact,
    planContract: args.planContract,
    assignment: metadata,
  });
  const phaseId = args.phaseIdSuffix
    ? `thermo-phase-1-${args.domain}-${args.phaseIdSuffix}`
    : `thermo-phase-1-${args.domain}`;
  const run = await runThermoParticipant({
    chatDir: args.chatDir,
    chatId: args.chatId,
    roundDir: args.roundDir,
    phaseId,
    title: `Thermo ${args.domain} specialist review`,
    description: `Review ${args.domain} concerns in the supplied code-review artifact.`,
    ranked: args.ranked,
    metadata,
    phaseGroup: 'specialist',
    reviewerIdx: args.reviewerIdx,
    prompt,
    tmuxMgr: args.tmuxMgr,
    errorDetector: args.errorDetector,
    abortSignal: args.abortSignal,
    onEvent: args.onEvent,
  });
  const output = readCompletedAnswer(run.answerFile);
  return {
    ...(output ? { output: { origin: metadata, output } } : {}),
    skippedAgent: skippedFrom(metadata, run.answerFile, failureReason(run.answerFile)),
  };
}

async function runValidationParticipant(args: {
  chatDir: string;
  chatId: string;
  roundDir: string;
  domain: ThermoDomain;
  ranked: RankedReviewVoice;
  reviewerIdx: number;
  artifact: string;
  planContract?: CodeReviewPlanContract;
  phaseOneOutputs: ThermoReviewOutput[];
  tmuxMgr: TmuxManager;
  errorDetector: ErrorDetector;
  abortSignal: AbortSignal;
  onEvent: (event: RunnerEvent) => void;
}): Promise<{
  domain: ThermoDomain;
  output?: ThermoValidationOutput;
  skippedAgents: ThermoSkippedAgent[];
}> {
  const metadata = metadataFor(args.ranked, args.domain, 'validator');
  const prompt = buildThermoValidationPrompt({
    domain: args.domain,
    domainScope: thermoDomainCheck(args.domain),
    originalArtifact: args.artifact,
    phaseOneOutputs: args.phaseOneOutputs,
    assignmentContext: assignmentContext(metadata),
    planContract: args.planContract,
  });

  const run = await runThermoParticipant({
    chatDir: args.chatDir,
    chatId: args.chatId,
    roundDir: args.roundDir,
    phaseId: `thermo-phase-2-${args.domain}`,
    title: `Thermo ${args.domain} validation`,
    description: `Validate phase 1 findings for ${args.domain}.`,
    ranked: args.ranked,
    metadata,
    phaseGroup: 'validation',
    reviewerIdx: args.reviewerIdx,
    prompt,
    tmuxMgr: args.tmuxMgr,
    errorDetector: args.errorDetector,
    abortSignal: args.abortSignal,
    onEvent: args.onEvent,
  });
  const output = readCompletedAnswer(run.answerFile);
  return {
    domain: args.domain,
    ...(output ? { output: { validator: metadata, output } } : {}),
    skippedAgents: output
      ? []
      : [skippedFrom(metadata, run.answerFile, failureReason(run.answerFile))],
  };
}

async function runThermoParticipant(args: {
  chatDir: string;
  chatId: string;
  roundDir: string;
  phaseId: string;
  title: string;
  description: string;
  ranked: RankedReviewVoice;
  metadata: ThermoAssignmentMetadata;
  phaseGroup: 'specialist' | 'validation' | 'synthesis' | 'audit';
  reviewerIdx: number;
  prompt: string;
  tmuxMgr: TmuxManager;
  errorDetector: ErrorDetector;
  abortSignal: AbortSignal;
  onEvent: (event: RunnerEvent) => void;
}): Promise<{ result: boolean | null; answerFile: string }> {
  const phase = standardPhase(args.phaseId, args.title, args.description, args.ranked);

  return runSingleReviewerWithPrompt({
    chatDir: args.chatDir,
    chatId: args.chatId,
    phase,
    phaseIdx: PHASE_IDX,
    round: ROUND,
    candidateIdx: 0,
    reviewerIdx: args.reviewerIdx,
    askContent: args.prompt,
    tmuxMgr: args.tmuxMgr,
    errorDetector: args.errorDetector,
    abortSignal: args.abortSignal,
    onEvent: args.onEvent,
    participantMetadata: {
      kind: 'thermo',
      phaseGroup: args.phaseGroup,
      phaseId: args.phaseId,
      phaseLabel: args.title,
      description: args.description,
      check: thermoDomainCheck(args.metadata.domain),
      domain: args.metadata.domain,
      role: args.metadata.role,
      voiceId: args.metadata.voiceId,
      provider: args.metadata.provider,
      modelId: args.metadata.modelId,
      tier: args.metadata.tier,
    },
  });
}

async function runSynthesisPass(args: {
  chatDir: string;
  chatId: string;
  roundDir: string;
  artifact: string;
  planContract?: CodeReviewPlanContract;
  assignments: ThermoAssignmentPlan;
  coverageGaps: ThermoCoverageGap[];
  reviewerIdx: number;
  phaseOneOutputs: ThermoReviewOutput[];
  validationNotes: ThermoValidationOutput[];
  skippedAgents: ThermoSkippedAgent[];
  tmuxMgr: TmuxManager;
  errorDetector: ErrorDetector;
  abortSignal: AbortSignal;
  onEvent: (event: RunnerEvent) => void;
  ranked?: RankedReviewVoice;
  agentSuffix?: number;
}): Promise<{ completed: boolean; body: string; answerFile: string }> {
  const ranked = args.ranked ?? args.assignments.assignments.final_synthesis?.primary;
  const triageDir = path.join(args.roundDir, 'triage');
  fs.mkdirSync(triageDir, { recursive: true });
  const answerFile = path.join(triageDir, 'answer.md');
  const askFile = path.join(triageDir, 'ask.md');

  if (!ranked) {
    return { completed: false, body: '', answerFile };
  }

  const prompt = buildThermoSynthesisPrompt({
    artifact: args.artifact,
    planContract: args.planContract,
    phaseOneOutputs: args.phaseOneOutputs,
    validationNotes: args.validationNotes,
    skippedAgents: skippedAgentNotes(args.skippedAgents),
    quotaNotes: quotaNotes(args.skippedAgents),
    coverageGaps: coverageGapNotes(args.coverageGaps),
    assignmentSummary: assignmentSummary(args.assignments),
  });

  const phase = standardPhase(
    args.agentSuffix === 1 ? 'thermo-final-synthesis-revision' : 'thermo-final-synthesis',
    args.agentSuffix === 1 ? 'Thermo final synthesis revision' : 'Thermo final synthesis',
    'Synthesize thermo review findings into the final triage report.',
    ranked,
  );

  const run = await runSingleReviewerWithPrompt({
    chatDir: args.chatDir,
    chatId: args.chatId,
    phase,
    phaseIdx: PHASE_IDX,
    round: ROUND,
    candidateIdx: 0,
    reviewerIdx: args.reviewerIdx,
    askContent: prompt,
    tmuxMgr: args.tmuxMgr,
    errorDetector: args.errorDetector,
    abortSignal: args.abortSignal,
    onEvent: args.onEvent,
    participantMetadata: {
      kind: 'thermo',
      phaseGroup: 'synthesis',
      phaseId: phase.id,
      phaseLabel: phase.title,
      description: phase.description ?? 'Synthesize thermo review findings into the final triage report.',
      check: thermoDomainCheck('final_synthesis'),
      domain: 'final_synthesis',
      role: 'synthesizer',
      voiceId: ranked.voice.id,
      provider: ranked.voice.provider,
      modelId: ranked.voice.model_id,
      tier: ranked.tier,
    },
  });

  const participantBody = readCompletedAnswer(run.answerFile);
  if (args.agentSuffix === 1) {
    preserveDraftTriage(triageDir);
  }
  fs.writeFileSync(askFile, prompt);
  if (fs.existsSync(run.answerFile)) {
    fs.copyFileSync(run.answerFile, answerFile);
  }

  return { completed: run.result !== null && participantBody.length > 0, body: participantBody, answerFile };
}

function readCompletedAnswer(answerFile: string): string {
  if (!fs.existsSync(answerFile)) return '';
  const trimmed = fs.readFileSync(answerFile, 'utf-8').trimEnd();
  if (!trimmed || trimmed.startsWith('## REVIEWER FAILED')) return '';
  return trimmed.replace(/\n##\s*DONE\s*$/i, '').trim();
}

function failureReason(answerFile: string): string {
  if (!fs.existsSync(answerFile)) return 'no_answer';
  const raw = fs.readFileSync(answerFile, 'utf-8');
  const kind = raw.match(/\*\*Kind:\*\*\s*([^\n]+)/)?.[1]?.trim();
  if (kind) return kind;
  if (raw.startsWith('## REVIEWER FAILED')) return 'reviewer_failed';
  return 'no_completed_output';
}

function skippedFrom(
  metadata: ThermoAssignmentMetadata,
  answerFile: string,
  reason: string,
): ThermoSkippedAgent {
  return {
    domain: metadata.domain,
    role: metadata.role === 'synthesizer' ? 'synthesizer' : metadata.role,
    voiceId: metadata.voiceId,
    provider: metadata.provider,
    modelId: metadata.modelId,
    reason,
    answerFile,
  };
}

function writeFailureSummary(answerFile: string, reason: string, detail?: string): void {
  fs.mkdirSync(path.dirname(answerFile), { recursive: true });
  fs.writeFileSync(
    answerFile,
    `## REVIEWER FAILED\n\n**Kind:** ${reason}\n\n${detail ?? 'Final thermo synthesis did not produce a completed answer.'}\n`,
  );
}

function synthesisReadinessGaps(
  assignments: ThermoAssignmentPlan,
  laneRuns: Array<{
    domain: ThermoDomain;
    phaseOneOutput?: ThermoReviewOutput;
    validationOutput?: ThermoValidationOutput;
    validationSkippedForFallback?: boolean;
  }>,
  planContract?: CodeReviewPlanContract,
): ThermoCoverageGap[] {
  const runByDomain = new Map(laneRuns.map((run) => [run.domain, run]));
  const gaps: ThermoCoverageGap[] = [];
  const planContractMatched = planContract?.status === 'matched';

  for (const domain of THERMO_SPECIALIST_DOMAINS) {
    const assignment = assignments.assignments[domain];
    const run = runByDomain.get(domain);
    if (!assignment?.primary) {
      gaps.push({
        domain,
        severity: isCriticalThermoSpecialistDomain(domain, { planContractMatched })
          ? 'critical'
          : 'warning',
        message: `No ${domain} primary reviewer was assigned.`,
      });
      continue;
    }
    if (!run?.phaseOneOutput) {
      gaps.push(runtimeCoverageGap(domain, 'specialist', planContract));
      continue;
    }
    if (!assignment.validator) {
      gaps.push({
        domain,
        severity: 'warning',
        message: `No ${domain} review reviewer was assigned.`,
      });
      continue;
    }
    if (run.validationSkippedForFallback) {
      continue;
    }
    if (!run.validationOutput) {
      gaps.push(runtimeCoverageGap(domain, 'validator', planContract));
    }
  }

  return dedupeCoverageGaps(gaps);
}

function dedupeCoverageGaps(gaps: ThermoCoverageGap[]): ThermoCoverageGap[] {
  const seen = new Set<string>();
  return gaps.filter((gap) => {
    const key = `${gap.domain}:${gap.severity}:${gap.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function verdictFromFinalReport(body: string): Exclude<ThermoReviewVerdict, 'failed'> {
  const explicit = body.match(/^Verdict:[^\S\r\n]*([^\r\n]*)$/im)?.[1]?.trim();
  if (explicit !== undefined) {
    return explicit === 'safe_to_merge' ? 'approved' : 'request_changes';
  }
  if (looksLikeConciseThermoReport(body)) return 'request_changes';
  if (hasMeaningfulSection(body, 'Valid Blocking')) return 'request_changes';
  return 'approved';
}

function looksLikeConciseThermoReport(body: string): boolean {
  return (
    /^Run Health:\s*/im.test(body) ||
    /^Plan:\s*/im.test(body) ||
    /^##\s*Domain Coverage\s*$/im.test(body)
  );
}

function runtimeCoverageGap(
  domain: ThermoDomain,
  role: 'specialist' | 'validator',
  planContract?: CodeReviewPlanContract,
): ThermoCoverageGap {
  const severity =
    role === 'validator' ||
    isCriticalThermoSpecialistDomain(domain, {
      planContractMatched: planContract?.status === 'matched',
    })
      ? 'critical'
      : 'warning';
  return {
    domain,
    severity,
    message:
      role === 'specialist'
        ? `No completed ${domain} specialist review was produced at runtime.`
        : `No completed ${domain} validation note was produced at runtime.`,
  };
}

function promotedValidatorCoverageGap(domain: ThermoDomain): ThermoCoverageGap {
  return {
    domain,
    severity: 'warning',
    message: `The ${domain} validator was promoted to specialist fallback, so no independent validation ran.`,
  };
}

function finalVerdict(
  body: string,
  safety: { allSpecialistsFailed: boolean; hasCriticalCoverageGaps: boolean },
): Exclude<ThermoReviewVerdict, 'failed'> {
  const parsed = verdictFromFinalReport(body);
  if (parsed === 'approved' && (safety.allSpecialistsFailed || safety.hasCriticalCoverageGaps)) {
    return 'request_changes';
  }
  return parsed;
}

function preserveDraftTriage(triageDir: string): void {
  const askFile = path.join(triageDir, 'ask.md');
  const answerFile = path.join(triageDir, 'answer.md');
  if (fs.existsSync(askFile)) {
    fs.copyFileSync(askFile, path.join(triageDir, 'draft-ask.md'));
  }
  if (fs.existsSync(answerFile)) {
    fs.copyFileSync(answerFile, path.join(triageDir, 'draft-answer.md'));
  }
}

function cancelledResult(
  args: {
    chatId: string;
    assignments: ThermoAssignmentPlan;
    onEvent: (event: RunnerEvent) => void;
  },
  partial?: {
    phaseOneOutputs?: ThermoReviewOutput[];
    validationNotes?: ThermoValidationOutput[];
    skippedAgents?: ThermoSkippedAgent[];
    answerFile?: string;
  },
): ThermoReviewResult {
  args.onEvent({
    chatId: args.chatId,
    type: 'chat_done',
    payload: { status: 'cancelled', verdict: 'failed' },
    ts: Date.now(),
  });
  return {
    completed: false,
    verdict: 'failed',
    phaseOneOutputs: partial?.phaseOneOutputs ?? [],
    validationNotes: partial?.validationNotes ?? [],
    skippedAgents: partial?.skippedAgents ?? [],
    coverageGaps: args.assignments.coverageGaps,
    answerFile: partial?.answerFile,
  };
}

function hasMeaningfulSection(body: string, title: string): boolean {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = body.match(new RegExp(`\\*\\*${escaped}\\*\\*\\s*([\\s\\S]*?)(?=\\n\\*\\*[^\\n]+\\*\\*|$)`, 'i'));
  if (!match) return false;
  const section = match[1]
    .replace(/##\s*DONE\s*$/i, '')
    .replace(/^\s*[-*]\s*/gm, '')
    .trim();
  if (!section) return false;
  return !/^(none\.?|n\/a\.?|no valid findings?\.?|no issues?\.?)$/i.test(section);
}

function assignmentSummary(plan: ThermoAssignmentPlan): string {
  return Object.values(plan.assignments)
    .map((assignment) => {
      const primary = assignment.primary
        ? `${assignment.primary.voice.provider}/${assignment.primary.voice.model_id} ${assignment.primary.tier}`
        : 'none';
      const validator = assignment.validator
        ? `${assignment.validator.voice.provider}/${assignment.validator.voice.model_id} ${assignment.validator.tier}`
        : 'none';
      return `${assignment.domain}: primary=${primary}; validator=${validator}`;
    })
    .join('\n');
}

function writeThermoPlan(chatDir: string, plan: ThermoAssignmentPlan): void {
  try {
    fs.mkdirSync(chatDir, { recursive: true });
    fs.writeFileSync(
      path.join(chatDir, '_thermo-plan.json'),
      JSON.stringify({
        phases: [
          {
            id: 'specialist',
            label: 'Phase 1',
            title: 'Specialist review',
            description: 'One primary reviewer checks each Thermo domain.',
          },
          {
            id: 'validation',
            label: 'Phase 2',
            title: 'Adversarial validation',
            description: 'Second reviewers challenge each domain as soon as its primary review finishes.',
          },
          {
            id: 'synthesis',
            label: 'Phase 3',
            title: 'Final synthesis',
            description: 'One strong model merges findings into the final review.',
          },
          {
            id: 'audit',
            label: 'Phase 4',
            title: 'Synthesis audit',
            description: 'A final auditor checks that the synthesis did not overstate or miss findings.',
          },
        ],
        domains: THERMO_SPECIALIST_DOMAINS.map((domain) => {
          const assignment = plan.assignments[domain];
          return {
            domain,
            check: thermoDomainCheck(domain),
            validatorPolicy: assignment.validatorPolicy,
            validatorReason: assignment.validatorReason,
            primary: assignment.primary ? voiceSummary(assignment.primary) : null,
            validator: assignment.validator ? voiceSummary(assignment.validator) : null,
          };
        }),
      }, null, 2),
      'utf-8',
    );
  } catch {
    /* informational sidecar; ignore write errors */
  }
}

function voiceSummary(ranked: RankedReviewVoice): {
  voiceId: string;
  provider: string;
  modelId: string;
  tier: RankedReviewVoice['tier'];
} {
  return {
    voiceId: ranked.voice.id,
    provider: ranked.voice.provider,
    modelId: ranked.voice.model_id,
    tier: ranked.tier,
  };
}

function assignmentContext(metadata: ThermoAssignmentMetadata): string {
  return [
    `Validator domain: ${metadata.domain}`,
    `Voice: ${metadata.voiceId}`,
    `Provider: ${metadata.provider}`,
    `Model: ${metadata.modelId}`,
    `Tier: ${metadata.tier}`,
  ].join('\n');
}

function skippedAgentNotes(skippedAgents: ThermoSkippedAgent[]): string[] {
  return skippedAgents.map((agent) => (
    `${agent.domain} ${agent.role}: ${agent.provider}/${agent.modelId} (${agent.voiceId}) skipped: ${agent.reason}`
  ));
}

function quotaNotes(skippedAgents: ThermoSkippedAgent[]): string[] {
  return skippedAgents.map((agent) => (
    `${agent.domain} ${agent.role}: ${agent.provider}/${agent.modelId} did not complete (${agent.reason})`
  ));
}

function coverageGapNotes(gaps: ThermoCoverageGap[]): string[] {
  return gaps.map((gap) => `${gap.severity}: ${gap.domain}: ${gap.message}`);
}
