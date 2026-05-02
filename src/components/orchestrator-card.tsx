"use client";

import { useState } from "react";
import {
  Check,
  Loader2,
  Plug,
  AlertTriangle,
  ChevronDown,
} from "lucide-react";
import {
  connectOrchestrator,
  type OrchestratorStatus,
  type OrchestratorName,
  DaemonError,
} from "@/lib/api";
import { updateVoice, type Voice } from "@/lib/api/voices";
import { cn } from "@/lib/utils";

/**
 * One unified card per CLI on the /connect page. Combines:
 *   1. MCP wiring status + Connect button (the original OrchestratorCard
 *      content — this is what tells the user "chorus is reachable from
 *      Claude Code").
 *   2. Inline-expandable voice picker. Lists already-enabled voices on
 *      the collapsed card; click to expand the checkbox grid; toggles
 *      save immediately via PUT /voices/:id.
 *
 * Data source: voices table. The daemon's seed populates these on boot
 * (Phase 1 sync for single-model CLIs; Phase 2 background warmup for
 * opencode multi-model). OpenCode voices are grouped by their
 * model_id's gateway prefix in this card's UI.
 */
interface Props {
  initial: OrchestratorStatus;
  /** Voices for this orchestrator's provider — both enabled and disabled. */
  voices: Voice[];
}

const ORCHESTRATOR_TO_PROVIDER: Record<string, string> = {
  claude: "claude-code",
  codex: "codex-cli",
  gemini: "gemini-cli",
  opencode: "opencode-cli",
  kimi: "kimi-cli",
};

export function OrchestratorCard({ initial, voices: initialVoices }: Props) {
  const [status, setStatus] = useState<OrchestratorStatus>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justConnected, setJustConnected] = useState(false);

  // Per-CLI voice picker state.
  const provider = ORCHESTRATOR_TO_PROVIDER[initial.name];
  const [voices, setVoices] = useState<Voice[]>(initialVoices);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const supportsModels = !!provider && voices.length > 0;
  const enabledCount = voices.filter((v) => v.enabled).length;
  const enabledLabels = voices.filter((v) => v.enabled).map((v) => v.model_id);

  const isOpencode = provider === "opencode-cli";

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await connectOrchestrator(status.name as OrchestratorName);
      setStatus(result.status);
      setJustConnected(result.added.length > 0);
    } catch (err) {
      setError(
        err instanceof DaemonError
          ? err.message
          : "Failed to connect — is the daemon running?",
      );
    } finally {
      setBusy(false);
    }
  };

  const toggleVoice = async (v: Voice) => {
    setSaving(v.id);
    setSaveError(null);
    try {
      const next = await updateVoice(v.id, { enabled: !v.enabled });
      setVoices((prev) => prev.map((p) => (p.id === next.id ? next : p)));
    } catch (err) {
      setSaveError(
        err instanceof DaemonError ? err.message : "Couldn't save. Is the daemon running?",
      );
    } finally {
      setSaving(null);
    }
  };

  const isConnected = status.connected;
  const partial = status.approvedTools > 0 && !isConnected;

  // Group OpenCode voices by gateway prefix in model_id.
  const opencodeGroups = new Map<string, Voice[]>();
  if (isOpencode) {
    for (const v of voices) {
      const slash = v.model_id.indexOf("/");
      const gw = slash > 0 ? v.model_id.slice(0, slash) : "other";
      const list = opencodeGroups.get(gw) ?? [];
      list.push(v);
      opencodeGroups.set(gw, list);
    }
  }
  const sortedGateways = Array.from(opencodeGroups.keys()).sort();

  return (
    <div className="rounded-lg border border-border bg-gradient-to-br from-primary/5 via-card to-card">
      <div className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold">{status.label}</h3>
              {isConnected ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                  <Check className="h-3 w-3" /> Connected
                </span>
              ) : partial ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-300">
                  {status.approvedTools}/{status.totalTools} tools approved
                </span>
              ) : status.supported ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                  Not connected
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                  Coming soon
                </span>
              )}
              {supportsModels && (
                <span className="text-[10px] text-muted-foreground">
                  · {enabledCount} model{enabledCount === 1 ? "" : "s"} enabled
                </span>
              )}
            </div>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {status.note}
            </p>
            {supportsModels && enabledCount > 0 && (
              <p className="mt-2 truncate font-mono text-[11px] text-foreground/80" title={enabledLabels.join(", ")}>
                {enabledLabels.slice(0, 3).join(", ")}
                {enabledLabels.length > 3 && ` +${enabledLabels.length - 3} more`}
              </p>
            )}
            {isConnected && status.firstCallBehavior === "prompts_once" && (
              <p className="mt-2 text-[11px] text-amber-300/90">
                ⚠ First chorus.* call will show a one-time prompt — click &quot;Always allow&quot;.
              </p>
            )}
            {isConnected && status.firstCallBehavior === "inherits_global" && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                Whether tool calls prompt depends on your existing approval-policy setting.
              </p>
            )}
          </div>
        </div>

        {status.supported && (
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            {justConnected && !error && (
              <p className="text-xs text-emerald-400">
                ✓ Done. Restart {status.label} for the change to take effect.
              </p>
            )}
            {error && (
              <p className="flex items-start gap-1 text-xs text-destructive">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {error}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
              {supportsModels && (
                <button
                  type="button"
                  onClick={() => setOpen((v) => !v)}
                  className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-xs font-medium text-foreground transition hover:border-muted-foreground/30"
                >
                  Manage models
                  <ChevronDown
                    className={cn(
                      "h-3 w-3 transition-transform",
                      open && "rotate-180",
                    )}
                  />
                </button>
              )}
              <button
                type="button"
                onClick={connect}
                disabled={busy || (isConnected && !partial)}
                className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plug className="h-4 w-4" />
                )}
                {isConnected
                  ? "Already connected"
                  : partial
                    ? "Approve remaining tools"
                    : `Connect ${status.label}`}
              </button>
            </div>
          </div>
        )}
      </div>

      {open && supportsModels && (
        <div className="space-y-3 border-t border-border bg-card/50 p-4 sm:p-5">
          {saveError && <p className="text-[11px] text-destructive">{saveError}</p>}

          {isOpencode ? (
            <>
              {sortedGateways.map((gateway) => {
                const list = opencodeGroups.get(gateway) ?? [];
                return (
                  <div key={gateway} className="space-y-1">
                    <p className="text-[11px] font-mono text-muted-foreground/80">
                      {gateway}/
                    </p>
                    <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                      {list.map((v) => (
                        <ModelToggle
                          key={v.id}
                          label={v.model_id.slice(gateway.length + 1)}
                          value={v.model_id}
                          selected={v.enabled}
                          disabled={saving === v.id}
                          onClick={() => toggleVoice(v)}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </>
          ) : (
            <div className="grid grid-cols-1 gap-1">
              {voices.map((v) => (
                <ModelToggle
                  key={v.id}
                  label={v.model_id}
                  value={v.model_id}
                  selected={v.enabled}
                  disabled={saving === v.id}
                  onClick={() => toggleVoice(v)}
                />
              ))}
            </div>
          )}

          <p className="text-[11px] leading-relaxed text-muted-foreground/70">
            Toggles save automatically. Templates and the New Chat dialog only offer
            models you&apos;ve enabled here.
          </p>
        </div>
      )}
    </div>
  );
}

interface ModelToggleProps {
  label: string;
  value: string;
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
}

function ModelToggle({ label, value, selected, disabled, onClick }: ModelToggleProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={value}
      className={cn(
        "flex items-center gap-2 rounded border px-2 py-1.5 text-left text-[11px] transition disabled:opacity-60",
        selected
          ? "border-primary/50 bg-primary/10 text-foreground"
          : "border-border bg-card hover:border-muted-foreground/30 text-muted-foreground",
      )}
    >
      <div
        className={cn(
          "grid h-3 w-3 shrink-0 place-items-center rounded-sm border transition",
          selected
            ? "border-primary bg-primary text-primary-foreground"
            : "border-border",
        )}
      >
        {selected && <Check className="h-2 w-2" />}
      </div>
      <span className="truncate font-mono">{label}</span>
    </button>
  );
}
