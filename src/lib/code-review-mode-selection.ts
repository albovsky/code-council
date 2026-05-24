import {
  DEFAULT_CODE_REVIEW_MODE,
  isCodeReviewMode,
  type CodeReviewMode,
} from "@/lib/code-review-modes";
import { persistedSelection } from "@/lib/persisted-selection";

export const CODE_REVIEW_MODE_STORAGE_KEY =
  "code-council:code-review-mode";

export const CODE_REVIEW_MODE_COOKIE_NAME = "code_review_mode";

export function parseCodeReviewModeSelection(
  value: string | null | undefined,
): CodeReviewMode {
  return isCodeReviewMode(value) ? value : DEFAULT_CODE_REVIEW_MODE;
}

const codeReviewModeSelection = persistedSelection<CodeReviewMode>({
  storageKey: CODE_REVIEW_MODE_STORAGE_KEY,
  cookieName: CODE_REVIEW_MODE_COOKIE_NAME,
  parse: parseCodeReviewModeSelection,
  serialize: (mode) => mode,
  defaultValue: DEFAULT_CODE_REVIEW_MODE,
});

export function readCodeReviewModeSelection(): CodeReviewMode {
  return codeReviewModeSelection.read();
}

export function writeCodeReviewModeSelection(mode: CodeReviewMode): void {
  codeReviewModeSelection.write(mode);
}
