import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { caseStats, failAtK, latexEscape, render, reportGroup, reportTitle, runModeLabel, summaryTable } from "./report.ts";
import type { TrialRow } from "./trials.ts";

describe("failAtK", () => {
  test("matches the worked example in Chapter 5 (2 failures in 10 runs)", () => {
    assert.ok(Math.abs(failAtK(10, 2, 1)! - 0.2) < 1e-12);
    assert.ok(Math.abs(failAtK(10, 2, 3)! - (1 - 56 / 120)) < 1e-12); // ≈ 0.533
    assert.ok(Math.abs(failAtK(10, 2, 5)! - (1 - 56 / 252)) < 1e-12); // ≈ 0.778
  });

  test("is 0 with no failures, 1 once k exceeds the passing trials, null past N", () => {
    assert.equal(failAtK(10, 0, 5), 0);
    assert.equal(failAtK(10, 8, 3), 1);
    assert.equal(failAtK(3, 1, 5), null);
  });
});

const row = (caseId: string, trial: number, status: TrialRow["status"], extra: Partial<TrialRow> = {}): TrialRow => ({
  schemaVersion: 1,
  runId: "r",
  conditionId: "c",
  caseId,
  relation: "MR_CE",
  semanticGroup: `g-${caseId}`,
  strata: [],
  trial,
  attempt: 1,
  status,
  reason: status,
  invocations: 2,
  tokens: 10,
  costUsd: null,
  latencyMs: 1,
  overReach: false,
  overReachControls: [],
  contextIntact: true,
  resolvedModels: [],
  providers: [],
  observations: { source: {} as never, followup: {} as never },
  turnIds: [],
  createdAt: "",
  ...extra,
});

describe("summaries", () => {
  const rows = [
    row("A", 1, "pass"), row("A", 2, "fail"), row("A", 3, "pass"),
    row("B", 1, "pass"), row("B", 2, "pass"), row("B", 3, "infra"),
  ];

  test("infrastructure trials are excluded from N and counted apart", () => {
    const b = caseStats(rows).find((s) => s.caseId === "B")!;
    assert.equal(b.n, 2);
    assert.equal(b.infra, 1);
    assert.equal(b.firstFailure, null);
  });

  test("the first failure is the earliest failing trial", () => {
    assert.equal(caseStats(rows).find((s) => s.caseId === "A")!.firstFailure, 2);
  });

  test("summary rows report the pass / intermittent / fail split", () => {
    const t = summaryTable(rows, [1], "t");
    assert.equal(t.rows.length, 1);
    assert.equal(t.rows[0].split, "1 / 1 / 0");
    assert.equal(t.rows[0].trials, "5");
    assert.equal(t.rows[0].infra, "1");
  });

  test("renders every format", () => {
    const t = summaryTable(rows, [1, 3], "Pilot_results 100%");
    assert.match(render(t, "md"), /^\| Configuration/);
    const tex = render(t, "latex");
    assert.match(tex, /\$MR_\{CE\}\$/);
    assert.match(tex, /Pilot\\_results 100\\%/);
    assert.equal(render(t, "csv").split("\n").length, 2);
  });
});

describe("reportGroup", () => {
  test("splits MR_CE by generation family", () => {
    assert.equal(reportGroup({ relation: "MR_CE", strata: ["ce:para", "template-pair"] }), "MR_CE (para)");
    assert.equal(reportGroup({ relation: "MR_CE", strata: ["ce:surface", "transform:uppercase"] }), "MR_CE (surface)");
  });

  test("reports context amnesia as MR_CA’s context-amnesia extension", () => {
    assert.equal(reportGroup({ relation: "CONTEXT_AMNESIA", strata: [] }), "MR_CA (context amnesia)");
    assert.equal(reportGroup({ relation: "MR_CA", strata: [] }), "MR_CA");
  });

  test("gives each group its own summary row, in Table 4.1 order", () => {
    const rows = [
      row("S", 1, "fail", { strata: ["ce:surface"] }),
      row("P", 1, "pass", { strata: ["ce:para"] }),
      row("X", 1, "pass", { relation: "CONTEXT_AMNESIA" }),
      row("Y", 1, "pass", { relation: "MR_CA" }),
    ];
    const t = summaryTable(rows, [1], "t");
    assert.deepEqual(t.rows.map((r) => r.mr), ["MR_CE (para)", "MR_CE (surface)", "MR_CA", "MR_CA (context amnesia)"]);
    assert.match(render(t, "latex"), /\$MR_\{CA\}\$ \(context amnesia\)/);
  });
});

test("latexEscape handles the characters that break a tabular", () => {
  assert.equal(latexEscape("a_b & 5% $x #1"), "a\\_b \\& 5\\% \\$x \\#1");
});

describe("run mode label", () => {
  test("marks a dry run so it cannot pass for a model run", () => {
    assert.equal(runModeLabel([row("A", 1, "pass", { mode: "local-test" })]), "dry run — local parser");
    assert.equal(reportTitle("r", [row("A", 1, "pass", { mode: "local-test" })]), "MR results, r (dry run — local parser)");
    assert.equal(runModeLabel([row("A", 1, "pass", { mode: "llm" })]), "LLM");
  });

  test("flags mixed rows, and says nothing when no row records its mode", () => {
    assert.equal(runModeLabel([row("A", 1, "pass", { mode: "llm" }), row("B", 1, "pass", { mode: "local-test" })]), "mixed: dry run and LLM");
    assert.equal(runModeLabel([row("A", 1, "pass")]), null);
    assert.equal(reportTitle("r", [row("A", 1, "pass")]), "MR results, r");
  });
});
