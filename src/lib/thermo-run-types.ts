export type ThermoPhaseGroup = "specialist" | "validation" | "synthesis" | "audit";

export type ThermoParticipantRole =
  | "primary"
  | "validator"
  | "synthesizer"
  | "auditor";

export type ThermoDomain =
  | "architecture"
  | "security"
  | "correctness"
  | "tests"
  | "performance"
  | "docs"
  | "final_synthesis"
  | "adversarial_noise"
  | "synthesis_audit";

const THERMO_DOMAINS = new Set<ThermoDomain>([
  "architecture",
  "security",
  "correctness",
  "tests",
  "performance",
  "docs",
  "final_synthesis",
  "adversarial_noise",
  "synthesis_audit",
]);

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
