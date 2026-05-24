/**
 * Compact "fleet status" panel for the home page.
 *
 * Shows each connected CLI plus its current health (recorded by the runner
 * when error-detector fires). Tells the user at a glance:
 *   - which CLIs are wired up
 *   - which ones are quota-exhausted (and when they reset)
 *   - which ones are auth-broken
 *
 * Server component. Fetches voices plus /cli/health and merges them.
 * Voice loading controls rendering; health loading is best-effort.
 */

import { fetchFromDaemon } from "@/lib/api/client";
import { cookies } from "next/headers";
import type { ListEnvelope, Settings } from "@/lib/types";
import type { Voice } from "@/lib/api/voices";
import type { CliHealth } from "@/lib/api/cli-health";
import { CliStatusPanelClient } from "@/components/cli-status-panel-client";
import { rankReviewVoices } from "@/lib/review-model-tiering";
import {
  displayModelName,
  modelLogoForVoice,
  providerLabelForVoice,
} from "@/lib/model-display";
import {
  CODE_REVIEW_DISABLED_VOICE_IDS_SETTING_KEY,
  CODE_REVIEW_DISABLED_VOICE_IDS_COOKIE_NAME,
  parseDisabledCodeReviewVoiceIds,
} from "@/lib/code-review-agent-selection";

export async function CliStatusPanel() {
  let healths: CliHealth[] = [];
  let allVoices: Voice[] = [];
  let openrouterVoices: Voice[] = [];
  const cookieStore = await cookies();
  let initialDisabledVoiceIds = parseDisabledCodeReviewVoiceIds(
    cookieStore.get(CODE_REVIEW_DISABLED_VOICE_IDS_COOKIE_NAME)?.value ?? null,
  );
  try {
    const settings = await fetchFromDaemon<Settings>("/settings");
    const disabledFromSettings =
      settings[CODE_REVIEW_DISABLED_VOICE_IDS_SETTING_KEY];
    if (Array.isArray(disabledFromSettings)) {
      initialDisabledVoiceIds = disabledFromSettings.filter(
        (item): item is string => typeof item === "string",
      );
    }
  } catch {
    /* settings load is best-effort; cookie/local fallback still works */
  }
  try {
    const env = await fetchFromDaemon<ListEnvelope<CliHealth>>("/cli/health");
    healths = env.items;
  } catch {
    healths = [];
  }
  try {
    // Default GET /voices returns ALL rows (enabled + disabled)
    const env = await fetchFromDaemon<ListEnvelope<Voice>>("/voices?source=cli");
    allVoices = env.items;
  } catch {
    /* voices load is best-effort */
  }
  try {
    const env = await fetchFromDaemon<ListEnvelope<Voice>>(
      "/voices?source=api&provider=openrouter",
    );
    openrouterVoices = env.items;
  } catch {
    /* best-effort */
  }

  const healthByLineage: Record<string, CliHealth> = {};
  for (const h of healths) healthByLineage[h.lineage] = h;

  // Filter and collect all enabled models across active CLI and API connections
  const enabledVoices = rankReviewVoices([
    ...allVoices.filter((v) => v.enabled),
    ...openrouterVoices.filter((v) => v.enabled),
  ]);

  if (enabledVoices.length === 0) return null;

  return (
    <CliStatusPanelClient
      initialDisabledVoiceIds={initialDisabledVoiceIds}
      voices={enabledVoices.map((ranked) => {
        const v = ranked.voice;
        const healthKey = v.provider === "openrouter" ? "openrouter" : v.lineage;
        const health = healthByLineage[healthKey] ?? {
          lineage: healthKey,
          status: "unknown" as const,
          updatedAt: 0,
        };

        return {
          id: v.id,
          modelId: v.model_id,
          modelName: displayModelName(v.model_id),
          providerName: providerLabelForVoice(v),
          logo: modelLogoForVoice(v),
          tier: ranked.tier,
          health,
        };
      })}
    />
  );
}
