import fs from "node:fs";
import path from "node:path";

/**
 * Participant diagnostic sidecar.
 *
 * `_events.jsonl` is an append-only, best-effort stream of per-participant
 * warnings/errors that should survive after SSE has ended. Each line is a
 * JSON object with a lifecycle `kind`, user-facing `message`, numeric `ts`,
 * and severity of `info`, `warning`, or `error`. Readers are strict about the
 * required fields, drop malformed optional fields, and ignore bad rows so a
 * hand-edited or partially written sidecar cannot break the run page.
 */
export interface ParticipantEvent {
  kind: string;
  severity: "info" | "warning" | "error";
  message: string;
  detail?: string;
  summary?: string;
  command?: string;
  ts: number;
}

interface PermissionPromptLike {
  kind: string;
  detail?: string;
  permissionRequest?: {
    summary?: string;
    command?: string;
  };
}

const EVENTS_FILE = "_events.jsonl";
const SEVERITIES = new Set<ParticipantEvent["severity"]>([
  "info",
  "warning",
  "error",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function parseParticipantEvent(value: unknown): ParticipantEvent | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.kind !== "string") return undefined;
  if (!SEVERITIES.has(value.severity as ParticipantEvent["severity"])) {
    return undefined;
  }
  if (typeof value.message !== "string") return undefined;
  if (typeof value.ts !== "number" || !Number.isFinite(value.ts)) {
    return undefined;
  }

  return {
    kind: value.kind,
    severity: value.severity as ParticipantEvent["severity"],
    message: value.message,
    ...(typeof value.detail === "string" ? { detail: value.detail } : {}),
    ...(typeof value.summary === "string" ? { summary: value.summary } : {}),
    ...(typeof value.command === "string" ? { command: value.command } : {}),
    ts: value.ts,
  };
}

export function permissionAutoApprovedEvent(
  err: PermissionPromptLike,
  _keys: readonly string[],
  ts = Date.now(),
): ParticipantEvent {
  const command = err.permissionRequest?.command;
  const summary = err.permissionRequest?.summary;
  const label = command ?? summary ?? "permission request";
  return {
    kind: "permission_auto_approved",
    severity: "info",
    message: `Permission auto-approved: ${label}`,
    ...(err.detail ? { detail: err.detail } : {}),
    ...(command ? { command } : {}),
    ...(summary ? { summary } : {}),
    ts,
  };
}

export function permissionBlockedEvent(
  err: PermissionPromptLike,
  ts = Date.now(),
): ParticipantEvent {
  const command = err.permissionRequest?.command;
  const summary = err.permissionRequest?.summary;
  const label = command ?? summary ?? "permission required";
  return {
    kind: "permission_blocked",
    severity: "error",
    message: `Permission blocked: ${label}`,
    ...(err.detail ? { detail: err.detail } : {}),
    ...(command ? { command } : {}),
    ...(summary ? { summary } : {}),
    ts,
  };
}

export function appendParticipantEvent(
  participantDir: string,
  event: ParticipantEvent,
): void {
  fs.mkdirSync(participantDir, { recursive: true });
  fs.appendFileSync(
    path.join(participantDir, EVENTS_FILE),
    `${JSON.stringify(event)}\n`,
    "utf-8",
  );
}

export function readParticipantEvents(participantDir: string): ParticipantEvent[] {
  const eventsPath = path.join(participantDir, EVENTS_FILE);
  if (!fs.existsSync(eventsPath)) return [];
  const events: ParticipantEvent[] = [];
  for (const line of fs.readFileSync(eventsPath, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = parseParticipantEvent(JSON.parse(line));
      if (parsed) events.push(parsed);
    } catch {
      /* ignore malformed diagnostic rows */
    }
  }
  return events;
}
