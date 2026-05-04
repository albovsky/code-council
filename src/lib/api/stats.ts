// Stats client — talks to /stats on the daemon. Aggregates everything
// the home page needs in one round-trip. See routes/stats.ts for shape.

import { fetchFromDaemon } from "./client";

export interface StatsSummary {
  totalRuns: number;
  runsToday: number;
  runsWeek: number;
  byStatus: Record<string, number>;
  approvalRate: number;
  avgDurationMs: number;
  topTemplate: { id: string; runs: number } | null;
  totalCostUsd: number;
  costTodayUsd: number;
  totalTokensIn: number;
  totalTokensOut: number;
  enabledVoices: number;
  activeLineages: number;
}

export async function getStats(): Promise<StatsSummary> {
  return fetchFromDaemon<StatsSummary>("/stats");
}
