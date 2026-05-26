import {
  AlertTriangle,
  CheckCircle2,
  CircleMinus,
  CircleSlash2,
  Loader2,
  RotateCw,
  XCircle,
} from "lucide-react";
import type { ParticipantState } from "./types";

/**
 * Small status chip rendered in the top-right of every ParticipantCard.
 * Mirrors the card-level border colour but with crisp text + icon, so the
 * grid is scannable at a glance even when the user is staring at the
 * stream area in the middle.
 */
export function StateBadge({
  state,
  onRetry,
  retrying = false,
}: {
  state: ParticipantState;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  switch (state) {
    case "done":
      return (
        <span className="flex items-center gap-1 rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400">
          <CheckCircle2 className="h-3 w-3" /> DONE
        </span>
      );
    case "errored":
      if (onRetry) {
        return (
          <button
            type="button"
            disabled={retrying}
            onClick={onRetry}
            className="group flex min-w-[82px] items-center justify-center gap-1 rounded-md bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive transition-colors hover:bg-destructive/15 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-70"
            title="Try this run again"
            aria-label="Try this run again"
          >
            {retrying ? (
              <>
                <RotateCw className="h-3 w-3 animate-spin" /> RETRYING
              </>
            ) : (
              <>
                <span className="flex items-center gap-1 group-hover:hidden group-focus-visible:hidden">
                  <AlertTriangle className="h-3 w-3" /> FAILED
                </span>
                <span className="hidden items-center gap-1 group-hover:flex group-focus-visible:flex">
                  <RotateCw className="h-3 w-3" /> TRY AGAIN
                </span>
              </>
            )}
          </button>
        );
      }
      return (
        <span className="flex items-center gap-1 rounded-md bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive">
          <AlertTriangle className="h-3 w-3" /> FAILED
        </span>
      );
    case "cancelled":
      return (
        <span className="flex items-center gap-1 rounded-md bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          <XCircle className="h-3 w-3" /> CANCELLED
        </span>
      );
    case "working":
      return (
        <span className="flex items-center gap-1 rounded-md bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> WORKING
        </span>
      );
    case "skipped":
      return (
        <span className="flex items-center gap-1 rounded-md bg-muted/50 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          <CircleSlash2 className="h-3 w-3" /> SKIPPED
        </span>
      );
    case "not_run":
      return (
        <span className="flex items-center gap-1 rounded-md bg-muted/50 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          <CircleMinus className="h-3 w-3" /> NOT RUN
        </span>
      );
    case "pending":
      return (
        <span className="flex items-center gap-1 rounded-md bg-muted/40 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground/80">
          QUEUED
        </span>
      );
    default:
      return (
        <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          IDLE
        </span>
      );
  }
}
