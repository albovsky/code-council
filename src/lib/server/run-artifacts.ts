import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readOpenCodeTerminalUsageFromTmux } from "@/lib/server/opencode-terminal-usage";
import {
  readParticipantEvents,
  type ParticipantEvent,
} from "@/lib/server/participant-events";
import { readThermoParticipantMetadata } from "@/lib/server/thermo-run-artifacts";
import type { ThermoParticipantMetadata } from "@/lib/thermo-run-types";
import type { ReviewerLineage } from "@/lib/types";

export interface ParticipantSnapshot {
  participant: string;
  role: "doer" | "reviewer";
  agentName: string;
  lineage: ReviewerLineage;
  hasAnswer: boolean;
  answer?: string;
  findingsPreview?: string[];
  binaryUsed?: string;
  modelUsed?: string;
  durationMs?: number;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    cachedInputTokens?: number;
    costUsd?: number;
  };
  terminalUsage?: {
    contextTokens?: number;
    costUsd?: number;
  };
  events?: ParticipantEvent[];
  thermo?: ThermoParticipantMetadata;
}

export interface RoundSnapshot {
  round: number;
  participants: ParticipantSnapshot[];
}

export interface BuildParticipantSnapshotInput {
  chatId: string;
  roundNum: number;
  participantDir: string;
  participantName: string;
}

const AGENT_TO_LINEAGE: Record<string, ReviewerLineage> = {
  "claude-code": "claude",
  "codex-cli": "codex",
  "antigravity-cli": "antigravity",
  "opencode-cli": "opencode",
  "kimi-cli": "kimi",
  openrouter: "openrouter",
};

function lineageForAgent(rawAgent: string): ReviewerLineage {
  return AGENT_TO_LINEAGE[rawAgent] ?? "local";
}

function readJsonObject(filePath: string): Record<string, unknown> | undefined {
  if (!fs.existsSync(filePath)) return undefined;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function readAnswer(answerPath: string): {
  hasAnswer: boolean;
  answer?: string;
  findingsPreview?: string[];
} {
  if (!fs.existsSync(answerPath)) return { hasAnswer: false };
  try {
    const answer = fs.readFileSync(answerPath, "utf-8");
    const hasAnswer = /\n##\s*DONE\s*\n?$/i.test(answer.trimEnd());
    return {
      hasAnswer,
      answer,
      ...(hasAnswer
        ? {
            findingsPreview: answer
              .split("\n")
              .filter((line) => line.trim().length > 0 && !line.startsWith("##"))
              .slice(0, 4)
              .map((line) => (line.length > 90 ? line.slice(0, 90) + "…" : line)),
          }
        : {}),
    };
  } catch {
    return { hasAnswer: false };
  }
}

function readMeta(participantDir: string): {
  binaryUsed?: string;
  modelUsed?: string;
} {
  const meta = readJsonObject(path.join(participantDir, "_meta.json"));
  if (!meta) return {};
  return {
    ...(typeof meta.binary === "string" ? { binaryUsed: meta.binary } : {}),
    ...(typeof meta.model === "string" ? { modelUsed: meta.model } : {}),
  };
}

function readStats(participantDir: string): Pick<
  ParticipantSnapshot,
  "durationMs" | "usage" | "terminalUsage"
> {
  const stats = readJsonObject(path.join(participantDir, "_stats.json"));
  if (!stats) return {};

  const usageSource =
    stats.usage && typeof stats.usage === "object"
      ? (stats.usage as Record<string, unknown>)
      : undefined;
  const terminalUsageSource =
    stats.terminalUsage && typeof stats.terminalUsage === "object"
      ? (stats.terminalUsage as Record<string, unknown>)
      : undefined;

  const usage: NonNullable<ParticipantSnapshot["usage"]> = {};
  if (typeof usageSource?.inputTokens === "number") {
    usage.inputTokens = usageSource.inputTokens;
  }
  if (typeof usageSource?.outputTokens === "number") {
    usage.outputTokens = usageSource.outputTokens;
  }
  if (typeof usageSource?.cachedInputTokens === "number") {
    usage.cachedInputTokens = usageSource.cachedInputTokens;
  }
  if (typeof usageSource?.costUsd === "number") {
    usage.costUsd = usageSource.costUsd;
  }

  const terminalUsage: NonNullable<ParticipantSnapshot["terminalUsage"]> = {};
  if (typeof terminalUsageSource?.contextTokens === "number") {
    terminalUsage.contextTokens = terminalUsageSource.contextTokens;
  }
  if (typeof terminalUsageSource?.costUsd === "number") {
    terminalUsage.costUsd = terminalUsageSource.costUsd;
  }

  return {
    ...(typeof stats.durationMs === "number" ? { durationMs: stats.durationMs } : {}),
    ...(Object.keys(usage).length > 0 ? { usage } : {}),
    ...(Object.keys(terminalUsage).length > 0 ? { terminalUsage } : {}),
  };
}

export function buildParticipantSnapshot(
  input: BuildParticipantSnapshotInput,
): ParticipantSnapshot {
  const role: "doer" | "reviewer" = input.participantName.startsWith("doer-")
    ? "doer"
    : "reviewer";
  const rawAgent = input.participantName
    .replace(/^(doer-|reviewer-)/, "")
    .replace(/-\d+$/, "");
  const sessionAgent = input.participantName.replace(/^(doer-|reviewer-)/, "");
  const lineage = lineageForAgent(rawAgent);
  const answerState = readAnswer(path.join(input.participantDir, "answer.md"));
  const meta = readMeta(input.participantDir);
  const stats = readStats(input.participantDir);
  const thermo = readThermoParticipantMetadata(
    input.participantDir,
    answerState.answer,
    meta.modelUsed,
  );
  const events = readParticipantEvents(input.participantDir);
  let terminalUsage = stats.terminalUsage;
  if (!terminalUsage && thermo?.provider === "opencode-cli") {
    terminalUsage =
      readOpenCodeTerminalUsageFromTmux(input.chatId, thermo.phaseId, role, sessionAgent) ??
      undefined;
  }

  return {
    participant: input.participantName,
    role,
    agentName: rawAgent,
    lineage,
    ...answerState,
    ...meta,
    ...stats,
    terminalUsage,
    ...(events.length > 0 ? { events } : {}),
    thermo,
  };
}

export function readChatRounds(chatId: string): RoundSnapshot[] {
  const chatDir = path.join(os.homedir(), ".code-council", "chats", chatId);
  if (!fs.existsSync(chatDir)) return [];

  const entries = fs
    .readdirSync(chatDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith("round-"));

  const rounds: RoundSnapshot[] = [];
  for (const entry of entries) {
    const roundNum = parseInt(entry.name.replace("round-", ""), 10);
    if (!Number.isFinite(roundNum)) continue;

    const roundDir = path.join(chatDir, entry.name);
    const participants = fs
      .readdirSync(roundDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name !== "triage")
      .map((d) =>
        buildParticipantSnapshot({
          chatId,
          roundNum,
          participantDir: path.join(roundDir, d.name),
          participantName: d.name,
        }),
      );

    rounds.push({ round: roundNum, participants });
  }

  return rounds.sort((a, b) => a.round - b.round);
}
