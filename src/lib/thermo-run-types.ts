export type ThermoPhaseGroup = "specialist" | "validation" | "synthesis" | "audit";

export type ThermoParticipantRole =
  | "primary"
  | "validator"
  | "synthesizer"
  | "auditor";

export interface ThermoParticipantMetadata {
  kind: "thermo";
  phaseGroup: ThermoPhaseGroup;
  phaseId: string;
  phaseLabel: string;
  description: string;
  check: string;
  domain: string;
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
  domain: string;
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
