export type ReviewModelTier =
  | 'A_PLUS'
  | 'A'
  | 'A_MINUS'
  | 'B_PLUS'
  | 'B'
  | 'B_MINUS'
  | 'C';

export interface ReviewVoice {
  id: string;
  provider: string;
  model_id: string;
  lineage: string;
  vendor_family: string | null;
  enabled: boolean;
}

export interface RankedReviewVoice {
  voice: ReviewVoice;
  tier: ReviewModelTier;
  score: number;
  reasons: string[];
}

const MODEL_TIER_OVERRIDES: Record<string, { tier: ReviewModelTier; score: number }> = {
  'gpt-5.5': { tier: 'A_PLUS', score: 1000 },
  'opencode-go/deepseek-v4-pro': { tier: 'A', score: 930 },
  'opencode-go/kimi-k2.6': { tier: 'A_MINUS', score: 880 },
  'opencode-go/glm-5.1': { tier: 'B_PLUS', score: 820 },
  'opencode-go/qwen3.6-plus': { tier: 'B_PLUS', score: 805 },
  'opencode-go/minimax-m2.7': { tier: 'B', score: 760 },
  'opencode-go/deepseek-v4-flash': { tier: 'B_MINUS', score: 690 },
  'gemini-3.5-flash': { tier: 'C', score: 540 },
};

export const REVIEW_MODEL_TIER_RANK: Record<ReviewModelTier, number> = {
  A_PLUS: 6,
  A: 5,
  A_MINUS: 4,
  B_PLUS: 3,
  B: 2,
  B_MINUS: 1,
  C: 0,
};

function normalizeModelId(modelId: string): string {
  return modelId.trim().toLowerCase();
}

function classifyUnknownModel(voice: ReviewVoice): Omit<RankedReviewVoice, 'voice'> {
  const modelId = normalizeModelId(voice.model_id);
  const haystack = [
    modelId,
    voice.provider,
    voice.lineage,
    voice.vendor_family ?? '',
  ].join(' ').toLowerCase();

  if (/\b(gpt|opus|sonnet)\b/.test(haystack) || haystack.includes('reasoning')) {
    return {
      tier: 'A_MINUS',
      score: 860,
      reasons: ['heuristic: frontier or reasoning model name'],
    };
  }

  if (haystack.includes('pro') || haystack.includes('plus') || haystack.includes('deep')) {
    return {
      tier: 'B_PLUS',
      score: 800,
      reasons: ['heuristic: pro, plus, or deep model name'],
    };
  }

  if (haystack.includes('mini') || haystack.includes('small')) {
    return {
      tier: 'B',
      score: 740,
      reasons: ['heuristic: compact model name'],
    };
  }

  if (haystack.includes('flash') || haystack.includes('fast') || haystack.includes('lite')) {
    return {
      tier: 'C',
      score: 540,
      reasons: ['heuristic: speed-optimized model name'],
    };
  }

  return {
    tier: 'B_MINUS',
    score: 660,
    reasons: ['heuristic: unknown model default'],
  };
}

export function rankReviewVoice(voice: ReviewVoice): RankedReviewVoice {
  const override = MODEL_TIER_OVERRIDES[normalizeModelId(voice.model_id)];
  if (override) {
    return {
      voice,
      tier: override.tier,
      score: override.score,
      reasons: ['explicit current-fleet override'],
    };
  }

  return {
    voice,
    ...classifyUnknownModel(voice),
  };
}

export function rankReviewVoices(voices: ReviewVoice[]): RankedReviewVoice[] {
  return voices
    .filter((voice) => voice.enabled)
    .map(rankReviewVoice)
    .sort((left, right) => {
      if (left.score !== right.score) {
        return right.score - left.score;
      }

      const leftKey = `${left.voice.provider}:${left.voice.model_id}`;
      const rightKey = `${right.voice.provider}:${right.voice.model_id}`;
      const keyComparison = leftKey.localeCompare(rightKey);
      if (keyComparison !== 0) {
        return keyComparison;
      }

      return left.voice.id.localeCompare(right.voice.id);
    });
}

export function isReviewModelTierAtLeast(tier: ReviewModelTier, minimum: ReviewModelTier): boolean {
  return REVIEW_MODEL_TIER_RANK[tier] >= REVIEW_MODEL_TIER_RANK[minimum];
}
