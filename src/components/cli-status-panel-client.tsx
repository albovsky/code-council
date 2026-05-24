"use client";

import { useState } from "react";
import type React from "react";
import { MinusCircle, Plug } from "lucide-react";
import Link from "next/link";
import { CliHealthBadge } from "@/components/cli-health-badge";
import { updateSettings } from "@/lib/api/settings";
import {
  CODE_REVIEW_DISABLED_VOICE_IDS_SETTING_KEY,
  readDisabledCodeReviewVoiceIds,
  writeDisabledCodeReviewVoiceIds,
} from "@/lib/code-review-agent-selection";
import type { CliHealth } from "@/lib/api/cli-health";
import type { Settings } from "@/lib/types";
import type { ReviewModelTier } from "@/lib/review-model-tiering";

interface FleetVoice {
  id: string;
  modelId: string;
  modelName: string;
  providerName: string;
  logo: {
    src?: string;
    label: string;
    className: string;
    imageClassName?: string;
  };
  tier: ReviewModelTier;
  health: CliHealth;
}

interface CliStatusPanelClientProps {
  voices: FleetVoice[];
  initialDisabledVoiceIds: string[];
}

function tierLabel(tier: ReviewModelTier): string {
  switch (tier) {
    case "A_PLUS":
      return "A+";
    case "A_MINUS":
      return "A-";
    case "B_PLUS":
      return "B+";
    case "B_MINUS":
      return "B-";
    default:
      return tier;
  }
}

function tierBadge(tier: ReviewModelTier, disabled: boolean): React.ReactNode {
  const tone = disabled
    ? "border-zinc-500/20 bg-zinc-800/70 text-zinc-500"
    : tier.startsWith("A")
      ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-300"
      : tier.startsWith("B")
        ? "border-sky-400/25 bg-sky-500/10 text-sky-300"
        : "border-zinc-400/20 bg-muted text-muted-foreground";

  return (
    <span className={`inline-flex min-w-16 items-center justify-center rounded-full border px-2 py-0.5 text-[10px] font-semibold transition-colors duration-200 ease-out ${tone}`}>
      Tier {tierLabel(tier)}
    </span>
  );
}

function disabledBadge(): React.ReactNode {
  return (
    <span className="inline-flex min-w-20 items-center justify-center gap-1 rounded-full bg-zinc-800/80 px-2 py-0.5 text-[10px] font-medium text-zinc-500 transition-colors duration-200 ease-out">
      <MinusCircle className="h-3 w-3" />
      Disabled
    </span>
  );
}

function readDisabledSet(): Set<string> {
  return new Set(readDisabledCodeReviewVoiceIds());
}

function persistDisabledVoiceIdsToDaemon(voiceIds: string[]): void {
  void updateSettings({
    [CODE_REVIEW_DISABLED_VOICE_IDS_SETTING_KEY]: voiceIds,
  } as Partial<Settings>).catch(() => {
    /* local state stays authoritative for this page if daemon write fails */
  });
}

export function CliStatusPanelClient({
  voices,
  initialDisabledVoiceIds,
}: CliStatusPanelClientProps) {
  const [disabledVoiceIds, setDisabledVoiceIds] = useState<Set<string>>(
    () => new Set(initialDisabledVoiceIds.length > 0 ? initialDisabledVoiceIds : readDisabledSet()),
  );

  function persist(next: Set<string>) {
    const voiceIds = [...next].sort();
    writeDisabledCodeReviewVoiceIds(voiceIds);
    persistDisabledVoiceIdsToDaemon(voiceIds);
    setDisabledVoiceIds(next);
  }

  function toggleVoice(voiceId: string) {
    const next = new Set(disabledVoiceIds);
    if (next.has(voiceId)) {
      next.delete(voiceId);
    } else {
      next.add(voiceId);
    }
    persist(next);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>, voiceId: string) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    toggleVoice(voiceId);
  }

  return (
    <section className="mt-10">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Reviewer fleet
        </h2>
        <Link
          href="/connect"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground transition hover:text-foreground"
        >
          <Plug className="h-3 w-3" />
          Manage connections →
        </Link>
      </div>
      <div className="grid grid-cols-1 items-start gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {voices.map((voice) => {
          const disabled = disabledVoiceIds.has(voice.id);
          return (
            <div
              key={voice.id}
              role="button"
              tabIndex={0}
              aria-pressed={!disabled}
              aria-label={disabled ? `Include ${voice.modelName} in code review` : `Disable ${voice.modelName} for code review`}
              onClick={() => toggleVoice(voice.id)}
              onKeyDown={(event) => handleKeyDown(event, voice.id)}
              className={`flex cursor-pointer items-center justify-between gap-3 rounded-lg border p-3 shadow-sm transition-[background-color,border-color,filter] duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 ${
                disabled
                  ? "border-zinc-800 bg-card brightness-50 saturate-75 hover:border-zinc-700"
                  : "border-border bg-card brightness-100 saturate-100 hover:border-foreground/20"
              }`}
            >
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <span className={voice.logo.className} title={`${voice.logo.label} logo`}>
                  {voice.logo.src ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={voice.logo.src}
                      alt={`${voice.logo.label} logo`}
                      className={voice.logo.imageClassName ?? "h-full w-full object-contain"}
                    />
                  ) : (
                    voice.logo.label
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-foreground" title={voice.modelId}>
                    {voice.modelName}
                  </div>
                  <div className="mt-0.5 text-[10px] font-medium text-muted-foreground">
                    via {voice.providerName}
                  </div>
                </div>
              </div>
              <div className="flex w-24 shrink-0 flex-col items-end gap-1">
                {tierBadge(voice.tier, disabled)}
                {disabled ? (
                  disabledBadge()
                ) : (
                  <span className="inline-flex min-w-20 justify-end" onClick={(event) => event.stopPropagation()}>
                    <CliHealthBadge voiceId={voice.id} initialHealth={voice.health} />
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
