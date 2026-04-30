import Link from "next/link";
import { ArrowRight, Plus, Activity, Layers, Users } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PROJECTS, AGENTS, ACTIVE_RUN, TEMPLATES } from "@/lib/mock-data";

const STATS = [
  {
    label: "Active runs",
    value: 2,
    icon: Activity,
    accent: "text-primary",
  },
  {
    label: "Connected agents",
    value: AGENTS.filter((a) => a.status === "connected").length,
    suffix: ` / ${AGENTS.length}`,
    icon: Users,
    accent: "text-foreground",
  },
  {
    label: "Templates",
    value: TEMPLATES.length,
    icon: Layers,
    accent: "text-foreground",
  },
];

export default function HomePage() {
  return (
    <AppShell>
      <div className="mx-auto w-full max-w-6xl px-8 py-10">
        <div className="mb-8">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Tuesday, 29 April
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">
            Many voices, one chorus.
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            What do you want a council of LLMs to look at today?
          </p>
        </div>

        <div className="mb-10 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Link
            href="/new"
            className="group flex items-center gap-3 rounded-lg border border-primary/40 bg-primary/10 p-4 transition hover:bg-primary/15"
          >
            <div className="grid h-10 w-10 place-items-center rounded-md bg-primary/20 text-primary">
              <Plus className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <div className="text-sm font-medium">New chat</div>
              <div className="text-xs text-muted-foreground">
                Paste a task, pick a template
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-foreground" />
          </Link>

          {TEMPLATES.slice(0, 3).map((t) => (
            <Link
              key={t.id}
              href={`/new?template=${t.id}`}
              className="group flex items-center gap-3 rounded-lg border border-border bg-card p-4 transition hover:border-muted-foreground/30"
            >
              <div className="grid h-10 w-10 place-items-center rounded-md bg-muted text-muted-foreground">
                <Layers className="h-4 w-4" />
              </div>
              <div className="flex-1">
                <div className="text-sm font-medium">{t.name}</div>
                <div className="text-xs text-muted-foreground line-clamp-1">
                  {t.description}
                </div>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground/50 transition group-hover:translate-x-0.5 group-hover:text-foreground" />
            </Link>
          ))}
        </div>

        <div className="mb-10 grid grid-cols-3 gap-3">
          {STATS.map((s) => {
            const Icon = s.icon;
            return (
              <Card key={s.label} className="bg-card p-5">
                <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
                  <Icon className="h-3.5 w-3.5" />
                  {s.label}
                </div>
                <div className={`mt-2 text-2xl font-semibold ${s.accent}`}>
                  {s.value}
                  {s.suffix && (
                    <span className="text-base font-normal text-muted-foreground">
                      {s.suffix}
                    </span>
                  )}
                </div>
              </Card>
            );
          })}
        </div>

        <section className="mb-10">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Active runs
            </h2>
            <Link
              href="/projects"
              className="text-xs text-muted-foreground transition hover:text-foreground"
            >
              View all →
            </Link>
          </div>
          <Link
            href={`/runs/${ACTIVE_RUN.id}`}
            className="group block rounded-lg border border-border bg-card p-5 transition hover:border-muted-foreground/30"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-primary animate-pulse-soft" />
                  <span className="text-xs font-medium uppercase tracking-wider text-primary">
                    Running
                  </span>
                  <Badge
                    variant="outline"
                    className="border-border font-mono text-[10px]"
                  >
                    {ACTIVE_RUN.templateId}
                  </Badge>
                </div>
                <h3 className="mt-2 text-base font-semibold">
                  {ACTIVE_RUN.title}
                </h3>
                <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
                  {ACTIVE_RUN.prompt}
                </p>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-foreground" />
            </div>
            <div className="mt-4 flex items-center gap-4">
              {ACTIVE_RUN.reviewers.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground"
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      r.state === "done"
                        ? "bg-[hsl(var(--success))]"
                        : r.state === "errored"
                          ? "bg-destructive"
                          : "bg-primary animate-pulse-soft"
                    }`}
                  />
                  <span className="font-mono">{r.name}</span>
                  <span className="text-muted-foreground/50">·</span>
                  <span className="capitalize">{r.state}</span>
                </div>
              ))}
            </div>
          </Link>
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Projects
            </h2>
            <Link
              href="/projects"
              className="text-xs text-muted-foreground transition hover:text-foreground"
            >
              View all →
            </Link>
          </div>
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
          </div>
        </section>
      </div>
    </AppShell>
  );
}
