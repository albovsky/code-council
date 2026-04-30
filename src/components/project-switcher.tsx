"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronsUpDown, Plus, FolderKanban, Check } from "lucide-react";
import { PROJECTS, type Project } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

interface ProjectSwitcherProps {
  activeProjectId: string | null;
}

export function ProjectSwitcher({ activeProjectId }: ProjectSwitcherProps) {
  const [open, setOpen] = useState(false);
  const active: Project | undefined =
    PROJECTS.find((p) => p.id === activeProjectId) ?? PROJECTS[0];

  return (
    <div className="relative px-2 pt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex h-9 w-full items-center gap-2 rounded-md border border-border bg-card px-2 text-sm transition",
          open
            ? "border-muted-foreground/30 bg-accent"
            : "hover:border-muted-foreground/20 hover:bg-accent/50",
        )}
      >
        <span aria-hidden className="text-base leading-none">
          {active.emoji}
        </span>
        <span className="flex-1 truncate text-left font-medium">
          {active.name}
        </span>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div
            className="absolute left-2 right-2 top-full z-50 mt-1 overflow-hidden rounded-md border border-border bg-popover p-1 shadow-2xl"
          >
            <div className="px-2 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Switch project
            </div>
            <ul className="flex flex-col gap-0.5">
              {PROJECTS.map((p) => {
                const isActive = p.id === active.id;
                return (
                  <li key={p.id}>
                    <Link
                      href={`/projects/${p.id}`}
                      onClick={() => setOpen(false)}
                      className={cn(
                        "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                        isActive
                          ? "bg-accent text-foreground"
                          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                      )}
                    >
                      <span aria-hidden className="text-base leading-none">
                        {p.emoji}
                      </span>
                      <span className="flex-1 truncate">{p.name}</span>
                      {p.activeRuns > 0 && !isActive && (
                        <span
                          className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse-soft"
                          title={`${p.activeRuns} active`}
                        />
                      )}
                      {isActive && (
                        <Check className="h-3.5 w-3.5 text-primary" />
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
            <div className="my-1 border-t border-border" />
            <Link
              href="/projects"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition hover:bg-accent/50 hover:text-foreground"
            >
              <FolderKanban className="h-3.5 w-3.5" />
              View all projects
            </Link>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition hover:bg-accent/50 hover:text-foreground"
            >
              <Plus className="h-3.5 w-3.5" />
              New project
            </button>
          </div>
        </>
      )}
    </div>
  );
}
