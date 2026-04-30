import Link from "next/link";
import { notFound } from "next/navigation";
import { Plus, ExternalLink } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { PROJECTS, TASKS_BY_PROJECT, TEMPLATES } from "@/lib/mock-data";

interface ProjectPageProps {
  params: Promise<{ projectId: string }>;
}

const STATUS_LABEL = {
  running: { label: "Running", color: "text-primary", dot: "bg-primary animate-pulse-soft" },
  done: { label: "Done", color: "text-emerald-400", dot: "bg-emerald-400" },
  "needs-review": { label: "Needs review", color: "text-amber-400", dot: "bg-amber-400" },
  failed: { label: "Failed", color: "text-destructive", dot: "bg-destructive" },
} as const;

export default async function ProjectPage({ params }: ProjectPageProps) {
  const { projectId } = await params;
  const project = PROJECTS.find((p) => p.id === projectId);
  if (!project) notFound();

  const tasks = TASKS_BY_PROJECT[project.id] ?? [];

  return (
    <AppShell>
      <div className="border-b border-border bg-card/30 px-8 py-6">
        <div className="mx-auto flex max-w-6xl items-start justify-between gap-6">
          <div className="flex items-start gap-4">
            <span className="text-3xl leading-none">{project.emoji}</span>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">
                {project.name}
              </h1>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {project.description}
              </p>
              <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
                <span>{project.taskCount} tasks</span>
                <span>·</span>
                <span>{project.activeRuns} active</span>
                <span>·</span>
                <span>last activity {project.lastActivity}</span>
              </div>
            </div>
          </div>
          <Link
            href="/new"
            className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            New chat
          </Link>
        </div>
      </div>

      <div className="mx-auto w-full max-w-6xl px-8 py-8">
        {tasks.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-card/30 p-12 text-center">
            <p className="text-sm text-muted-foreground">
              No tasks in this project yet. Start one →
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="grid grid-cols-12 gap-3 border-b border-border bg-card/60 px-4 py-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              <div className="col-span-1">Status</div>
              <div className="col-span-6">Task</div>
              <div className="col-span-2">Template</div>
              <div className="col-span-2">Created</div>
              <div className="col-span-1 text-right">Open</div>
            </div>
            <ul>
              {tasks.map((t) => {
                const tmpl = TEMPLATES.find((tt) => tt.id === t.templateId);
                const status = STATUS_LABEL[t.status];
                return (
                  <li key={t.id} className="border-b border-border last:border-b-0">
                    <Link
                      href={`/runs/${t.id}`}
                      className="grid grid-cols-12 items-center gap-3 px-4 py-3 transition hover:bg-accent/30"
                    >
                      <div className="col-span-1">
                        <span className="flex items-center gap-1.5">
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${status.dot}`}
                          />
                          <span
                            className={`text-[11px] font-medium ${status.color}`}
                          >
                            {status.label}
                          </span>
                        </span>
                      </div>
                      <div className="col-span-6">
                        <div className="text-sm font-medium">{t.title}</div>
                        <div className="text-xs text-muted-foreground line-clamp-1">
                          {t.synthesizedAnswer ?? t.prompt}
                        </div>
                      </div>
                      <div className="col-span-2">
                        <Badge
                          variant="outline"
                          className="border-border font-mono text-[10px]"
                        >
                          {tmpl?.name ?? t.templateId}
                        </Badge>
                      </div>
                      <div className="col-span-2 font-mono text-[11px] text-muted-foreground">
                        {new Date(t.createdAt).toLocaleString("en-GB", {
                          day: "2-digit",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </div>
                      <div className="col-span-1 text-right">
                        <ExternalLink className="ml-auto h-3.5 w-3.5 text-muted-foreground" />
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </AppShell>
  );
}
