import {
  isReviewModelTierAtLeast,
  rankReviewVoices,
  type RankedReviewVoice,
  type ReviewVoice,
} from './review-model-tiering';

export type ThermoDomain =
  | 'architecture'
  | 'security'
  | 'correctness'
  | 'tests'
  | 'performance'
  | 'docs'
  | 'final_synthesis'
  | 'synthesis_audit';

export type ThermoCoverageGapSeverity = 'critical' | 'warning';

export interface ThermoCoverageGap {
  domain: ThermoDomain;
  severity: ThermoCoverageGapSeverity;
  message: string;
}

export interface ThermoDomainAssignment {
  domain: ThermoDomain;
  primary?: RankedReviewVoice;
  validator?: RankedReviewVoice;
  validatorPolicy: 'always' | 'conditional' | 'none';
  validatorReason: string;
}

export interface ThermoAssignmentPlan {
  assignments: Record<ThermoDomain, ThermoDomainAssignment>;
  coverageGaps: ThermoCoverageGap[];
  skippedVoiceIds: string[];
}

export interface AssignThermoReviewDomainsInput {
  voices: ReviewVoice[];
  skippedVoiceIds?: string[];
  changedFiles?: string[];
}

export const THERMO_REVIEW_DOMAINS: ThermoDomain[] = [
  'architecture',
  'security',
  'correctness',
  'tests',
  'performance',
  'docs',
  'final_synthesis',
  'synthesis_audit',
];

const TARGET_ASSIGNMENTS: Record<ThermoDomain, { primary: string; validator?: string }> = {
  architecture: {
    primary: 'gpt-5.5',
    validator: 'opencode-go/kimi-k2.6',
  },
  security: {
    primary: 'opencode-go/deepseek-v4-pro',
    validator: 'gpt-5.5',
  },
  correctness: {
    primary: 'opencode-go/kimi-k2.6',
    validator: 'opencode-go/qwen3.6-plus',
  },
  tests: {
    primary: 'opencode-go/qwen3.6-plus',
    validator: 'opencode-go/deepseek-v4-flash',
  },
  performance: {
    primary: 'opencode-go/glm-5.1',
    validator: 'opencode-go/deepseek-v4-pro',
  },
  docs: {
    primary: 'opencode-go/deepseek-v4-flash',
    validator: 'gemini-3.5-flash',
  },
  final_synthesis: {
    primary: 'gpt-5.5',
    validator: 'opencode-go/deepseek-v4-pro',
  },
  synthesis_audit: {
    primary: 'opencode-go/deepseek-v4-pro',
    validator: 'opencode-go/kimi-k2.6',
  },
};

function findByModelId(
  ranked: RankedReviewVoice[],
  modelId: string | undefined,
  excludedVoiceIds: Set<string>,
): RankedReviewVoice | undefined {
  if (!modelId) {
    return undefined;
  }

  return ranked.find((item) => (
    item.voice.model_id === modelId && !excludedVoiceIds.has(item.voice.id)
  ));
}

function firstAvailable(
  ranked: RankedReviewVoice[],
  excludedVoiceIds: Set<string>,
  minimumTier?: RankedReviewVoice['tier'],
): RankedReviewVoice | undefined {
  return ranked.find((item) => (
    !excludedVoiceIds.has(item.voice.id)
    && (!minimumTier || isReviewModelTierAtLeast(item.tier, minimumTier))
  ));
}

function selectPrimary(
  domain: ThermoDomain,
  ranked: RankedReviewVoice[],
  skippedVoiceIds: Set<string>,
): RankedReviewVoice | undefined {
  const exact = findByModelId(ranked, TARGET_ASSIGNMENTS[domain].primary, skippedVoiceIds);
  if (exact) {
    return exact;
  }

  if (domain === 'final_synthesis') {
    return firstAvailable(ranked, skippedVoiceIds, 'A_MINUS') ?? firstAvailable(ranked, skippedVoiceIds);
  }

  if (domain === 'architecture') {
    return firstAvailable(ranked, skippedVoiceIds, 'A_MINUS') ?? firstAvailable(ranked, skippedVoiceIds);
  }

  if (domain === 'security') {
    return firstAvailable(ranked, skippedVoiceIds, 'A') ?? firstAvailable(ranked, skippedVoiceIds);
  }

  return firstAvailable(ranked, skippedVoiceIds);
}

function selectValidator(
  domain: ThermoDomain,
  ranked: RankedReviewVoice[],
  skippedVoiceIds: Set<string>,
  primary: RankedReviewVoice | undefined,
  includeConditionalValidator: boolean,
): RankedReviewVoice | undefined {
  if (validatorPolicyForDomain(domain) === 'none') {
    return undefined;
  }
  if (validatorPolicyForDomain(domain) === 'conditional' && !includeConditionalValidator) {
    return undefined;
  }

  const excluded = new Set(skippedVoiceIds);
  if (primary) {
    excluded.add(primary.voice.id);
  }

  const exact = findByModelId(ranked, TARGET_ASSIGNMENTS[domain].validator, excluded);
  if (exact) {
    return exact;
  }

  if (domain === 'security') {
    return firstAvailable(ranked, excluded, 'A') ?? firstAvailable(ranked, excluded);
  }

  if (domain === 'architecture' || domain === 'final_synthesis' || domain === 'synthesis_audit') {
    return firstAvailable(ranked, excluded, 'A_MINUS') ?? firstAvailable(ranked, excluded);
  }

  return firstAvailable(ranked, excluded);
}

function validatorPolicyForDomain(domain: ThermoDomain): ThermoDomainAssignment['validatorPolicy'] {
  switch (domain) {
    case 'architecture':
    case 'security':
    case 'correctness':
    case 'tests':
      return 'always';
    case 'performance':
    case 'docs':
      return 'conditional';
    case 'final_synthesis':
    case 'synthesis_audit':
      return 'none';
  }
}

function touchesHotPath(files: string[]): boolean {
  return files.some((file) => (
    /(^|\/)(runner|daemon|api|lib|server|db|cache|stream|sync|worker|queue|storage|auth)(\/|[-_.])/i.test(file)
    || /\.(sql|prisma)$/i.test(file)
  ));
}

function touchesPublicApiOrSchema(files: string[]): boolean {
  return files.some((file) => (
    /(^|\/)(api|routes|schema|migration|migrations|templates|docs)(\/|[-_.])/i.test(file)
    || /\.(sql|prisma|ya?ml|md)$/i.test(file)
  ));
}

function shouldIncludeConditionalValidator(domain: ThermoDomain, changedFiles: string[]): boolean {
  if (domain === 'performance') return touchesHotPath(changedFiles);
  if (domain === 'docs') return touchesPublicApiOrSchema(changedFiles);
  return true;
}

function validatorReasonForDomain(domain: ThermoDomain, included: boolean): string {
  switch (domain) {
    case 'architecture':
      return 'Architecture / maintainability is risky, so a second adversarial reviewer checks the primary findings.';
    case 'security':
      return 'Security / auth / data-loss risk requires a second adversarial reviewer.';
    case 'correctness':
      return 'Correctness / regression risk gets a second reviewer.';
    case 'tests':
      return 'Tests / fake coverage gets a second checker; Tier C is acceptable as secondary.';
    case 'performance':
      return included
        ? 'Performance gets a second reviewer because the diff touches hot-path code.'
        : 'Performance secondary skipped because the diff does not look like hot-path code.';
    case 'docs':
      return included
        ? 'Docs / migrations gets a second reviewer because the diff touches docs, schema, public API, or release-facing files.'
        : 'Docs secondary skipped because this does not look like a public API, schema, migration, or release-note change.';
    case 'final_synthesis':
      return 'Final synthesis is its own phase, not a domain validator.';
    case 'synthesis_audit':
      return 'Final synthesis gets audited for unsupported blockers and missing downgrades.';
  }
}

function hasTierAtLeast(ranked: RankedReviewVoice[], minimumTier: RankedReviewVoice['tier']): boolean {
  return ranked.some((item) => isReviewModelTierAtLeast(item.tier, minimumTier));
}

function buildCoverageGaps(
  ranked: RankedReviewVoice[],
  assignments: Record<ThermoDomain, ThermoDomainAssignment>,
): ThermoCoverageGap[] {
  const gaps: ThermoCoverageGap[] = [];

  if (!hasTierAtLeast(ranked, 'A')) {
    gaps.push({
      domain: 'security',
      severity: 'critical',
      message: 'Security requires an A or A+ model, but none is available.',
    });
  }

  if (!hasTierAtLeast(ranked, 'A_MINUS')) {
    gaps.push({
      domain: 'architecture',
      severity: 'critical',
      message: 'Architecture requires an A-, A, or A+ model, but none is available.',
    });
    gaps.push({
      domain: 'final_synthesis',
      severity: 'critical',
      message: 'Final synthesis requires an A-, A, or A+ model, but none is available.',
    });
  }

  for (const domain of THERMO_REVIEW_DOMAINS) {
    const assignment = assignments[domain];
    if (!assignment.primary) {
      gaps.push({
        domain,
        severity: domain === 'security' || domain === 'architecture' || domain === 'final_synthesis'
          ? 'critical'
          : 'warning',
        message: `${domainLabel(domain)} has no available reviewer after skipped or unavailable models.`,
      });
      continue;
    }

    if (!assignment.validator) {
      if (assignment.validatorPolicy === 'conditional') {
        continue;
      }
      if (assignment.validatorPolicy === 'none') {
        continue;
      }
      gaps.push({
        domain,
        severity: 'warning',
        message: `${domainLabel(domain)} has no separate validator after skipped or unavailable models.`,
      });
    }
  }

  return gaps;
}

function domainLabel(domain: ThermoDomain): string {
  return domain
    .split('_')
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ');
}

export function assignThermoReviewDomains(input: AssignThermoReviewDomainsInput): ThermoAssignmentPlan {
  const skippedVoiceIds = new Set(input.skippedVoiceIds ?? []);
  const changedFiles = input.changedFiles ?? [];
  const ranked = rankReviewVoices(input.voices)
    .filter((item) => !skippedVoiceIds.has(item.voice.id));

  const assignments = Object.fromEntries(
    THERMO_REVIEW_DOMAINS.map((domain) => {
      const includeConditionalValidator = shouldIncludeConditionalValidator(domain, changedFiles);
      const primary = selectPrimary(domain, ranked, skippedVoiceIds);
      const validator = selectValidator(
        domain,
        ranked,
        skippedVoiceIds,
        primary,
        includeConditionalValidator,
      );
      return [
        domain,
        {
          domain,
          primary,
          validator,
          validatorPolicy: validatorPolicyForDomain(domain),
          validatorReason: validatorReasonForDomain(domain, includeConditionalValidator),
        },
      ];
    }),
  ) as Record<ThermoDomain, ThermoDomainAssignment>;

  return {
    assignments,
    coverageGaps: buildCoverageGaps(ranked, assignments),
    skippedVoiceIds: [...skippedVoiceIds].sort(),
  };
}
