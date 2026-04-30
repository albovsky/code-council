"use client";

import { Sparkles, ChevronDown } from "lucide-react";
import type { SynthesizedAnswer } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

interface SynthesisCardProps {
  synthesis: SynthesizedAnswer;
  /** True when all reviewers are done — controls fade-in. */
  visible: boolean;
}

const VERDICT: Record<
  SynthesizedAnswer["verdict"],
  { label: string; ring: string; bg: string; text: string }
> = {
  agree: {
    label: "All agree",
    ring: "ring-emerald-500/30",
    bg: "bg-emerald-500/10",
    text: "text-emerald-400",
  },
  partial: {
    label: "Partial agreement",
    ring: "ring-amber-500/30",
    bg: "bg-amber-500/10",
    text: "text-amber-400",
  },
  disagree: {
    label: "Disagreement",
    ring: "ring-red-500/30",
    bg: "bg-red-500/10",
    text: "text-red-400",
  },
};

const SEVERITY: Record<string, string> = {
  critical: "bg-red-500/15 text-red-300 ring-1 ring-inset ring-red-500/30",
  high: "bg-orange-500/15 text-orange-300 ring-1 ring-inset ring-orange-500/30",
  medium: "bg-amber-500/15 text-amber-300 ring-1 ring-inset ring-amber-500/30",
  low: "bg-muted text-muted-foreground ring-1 ring-inset ring-border",
};

export function SynthesisCard({ synthesis, visible }: SynthesisCardProps) {
  const v = VERDICT[synthesis.verdict];

  return (
    <section
      aria-label="Synthesis"
      className={cn(
        "mb-6 overflow-hidden rounded-xl border border-border bg-card transition-all duration-500",
        visible
          ? "max-h-[800px] translate-y-0 opacity-100"
          : "pointer-events-none max-h-0 -translate-y-2 border-transparent opacity-0",
      )}
    >
      {/* Top stripe */}
      <div className="flex items-center gap-3 border-b border-border bg-card/60 px-5 py-3">
        <div className="grid h-7 w-7 place-items-center rounded-md bg-primary/15 text-primary ring-1 ring-primary/20">
          <Sparkles className="h-3.5 w-3.5" />
        </div>
        <div className="flex-1">
          <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Synthesis
          </div>
          <div className="text-[11px] text-muted-foreground/80">
            Lineage-weighted quorum across {3} reviewers
          </div>
        </div>
        <span
          className={cn(
            "flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium ring-1 ring-inset",
            v.bg,
            v.text,
            v.ring,
          )}
        >
          {v.label}
        </span>
      </div>

      {/* Body */}
      <div className="px-5 py-5">
        <h2 className="text-base font-semibold leading-snug tracking-tight text-foreground">
          {synthesis.headline}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {synthesis.summary}
        </p>

        <div className="mt-5">
          <div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Findings ({synthesis.findings.length})
          </div>
          <ul className="space-y-2">
            {synthesis.findings.map((f, i) => (
              <li
                key={i}
                className="flex items-start gap-3 rounded-md border border-border bg-card/40 px-3 py-2.5"
              >
                <span
                  className={cn(
                    "mt-0.5 inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-none tracking-wide",
                    SEVERITY[f.severity],
                  )}
                >
                  {f.severity}
                </span>
                <div className="flex-1">
                  <p className="text-sm leading-snug text-foreground/95">
                    {f.text}
                  </p>
                  <div className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                    <span>Agreed by</span>
                    {f.agreedBy.map((a) => (
                      <span
                        key={a}
                        className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]"
                      >
                        {a}
                      </span>
                    ))}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-5 rounded-md border border-primary/30 bg-primary/5 px-4 py-3">
          <div className="text-[10px] font-medium uppercase tracking-wider text-primary/80">
            Recommendation
          </div>
          <p className="mt-1 text-sm leading-relaxed text-foreground/90">
            {synthesis.recommendation}
          </p>
        </div>
      </div>

      {/* Foot — points down to per-reviewer cards */}
      <div className="flex items-center justify-center gap-1.5 border-t border-border bg-card/40 px-5 py-2 text-[11px] text-muted-foreground">
        <ChevronDown className="h-3 w-3" />
        Per-reviewer details below
      </div>
    </section>
  );
}
