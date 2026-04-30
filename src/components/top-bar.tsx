"use client";

import { Plus, Search, Command } from "lucide-react";
import Link from "next/link";

export function TopBar() {
  return (
    <header className="flex h-14 items-center gap-3 border-b border-border bg-background/60 px-6 backdrop-blur">
      <div className="flex flex-1 items-center gap-2">
        <button
          type="button"
          className="flex h-9 w-full max-w-sm items-center gap-2 overflow-hidden rounded-md border border-border bg-card px-3 text-sm text-muted-foreground transition hover:border-muted-foreground/40 hover:text-foreground"
        >
          <Search className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate whitespace-nowrap">Search…</span>
          <kbd className="ml-auto flex shrink-0 items-center gap-0.5 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">
            <Command className="h-3 w-3" />K
          </kbd>
        </button>
      </div>

      <Link
        href="/new"
        className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
      >
        <Plus className="h-4 w-4" />
        New chat
      </Link>
    </header>
  );
}
