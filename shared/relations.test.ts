/**
 * Tests for the relation checker and the case precondition validator. Check
 * is the MR oracle, and validateCase decides what may enter a frozen test set.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import type { Command, CommandMeta, PromptConfig, TurnRecord } from "./contract.ts";
import { resetState, step } from "./transition.ts";
import { check, isInfraFailure, type MrInstance, type TraceResult } from "./relations.ts";
import { validateCase, type MrCase } from "./cases.ts";

const P: PromptConfig = {
  requestedModel: "test",
  resolvedModel: null,
  temperature: 0,
  topP: 1,
  systemPromptHash: "h",
  commandSchemaHash: "h",
  historyPolicy: "full",
  historyMaxTurns: null,
  clearActionEnabled: true,
};

function q(filters: Partial<Command["filters"]>, sort: Command["sort"] = null): Command {
  return {
    filters: { category: null, maxPrice: null, minRating: null, inStockOnly: null, ...filters },
    sort,
    explanation: "test",
  };
}

/** A trace produced by applying fixed commands, standing in for M. */
function trace(commands: Command[]): TraceResult {
  let state = resetState(P);
  const records: TurnRecord[] = [];
  commands.forEach((c, i) => {
    const before = state;
    state = step(state, `u${i}`, c, { clearActionEnabled: true }).state;
    records.push({ ok: true, fp: [], writeSet: null, error: null, meta: null, vBefore: before.V } as unknown as TurnRecord);
  });
  return { state, records };
}

const instance = (relation: MrInstance["relation"], extra: Partial<MrInstance> = {}): MrInstance => ({
  relation,
  predicate: "test",
  legacyName: null,
  description: "",
  sourceTrace: [],
  followupTrace: [],
  writeSets: { source: [], followup: [] },
  ...extra,
});

describe("check — MR_CE and MR_COMP use observational equality", () => {
  test("equal observations hold", () => {
    const r = check(instance("MR_CE"), trace([q({ category: "books" })]), trace([q({ category: "books" })]));
    assert.equal(r.holds, true);
  });

  test("a V difference fails even when D matches", () => {
    // maxPrice 500 vs 400 excludes nothing in this catalog: same D, different V.
    const r = check(instance("MR_CE"), trace([q({ maxPrice: 400 })]), trace([q({})]));
    assert.equal(r.holds, false);
    assert.equal(r.reason, "V differs (D matched)");
  });

  test("MR_COMP compares the end of the sequence with the composed utterance", () => {
    const seq = trace([q({ category: "electronics" }), q({ category: "electronics", maxPrice: 100 })]);
    const one = trace([q({ category: "electronics", maxPrice: 100 })]);
    assert.equal(check(instance("MR_COMP"), seq, one).holds, true);

    // The second turn dropped the category: constraint lost across turns.
    const leaky = trace([q({ category: "electronics" }), q({ maxPrice: 100 })]);
    assert.equal(check(instance("MR_COMP"), leaky, one).holds, false);
  });
});

describe("check — failed turns", () => {
  const failed = (meta: Partial<CommandMeta> | null): TraceResult => ({
    state: resetState(P),
    records: [{ ok: false, error: "boom", meta } as unknown as TurnRecord],
  });

  test("a provider error is infrastructure, not a violation of the mediator", () => {
    const r = check(instance("MR_CE"), failed({ error: { code: "llm_error", message: "timeout" } }), trace([]));
    assert.equal(r.holds, false);
    assert.equal(r.infra, true);
  });

  test("a schema-invalid command is the mediator's own failure", () => {
    const r = check(instance("MR_CE"), failed({ error: { code: "schema_invalid", message: "bad" } }), trace([]));
    assert.equal(r.infra, false);
  });

  test("no meta at all means the request never arrived", () => {
    assert.equal(isInfraFailure({ ok: false, meta: null } as unknown as TurnRecord), true);
  });
});

describe("validateCase — preconditions from labels", () => {
  const base = (c: Partial<MrCase>): MrCase => ({
    id: "X",
    relation: "MR_CE",
    predicate: "Para",
    semanticGroup: "g",
    strata: [],
    legacyName: null,
    description: "",
    sourceTrace: [],
    followupTrace: [],
    writeSets: { source: [], followup: [] },
    provenance: { generator: "manual", sources: [] },
    ...c,
  });

  test("MR_CA rejects overlapping write sets", () => {
    const problems = validateCase(base({
      relation: "MR_CA",
      sourceTrace: ["show books", "show items under $50"],
      followupTrace: ["show items under $50", "show books"],
      writeSets: { source: [["category"], ["category"]], followup: [["category"], ["category"]] },
    }));
    assert.ok(problems.some((p) => p.includes("overlap")), problems.join());
  });

  test("MR_COMP requires the composed W to be the union of the sequence", () => {
    const ok = base({
      relation: "MR_COMP",
      sourceTrace: ["show books", "under $50"],
      followupTrace: ["show books under $50"],
      writeSets: { source: [["category"], ["maxPrice"]], followup: [["category", "maxPrice"]] },
    });
    assert.deepEqual(validateCase(ok), []);
    const bad = { ...ok, writeSets: { source: ok.writeSets.source, followup: [["category" as const]] } };
    assert.ok(validateCase(bad).length > 0);
  });

  test("MR_AC rejects a refinement of a control the base already writes", () => {
    const problems = validateCase(base({
      relation: "MR_AC",
      sourceTrace: ["show items under $100"],
      followupTrace: ["show items under $100 under $50"],
      writeSets: { source: [["maxPrice"]], followup: [["maxPrice"]] },
      refinement: { control: "maxPrice", value: 50 },
    }));
    assert.ok(problems.some((p) => p.includes("already writes")), problems.join());
  });

  test("MR_AC rejects a non-constraining target such as sort", () => {
    const problems = validateCase(base({
      relation: "MR_AC",
      sourceTrace: ["show books"],
      followupTrace: ["show books sorted by name"],
      writeSets: { source: [["category"]], followup: [["category", "sort"]] },
      refinement: { control: "sort", value: "name_asc" },
    }));
    assert.ok(problems.some((p) => p.includes("C_con")), problems.join());
  });

  test("MR_REV starts from σ₀ and needs a reversible forward control", () => {
    const problems = validateCase(base({
      relation: "MR_REV",
      followupTrace: ["clear all filters", "undo that"],
      writeSets: { source: [], followup: [["clearFilters"], ["clearFilters"]] },
    }));
    assert.ok(problems.some((p) => p.includes("irreversible")), problems.join());
  });
});
