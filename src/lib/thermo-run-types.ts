export type ThermoPhaseGroup = "specialist" | "validation" | "synthesis" | "audit";

export type ThermoParticipantRole =
  | "primary"
  | "validator"
  | "synthesizer"
  | "auditor";

export const THERMO_SPECIALIST_DOMAINS = [
  "plan_completeness",
  "architecture",
  "security",
  "correctness",
  "tests",
  "performance",
  "docs",
] as const;

export const THERMO_SYSTEM_DOMAINS = [
  "final_synthesis",
  "synthesis_audit",
] as const;

export const THERMO_REVIEW_DOMAINS = [
  ...THERMO_SPECIALIST_DOMAINS,
  ...THERMO_SYSTEM_DOMAINS,
] as const;

export type ThermoSpecialistDomain =
  (typeof THERMO_SPECIALIST_DOMAINS)[number];

export type ThermoSystemDomain =
  (typeof THERMO_SYSTEM_DOMAINS)[number];

export type ThermoDomain =
  (typeof THERMO_REVIEW_DOMAINS)[number];

export const THERMO_DOMAIN_CHECKS: Record<ThermoDomain, string> = {
  plan_completeness:
    "Plan completeness, missed implementation commitments, and verification promised by the detected Superpowers plan.",
  architecture:
    "Architecture, maintainability, module boundaries, abstractions, and long-term change risk.",
  security:
    "Security, auth, authorization, data loss, secrets, privacy, and tenant isolation.",
  correctness:
    "Functional correctness, regressions, edge cases, state handling, and user-visible behavior.",
  tests:
    "Test coverage, fake coverage, missing assertions, brittle tests, and verification gaps.",
  performance:
    "Performance, scalability, resource usage, concurrency, caching, and avoidable repeated work.",
  docs:
    "Documentation, migrations, release notes, operator handoff, and public-facing behavior notes.",
  final_synthesis:
    "Final synthesis of validated review findings.",
  synthesis_audit:
    "Audit the final synthesis for unsupported blockers and missing downgrades.",
};

const THERMO_DOMAINS = new Set<ThermoDomain>(THERMO_REVIEW_DOMAINS);
const THERMO_SPECIALIST_DOMAIN_SET = new Set<ThermoDomain>(
  THERMO_SPECIALIST_DOMAINS,
);

export function thermoDomainCheck(domain: ThermoDomain): string {
  return THERMO_DOMAIN_CHECKS[domain];
}

export function thermoDomainLabel(domain: ThermoDomain): string {
  return domain
    .split("_")
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

export function isThermoSpecialistDomain(
  domain: ThermoDomain,
): domain is ThermoSpecialistDomain {
  return THERMO_SPECIALIST_DOMAIN_SET.has(domain);
}

export function isCriticalThermoSpecialistDomain(
  domain: ThermoDomain,
  options: { planContractMatched?: boolean } = {},
): domain is ThermoSpecialistDomain {
  if (domain === "plan_completeness") {
    return Boolean(options.planContractMatched);
  }
  return (
    domain === "architecture" ||
    domain === "security" ||
    domain === "correctness" ||
    domain === "tests"
  );
}

export function parseThermoDomain(value: unknown): ThermoDomain | undefined {
  return typeof value === "string" && THERMO_DOMAINS.has(value as ThermoDomain)
    ? (value as ThermoDomain)
    : undefined;
}

export interface ThermoParticipantMetadata {
  kind: "thermo";
  phaseGroup: ThermoPhaseGroup;
  phaseId: string;
  phaseLabel: string;
  description: string;
  check: string;
  domain: ThermoDomain;
  role: ThermoParticipantRole;
  voiceId: string;
  provider: string;
  modelId: string;
  tier: string;
}

export interface ThermoPlanVoice {
  voiceId: string;
  provider: string;
  modelId: string;
  tier: string;
}

export interface ThermoPlanDomain {
  domain: ThermoDomain;
  check: string;
  validatorPolicy: "always" | "conditional" | "none";
  validatorReason: string;
  primary: ThermoPlanVoice | null;
  validator: ThermoPlanVoice | null;
}

export interface ThermoRunPlan {
  phases: Array<{
    id: ThermoPhaseGroup;
    label: string;
    title: string;
    description: string;
  }>;
  domains: ThermoPlanDomain[];
}
