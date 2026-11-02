/**
 * Three oracles over one recorded run, for RQ1 (proposal §5.7): the MR checker
 * (the trial's recorded status), the implicit oracle (a pure function of the
 * turns: an error, a malformed reply or a rejected value), and an LLM judge
 * (judge.jsonl, written by scripts/judge.ts). Nothing here recomputes the MR
 * verdict; it reads it.
 */
import type { TurnRecord } from "./contract.ts";
import type { TrialRow } from "./trials.ts";
import { reportGroup, type Table } from "./report.ts";

/** One judged turn, one line of judge.jsonl. */
export interface JudgeRow {
  schemaVersion: 1;
  runId: string;
  conditionId: string;
  caseId: string;
  trial: number;
  turnId: string;
  /** "invalid": the judge's reply could not be read; "error": the call failed. Neither counts as a verdict. */
  verdict: "pass" | "fail" | "invalid" | "error";
  reason: string | null;
  raw: string | null;
  /** The judge's P: everything that decides its verdict apart from the turn. */
  judge: { provider: "openrouter"; model: string; resolvedModel: string | null; reasoningEffort: string; maxTokens: number; promptFile: string; promptSha256: string };
  usage: { promptTokens: number | null; completionTokens: number | null; costUsd: number | null } | null;
  latencyMs: number;
  createdAt: string;
}

/** The implicit oracle: a turn that errored, was malformed, or had a value rejected. No model involved. */
export const implicitTurnFails = (t: TurnRecord): boolean => !t.ok || t.rejected.length > 0;

/** A trial's judge verdict: fail if any turn fails; null unless every turn has a pass or fail verdict. */
export function judgeTrialVerdict(trial: TrialRow, judged: ReadonlyMap<string, JudgeRow>): "pass" | "fail" | null {
  const verdicts = trial.turnIds.map((id) => judged.get(id)?.verdict);
  if (verdicts.some((v) => v !== "pass" && v !== "fail")) return null;
  return verdicts.includes("fail") ? "fail" : "pass";
}

/**
 * One row per configuration × relation group: trials, failures by each oracle,
 * and where the MR checker and the judge agree or not. Infra trials are left
 * out, as in the report, so the MR column equals the report's failure count.
 */
export function oracleTable(
  rows: readonly TrialRow[],
  turns: ReadonlyMap<string, TurnRecord>,
  judged: ReadonlyMap<string, JudgeRow> | null,
  title: string,
): Table {
  const groups = new Map<string, TrialRow[]>();
  for (const r of rows) {
    if (r.status === "infra") continue;
    const key = `${r.conditionId}\u0000${reportGroup(r)}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const out: Array<Record<string, string>> = [];
  for (const [key, trials] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    const [configuration, mr] = key.split("\u0000");
    const mrFail = (t: TrialRow) => t.status === "fail";
    const implicit = trials.filter((t) => t.turnIds.some((id) => {
      const turn = turns.get(id);
      return turn !== undefined && implicitTurnFails(turn);
    })).length;
    const row: Record<string, string> = {
      configuration, mr, trials: String(trials.length),
      mrFail: String(trials.filter(mrFail).length),
      implicit: String(implicit),
    };
    if (judged) {
      const both = trials.map((t) => ({ mr: mrFail(t), judge: judgeTrialVerdict(t, judged) })).filter((x) => x.judge !== null);
      row.judged = String(both.length);
      row.judgeFail = String(both.filter((x) => x.judge === "fail").length);
      row.bothFail = String(both.filter((x) => x.mr && x.judge === "fail").length);
      row.mrOnly = String(both.filter((x) => x.mr && x.judge === "pass").length);
      row.judgeOnly = String(both.filter((x) => !x.mr && x.judge === "fail").length);
    }
    out.push(row);
  }
  const columns = [
    { key: "configuration", label: "Configuration", numeric: false },
    { key: "mr", label: "MR", numeric: false },
    { key: "trials", label: "Trials", numeric: true },
    { key: "mrFail", label: "MR fail", numeric: true },
    { key: "implicit", label: "Implicit fail", numeric: true },
    ...(judged ? [
      { key: "judged", label: "Judged", numeric: true },
      { key: "judgeFail", label: "Judge fail", numeric: true },
      { key: "bothFail", label: "Both fail", numeric: true },
      { key: "mrOnly", label: "MR only", numeric: true },
      { key: "judgeOnly", label: "Judge only", numeric: true },
    ] : []),
  ];
  return { title, columns, rows: out };
}
