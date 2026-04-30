import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { LiveRunView } from "@/components/live-run-view";
import { ACTIVE_RUN, PROJECTS, TEMPLATES } from "@/lib/mock-data";

interface RunPageProps {
  params: Promise<{ runId: string }>;
}

export default async function RunPage({ params }: RunPageProps) {
  const { runId } = await params;

  // For the prototype, only ACTIVE_RUN is rendered as live; everything else 404s.
  if (runId !== ACTIVE_RUN.id) {
    notFound();
  }
  const run = ACTIVE_RUN;
  const project = PROJECTS.find((p) => p.id === run.projectId);
  const template = TEMPLATES.find((t) => t.id === run.templateId);

  return (
    <AppShell>
      <div className="flex h-full flex-col">
        <LiveRunView run={run} project={project} template={template} />
      </div>
    </AppShell>
  );
}
