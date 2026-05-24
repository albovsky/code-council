"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  CircleHelp,
  Clock,
  Loader2,
} from "lucide-react";
import {
  checkVoiceHealth,
  type CliHealth,
  type CliHealthStatus,
} from "@/lib/api/cli-health";

function formatResetIn(resetAt?: number): string | null {
  if (!resetAt) return null;
  const ms = resetAt - Date.now();
  if (ms <= 0) return "now";
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `in ${hours}h`;
  const days = Math.round(hours / 24);
  return `in ${days}d`;
}

function badgeTone(status: CliHealthStatus): string {
  switch (status) {
    case "healthy":
      return "bg-emerald-500/10 text-emerald-300";
    case "quota_exhausted":
    case "rate_limited":
      return "bg-amber-500/10 text-amber-300";
    case "auth_invalid":
      return "bg-destructive/10 text-destructive";
    case "unknown":
    default:
      return "bg-muted text-muted-foreground";
  }
}

function badgeContent(health: CliHealth, checking: boolean): React.ReactNode {
  if (checking) {
    return (
      <>
        <Loader2 className="h-3 w-3 animate-spin" />
        Checking
      </>
    );
  }

  switch (health.status) {
    case "quota_exhausted":
      return (
        <>
          <Clock className="h-3 w-3" />
          Quota exhausted
          {health.resetAt && (
            <span className="ml-1 text-amber-200/70">
              {formatResetIn(health.resetAt)}
            </span>
          )}
        </>
      );
    case "auth_invalid":
      return (
        <>
          <AlertTriangle className="h-3 w-3" />
          Auth broken
        </>
      );
    case "rate_limited":
      return (
        <>
          <Clock className="h-3 w-3" />
          Rate-limited
        </>
      );
    case "healthy":
      return (
        <>
          <CheckCircle2 className="h-3 w-3" />
          Active
        </>
      );
    case "unknown":
    default:
      return (
        <>
          <CircleHelp className="h-3 w-3" />
          Untested
        </>
      );
  }
}

interface CliHealthBadgeProps {
  voiceId: string;
  initialHealth: CliHealth;
}

export function CliHealthBadge({ voiceId, initialHealth }: CliHealthBadgeProps) {
  const router = useRouter();
  const [health, setHealth] = useState(initialHealth);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canCheck = health.status === "unknown";
  const title =
    error ??
    health.message ??
    (canCheck ? "Run a quick readiness check" : undefined);
  const className = `inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition ${badgeTone(
    checking ? "unknown" : health.status,
  )}`;

  async function handleCheck() {
    if (!canCheck || checking) return;
    setChecking(true);
    setError(null);
    try {
      const result = await checkVoiceHealth(voiceId);
      setHealth(result.health);
      if (!result.ok && result.message) {
        setError(result.message);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Readiness check failed");
    } finally {
      setChecking(false);
    }
  }

  if (!canCheck) {
    return (
      <span className={className} title={title}>
        {badgeContent(health, false)}
      </span>
    );
  }

  return (
    <button
      type="button"
      className={`${className} hover:text-foreground disabled:cursor-wait disabled:opacity-80`}
      title={title}
      onClick={handleCheck}
      disabled={checking}
    >
      {badgeContent(health, checking)}
    </button>
  );
}
