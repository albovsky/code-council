"use client";

import { Check, Loader2 } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import type {
  CliDetection,
  DetectableCliId,
} from "@/lib/api/settings";
import type { OpencodeModelsResult } from "@/lib/api/orchestrators";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UI_LINEAGE_BRAND, type UILineage } from "@/lib/lineage-maps";
import { cn } from "@/lib/utils";
import { CLIS, manualBinaryName } from "./helpers";

/**
 * CLI subscription cards on the onboarding page. Mirrors /connect's
 * gradient-card aesthetic so the two pages feel like the same product.
 *
 * Layout rules:
 *   - 2-column grid on lg+; single column below.
 *   - Each card is a fixed h-72 slot — keeps row alignment when one
 *     card has a model picker and another doesn't.
 *   - Only the 5 CLI subscriptions show here. Cursor + Windsurf are
 *     IDEs (no voices) and live on /connect.
 *   - Detected CLIs render in their lineage's brand colour, expanded
 *     with model picker inline. Not-detected CLIs render in muted grey
 *     with the "Set path manually" link only.
 */

const CLI_TO_UI_LINEAGE: Record<string, UILineage> = {
  "claude-code": "claude",
  "codex-cli": "codex",
  "gemini-cli": "gemini",
  "opencode-cli": "opencode",
  "kimi-cli": "kimi",
};

const NEUTRAL_BRAND = {
  dot: "bg-muted-foreground/40",
  gradient: "bg-gradient-to-br from-muted/30 via-card to-card",
} as const;

interface CliSectionProps {
  selectedClis: Set<string>;
  toggleCli: (id: string) => void;
  detection: Record<string, CliDetection>;
  manualOpen: Set<string>;
  toggleManual: (id: string) => void;
  manualPath: Record<string, string>;
  setManualPath: Dispatch<SetStateAction<Record<string, string>>>;
  manualError: Record<string, string>;
  manualBusy: Set<string>;
  submitManualPath: (id: DetectableCliId) => void;

  opencodeModels: OpencodeModelsResult | null;
  opencodeModelsError: string | null;
  opencodeModelsLoading: boolean;
  selectedOpencodeModels: Set<string>;
  toggleOpencodeModel: (m: string) => void;
}

// Onboarding only lists actual CLI subscriptions. IDEs (Cursor/Windsurf)
// belong on /connect — they invoke chorus but don't act as voices.
const ONBOARDING_CLIS = CLIS.filter(
  (c) => c.id !== "cursor" && c.id !== "windsurf",
);

export function CliSection(props: CliSectionProps) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        CLI subscriptions
      </h2>
      <div className="grid grid-cols-1 items-start gap-2 lg:grid-cols-2">
        {ONBOARDING_CLIS.map((cli) => {
          const checked = props.selectedClis.has(cli.id);
          const probe = props.detection[cli.id];
          const found = probe?.found === true;
          const showManual = !found && props.manualOpen.has(cli.id);
          const isBusy = props.manualBusy.has(cli.id);
          const brand = found
            ? (UI_LINEAGE_BRAND[CLI_TO_UI_LINEAGE[cli.id]] ?? NEUTRAL_BRAND)
            : NEUTRAL_BRAND;

          return (
            <div
              key={cli.id}
              className={cn(
                "flex h-72 flex-col rounded-lg border transition",
                found
                  ? "border-border"
                  : "border-border/60 opacity-70",
                brand.gradient,
              )}
            >
              {/* Header — checkbox + label + status badge */}
              <button
                type="button"
                onClick={() => found && props.toggleCli(cli.id)}
                disabled={!found}
                className={cn(
                  "flex shrink-0 items-center gap-3 px-4 py-3 text-left transition",
                  found
                    ? "hover:bg-card/30"
                    : "cursor-not-allowed",
                )}
              >
                <div
                  className={cn(
                    "grid h-5 w-5 shrink-0 place-items-center rounded border transition",
                    !found && "opacity-50",
                    checked
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border",
                  )}
                >
                  {checked && <Check className="h-3 w-3" />}
                </div>
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <span
                    className={cn("h-2 w-2 shrink-0 rounded-full", brand.dot)}
                  />
                  <h3 className="whitespace-nowrap text-sm font-semibold">
                    {cli.label}
                  </h3>
                  {found ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-emerald-300">
                      <Check className="h-3 w-3" /> Installed
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-full border border-border bg-card px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                      Not found
                    </span>
                  )}
                </div>
              </button>

              {/* Body — fills the rest of the card */}
              <div className="flex flex-1 flex-col gap-2 overflow-y-auto border-t border-border bg-card/30 p-4">
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {found && probe.path ? (
                    <code className="rounded bg-muted/60 px-1.5 py-0.5 font-mono">
                      {probe.path}
                    </code>
                  ) : (
                    cli.hint
                  )}
                </p>

                {!found && (
                  <div className="space-y-2">
                    <button
                      type="button"
                      onClick={() => props.toggleManual(cli.id)}
                      className="text-[11px] text-muted-foreground transition hover:text-foreground"
                    >
                      {showManual
                        ? "Cancel"
                        : "Don't see it? Set path manually →"}
                    </button>
                    {showManual && (
                      <ManualPath
                        cliId={cli.id}
                        value={props.manualPath[cli.id] ?? ""}
                        onChange={(v) =>
                          props.setManualPath((prev) => ({
                            ...prev,
                            [cli.id]: v,
                          }))
                        }
                        error={props.manualError[cli.id]}
                        busy={isBusy}
                        onSubmit={() =>
                          props.submitManualPath(cli.id as DetectableCliId)
                        }
                      />
                    )}
                  </div>
                )}

                {found && cli.id === "opencode-cli" && checked && (
                  <OpencodeInline
                    loading={props.opencodeModelsLoading}
                    error={props.opencodeModelsError}
                    models={props.opencodeModels}
                    selected={props.selectedOpencodeModels}
                    onToggle={props.toggleOpencodeModel}
                  />
                )}

                {found &&
                  cli.id !== "opencode-cli" &&
                  checked && (
                    <p className="text-[11px] italic text-muted-foreground/80">
                      Default model auto-enabled.
                    </p>
                  )}
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-[11px] text-muted-foreground">
        Cursor and Windsurf are IDEs that invoke chorus, not voices —
        wire them up on the Connect page after onboarding.
      </p>
    </section>
  );
}

/**
 * Inline OpenCode model picker. Lives inside the card body (no extra
 * outer container) so widths align with the parent card.
 */
interface OpencodeInlineProps {
  loading: boolean;
  error: string | null;
  models: OpencodeModelsResult | null;
  selected: Set<string>;
  onToggle: (m: string) => void;
}

function OpencodeInline({
  loading,
  error,
  models,
  selected,
  onToggle,
}: OpencodeInlineProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Pick models to enable
        </p>
        <p className="text-[11px] text-muted-foreground/70">
          {selected.size} selected
        </p>
      </div>

      {loading && (
        <p className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Listing models from{" "}
          <code className="rounded bg-muted px-1">opencode models</code>…
        </p>
      )}

      {error && <p className="text-[11px] text-destructive">{error}</p>}

      {models && (
        <div className="space-y-2">
          {Object.entries(models.gateways)
            .filter(([gw]) => gw.startsWith("opencode"))
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([gateway, list]) => (
              <div key={gateway} className="space-y-1">
                <p className="text-[10px] font-mono text-muted-foreground/80">
                  {gateway}/
                </p>
                <div className="grid grid-cols-1 gap-1">
                  {list.map((m) => {
                    const sel = selected.has(m);
                    return (
                      <button
                        key={m}
                        type="button"
                        onClick={() => onToggle(m)}
                        title={m}
                        className={cn(
                          "flex items-center gap-2 rounded border px-2 py-1.5 text-left text-[11px] transition",
                          sel
                            ? "border-primary/50 bg-primary/10 text-foreground"
                            : "border-border bg-card text-muted-foreground hover:border-muted-foreground/30",
                        )}
                      >
                        <div
                          className={cn(
                            "grid h-3 w-3 shrink-0 place-items-center rounded-sm border transition",
                            sel
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border",
                          )}
                        >
                          {sel && <Check className="h-2 w-2" />}
                        </div>
                        <span className="truncate font-mono">
                          {m.slice(gateway.length + 1)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          <p className="text-[11px] leading-relaxed text-muted-foreground/70">
            Pre-selected: {models.defaultPicks.join(", ") || "none"}. Change
            anytime in <code className="rounded bg-muted px-1">Settings</code>.
          </p>
        </div>
      )}
    </div>
  );
}

function ManualPath({
  cliId,
  value,
  onChange,
  error,
  busy,
  onSubmit,
}: {
  cliId: string;
  value: string;
  onChange: (v: string) => void;
  error: string | undefined;
  busy: boolean;
  onSubmit: () => void;
}) {
  const bin = manualBinaryName(cliId);
  return (
    <div className="space-y-2 rounded-md border border-border bg-card/50 p-3">
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Paste the full path to the{" "}
        <code className="rounded bg-muted px-1">{bin}</code> binary. Run{" "}
        <code className="rounded bg-muted px-1">which {bin}</code> (macOS /
        Linux) or <code className="rounded bg-muted px-1">where {bin}</code>{" "}
        (Windows) to find it.
      </p>
      <div className="flex gap-2">
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="/usr/local/bin/claude"
          className="flex-1 font-mono text-xs"
          spellCheck={false}
          autoComplete="off"
        />
        <Button
          type="button"
          variant="secondary"
          disabled={busy}
          onClick={onSubmit}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Verify"}
        </Button>
      </div>
      {error && <p className="text-[11px] text-destructive">{error}</p>}
    </div>
  );
}
