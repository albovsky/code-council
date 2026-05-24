import { persistedSelection } from "@/lib/persisted-selection";

export const CODE_REVIEW_DISABLED_VOICE_IDS_STORAGE_KEY =
  "code-council:code-review-disabled-voice-ids";

export const CODE_REVIEW_DISABLED_VOICE_IDS_SETTING_KEY =
  "code_review.disabled_voice_ids";

export const CODE_REVIEW_DISABLED_VOICE_IDS_COOKIE_NAME =
  "code_review_disabled_voice_ids";

export function parseDisabledCodeReviewVoiceIds(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

const disabledVoiceSelection = persistedSelection<string[]>({
  storageKey: CODE_REVIEW_DISABLED_VOICE_IDS_STORAGE_KEY,
  cookieName: CODE_REVIEW_DISABLED_VOICE_IDS_COOKIE_NAME,
  parse: parseDisabledCodeReviewVoiceIds,
  serialize: (voiceIds) => JSON.stringify([...new Set(voiceIds)].sort()),
  defaultValue: [],
});

export function readDisabledCodeReviewVoiceIds(): string[] {
  return disabledVoiceSelection.read();
}

export function writeDisabledCodeReviewVoiceIds(voiceIds: string[]): void {
  disabledVoiceSelection.write(voiceIds);
}
