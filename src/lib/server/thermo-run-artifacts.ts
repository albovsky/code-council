import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  ThermoDomain,
  ThermoParticipantMetadata,
  ThermoParticipantRole,
  ThermoPhaseGroup,
  ThermoRunPlan,
} from "@/lib/thermo-run-types";
import { parseThermoDomain } from "@/lib/thermo-run-types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function isPhaseGroup(value: unknown): value is ThermoPhaseGroup {
  return (
    value === "specialist" ||
    value === "validation" ||
    value === "synthesis" ||
    value === "audit"
  );
}

function isRole(value: unknown): value is ThermoParticipantRole {
  return (
    value === "primary" ||
    value === "validator" ||
    value === "synthesizer" ||
    value === "auditor"
  );
}

export function parseThermoParticipantMetadata(
  value: unknown,
): ThermoParticipantMetadata | undefined {
  if (!isRecord(value)) return undefined;
  if (value.kind !== "thermo") return undefined;
  if (!isPhaseGroup(value.phaseGroup)) return undefined;
  if (!isRole(value.role)) return undefined;
  const domain = parseThermoDomain(value.domain) ?? "final_synthesis";

  const requiredStrings = [
    "phaseId",
    "phaseLabel",
    "description",
    "check",
    "voiceId",
    "provider",
    "modelId",
    "tier",
  ] as const;
  for (const key of requiredStrings) {
    if (typeof value[key] !== "string") return undefined;
  }
  const phaseId = value.phaseId;
  const phaseLabel = value.phaseLabel;
  const description = value.description;
  const check = value.check;
  const voiceId = value.voiceId;
  const provider = value.provider;
  const modelId = value.modelId;
  const tier = value.tier;
  if (
    typeof phaseId !== "string" ||
    typeof phaseLabel !== "string" ||
    typeof description !== "string" ||
    typeof check !== "string" ||
    typeof voiceId !== "string" ||
    typeof provider !== "string" ||
    typeof modelId !== "string" ||
    typeof tier !== "string"
  ) {
    return undefined;
  }

  return {
    kind: "thermo",
    phaseGroup: value.phaseGroup,
    phaseId,
    phaseLabel,
    description,
    check,
    domain,
    role: value.role,
    voiceId,
    provider,
    modelId,
    tier,
  };
}

export function readThermoParticipantMetadata(
  participantDir: string,
  legacyAnswer?: string,
  modelUsed?: string,
): ThermoParticipantMetadata | undefined {
  const thermoPath = path.join(participantDir, "_thermo.json");
  if (fs.existsSync(thermoPath)) {
    try {
      const parsed = parseThermoParticipantMetadata(
        JSON.parse(fs.readFileSync(thermoPath, "utf-8")),
      );
      if (parsed) return parsed;
    } catch {
      /* malformed sidecar: fall through to legacy inference */
    }
  }

  return legacyAnswer ? inferLegacyThermoMetadata(legacyAnswer, modelUsed) : undefined;
}

export function inferLegacyThermoMetadata(
  answer: string,
  modelUsed?: string,
): ThermoParticipantMetadata | undefined {
  const header = answer.split("\n").slice(0, 24).join("\n");
  if (
    !/^#\s*Thermo\s+Phase\s+[12]\b|^#\s*Performance Specialist Review\b|^#\s*Thermo\s+(Final Synthesis|Synthesis Audit)\b/im.test(
      header,
    )
  ) {
    return undefined;
  }

  const phaseGroup = inferLegacyPhaseGroup(header);
  const role = roleForPhaseGroup(phaseGroup);
  const domain = inferLegacyThermoDomain(header);
  const reviewerLine =
    header.match(/\*\*(?:Reviewer|Validator):\*\*\s*([^\n]+)/i)?.[1] ?? "";
  const tier = reviewerLine.match(/Tier\s+([^)]+)/i)?.[1]?.trim() ?? "";
  const model =
    reviewerLine
      .replace(/\(Tier[^)]*\)/i, "")
      .replace(/^[^:]+:/, "")
      .trim() ||
    modelUsed ||
    "";
  const phaseLabel =
    phaseGroup === "validation"
      ? "Thermo adversarial validation"
      : phaseGroup === "synthesis"
        ? "Thermo final synthesis"
        : phaseGroup === "audit"
          ? "Thermo synthesis audit"
          : "Thermo specialist review";

  return {
    kind: "thermo",
    phaseGroup,
    phaseId: `legacy-${phaseGroup}-${domain}`,
    phaseLabel,
    description: phaseLabel,
    check: legacyDomainCheck(domain),
    domain,
    role,
    voiceId: model,
    provider: "",
    modelId: model,
    tier,
  };
}

function inferLegacyPhaseGroup(header: string): ThermoPhaseGroup {
  if (/synthesis audit/i.test(header)) return "audit";
  if (/final synthesis/i.test(header)) return "synthesis";
  if (/phase\s*2|cross-validation|validation|validator/i.test(header)) {
    return "validation";
  }
  return "specialist";
}

function roleForPhaseGroup(phaseGroup: ThermoPhaseGroup): ThermoParticipantRole {
  if (phaseGroup === "audit") return "auditor";
  if (phaseGroup === "synthesis") return "synthesizer";
  if (phaseGroup === "validation") return "validator";
  return "primary";
}

function inferLegacyThermoDomain(header: string): ThermoDomain {
  const explicit = header.match(
    /(?:\*\*Domain:\*\*|^Domain:|^## Domain\s*\n)\s*([^\n]+)/im,
  )?.[1];
  const heading = header.match(
    /^#.*?\b(architecture|security|correctness|tests?|performance|docs?|documentation|adversarial_noise)\b/im,
  )?.[1];
  return normalizeLegacyThermoDomain(explicit ?? heading ?? "final_synthesis");
}

function normalizeLegacyThermoDomain(value: string): ThermoDomain {
  const normalized = value.toLowerCase();
  if (normalized.includes("architecture")) return "architecture";
  if (normalized.includes("security")) return "security";
  if (normalized.includes("correctness")) return "correctness";
  if (/\btests?\b/.test(normalized)) return "tests";
  if (normalized.includes("performance")) return "performance";
  if (normalized.includes("documentation") || /\bdocs?\b/.test(normalized)) {
    return "docs";
  }
  if (normalized.includes("adversarial_noise")) return "adversarial_noise";
  if (normalized.includes("synthesis_audit")) return "synthesis_audit";
  return parseThermoDomain(normalized) ?? "final_synthesis";
}

function legacyDomainCheck(domain: ThermoDomain): string {
  switch (domain) {
    case "architecture":
      return "Architecture, maintainability, module boundaries, abstractions, and long-term change risk.";
    case "security":
      return "Security, auth, authorization, data loss, secrets, privacy, and tenant isolation.";
    case "correctness":
      return "Functional correctness, regressions, edge cases, state handling, and user-visible behavior.";
    case "tests":
      return "Test coverage, fake coverage, missing assertions, brittle tests, and verification gaps.";
    case "performance":
      return "Performance, scalability, resource usage, concurrency, caching, and avoidable repeated work.";
    case "docs":
      return "Documentation, migrations, release notes, operator handoff, and public-facing behavior notes.";
    default:
      return "Final synthesis of validated review findings.";
  }
}

export function readThermoRunPlan(chatDir: string): ThermoRunPlan | null {
  const planPath = path.join(chatDir, "_thermo-plan.json");
  if (!fs.existsSync(planPath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(planPath, "utf-8")) as Partial<ThermoRunPlan>;
    if (Array.isArray(parsed.phases) && Array.isArray(parsed.domains)) {
      return {
        phases: parsed.phases,
        domains: parsed.domains.map((domain) => ({
          ...domain,
          domain: parseThermoDomain(domain.domain) ?? "final_synthesis",
        })),
      };
    }
  } catch {
    /* informational sidecar; ignore parse errors */
  }
  return null;
}

export function readThermoRunPlanByChatId(chatId: string): ThermoRunPlan | null {
  return readThermoRunPlan(path.join(os.homedir(), ".code-council", "chats", chatId));
}
