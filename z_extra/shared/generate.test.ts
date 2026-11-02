import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { parseCasesJsonl, toJsonl, validateCase } from "./cases.ts";
import { generateCandidates, poolOf, selectCases } from "./generate.ts";

describe("generateCandidates", () => {
  const { candidates } = generateCandidates();

  test("every candidate satisfies its precondition", () => {
    for (const c of candidates) assert.deepEqual(validateCase({ ...c, id: "t" }), [], c.description);
  });

  test("covers all five core relations", () => {
    const relations = new Set(candidates.map((c) => c.relation));
    for (const r of ["MR_CE", "MR_AC", "MR_CA", "MR_REV", "MR_COMP"]) assert.ok(relations.has(r as never), r);
  });

  test("includes the Figure 1.2 case-invariance pair", () => {
    const fig = candidates.find(
      (c) => c.relation === "MR_CE" &&
        c.sourceTrace[0] === "show electronics under $100 sorted by rating" &&
        c.followupTrace[0] === "SHOW ELECTRONICS UNDER $100 SORTED BY RATING",
    );
    assert.ok(fig);
  });

  test("includes the proposal's MR_COMP example and an idempotence case", () => {
    assert.ok(candidates.some((c) => c.relation === "MR_COMP" && c.sourceTrace.length === 3));
    assert.ok(candidates.some((c) => c.relation === "MR_COMP" && c.strata.includes("idempotence")));
  });
});

describe("selectCases", () => {
  const { candidates } = generateCandidates();

  test("is deterministic for a seed", () => {
    const a = selectCases(candidates, { seed: 7, groups: 5, perGroup: 2 });
    const b = selectCases(candidates, { seed: 7, groups: 5, perGroup: 2 });
    assert.equal(toJsonl(a.cases), toJsonl(b.cases));
  });

  test("respects groups and per-group limits", () => {
    const { cases } = selectCases(candidates, { seed: 1, groups: 3, perGroup: 2, relations: ["MR_CA"] });
    assert.ok(new Set(cases.map((c) => c.semanticGroup)).size <= 3);
    assert.ok(cases.length <= 6);
  });

  test("reports pools with too few semantic groups", () => {
    const { shortfalls } = selectCases(candidates, { seed: 1, groups: 10, perGroup: 1, relations: ["MR_REV"] });
    assert.equal(shortfalls[0]?.pool, "MR_REV");
  });

  test("selects the two MR_CE families as separate pools with their own quotas", () => {
    const { cases } = selectCases(candidates, { seed: 1, groups: 4, perGroup: 1, relations: ["MR_CE"] });
    const para = cases.filter((c) => poolOf(c) === "MR_CE:para");
    const surface = cases.filter((c) => poolOf(c) === "MR_CE:surface");
    assert.equal(para.length, 4);
    assert.ok(para.every((c) => c.id.startsWith("CEP-") && !c.strata.some((t) => t.startsWith("transform:"))));
    // 4 random surface cases plus the pinned Figure 1.2 case.
    assert.equal(surface.length, 5);
    assert.ok(surface.every((c) => c.id.startsWith("CES-")));
  });

  test("always includes the Figure 1.2 case, whatever the seed", () => {
    for (const seed of [1, 2, 3, 99]) {
      const { cases } = selectCases(candidates, { seed, groups: 2, perGroup: 1, relations: ["MR_CE"] });
      assert.equal(cases.filter((c) => c.strata.includes("pinned:figure-1.2")).length, 1, `seed ${seed}`);
    }
  });

  test("includes context amnesia by default", () => {
    const { cases } = selectCases(candidates, { seed: 1, groups: 1, perGroup: 1 });
    assert.ok(cases.some((c) => c.relation === "CONTEXT_AMNESIA"));
  });
});

test("the committed pilot test set parses and validates", () => {
  const { cases, problems } = parseCasesJsonl(readFileSync("cases/pilot.jsonl", "utf8"));
  assert.deepEqual(problems, []);
  assert.ok(cases.length > 0);
});
