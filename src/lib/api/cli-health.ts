import { fetchFromDaemon } from "./client";

export type CliHealthStatus =
  | "healthy"
  | "quota_exhausted"
  | "auth_invalid"
  | "rate_limited"
  | "unknown";

export interface CliHealth {
  lineage: string;
  status: CliHealthStatus;
  message?: string;
  resetAt?: number;
  updatedAt: number;
}

export interface CliHealthCheckResult {
  ok: boolean;
  voiceId: string;
  health: CliHealth;
  message?: string;
}

export async function checkVoiceHealth(voiceId: string): Promise<CliHealthCheckResult> {
  return fetchFromDaemon<CliHealthCheckResult>("/cli/health/check", {
    method: "POST",
    body: JSON.stringify({ voiceId }),
  });
}
