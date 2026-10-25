import { test } from "node:test";
import assert from "node:assert/strict";

import type { TurnRecord } from "./contract.ts";
import type { TrialRow } from "./trials.ts";
import { implicitTurnFails, judgeTrialVerdict, oracleTable, type JudgeRow } from "./oracles.ts";
import { summaryTable } from "./report.ts";

const trial = (caseId: string, n: number, status: TrialRow["status"], turnIds: string[]): TrialRow => ({
  schemaVersion: 1, runId: "r", conditionId: "c", caseId, relation: "MR_CE", semanticGroup: caseId, strata: ["ce:para"],
  trial: n, attempt: 1, status, reason: status, invocations: turnIds.length, tokens: null, costUsd: null, latencyMs: 1,
  overReach: false, overReachControls: [], contextIntact: true, resolvedModels: [], providers: [],
  observations: { source: {} as never, followup: {} as never }, turnIds, createdAt: "",
});
const turn = (id: string, extra: Partial<TurnRecord> = {}): TurnRecord => ({ id, ok: true, rejected: [], ...extra }) as TurnRecord;
const verdict = (turnId: string, v: JudgeRow["verdict"]): JudgeRow => ({ turnId, verdict: v }) as JudgeRow;

test("the implicit oracle fails a turn on an error or a rejected value only", () => {
  assert.equal(implicitTurnFails(turn("a")), false);
  assert.equal(implicitTurnFails(turn("a", { ok: false })), true);
  assert.equal(implicitTurnFails(turn("a", { rejected: [{ control: "minRating", value: 4.2, reason: "x" }] as never })), true);
});

test("a trial fails the judge if any turn fails, and has no verdict until every turn has one", () => {
  const t = trial("A", 1, "pass", ["a", "b"]);
  assert.equal(judgeTrialVerdict(t, new Map([["a", verdict("a", "pass")], ["b", verdict("b", "pass")]])), "pass");
  assert.equal(judgeTrialVerdict(t, new Map([["a", verdict("a", "pass")], ["b", verdict("b", "fail")]])), "fail");
  assert.equal(judgeTrialVerdict(t, new Map([["a", verdict("a", "pass")]])), null, "b not judged yet");
  assert.equal(judgeTrialVerdict(t, new Map([["a", verdict("a", "fail")], ["b", verdict("b", "invalid")]])), null, "an unreadable reply is no verdict");
});

test("the table counts each oracle and the overlaps, and its MR column is the report's", () => {
  const rows = [
    trial("A", 1, "fail", ["a1", "a2"]), // MR fails, judge fails, implicit fails
    trial("B", 1, "fail", ["b1", "b2"]), // MR fails, judge passes
    trial("C", 1, "pass", ["c1", "c2"]), // MR passes, judge fails
    trial("D", 1, "pass", ["d1", "d2"]), // both pass; not judged on d2
    trial("E", 1, "infra", ["e1"]), // left out everywhere
  ];
  const turns = new Map([...rows.flatMap((r) => r.turnIds)].map((id) => [id, turn(id, id === "a2" ? { ok: false } : {})]));
  const judged = new Map<string, JudgeRow>([
    ["a1", verdict("a1", "pass")], ["a2", verdict("a2", "fail")],
    ["b1", verdict("b1", "pass")], ["b2", verdict("b2", "pass")],
    ["c1", verdict("c1", "fail")], ["c2", verdict("c2", "pass")],
    ["d1", verdict("d1", "pass")],
  ]);
  const [row] = oracleTable(rows, turns, judged, "t").rows;
  assert.deepEqual(row, {
    configuration: "c", mr: "MR_CE (para)", trials: "4", mrFail: "2", implicit: "1",
    judged: "3", judgeFail: "2", bothFail: "1", mrOnly: "1", judgeOnly: "1",
  });
  const report = summaryTable(rows, [1], "t").rows[0];
  assert.equal(report.trials, row.trials, "same trials as the report");
  assert.equal(report.rate, "50.0%", "and the report's failures: 2 of 4");
  assert.equal(oracleTable(rows, turns, null, "t").columns.some((c) => c.key === "judged"), false, "no judge columns without judge.jsonl");
});
