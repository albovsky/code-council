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
}

export interface ThermoValidationPromptInput {
  domain: ThermoDomain;
  domainScope: string;
  originalArtifact: string;
  phaseOneOutputs: ThermoReviewOutput[];
  assignmentContext: string;
}

export interface ThermoSynthesisPromptInput {
  artifact: string;
  phaseOneOutputs: ThermoReviewOutput[];
  validationNotes: ThermoValidationOutput[];
  skippedAgents: string[];
  quotaNotes: string[];
  coverageGaps: string[];
  assignmentSummary: string;
}

export interface ThermoAuditPromptInput {
  draftFinalReport: string;
  artifact: string;
  phaseOneOutputs: ThermoReviewOutput[];
  validationNotes: ThermoValidationOutput[];
  coverageGaps: string[];
  skippedAgents: string[];
  quotaNotes: string[];
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
      'A blocking finding needs Tier A-/better origin or validation.',
      'A security/data-loss blocking finding needs Tier A/A+ validation when available.',
      'If validators disagree, downgrade to Mostly Valid or Needs Owner Decision.',
      'Broad style feedback needs concrete regression risk.',
      'Quota/skipped agents belong only in Coverage Gaps.',
    ].join('\n'),
    [
      '## Final Report Contract',
      'Return exactly these sections in this order:',
      '',
      '**Valid Blocking**',
      '**Valid Non-Blocking**',
      '**Mostly Valid**',
      '**Needs Owner Decision**',
      '**Noise**',
      '**Coverage Gaps**',
      '**Fix Plan**',
      '**Validation**',
    ].join('\n'),
    doneFooter(),
  ].join('\n\n');
}

export function buildThermoAuditPrompt(input: ThermoAuditPromptInput): string {
  return [
    '# Thermo Synthesis Audit',
    section('Draft Final Report', fencedData('draft-final-report', input.draftFinalReport)),
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
      'Find unsupported blockers, misclassified noise, and missing coverage gaps.',
      'Check that quota or skipped agents appear only as coverage gaps.',
      'Check that security or data-loss blockers have the required validation when available.',
      'Output APPROVED when the draft can stand as final.',
      'Output REQUIRED_REVISIONS when the synthesizer must revise, followed by concise required changes.',
    ].join('\n'),
    doneFooter(),
  ].join('\n\n');
}
