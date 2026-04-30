import Link from "next/link";
import { Plus, FolderPlus, ArrowRight } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { PROJECTS } from "@/lib/mock-data";

export default function ProjectsIndexPage() {
  const isEmpty = PROJECTS.length === 0;

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-6xl px-8 py-10">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              Projects
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">
              All projects
            </h1>
          </div>
          <Link
            href="/onboarding"
            className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            New project
          </Link>
        </div>

        {isEmpty ? (
          <Card className="border-dashed bg-card/30 p-10 text-center">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-md bg-primary/10 text-primary">
              <FolderPlus className="h-6 w-6" />
            </span>
            <h2 className="mt-4 text-base font-semibold text-foreground">
              No projects yet
            </h2>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              A project points at a codebase — a local folder, a git repo, or a
              sandbox dir. Reviewers read from it; the driver writes into it.
              Create your first project to get started.
            </p>
            <Link
              href="/onboarding"
              className="mt-5 inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
            >
              Start onboarding
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {PROJECTS.map((p) => (
              <Link
                key={p.id}
                href={`/projects/${p.id}`}
                className="group flex flex-col rounded-lg border border-border bg-card p-5 transition hover:border-muted-foreground/30"
              >
                <div className="flex items-center gap-3">
                  <span aria-hidden className="text-2xl leading-none">
                    {p.emoji}
                  </span>
                  <div className="flex-1">
                    <div className="text-sm font-semibold">{p.name}</div>
                    <div className="text-xs text-muted-foreground line-clamp-1">
                      {p.description}
                    </div>
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
                  <span>{p.taskCount} tasks</span>
                  {p.activeRuns > 0 ? (
                    <span className="flex items-center gap-1 text-primary">
                      <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse-soft" />
                      {p.activeRuns} active
                    </span>
                  ) : (
                    <span>{p.lastActivity}</span>
                  )}
                </div>
              </Link>
            ))}

            {/* Always-present "Add project" tile */}
            <Link
              href="/onboarding"
              className="group flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-card/30 p-5 text-center transition hover:border-primary/40 hover:bg-card/50"
            >
              <span className="grid h-9 w-9 place-items-center rounded-md bg-primary/10 text-primary">
                <Plus className="h-4 w-4" />
              </span>
              <span className="text-sm font-medium text-foreground">
                New project
              </span>
              <span className="text-xs text-muted-foreground">
                Connect another codebase
              </span>
            </Link>
          </div>
        )}
      </div>
    </AppShell>
  );
}
