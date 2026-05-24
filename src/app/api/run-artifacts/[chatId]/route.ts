/**
 * Filesystem-backed artifacts endpoint for the run page.
 * Returns the structure of ~/.code-council/chats/<id>/round-N/<participant>/answer.md
 * as a JSON tree the LiveRunReal client component can consume.
 *
 * Reads from disk, no DB. Cheap enough to poll every 4s. Daemon and Next.js
 * are co-hosted so the filesystem read is local.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { readChatRounds } from "@/lib/server/run-artifacts";
import { readThermoRunPlanByChatId } from "@/lib/server/thermo-run-artifacts";

interface TriageSnapshot {
  hasAnswer: boolean;
  answer?: string;
}

interface SwapEntry {
  round: number;
  phaseId: string;
  role: "doer" | "reviewer";
  agent: string;
  reason: "lineage_fallback" | "model_fallback";
  fromLineage: string;
  toLineage: string;
  fromModel: string;
  toModel: string;
  fallbackIdx: number;
  ts: number;
  fromErrorKind?: string;
  fromErrorMessage?: string;
}

/**
 * Full shape validation — sidecar is on disk and could be hand-edited
 * or written by an older runner. Returns the typed entry on success or
 * null. The UI sorts on `fallbackIdx` (NaN if missing) and branches on
 * `reason` (silent fallthrough to "Model fallback" if unknown), so
 * loose validation propagates display bugs.
 */
function isValidSwapEntry(entry: unknown): SwapEntry | null {
  if (!entry || typeof entry !== "object") return null;
  const e = entry as Record<string, unknown>;
  if (typeof e.round !== "number") return null;
  if (typeof e.phaseId !== "string") return null;
  if (e.role !== "doer" && e.role !== "reviewer") return null;
  if (typeof e.agent !== "string") return null;
  if (e.reason !== "lineage_fallback" && e.reason !== "model_fallback")
    return null;
  if (typeof e.fromLineage !== "string") return null;
  if (typeof e.toLineage !== "string") return null;
  if (typeof e.fromModel !== "string") return null;
  if (typeof e.toModel !== "string") return null;
  if (typeof e.fallbackIdx !== "number") return null;
  if (typeof e.ts !== "number") return null;
  return e as unknown as SwapEntry;
}

/**
 * Reads `_attempts.jsonl` from a participant dir and indexes the rows by
 * model id. Used to enrich swap entries with the underlying error of the
 * failed attempt — the JSONL is append-only, so multi-step fallback chains
 * leave one row per attempt (oldest first). On a model collision we keep
 * the latest entry, which matches "the most recent failure for this
 * model" when the swap UI is interpreting a single chain.
 */
function readAttemptsByModel(
  partDir: string,
): Map<string, { errorKind: string; errorMessage: string }> {
  const map = new Map<string, { errorKind: string; errorMessage: string }>();
  const attemptsPath = path.join(partDir, "_attempts.jsonl");
  if (!fs.existsSync(attemptsPath)) return map;
  try {
    const lines = fs
      .readFileSync(attemptsPath, "utf-8")
      .split("\n")
      .filter((l) => l.trim().length > 0);
    for (const line of lines) {
      try {
        const e = JSON.parse(line) as Record<string, unknown>;
        const model =
          typeof e.model === "string" ? e.model : "(default)";
        const errorKind =
          typeof e.errorKind === "string" ? e.errorKind : "unknown";
        const errorMessage =
          typeof e.errorMessage === "string"
            ? e.errorMessage.slice(0, 200)
            : "";
        map.set(model, { errorKind, errorMessage });
      } catch {
        /* skip malformed line */
      }
    }
  } catch {
    /* best-effort */
  }
  return map;
}

/**
 * Walks every participant dir under a chat and aggregates the
 * `_swaps.json` sidecars into a flat array. Mirrors how _stats.json
 * is consumed: the run page renders one swap card per entry. Empty
 * array when no swaps fired.
 */
function readChatSwaps(chatId: string): SwapEntry[] {
  const chatDir = path.join(os.homedir(), ".code-council", "chats", chatId);
  if (!fs.existsSync(chatDir)) return [];
  const out: SwapEntry[] = [];
  for (const round of fs
    .readdirSync(chatDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith("round-"))) {
    const roundDir = path.join(chatDir, round.name);
    for (const part of fs.readdirSync(roundDir, { withFileTypes: true })) {
      if (!part.isDirectory()) continue;
      const partDir = path.join(roundDir, part.name);
      const swapPath = path.join(partDir, "_swaps.json");
      if (!fs.existsSync(swapPath)) continue;
      try {
        const parsed = JSON.parse(fs.readFileSync(swapPath, "utf-8"));
        if (Array.isArray(parsed)) {
          // Pre-load _attempts.jsonl once per participant dir — each swap
          // entry's "from" side maps to the JSONL row whose model matches
          // the swap's fromModel. Lets the UI render "kimi-k2.6 failed:
          // cli_failed — model not found" instead of a bare arrow.
          const attemptsByModel = readAttemptsByModel(partDir);
          for (const entry of parsed) {
            const valid = isValidSwapEntry(entry);
            if (!valid) continue;
            const att = attemptsByModel.get(valid.fromModel);
            if (att) {
              valid.fromErrorKind = att.errorKind;
              valid.fromErrorMessage = att.errorMessage;
            }
            out.push(valid);
          }
        }
      } catch {
        /* malformed sidecar — skip */
      }
    }
  }
  return out;
}

function readTriage(chatId: string): TriageSnapshot | null {
  const answerPath = path.join(
    os.homedir(),
    ".code-council",
    "chats",
    chatId,
    "round-1",
    "triage",
    "answer.md",
  );
  if (!fs.existsSync(answerPath)) return null;
  try {
    const answer = fs.readFileSync(answerPath, "utf-8");
    return {
      hasAnswer: /\n##\s*DONE\s*\n?$/i.test(answer.trimEnd()),
      answer,
    };
  } catch {
    return null;
  }
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ chatId: string }> },
) {
  const { chatId } = await params;
  // Defense-in-depth: chatId is a ULID-looking string. Reject paths with `..`
  // or slashes so a malformed param can't escape the chats dir.
  if (chatId.includes("..") || chatId.includes("/") || chatId.includes("\\")) {
    return Response.json({ rounds: [] }, { status: 400 });
  }
  const rounds = readChatRounds(chatId);
  const swaps = readChatSwaps(chatId);
  const triage = readTriage(chatId);
  const thermoPlan = readThermoRunPlanByChatId(chatId);
  return Response.json({ rounds, swaps, triage, thermoPlan });
}
