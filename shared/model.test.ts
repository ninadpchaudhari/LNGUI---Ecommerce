/**
 * Tests for the pure model operations. These functions *are* the oracle, so a
 * defect here silently corrupts every verdict the harness reports.
 *
 * Run with `npm test` (node:test via tsx — no extra dependencies).
 *
 * Where possible the expected values are taken from Appendix A of the proposal,
 * so the code is checked against the written model rather than against itself.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  CONTROL_IDS,
  V0,
  type Valuation,
} from "./surface.generated.ts";
import {
  active,
  covMR,
  covNL,
  dataEqual,
  dataSubset,
  footprint,
  hashString,
  inDomain,
  observationallyEqual,
  overReach,
  pointUpdate,
  resetValuation,
  unreachedControls,
  valuationEqual,
  verdictFor,
  type Command,
  type DataState,
  type HistoryTurn,
  type SortValue,
} from "./contract.ts";
import { applyCommand, renderData, resetState, step, visibleProducts } from "./transition.ts";
import { effectiveHistory, renderHistory } from "./history.ts";
import { inferWriteSet } from "../src/utils/relations.ts";


function cmd(
  partial: Partial<Command["filters"]> & { sort?: SortValue | null; clearFilters?: boolean },
): Command {
  const { sort, clearFilters, ...filters } = partial;
  return { filters, ...(sort === undefined ? {} : { sort }),
    ...(clearFilters === undefined ? {} : { clearFilters }), explanation: "test" };

}

describe("control surface", () => {
  test("|C| = 6, per Appendix A.1", () => {
    assert.equal(CONTROL_IDS.length, 6);
    assert.deepEqual([...CONTROL_IDS], [
      "category", "maxPrice", "minRating", "inStockOnly", "sort", "clearFilters",
    ]);
  });

  test("V0 is a total map over C", () => {
    for (const c of CONTROL_IDS) assert.ok(c in V0, `V0 missing ${c}`);
  });

  test("active(V) excludes bottom, per Eq. 4.3", () => {
    // V0 has maxPrice=500 and inStockOnly=false active; the rest are bottom.
    assert.deepEqual(active(resetValuation()), ["maxPrice", "inStockOnly"]);
  });
});

describe("inDomain", () => {
  test("accepts bottom for every control", () => {
    for (const c of CONTROL_IDS) assert.ok(inDomain(c, null), `${c} should accept null`);
  });

  test("rejects an off-domain rating the mediator might invent", () => {
    assert.ok(inDomain("minRating", 4));
    assert.ok(!inDomain("minRating", 4.2));
  });

  test("bounds maxPrice by its declared range", () => {
    assert.ok(inDomain("maxPrice", 0));
    assert.ok(inDomain("maxPrice", 500));
    assert.ok(!inDomain("maxPrice", 501));
    assert.ok(!inDomain("maxPrice", -1));
  });

  test("rejects an unknown category", () => {
    assert.ok(inDomain("category", "books"));
    assert.ok(!inDomain("category", "groceries"));
  });
});

describe("pointUpdate — Eq. 4.13", () => {
  test("sets the requested control and moves nothing else", () => {
    const V = resetValuation();
    const next = pointUpdate(V, "category", "books");
    assert.equal(next.category, "books");
    for (const c of CONTROL_IDS) {
      if (c !== "category") assert.equal(next[c], V[c], `${c} moved`);
    }
  });
});

describe("footprint — Eq. 4.15", () => {
  test("is empty for an unchanged valuation", () => {
    assert.deepEqual(footprint(resetValuation(), resetValuation()), []);
  });

  test("includes a control that changed value while staying active", () => {
    // §4.6: red -> blue is in the footprint even though the control stays active.
    const a = pointUpdate(resetValuation(), "category", "books");
    const b = pointUpdate(resetValuation(), "category", "home");
    assert.deepEqual(footprint(a, b), ["category"]);
  });

  test("includes a control moved off bottom", () => {
    const after = pointUpdate(resetValuation(), "minRating", 4);
    assert.deepEqual(footprint(resetValuation(), after), ["minRating"]);
  });
});

describe("overReach — the fp ⊆ W standing check (§4.6)", () => {
  test("is empty when the footprint is within the write set", () => {
    assert.deepEqual(overReach(["category"], ["category", "maxPrice"]), []);
  });

  test("names the undeclared control — the Figure 1.2 signature", () => {
    // "show electronics under $100" declares {category, maxPrice}; the uppercase
    // variant also moved minRating, which no utterance requested.
    assert.deepEqual(
      overReach(["category", "maxPrice", "minRating"], ["category", "maxPrice"]),
      ["minRating"],
    );
  });
});

describe("Apply — q → V′", () => {
  test("partial updates preserve unrelated controls and expose over-reach", () => {
    const dirty = { ...resetValuation(), category: "books", maxPrice: 50 } as Valuation;
    const result = applyCommand(dirty, cmd({ inStockOnly: true }));
    assert.equal(result.V.category, "books");
    assert.equal(result.V.maxPrice, 50);
    assert.deepEqual(footprint(dirty, result.V), ["inStockOnly"]);
    assert.deepEqual(applyCommand(dirty, cmd({})).V, dirty);
    const wrong = applyCommand(dirty, cmd({ inStockOnly: true, category: null }));
    assert.deepEqual(overReach(footprint(dirty, wrong.V), ["inStockOnly"]), ["category"]);
  });

  test("applies in-domain assignments and reports them", () => {
    const r = applyCommand(resetValuation(), cmd({ category: "books", maxPrice: 50 }));
    assert.equal(r.V.category, "books");
    assert.equal(r.V.maxPrice, 50);
    assert.deepEqual(r.rejected, []);
    assert.deepEqual(r.applied.sort(), ["category", "maxPrice"]);
  });

  test("a null field resolves to V₀(c), not to bottom", () => {
    // Explicit null resets only the named controls to their defaults.
    const dirty = { ...resetValuation(), maxPrice: 50, inStockOnly: true } as Valuation;
    const r = applyCommand(dirty, cmd({ category: "books", maxPrice: null, inStockOnly: null }));
    assert.equal(r.V.maxPrice, V0.maxPrice);
    assert.equal(r.V.inStockOnly, V0.inStockOnly);
    assert.equal(r.V.category, "books");
  });

  test("drops an out-of-domain value instead of coercing it", () => {
    // A mediator emitting minRating 4.2 is a mediator fault; clamping hides it.
    const r = applyCommand(resetValuation(), cmd({ minRating: 4.2 }));
    assert.equal(r.V.minRating, null, "off-domain value must not be applied");
    assert.equal(r.rejected.length, 1);
    assert.equal(r.rejected[0].control, "minRating");
    assert.equal(r.rejected[0].reason, "out-of-domain");
  });

  test("applies the rest of a partially valid command (§4.5)", () => {
    const r = applyCommand(
      resetValuation(),
      cmd({ category: "books", minRating: 4.2 }),
    );
    assert.equal(r.V.category, "books", "valid assignment should still land");
    assert.equal(r.V.minRating, null, "rejected assignment must not land");
    assert.deepEqual(r.applied, ["category"]);
    assert.equal(r.rejected.length, 1);
  });

  test("a null category does reach bottom, since V₀(category) is bottom", () => {
    const start = pointUpdate(resetValuation(), "category", "books");
    const r = applyCommand(start, cmd({ category: null }));
    assert.equal(r.V.category, null);
    assert.deepEqual(r.applied, ["category"]);
  });
});

describe("Apply — clearFilters (c₆)", () => {
  test("resets C to V₀ and sets its own sticky flag", () => {
    const dirty = { ...resetValuation(), category: "books", maxPrice: 50, minRating: 4 } as Valuation;
    const r = applyCommand(dirty, cmd({ clearFilters: true }));
    assert.equal(r.V.category, null);
    assert.equal(r.V.maxPrice, V0.maxPrice);
    assert.equal(r.V.minRating, null);
    assert.equal(r.V.clearFilters, "invoked");
  });

  test("puts c₆ in the footprint, which is what lets Cov_NL reach 6/6", () => {
    const r = applyCommand(resetValuation(), cmd({ clearFilters: true }));
    assert.ok(footprint(resetValuation(), r.V).includes("clearFilters"));
  });

  test("is idempotent, so clearing twice stays observationally equal to once", () => {
    // A counter here would leak H into O = ⟨V,D⟩.
    const once = applyCommand(resetValuation(), cmd({ clearFilters: true })).V;
    const twice = applyCommand(once, cmd({ clearFilters: true })).V;
    assert.ok(valuationEqual(once, twice));
  });

  test("cannot return to σ₀, which is why c₆ ∉ C_rev", () => {
    const cleared = applyCommand(resetValuation(), cmd({ clearFilters: true })).V;
    assert.ok(!valuationEqual(cleared, resetValuation()));
  });
});

describe("A — the canonical Appendix A.1 example", () => {
  test('"electronics under $100 sorted by rating" yields 3 products, rating-ordered', () => {
    const r = applyCommand(
      resetValuation(),
      cmd({ category: "electronics", maxPrice: 100, sort: "rating_desc" }),
    );
    const D = renderData(r.V);
    // Headphones 4.5, Speaker 4.0, USB-C Hub 3.5. The $149.99 Mechanical
    // Keyboard is excluded by the price clause.
    assert.equal(D.count, 3);
    assert.deepEqual(D.productIds, [1, 2, 3]);
    assert.equal(D.total, 20);
    assert.deepEqual(
      visibleProducts(r.V).map((p) => p.name),
      ["Wireless Headphones", "Bluetooth Speaker", "USB-C Hub"],
    );
  });

  test("V₀ shows the whole catalog", () => {
    const D = renderData(resetValuation());
    assert.equal(D.count, 20);
    assert.equal(D.total, 20);
  });

  test("inStockOnly drops the out-of-stock USB-C Hub", () => {
    const V = { ...resetValuation(), category: "electronics", inStockOnly: true } as Valuation;
    assert.deepEqual(renderData(V).productIds.sort(), [1, 2, 4]);
  });
});

describe("D comparators", () => {
  const ids = (productIds: number[]): DataState => ({
    productIds,
    count: productIds.length,
    total: 20,
  });

  test("dataEqual is order-sensitive, because sort is a control", () => {
    assert.ok(dataEqual(ids([1, 2, 3]), ids([1, 2, 3])));
    assert.ok(!dataEqual(ids([1, 2, 3]), ids([3, 2, 1])));
  });

  test("dataSubset is set containment, as MR_AC requires", () => {
    assert.ok(dataSubset(ids([1, 2]), ids([1, 2, 3])));
    // Order must not matter for containment.
    assert.ok(dataSubset(ids([2, 1]), ids([3, 2, 1])));
    assert.ok(!dataSubset(ids([1, 9]), ids([1, 2, 3])));
  });

  test("the two comparators genuinely differ", () => {
    // This is the pair that breaks MR_AC if the comparators are collapsed.
    assert.ok(dataSubset(ids([3, 2, 1]), ids([1, 2, 3])));
    assert.ok(!dataEqual(ids([3, 2, 1]), ids([1, 2, 3])));
  });
});

describe("observationallyEqual — Eq. 4.6", () => {
  test("ignores H and P, comparing only ⟨V,D⟩", () => {
    const P = {
      requestedModel: "m", resolvedModel: "m", temperature: 0, topP: 1,
      systemPromptHash: "h", commandSchemaHash: "h",
      historyPolicy: "full" as const, historyMaxTurns: null,
    };
    const a = resetState(P);
    // Reach the same V by a different route: one step that changes nothing.
    const b = step(a, "no-op", cmd({})).state;
    assert.notEqual(a.H.length, b.H.length, "histories should differ");
    assert.ok(observationallyEqual({ V: a.V, D: a.D }, { V: b.V, D: b.D }));
  });

  test("detects a V difference even when D is identical", () => {
    // maxPrice 500 vs 400 excludes nothing in this catalog, so D matches but V
    // does not. Under O = ⟨V,D⟩ this is a violation — there is no WEAK_PASS.
    const a = resetValuation();
    const b = pointUpdate(a, "maxPrice", 400);
    assert.ok(dataEqual(renderData(a), renderData(b)), "precondition: D matches");
    assert.ok(!observationallyEqual({ V: a, D: renderData(a) }, { V: b, D: renderData(b) }));
  });
});

describe("step — Eq. 4.9", () => {
  const P = {
    requestedModel: "m", resolvedModel: "m", temperature: 0, topP: 1,
    systemPromptHash: "h", commandSchemaHash: "h",
    historyPolicy: "full" as const, historyMaxTurns: null,
  };

  test("appends ⟨u,q,V′,D′⟩ to H and keeps P fixed", () => {
    const s0 = resetState(P);
    const q = cmd({ category: "books" });
    const { state } = step(s0, "show books", q);
    assert.equal(state.H.length, 1);
    assert.equal(state.H[0].u, "show books");
    assert.deepEqual(state.H[0].q, q);
    assert.equal(state.H[0].V.category, "books");
    assert.equal(state.H[0].D.count, 4);
    assert.equal(state.P, s0.P, "P must not drift across a transition");
  });

  test("a failed mediation still appends a turn but leaves V and D alone", () => {
    const s0 = resetState(P);
    const { state, fp } = step(s0, "???", null);
    assert.equal(state.H.length, 1);
    assert.deepEqual(fp, []);
    assert.ok(valuationEqual(state.V, s0.V));
  });
});

describe("coverage metrics", () => {
  test("Cov_NL reproduces the Appendix A.7 worked example of 3/6", () => {
    const covered = covNL([["category"], ["maxPrice"], ["sort"]]);
    assert.equal(covered, 3 / 6);
    assert.deepEqual(unreachedControls([["category"], ["maxPrice"], ["sort"]]), [
      "minRating", "inStockOnly", "clearFilters",
    ]);
  });

  test("Cov_NL reaches 1 only when every control including c₆ is moved", () => {
    assert.equal(covNL([[...CONTROL_IDS]]), 1);
  });

  test("Cov_MR counts a relation only when its precondition held", () => {
    assert.equal(covMR([{ relation: "MR_CE", verdict: "pass" }]), 1 / 5);
    assert.equal(
      covMR([{ relation: "MR_CE", verdict: "pass" }, { relation: "MR_CA", verdict: "skipped" }]),
      1 / 5,
      "a skipped case is not a valid instance",
    );
    assert.equal(
      covMR([
        { relation: "MR_CE", verdict: "pass" },
        { relation: "MR_AC", verdict: "fail" },
        { relation: "MR_CA", verdict: "pass" },
        { relation: "MR_REV", verdict: "fail" },
        { relation: "MR_COMP", verdict: "pass" },
      ]),
      1,
      "a failing case still exercised the relation",
    );
  });
});

describe("verdictFor — Eq. 4.18", () => {
  test("reports a violation strictly above epsilon", () => {
    // The §4.19.3 worked example: N=10, eps=0.2.
    assert.equal(verdictFor(1, 10, 0.2), "pass", "0.1 <= 0.2 is noise");
    assert.equal(verdictFor(2, 10, 0.2), "pass", "boundary is inclusive");
    assert.equal(verdictFor(3, 10, 0.2), "fail", "0.3 > 0.2 is a fault");
    assert.equal(verdictFor(8, 10, 0.2), "fail");
  });
});

describe("hashString", () => {
  test("is stable and differs on differing input", () => {
    assert.equal(hashString("abc"), hashString("abc"));
    assert.notEqual(hashString("abc"), hashString("abd"));
    assert.match(hashString("abc"), /^fnv1a32:[0-9a-f]{8}$/);
  });
});

describe("effectiveHistory — the context-management policy dial", () => {
  const turn = (u: string): HistoryTurn => ({
    u,
    q: cmd({}),
    V: resetValuation(),
    D: renderData(resetValuation()),
  });
  const H = [turn("one"), turn("two"), turn("three"), turn("four")];

  test('"full" sends every prior turn', () => {
    assert.equal(effectiveHistory(H, { policy: "full", maxTurns: null }).length, 4);
  });

  test('"last-k" truncates to the most recent k, the §1.2 mechanism', () => {
    const kept = effectiveHistory(H, { policy: "last-k", maxTurns: 2 });
    assert.deepEqual(kept.map((t) => t.u), ["three", "four"]);
  });

  test('"none" sends nothing — display-only history, amnesia at k = 0', () => {
    assert.deepEqual(effectiveHistory(H, { policy: "none", maxTurns: null }), []);
  });

  test("k = 0 under last-k degenerates to none", () => {
    assert.deepEqual(effectiveHistory(H, { policy: "last-k", maxTurns: 0 }), []);
  });

  test("the policy induces a monotone amount of retained context", () => {
    // The dose-response ordering the §5.4 sweep depends on.
    const sizes = [
      effectiveHistory(H, { policy: "none", maxTurns: null }).length,
      effectiveHistory(H, { policy: "last-k", maxTurns: 1 }).length,
      effectiveHistory(H, { policy: "last-k", maxTurns: 3 }).length,
      effectiveHistory(H, { policy: "full", maxTurns: null }).length,
    ];
    assert.deepEqual(sizes, [0, 1, 3, 4]);
    assert.deepEqual([...sizes].sort((a, b) => a - b), sizes, "must be non-decreasing");
  });
});

describe("renderHistory", () => {
  test("emits q as the assistant turn, per §4.5", () => {
    const q = cmd({ category: "books" });
    const msgs = renderHistory([
      { u: "show books", q, V: resetValuation(), D: renderData(resetValuation()) },
    ]);
    assert.deepEqual(msgs, [
      { role: "user", content: "show books" },
      { role: "assistant", content: JSON.stringify(q) },
    ]);
  });

  test("a failed turn still occupies a slot in the context", () => {
    const msgs = renderHistory([
      { u: "???", q: null, V: resetValuation(), D: renderData(resetValuation()) },
    ]);
    assert.equal(msgs.length, 2);
    assert.match(msgs[1].content, /no command emitted/);
  });
});

describe("inferWriteSet — W for a free-text chat utterance", () => {
  test('"sorted by rating" asks for an ordering, not a rating threshold', () => {
    // The bug this pins: treating the bare word "rating" as minRating put it in
    // W, which suppressed the over-reach report for exactly the Figure 1.2
    // fault — a mediator setting minRating=4 on an utterance that never asked.
    const W = inferWriteSet("show electronics under $100 sorted by rating");
    assert.deepEqual(W.sort(), ["category", "maxPrice", "sort"]);
    assert.ok(!W.includes("minRating"), "bare 'rating' must not imply minRating");
  });

  test("so the spurious minRating is reported as over-reach", () => {
    const W = inferWriteSet("show electronics under $100 sorted by rating");
    const fp: typeof W = ["category", "maxPrice", "minRating", "sort"];
    assert.deepEqual(overReach(fp, W), ["minRating"]);
  });

  test("an explicit threshold does imply minRating", () => {
    for (const u of [
      "show items rated 4 stars and up",
      "only 4.5 star products",
      "highly rated electronics",
      "minimum rating of 4",
    ]) {
      assert.ok(inferWriteSet(u).includes("minRating"), u);
    }
  });

  test("stock phrasings, including the negated form", () => {
    assert.ok(inferWriteSet("hide out-of-stock items").includes("inStockOnly"));
    assert.ok(inferWriteSet("only show what is in stock").includes("inStockOnly"));
  });

  test("clear is attributed to c₆", () => {
    assert.ok(inferWriteSet("clear all filters").includes("clearFilters"));
  });
});
