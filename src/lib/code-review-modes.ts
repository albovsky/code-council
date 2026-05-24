export type CodeReviewMode = 'fast' | 'thermo';

export const DEFAULT_CODE_REVIEW_MODE: CodeReviewMode = 'fast';

export const CODE_REVIEW_MODE_LABELS: Record<CodeReviewMode, string> = {
  fast: 'Fast',
  thermo: 'Thermo',
};

export const CODE_REVIEW_MODE_DESCRIPTIONS: Record<CodeReviewMode, string> = {
  fast: 'One reviewer pass plus triage synthesis.',
  thermo: 'Specialist reviewers, cross-validation, synthesis, and coverage gaps.',
};

export const CODE_REVIEW_MODES: CodeReviewMode[] = ['fast', 'thermo'];

export function isCodeReviewMode(value: unknown): value is CodeReviewMode {
  return value === 'fast' || value === 'thermo';
}
