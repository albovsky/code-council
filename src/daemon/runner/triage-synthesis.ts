import fs from 'fs';
import path from 'path';
import type { ReviewOnlyPhase, StandardPhase } from '../../lib/template-schema.js';
import {
  buildGhReviewTriagePrompt,
  verdictFromGhReviewTriage,
} from '../../lib/gh-review-triage-format.js';
import { pickShimForVoice } from '../agents/index.js';
import type { Lineage } from '../agents/types.js';
import { runReviewerHeadless } from './reviewer.js';
import type { RunnerEvent } from './types.js';

export interface TriageSynthesisResult {
  completed: boolean;
  verdict: 'approved' | 'request_changes' | 'failed';
  answerFile?: string;
}

export function collectReviewerOutputs(
  chatDir: string,
  round: number,
): Array<{ label: string; output: string }> {
  const roundDir = path.join(chatDir, `round-${round}`);
  if (!fs.existsSync(roundDir)) return [];

  return fs
    .readdirSync(roundDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('reviewer-'))
    .flatMap((entry) => {
      const answerPath = path.join(roundDir, entry.name, 'answer.md');
      if (!fs.existsSync(answerPath)) return [];
      const raw = fs.readFileSync(answerPath, 'utf-8');
      const trimmed = raw.trimEnd();
      if (trimmed.startsWith('## REVIEWER FAILED')) return [];
      if (!/\n##\s*DONE\s*$/i.test(trimmed)) return [];
      const output = trimmed.replace(/\n##\s*DONE\s*$/i, '').trim();
      if (!output) return [];
      return [{ label: entry.name, output }];
    });
}

export async function runTriageSynthesis(args: {
  chatDir: string;
  chatId: string;
  phase: ReviewOnlyPhase;
  phaseIdx: number;
  round: number;
  artifact: string;
  work: string;
  onEvent: (e: RunnerEvent) => void;
  abortSignal: AbortSignal;
}): Promise<TriageSynthesisResult> {
  const synth = args.phase.synthesizer;
  if (!synth) return { completed: true, verdict: 'approved' };

  const reviewerOutputs = collectReviewerOutputs(args.chatDir, args.round);
  if (reviewerOutputs.length === 0) {
    return { completed: false, verdict: 'failed' };
  }

  const roundDir = path.join(args.chatDir, `round-${args.round}`);
  const triageDir = path.join(roundDir, 'triage');
  fs.mkdirSync(triageDir, { recursive: true });
  const askFile = path.join(triageDir, 'ask.md');
  const answerFile = path.join(triageDir, 'answer.md');

  const prompt = buildGhReviewTriagePrompt({
    work: args.work,
    artifact: args.artifact,
    reviewerOutputs,
  });
  fs.writeFileSync(askFile, prompt);

  const standardPhase: StandardPhase = {
    id: `${args.phase.id}-triage`,
    kind: 'review',
    title: 'Consolidated Triage',
    description: 'Synthesize reviewer outputs into gh-review-triage format.',
    doer: { lineage: 'any' },
    reviewer: {
      require: 1,
      crossLineage: false,
      candidates: [{ lineage: synth.lineage, models: synth.models }],
    },
    inputs: { include: [], exclude: [] },
    iterate: {
      maxRounds: 1,
      onDisagreement: 'continue',
      shareSessionAcrossRounds: false,
      shareSessionAcrossPhases: false,
    },
    timeoutMs: args.phase.timeoutMs,
  };

  args.onEvent({
    chatId: args.chatId,
    type: 'phase_start',
    payload: {
      phaseId: standardPhase.id,
      phaseIdx: args.phaseIdx,
      kind: standardPhase.kind,
      round: args.round,
      role: 'reviewer',
      agent: 'triage-0',
    },
    ts: Date.now(),
  });

  const shim = pickShimForVoice(synth.lineage as Lineage, synth.models?.[0]);
  await runReviewerHeadless({
    shim,
    chatId: args.chatId,
    phase: standardPhase,
    round: args.round,
    reviewerIdx: 0,
    candidateLineage: synth.lineage,
    candidateModel: synth.models?.[0],
    agentName: 'triage',
    askContent: prompt,
    answerFile,
    reviewerDir: triageDir,
    abortSignal: args.abortSignal,
    onEvent: args.onEvent,
  });

  const answer = fs.existsSync(answerFile) ? fs.readFileSync(answerFile, 'utf-8') : '';
  const trimmed = answer.trimEnd();
  const completed =
    trimmed.length > 0 &&
    !trimmed.startsWith('## REVIEWER FAILED') &&
    /\n##\s*DONE\s*$/i.test(trimmed);

  if (!completed) {
    args.onEvent({
      chatId: args.chatId,
      type: 'phase_failed',
      payload: {
        phaseId: standardPhase.id,
        phaseIdx: args.phaseIdx,
        kind: standardPhase.kind,
        round: args.round,
        role: 'reviewer',
        agent: 'triage-0',
        reason: 'triage_synthesis_failed',
      },
      ts: Date.now(),
    });
    return { completed: false, verdict: 'failed', answerFile };
  }

  const body = trimmed.replace(/\n##\s*DONE\s*$/i, '').trim();
  const verdict = verdictFromGhReviewTriage(body);
  args.onEvent({
    chatId: args.chatId,
    type: 'phase_done',
    payload: {
      phaseId: standardPhase.id,
      phaseIdx: args.phaseIdx,
      kind: standardPhase.kind,
      round: args.round,
      role: 'reviewer',
      agent: 'triage-0',
      verdict,
    },
    ts: Date.now(),
  });

  return {
    completed: true,
    verdict,
    answerFile,
  };
}
