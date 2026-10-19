/**
 * The trial row: one execution of one frozen case under one condition. It is
 * the unit of RQ1 and RQ2, written by the sweep engine whichever front end
 * drives it, and read by the report.
 */
import type { ControlId, Observation, RelationName } from "./contract.ts";

export type TrialStatus = "pass" | "fail" | "infra";

export interface TrialRow {
  schemaVersion: 1;
  runId: string;
  conditionId: string;
  caseId: string;
  relation: RelationName;
  semanticGroup: string;
  strata: string[];
  /** Round number, 1..N. Trials of one case keep this order. */
  trial: number;
  /** 1 on the first try; higher after infrastructure retries. */
  attempt: number;
  status: TrialStatus;
  reason: string;
  invocations: number;
  tokens: number | null;
  costUsd: number | null;
  latencyMs: number;
  /** Standing assertions (§4.6), reported apart from the MR verdict. */
  overReach: boolean;
  overReachControls: ControlId[];
  contextIntact: boolean;
  resolvedModels: string[];
  providers: string[];
  observations: { source: Observation; followup: Observation };
  turnIds: string[];
  createdAt: string;
}

export const trialKey = (r: Pick<TrialRow, "conditionId" | "caseId" | "trial">): string =>
  `${r.conditionId}|${r.caseId}|${r.trial}`;

/** Parses trials JSONL. The last row for a key wins, so a retried trial replaces its infra row. */
export function parseTrialsJsonl(text: string): TrialRow[] {
  const byKey = new Map<string, TrialRow>();
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    const row = JSON.parse(line) as TrialRow;
    byKey.set(trialKey(row), row);
  }
  return [...byKey.values()];
}

/**
 * Whether two trial rows record the same outcome. Ignores identifiers, clock
 * times and latency, which legitimately differ between two executions.
 */
export function sameOutcome(a: TrialRow, b: TrialRow): boolean {
  const strip = (r: TrialRow) => ({
    conditionId: r.conditionId,
    caseId: r.caseId,
    trial: r.trial,
    status: r.status,
    reason: r.reason,
    invocations: r.invocations,
    overReach: r.overReach,
    overReachControls: r.overReachControls,
    contextIntact: r.contextIntact,
    observations: r.observations,
  });
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
}
