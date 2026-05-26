import type { CodeReviewPlanContract } from '../../lib/git-code-review-scope';
import type { ReviewModelTier } from '../../lib/review-model-tiering';
import type { ThermoDomain } from '../../lib/thermo-review-assignment';

export type ThermoAssignmentRole = 'primary' | 'validator' | 'synthesizer' | 'auditor';

export interface ThermoAssignmentMetadata {
  domain: ThermoDomain;
  role: ThermoAssignmentRole;
  voiceId: string;
  provider: string;
  modelId: string;
  tier: ReviewModelTier;
}

export interface ThermoReviewOutput {
  origin: ThermoAssignmentMetadata;
  output: string;
}

export interface ThermoValidationOutput {
  validator: ThermoAssignmentMetadata;
  output: string;
}

export interface ThermoPromptInput {
  domainScope: string;
  originalWork: string;
  filesBlock?: string;
  artifact: string;
  assignment: ThermoAssignmentMetadata;
  planContract?: CodeReviewPlanContract;
}

export interface ThermoValidationPromptInput {
  domain: ThermoDomain;
  domainScope: string;
  originalArtifact: string;
  phaseOneOutputs: ThermoReviewOutput[];
  assignmentContext: string;
  planContract?: CodeReviewPlanContract;
}

export interface ThermoSynthesisPromptInput {
  artifact: string;
  phaseOneOutputs: ThermoReviewOutput[];
  validationNotes: ThermoValidationOutput[];
  skippedAgents: string[];
  quotaNotes: string[];
  coverageGaps: string[];
  assignmentSummary: string;
  planContract?: CodeReviewPlanContract;
}

export interface ThermoAuditPromptInput {
  draftFinalReport: string;
  artifact: string;
  phaseOneOutputs: ThermoReviewOutput[];
  validationNotes: ThermoValidationOutput[];
  coverageGaps: string[];
  skippedAgents: string[];
  quotaNotes: string[];
  planContract?: CodeReviewPlanContract;
}

function trimBlock(value: string): string {
  return value.trim();
}

function section(title: string, body: string): string {
  return `## ${title}\n${trimBlock(body)}`;
}

function longestBacktickRun(value: string): number {
  return Math.max(0, ...Array.from(value.matchAll(/`+/g), (match) => match[0].length));
}

function fencedData(label: string, value: string): string {
  const body = trimBlock(value);
  const fence = '`'.repeat(Math.max(4, longestBacktickRun(body) + 1));

  return [
    `<thermo-data label="${label}">`,
    `${fence}text`,
    body,
    fence,
    '</thermo-data>',
  ].join('\n');
}

function dataListOrNone(label: string, items: string[]): string {
  if (items.length === 0) {
    return '- None reported.';
  }

  return items.map((item) => `- ${fencedData(label, item)}`).join('\n');
}

function formatPlanContract(planContract?: CodeReviewPlanContract): string {
  if (!planContract || planContract.status === 'not_found') {
    return [
      'Status: not_found',
      'Plan Completeness domain must report not checked.',
      'Do not create plan-completeness findings without a matched plan contract.',
    ].join('\n');
  }

  if (planContract.status === 'ambiguous') {
    return [
      'Status: ambiguous',
      `Source: ${planContract.source}`,
      'Plan Completeness domain must report not checked.',
      'Do not create plan-completeness findings because multiple candidate plans exist.',
      '',
      'Candidate plans:',
      ...planContract.candidates.map((candidate) => `- ${fencedData('plan-candidate', candidate)}`),
    ].join('\n');
  }

  return [
    'Status: matched',
    `Source: ${planContract.source}`,
    'Path:',
    fencedData('plan-path', planContract.path),
    'Content:',
    fencedData('plan-contract', planContract.content),
  ].join('\n');
}

function formatAssignment(assignment: ThermoAssignmentMetadata): string {
  return [
    `Domain: ${assignment.domain}`,
    `Role: ${assignment.role}`,
    'Voice ID:',
    fencedData('voice-id', assignment.voiceId),
    'Provider:',
    fencedData('provider', assignment.provider),
    'Model:',
    fencedData('model-id', assignment.modelId),
    `Tier: ${assignment.tier}`,
  ].join('\n');
}

function formatOutputMetadata(metadata: ThermoAssignmentMetadata): string {
  return [
    `Domain: ${metadata.domain}`,
    `Role: ${metadata.role}`,
    'Voice ID:',
    fencedData('voice-id', metadata.voiceId),
    'Provider:',
    fencedData('provider', metadata.provider),
    'Model:',
    fencedData('model-id', metadata.modelId),
    `Tier: ${metadata.tier}`,
  ].map((line) => {
    if (line.startsWith('<thermo-data')) {
      return line;
    }

    return `- ${line}`;
  }).join('\n');
}

function formatPhaseOneOutputs(outputs: ThermoReviewOutput[]): string {
  if (outputs.length === 0) {
    return '- No phase 1 outputs were supplied.';
  }

  return outputs
    .map((item, index) => [
      `### Output ${index + 1}`,
      formatOutputMetadata(item.origin),
      fencedData('phase-one-output', item.output),
    ].join('\n'))
    .join('\n\n');
}

function formatValidationNotes(outputs: ThermoValidationOutput[]): string {
  if (outputs.length === 0) {
    return '- No phase 2 validation notes were supplied.';
  }

  return outputs
    .map((item, index) => [
      `### Validation Note ${index + 1}`,
      formatOutputMetadata(item.validator),
      fencedData('validation-note', item.output),
    ].join('\n'))
    .join('\n\n');
}

function doneFooter(): string {
  return '## DONE';
}

export function buildThermoPhaseOnePrompt(input: ThermoPromptInput): string {
  const parts = [
    '# Thermo Phase 1 Specialist Review',
    section('Assignment', formatAssignment(input.assignment)),
    section('Domain Scope', fencedData('domain-scope', input.domainScope)),
    section('Original Work', fencedData('original-work', input.originalWork)),
    section('Plan Contract', formatPlanContract(input.planContract)),
  ];

  if (input.filesBlock?.trim()) {
    parts.push(section('Files', fencedData('files', input.filesBlock)));
  }

  parts.push(
    section('Artifact to Review', fencedData('artifact', input.artifact)),
    [
      '## Instructions',
      `Review only the ${input.assignment.domain} domain unless another issue directly affects that domain.`,
      'Use concrete evidence from the artifact. Do not invent missing context.',
      'If the plan contract is not matched, do not create plan-completeness findings.',
      'When a plan is matched, treat concrete checklist items, stated constraints, and promised validation as the implementation contract.',
      'Classify severity in the heading as blocking, high, medium, low, or note.',
    ].join('\n'),
    [
      '## Output Contract',
      'Return exactly these top-level sections and end with ## DONE:',
      '',
      '## Findings',
      '',
      '### [severity] Short title',
      '- Domain:',
      '- Evidence:',
      '- Why it matters:',
      '- Confidence:',
      '- Suggested fix:',
      '',
      '## Non-Issues Checked',
      '',
      '## Coverage Limits',
      '',
      doneFooter(),
    ].join('\n'),
  );

  return parts.join('\n\n');
}

export function buildThermoValidationPrompt(input: ThermoValidationPromptInput): string {
  return [
    '# Thermo Phase 2 Cross-Validation',
    section('Domain', input.domain),
    section('Domain Scope', fencedData('domain-scope', input.domainScope)),
    section('Assignment Context', fencedData('assignment-context', input.assignmentContext)),
    section('Plan Contract', formatPlanContract(input.planContract)),
    section('Original Artifact', fencedData('original-artifact', input.originalArtifact)),
    section('Phase 1 Outputs', formatPhaseOneOutputs(input.phaseOneOutputs)),
    [
      '## Validation Instructions',
      'Validate each phase 1 finding against the original artifact and domain context.',
      'Use only these classifications: valid, mostly_valid, noise, needs_owner_decision, insufficient_evidence.',
      'For each finding, include the classification, the evidence you checked, and any missing context.',
      'Do not promote findings beyond the supplied evidence.',
    ].join('\n'),
    doneFooter(),
  ].join('\n\n');
}

export function buildThermoSynthesisPrompt(input: ThermoSynthesisPromptInput): string {
  return [
    '# Thermo Final Synthesis',
    section('Assignment Summary', fencedData('assignment-summary', input.assignmentSummary)),
    section('Plan Contract', formatPlanContract(input.planContract)),
    section('Artifact', fencedData('artifact', input.artifact)),
    section('Phase 1 Outputs', formatPhaseOneOutputs(input.phaseOneOutputs)),
    section('Phase 2 Validation Notes', formatValidationNotes(input.validationNotes)),
    section(
      'Skipped and Quota Metadata',
      [
        'Skipped agents:',
        dataListOrNone('skipped-agent', input.skippedAgents),
        '',
        'Quota notes:',
        dataListOrNone('quota-note', input.quotaNotes),
      ].join('\n'),
    ),
    section('Coverage Gaps', dataListOrNone('coverage-gap', input.coverageGaps)),
    [
      '## Admission Rules',
      'Optimize for implementation gaps and merge risk, not audit completeness.',
      'Deduplicate by root cause across domains. One root cause becomes one finding with domain tags.',
      'Drop valid but low-impact findings from the default report unless they affect the verdict.',
      'A surfaced blocker needs validator agreement or deterministic evidence from the artifact/plan.',
      'A security/privacy/data-loss blocker needs an exact trust boundary, attacker/control surface, exploit path, impacted asset, and independent validation or deterministic evidence.',
      'Missing-test findings are allowed only when tied to a concrete merge, safety, or plan-verification risk.',
      'If the plan contract is not matched, mark Plan Completeness as not checked and do not create plan-gap findings.',
      'Keep quota, skipped-agent, model provenance, mostly-valid, noise, and reviewer debate out of the default report. They remain in trace artifacts.',
    ].join('\n'),
    [
      '## Final Report Contract',
      'Return a concise decision-grade markdown report. Omit empty findings sections.',
      '',
      'Verdict: safe_to_merge | changes_requested | owner_decision_needed | human_review_required | no_verdict',
      'Run Health: complete | degraded | failed',
      'Plan: matched `<path>` | not checked',
      '',
      '## Domain Coverage',
      '- Plan Completeness: clear | finding | degraded | not applicable | not checked',
      '- Correctness / Regression: clear | finding | degraded | not applicable | not checked',
      '- Security / Privacy: clear | finding | degraded | not applicable | not checked',
      '- Performance / Reliability: clear | finding | degraded | not applicable | not checked',
      '- Tests / Verification: clear | finding | degraded | not applicable | not checked',
      '- Maintainability / Architecture: clear | finding | degraded | not applicable | not checked',
      '- Docs / Operator Handoff: clear | finding | degraded | not applicable | not checked',
      '',
      '## Blockers',
      'Numbered list, maximum 3, only decision-grade blockers.',
      '',
      '## Owner Decisions',
      'Numbered list, maximum 2, only unresolved product/merge-policy choices.',
      '',
      '## Follow-Ups',
      'Numbered list, maximum 3, only important concrete non-blockers.',
      '',
      '## Verification',
      '- Evidence observed:',
      '- Missing verification affecting verdict:',
    ].join('\n'),
    doneFooter(),
  ].join('\n\n');
}

export function buildThermoAuditPrompt(input: ThermoAuditPromptInput): string {
  return [
    '# Thermo Synthesis Audit',
    section('Draft Final Report', fencedData('draft-final-report', input.draftFinalReport)),
    section('Plan Contract', formatPlanContract(input.planContract)),
    section('Original Artifact', fencedData('original-artifact', input.artifact)),
    section('Phase 1 Outputs', formatPhaseOneOutputs(input.phaseOneOutputs)),
    section('Phase 2 Validation Notes', formatValidationNotes(input.validationNotes)),
    section(
      'Skipped and Quota Metadata',
      [
        'Skipped agents:',
        dataListOrNone('skipped-agent', input.skippedAgents),
        '',
        'Quota notes:',
        dataListOrNone('quota-note', input.quotaNotes),
      ].join('\n'),
    ),
    section('Coverage Gaps', dataListOrNone('coverage-gap', input.coverageGaps)),
    [
      '## Audit Instructions',
      'Find unsupported blockers, missing decision-grade findings, weak domain coverage statuses, and low-value noise that leaked into the default report.',
      'Check that quota, skipped agents, model provenance, mostly-valid, noise, and reviewer debate stayed out of the default report.',
      'Check that security or data-loss blockers have the required trust-boundary evidence and validation.',
      'Check that plan-completeness findings appear only when the plan contract is matched.',
      'Output APPROVED when the draft can stand as final.',
      'Output REQUIRED_REVISIONS when the synthesizer must revise, followed by concise required changes.',
    ].join('\n'),
    doneFooter(),
  ].join('\n\n');
}
