import { describe, expect, it } from 'vitest';
import {
  THERMO_REVIEW_DOMAINS,
  assignThermoReviewDomains,
} from '@/lib/thermo-review-assignment';
import {
  THERMO_REVIEW_DOMAINS as CANONICAL_THERMO_REVIEW_DOMAINS,
  THERMO_SPECIALIST_DOMAINS,
} from '@/lib/thermo-run-types';
import type { ReviewVoice } from '@/lib/review-model-tiering';

function voice(modelId: string, overrides: Partial<ReviewVoice> = {}): ReviewVoice {
  return {
    id: overrides.id ?? modelId,
    provider: overrides.provider ?? modelId.split('/')[0] ?? 'openai',
    model_id: modelId,
    lineage: overrides.lineage ?? 'test',
    vendor_family: overrides.vendor_family ?? null,
    enabled: overrides.enabled ?? true,
  };
}

const fullFleet: ReviewVoice[] = [
  voice('gpt-5.5', { provider: 'openai', lineage: 'openai', vendor_family: 'openai' }),
  voice('opencode-go/deepseek-v4-pro', { vendor_family: 'deepseek' }),
  voice('opencode-go/kimi-k2.6', { vendor_family: 'moonshot' }),
  voice('opencode-go/glm-5.1', { vendor_family: 'zai' }),
  voice('opencode-go/qwen3.6-plus', { vendor_family: 'qwen' }),
  voice('opencode-go/minimax-m2.7', { vendor_family: 'minimax' }),
  voice('opencode-go/deepseek-v4-flash', { vendor_family: 'deepseek' }),
  voice('gemini-3.5-flash', { id: 'agy-gemini', provider: 'google', lineage: 'antigravity', vendor_family: 'google' }),
];

function selectedModelIds(plan: ReturnType<typeof assignThermoReviewDomains>) {
  return Object.fromEntries(
    THERMO_REVIEW_DOMAINS.map((domain) => [
      domain,
      {
        primary: plan.assignments[domain].primary?.voice.model_id,
        validator: plan.assignments[domain].validator?.voice.model_id,
      },
    ]),
  );
}

describe('assignThermoReviewDomains', () => {
  it('uses canonical Thermo domain definitions', () => {
    expect(THERMO_REVIEW_DOMAINS).toEqual(CANONICAL_THERMO_REVIEW_DOMAINS);
    expect(THERMO_SPECIALIST_DOMAINS).toEqual([
      'plan_completeness',
      'architecture',
      'security',
      'correctness',
      'tests',
      'performance',
      'docs',
    ]);
    expect(CANONICAL_THERMO_REVIEW_DOMAINS).not.toContain('adversarial_noise');
  });

  it('uses the target current-fleet mapping exactly', () => {
    const plan = assignThermoReviewDomains({
      voices: fullFleet,
      changedFiles: ['src/daemon/routes/code-review.ts', 'docs/release-notes.md'],
    });

    expect(selectedModelIds(plan)).toEqual({
      plan_completeness: { primary: 'gpt-5.5', validator: 'opencode-go/deepseek-v4-pro' },
      architecture: { primary: 'gpt-5.5', validator: 'opencode-go/kimi-k2.6' },
      security: { primary: 'opencode-go/deepseek-v4-pro', validator: 'gpt-5.5' },
      correctness: { primary: 'opencode-go/kimi-k2.6', validator: 'opencode-go/qwen3.6-plus' },
      tests: { primary: 'opencode-go/qwen3.6-plus', validator: 'opencode-go/deepseek-v4-flash' },
      performance: { primary: 'opencode-go/glm-5.1', validator: 'opencode-go/deepseek-v4-pro' },
      docs: { primary: 'opencode-go/deepseek-v4-flash', validator: 'gemini-3.5-flash' },
      final_synthesis: { primary: 'gpt-5.5', validator: undefined },
      synthesis_audit: { primary: 'opencode-go/deepseek-v4-pro', validator: undefined },
    });
    expect(plan.coverageGaps).toEqual([]);
  });

  it('assigns performance and docs validators even when the diff does not match old conditional heuristics', () => {
    const plan = assignThermoReviewDomains({
      voices: fullFleet,
      changedFiles: ['src/components/run-viewer/participant-card.tsx'],
    });

    expect(plan.assignments.performance.validator?.voice.model_id).toBe('opencode-go/deepseek-v4-pro');
    expect(plan.assignments.performance.validatorPolicy).toBe('always');
    expect(plan.assignments.docs.validator?.voice.model_id).toBe('gemini-3.5-flash');
    expect(plan.assignments.docs.validatorPolicy).toBe('always');
  });

  it('reports a critical coverage gap when security has no A-tier model', () => {
    const plan = assignThermoReviewDomains({
      voices: fullFleet.filter((item) => !['gpt-5.5', 'opencode-go/deepseek-v4-pro'].includes(item.model_id)),
    });

    expect(plan.coverageGaps).toContainEqual({
      domain: 'security',
      severity: 'critical',
      message: 'Security requires an A or A+ model, but none is available.',
    });
  });

  it('does not let security validate itself when only one A-tier model is available', () => {
    const plan = assignThermoReviewDomains({
      voices: [
        voice('gpt-5.5', {
          provider: 'openai',
          lineage: 'openai',
          vendor_family: 'openai',
        }),
      ],
    });

    expect(plan.assignments.security.primary?.voice.model_id).toBe('gpt-5.5');
    expect(plan.assignments.security.validator).toBeUndefined();
    expect(plan.coverageGaps).toContainEqual({
      domain: 'security',
      severity: 'critical',
      message: 'Security has no separate validator after skipped or unavailable models.',
    });
  });

  it('does not let docs validate itself when quota leaves only one model', () => {
    const plan = assignThermoReviewDomains({
      voices: [
        voice('gemini-3.5-flash', { id: 'agy-gemini', provider: 'google' }),
        voice('future-docs-flash', { id: 'fallback-docs', provider: 'openrouter' }),
      ],
      skippedVoiceIds: ['agy-gemini'],
    });

    expect(plan.assignments.docs.primary?.voice.id).toBe('fallback-docs');
    expect(plan.assignments.docs.validator).toBeUndefined();
    expect(plan.skippedVoiceIds).toEqual(['agy-gemini']);
    expect(plan.coverageGaps).toContainEqual({
      domain: 'docs',
      severity: 'warning',
      message: 'Docs has no separate validator after skipped or unavailable models.',
    });
  });

  it('reports a docs gap when skipped AGY Gemini leaves no fallback', () => {
    const plan = assignThermoReviewDomains({
      voices: [voice('gemini-3.5-flash', { id: 'agy-gemini', provider: 'google' })],
      skippedVoiceIds: ['agy-gemini'],
    });

    expect(plan.assignments.docs.primary).toBeUndefined();
    expect(plan.coverageGaps).toContainEqual({
      domain: 'docs',
      severity: 'warning',
      message: 'Docs has no available reviewer after skipped or unavailable models.',
    });
  });

  it('reports correctness and tests primary gaps as critical', () => {
    const plan = assignThermoReviewDomains({ voices: [] });

    expect(plan.coverageGaps).toContainEqual({
      domain: 'correctness',
      severity: 'critical',
      message: 'Correctness has no available reviewer after skipped or unavailable models.',
    });
    expect(plan.coverageGaps).toContainEqual({
      domain: 'tests',
      severity: 'critical',
      message: 'Tests has no available reviewer after skipped or unavailable models.',
    });
  });

  it('reports plan completeness primary gaps as critical only when a plan matched', () => {
    const withoutMatchedPlan = assignThermoReviewDomains({ voices: [] });
    const withMatchedPlan = assignThermoReviewDomains({
      voices: [],
      planContractMatched: true,
    });

    expect(withoutMatchedPlan.coverageGaps).toContainEqual({
      domain: 'plan_completeness',
      severity: 'warning',
      message: 'Plan Completeness has no available reviewer after skipped or unavailable models.',
    });
    expect(withMatchedPlan.coverageGaps).toContainEqual({
      domain: 'plan_completeness',
      severity: 'critical',
      message: 'Plan Completeness has no available reviewer after skipped or unavailable models.',
    });
  });

  it('falls back deterministically for a single model and reports critical gaps', () => {
    const plan = assignThermoReviewDomains({
      voices: [voice('unknown-review-pro', { provider: 'zeta', vendor_family: 'future' })],
    });

    expect(plan.assignments.architecture.primary?.voice.model_id).toBe('unknown-review-pro');
    expect(plan.assignments.plan_completeness.primary?.voice.model_id).toBe('unknown-review-pro');
    expect(plan.assignments.architecture.validator).toBeUndefined();
    expect(plan.assignments.plan_completeness.validator).toBeUndefined();
    expect(plan.assignments.security.primary?.voice.model_id).toBe('unknown-review-pro');
    expect(plan.assignments.security.validator).toBeUndefined();
    expect(plan.assignments.docs.validator).toBeUndefined();
    expect(plan.assignments.performance.validator).toBeUndefined();
    expect(plan.assignments.final_synthesis.primary?.voice.model_id).toBe('unknown-review-pro');
    expect(plan.coverageGaps).toEqual(expect.arrayContaining([
      {
        domain: 'security',
        severity: 'critical',
        message: 'Security requires an A or A+ model, but none is available.',
      },
      {
        domain: 'architecture',
        severity: 'critical',
        message: 'Architecture requires an A-, A, or A+ model, but none is available.',
      },
      {
        domain: 'final_synthesis',
        severity: 'critical',
        message: 'Final synthesis requires an A-, A, or A+ model, but none is available.',
      },
    ]));
  });
});
