import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { LiveRunReal } from "@/components/live-run-real";
import { getChat, getTemplate, DaemonError } from "@/lib/api";
import { readChatRounds } from "@/lib/server/run-artifacts";
import { readThermoRunPlanByChatId } from "@/lib/server/thermo-run-artifacts";

export const dynamic = "force-dynamic";

interface RunPageProps {
  params: Promise<{ runId: string }>;
}

async function getRunData(runId: string) {
  // Chat row + template are loaded independently. Template lookup is allowed
  // to fail (template deleted after the chat ran) — the chat is immutable
  // history and shouldn't 500 just because the user removed the template.
  // LiveRunReal accepts `template: Template | null` and degrades to a
  // template-less render (no phase stepper labels) when it's missing.
  let chat;
  try {
    chat = await getChat(runId);
  } catch (err) {
    throw err instanceof DaemonError ? err : new Error("Failed to load chat");
  }
  // Prefer the frozen snapshot captured at run-fire — this is what the
  // chat actually executed against. Without this, editing the template
  // later (adding/removing/renaming reviewers) retroactively reshapes
  // every old run page: phantom QUEUED cards for new candidates, lost
  // model labels on participants whose slot no longer exists. Fall back
  // to the live template only for chats that pre-date the snapshot
  // column (or chats deleted after run completion).
  let template = chat.templateSnapshot ?? null;
  if (!template) {
    try {
      template = await getTemplate(chat.templateId);
    } catch {
      // Template was deleted AND no snapshot exists — chat still renders,
      // just without template-derived UI (placeholder reviewer cards from
      // candidate definitions, phase names, etc.). Recorded participants
      // still come from disk via /api/run-artifacts.
    }
  }
  return { chat, template };
}

export default async function RunPage({ params }: RunPageProps) {
  const { runId } = await params;
  const { chat, template } = await getRunData(runId);

  if (!chat) {
    notFound();
  }

  const initialRounds = readChatRounds(chat.id);
  const initialThermoPlan = readThermoRunPlanByChatId(chat.id);

  return (
    <AppShell>
      <LiveRunReal
        chatId={chat.id}
        initialStatus={chat.status}
        initialRounds={initialRounds}
        initialThermoPlan={initialThermoPlan}
        template={template}
        templateId={chat.templateId}
        work={chat.work}
        initialPrUrl={chat.prUrl}
        initialShipError={chat.shipError}
        initialVerdict={chat.verdict}
      />
    </AppShell>
  );
}
