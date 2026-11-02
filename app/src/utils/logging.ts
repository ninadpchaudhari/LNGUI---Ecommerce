/**
 * In-session export of the two research artifacts.
 *
 * The server-side records in D1/JSONL are authoritative and survive reloads;
 * these exports are for pulling a session straight into a spreadsheet or an
 * analysis script.
 */
import type { ControlId, MrCaseRecord, TurnRecord } from "../../shared/contract.ts";

function esc(value: unknown): string {
  const s =
    value === null || value === undefined
      ? ""
      : typeof value === "string"
        ? value
        : typeof value === "object"
          ? JSON.stringify(value)
          : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(headers: readonly string[], rows: unknown[][]): string {
  return [headers.join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n");
}

const ids = (list: readonly ControlId[] | null): string =>
  list === null ? "" : list.join(" ");

/**
 * One flat row per transition. This is the replay log as a spreadsheet, and the
 * table the §4.15 metrics are computed from.
 */
export const TURN_CSV_HEADERS = [
  "id", "sessionId", "createdAt", "turnIndex", "kind", "relation", "role", "trial",
  "utterance", "ok", "error",
  "mode", "provider", "requestedModel", "resolvedModel", "temperature", "topP",
  "systemPromptHash", "commandMode", "historyPolicy", "historyMaxTurns", "clearActionEnabled",
  "historyEffective", "historyDisplayed",
  "attempts", "repaired", "totalLatencyMs", "promptTokens", "completionTokens",
  "totalTokens", "costUsd", "errorCode",
  "countBefore", "countAfter", "countDelta",
  "fp", "writeSet", "applied", "rejected",
  "overReach", "overReachControls", "contextIntact",
  "langfuseTraceId", "q", "vBefore", "vAfter",
] as const;

export function exportTurnsCsv(turns: readonly TurnRecord[]): string {
  return toCsv(
    TURN_CSV_HEADERS,
    turns.map((t) => {
      const m = t.meta;
      const u = m?.usageTotal;
      return [
        t.id, t.sessionId, t.createdAt, t.turnIndex, t.kind, t.relation, t.role, t.trial,
        t.u, t.ok ? 1 : 0, t.error,
        m?.mode, m?.provider, m?.P.requestedModel, m?.P.resolvedModel,
        m?.P.temperature, m?.P.topP, m?.P.systemPromptHash, m?.P.commandMode,
        m?.P.historyPolicy, m?.P.historyMaxTurns,
        m?.P.clearActionEnabled === undefined ? "" : m.P.clearActionEnabled ? 1 : 0,
        m?.historyTurnsEffective, m?.historyTurnsDisplayed,
        m?.attempts.length, m?.repaired ? 1 : 0, m?.totalLatencyMs,
        u?.promptTokens, u?.completionTokens, u?.totalTokens, u?.costUsd, m?.error?.code,
        t.dBefore.count, t.dAfter.count, t.dAfter.count - t.dBefore.count,
        ids(t.fp), ids(t.writeSet), ids(t.applied),
        t.rejected.map((r) => `${r.control}=${JSON.stringify(r.value)}:${r.reason}`).join(" "),
        t.flags.commandOverReach ? 1 : 0, ids(t.flags.overReachControls),
        t.flags.contextIntact ? 1 : 0,
        m?.langfuse.traceId, t.q, t.vBefore, t.vAfter,
      ];
    }),
  );
}

/** One row per MR test case: the report T of Algorithm 1. */
export const CASE_CSV_HEADERS = [
  "id", "sessionId", "createdAt", "relation", "predicate", "legacyName",
  "sourceTrace", "followupTrace", "n", "epsilon", "fails", "failureRate", "verdict",
  "skipReason", "covNL", "covMR", "firstFailureMs", "mediatorInvocations", "totalTokens",
  "evidenceTurnIds",
] as const;

export function exportCasesCsv(cases: readonly MrCaseRecord[]): string {
  return toCsv(
    CASE_CSV_HEADERS,
    cases.map((c) => [
      c.id, c.sessionId, c.createdAt, c.relation, c.predicate, c.legacyName,
      c.sourceTrace.join(" | "), c.followupTrace.join(" | "),
      c.n, c.epsilon, c.fails, c.failureRate.toFixed(4), c.verdict,
      c.skipReason, c.covNL.toFixed(4), c.covMR.toFixed(4),
      c.firstFailureMs, c.mediatorInvocations, c.totalTokens,
      c.evidenceTurnIds.join(" "),
    ]),
  );
}

export function exportSessionJson(payload: {
  sessionId: string;
  turns: readonly TurnRecord[];
  cases: readonly MrCaseRecord[];
}): string {
  return JSON.stringify(
    { schemaVersion: 1, exportedAt: new Date().toISOString(), ...payload },
    null,
    2,
  );
}

export function downloadFile(content: string, filename: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
