// Chat API endpoints
import { Chat } from "@/lib/types";
import { fetchFromDaemon } from "./client";

interface RawChatRow {
  id: string;
  work: string;
  template_id: string;
  status: Chat["status"];
  current_phase_idx?: number;
  yolo?: number | boolean;
  attached_files?: string | null;
  created_at: number;
  updated_at: number;
  finished_at?: number | null;
}

/**
 * Daemon stores chats with snake_case columns; the UI contract is camelCase.
 * Translate at the boundary so the rest of the app doesn't care.
 */
function fromRow(row: RawChatRow): Chat {
  let attached: string[] | undefined;
  if (row.attached_files) {
    try {
      const parsed = JSON.parse(row.attached_files);
      if (Array.isArray(parsed)) attached = parsed;
    } catch {
      // ignore — leave undefined
    }
  }
  return {
    id: row.id,
    work: row.work,
    templateId: row.template_id,
    status: row.status,
    currentPhaseIdx: row.current_phase_idx ?? 0,
    yolo: Boolean(row.yolo),
    attachedFiles: attached,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at ?? undefined,
  };
}

export async function listChats(options?: {
  limit?: number;
  offset?: number;
  status?: string;
}): Promise<Chat[]> {
  const params = new URLSearchParams();
  if (options?.limit) params.append("limit", options.limit.toString());
  if (options?.offset) params.append("offset", options.offset.toString());
  if (options?.status) params.append("status", options.status);

  const query = params.toString();
  const rows = await fetchFromDaemon<RawChatRow[]>(
    `/chats${query ? `?${query}` : ""}`,
  );
  return rows.map(fromRow);
}

export async function getChat(id: string): Promise<Chat> {
  const row = await fetchFromDaemon<RawChatRow>(`/chats/${id}`);
  return fromRow(row);
}

export async function createChat(options: {
  work: string;
  templateId: string;
  files?: string[];
}): Promise<Chat> {
  // Daemon expects { work, templateId, files? } per the spec — keep as-is.
  const row = await fetchFromDaemon<RawChatRow>("/chats", {
    method: "POST",
    body: JSON.stringify(options),
  });
  return fromRow(row);
}

export async function cancelChat(id: string): Promise<void> {
  await fetchFromDaemon<void>(`/chats/${id}/cancel`, { method: "POST" });
}

export async function resumeChat(id: string, answer: unknown): Promise<Chat> {
  const row = await fetchFromDaemon<RawChatRow>(`/chats/${id}/resume`, {
    method: "POST",
    body: JSON.stringify({ answer }),
  });
  return fromRow(row);
}

export function streamChat(id: string): EventSource {
  // Always go through the same-origin proxy so the browser can reach the
  // daemon (the daemon binds to 127.0.0.1 on the server, not the user's box).
  const url =
    typeof window === "undefined"
      ? new URL(
          `/chats/${id}/stream`,
          process.env.CHORUS_DAEMON_URL || "http://127.0.0.1:7707",
        ).toString()
      : `/api/daemon/chats/${id}/stream`;
  return new EventSource(url);
}

export async function listBlocked(): Promise<Chat[]> {
  const rows = await fetchFromDaemon<RawChatRow[]>("/blocked");
  return rows.map(fromRow);
}
