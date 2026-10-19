import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseCasesJsonl } from "./cases.ts";
import { summarizeSuite } from "./suite-summary.ts";

test("summarizeSuite accounts for every case and names each row's operators", () => {
  const { cases } = parseCasesJsonl(readFileSync("cases/pilot.jsonl", "utf8"));
  const rows = summarizeSuite(cases);
  assert.equal(rows.reduce((s, r) => s + r.cases, 0), cases.length);
  for (const r of rows) {
    assert.ok(r.checks.length > 0, `${r.group} has a relation name`);
    assert.equal(r.operators.reduce((s, o) => s + o.cases, 0), r.cases, `${r.group} operators add up`);
    assert.ok(r.operators.every((o) => o.key !== "other"), `${r.group} has no unlabelled operator`);
    for (const operator of r.operators) {
      const actual = cases.find((c) => c.id === operator.example.id)!;
      assert.ok(actual, `${operator.label} uses a case from the selected suite`);
      assert.deepEqual(operator.example.sourceTrace, actual.sourceTrace);
      assert.deepEqual(operator.example.followupTrace, actual.followupTrace);
    }
  }
  const surface = rows.find((r) => r.group === "MR_CE (surface)")!;
  assert.ok(surface.operators.some((o) => o.label === "Uppercase"));
});

test("relation names match the proposal and examples follow the selected test cases", () => {
  const { cases } = parseCasesJsonl(readFileSync("cases/pilot.jsonl", "utf8"));
  const rows = summarizeSuite(cases);
  assert.deepEqual(rows.map((r) => r.checks), [
    "Control Equivalence", "Control Equivalence", "Additive Constraining",
    "Commuting Actions", "Commuting Actions", "Action Reversibility", "Composition",
  ]);
  for (const row of rows) {
    for (const operator of row.operators) {
      const remaining = cases.filter((c) => c.id !== operator.example.id);
      for (const updated of summarizeSuite(remaining)) {
        for (const op of updated.operators) {
          assert.notEqual(op.example.id, operator.example.id, "excluded cases cannot appear as examples");
        }
      }
    }
  }
});
