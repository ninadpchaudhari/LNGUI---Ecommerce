/**
 * Running MR traces through M, and ad-hoc cases built from one utterance.
 *
 * Each relation pairs a *precondition* — a semantic predicate over utterances,
 * evaluated from generation labels only — with a *postcondition* over
 * observations O(σ) = ⟨V, D⟩. A mediator that mishandles an utterance cannot
 * falsify a precondition; it can only fail the relation (§A.4).
 *
 * The instance shape and the postcondition check live in shared/relations.ts.
 * This module holds what needs M: `runTrace` and `runTrial`, which the sweep
 * engine (sweep.ts) calls for every trial. It also turns a hand-typed
 * utterance into validated ad-hoc cases for exploration. Frozen experiment
 * cases come from the generator (shared/generate.ts).
 *
 * Case Invariance, Synonym Prefix, Format Suffix and the old "Commutativity"
 * (which reordered clauses inside a single utterance) are all MR_CE
 * instances, and Idempotency is an MR_COMP instance (s = ⟨u, u⟩, u_s = u).
 */
import {
  type ControlId,
  type PromptConfig,
  type RelationName,
  type TraceRole,
  type TurnRecord,
} from "../../shared/contract.ts";
import { validateCase, type MrCase } from "../../shared/cases.ts";
import { check, type CheckResult, type MrInstance, type TraceResult } from "../../shared/relations.ts";
import { C_REV, type ControlValue } from "../../shared/surface.generated.ts";
import { resetState } from "../../shared/transition.ts";
import { runTurn } from "./mediator.ts";
import type { FetchLike } from "./api.ts";
import type { Overrides } from "../../shared/overrides.ts";

export type { MrInstance } from "../../shared/relations.ts";

// ── Instances ───────────────────────────────────────────────────────────────

/**
 * MR_CE instances via surface-form transforms. Each transform preserves the
 * target by construction, so Para(u1, u2) holds without human review.
 */
function ceInstances(base: string): MrInstance[] {
  const W = inferWriteSet(base);
  const mk = (legacy: string, variant: string, description: string): MrInstance => ({
    relation: "MR_CE",
    predicate: "Para",
    legacyName: legacy,
    description,
    sourceTrace: [base],
    followupTrace: [variant],
    writeSets: { source: [W], followup: [W] },
  });

  const lower = base.toLowerCase();
  const out: MrInstance[] = [
    mk("Case Invariance", base.toUpperCase(), "Uppercasing must not change any control"),
    mk(
      "Synonym Prefix",
      lower.startsWith("show ") ? `display ${base.slice(5)}` : `display ${base}`,
      "A synonymous verb must not change any control",
    ),
    mk("Format Suffix", `${base} in a table`, "A presentation request must not change any control"),
  ];

  // Clause reordering within one utterance: still MR_CE, not MR_CA, because it
  // is a single utterance from a single starting state.
  const sortClause = base.match(/\b(sorted?\s+by\s+[\w\s]+)$/i);
  if (sortClause) {
    const rest = base.replace(sortClause[0], "").replace(/\s+/g, " ").trim();
    out.push(mk("Commutativity", `${sortClause[0]} ${rest}`, "Clause order within one utterance"));
  }
  return out;
}

/** MR_AC: u_r = u_b ⊕ δ, concatenated within one utterance (Eq. 4.12). */
function acInstances(base: string): MrInstance[] {
  const baseW = inferWriteSet(base);
  const candidates: Array<{ control: ControlId; value: ControlValue; clause: string }> = [
    { control: "maxPrice", value: 50, clause: "under $50" },
    { control: "minRating", value: 4, clause: "rated 4 stars and up" },
    { control: "inStockOnly", value: true, clause: "that are in stock" },
  ];

  return candidates
    // δ must target a control the base utterance does not already constrain,
    // otherwise the refinement is not additive.
    .filter((c) => !baseW.includes(c.control))
    .map((c) => ({
      relation: "MR_AC" as const,
      predicate: "Refine",
      legacyName: null,
      description: `Refining with "${c.clause}" must preserve V and narrow D`,
      sourceTrace: [base],
      followupTrace: [`${base} ${c.clause}`],
      writeSets: { source: [baseW], followup: [[...baseW, c.control]] },
      refinement: { control: c.control, value: c.value },
    }));
}

/** MR_CA: two independent utterances issued in both orders, no reset between. */
function caInstances(): MrInstance[] {
  const a = { u: "sort by lowest price first", W: ["sort"] as ControlId[] };
  const b = { u: "show books", W: ["category"] as ControlId[] };
  return [
    {
      relation: "MR_CA",
      predicate: "Indep",
      legacyName: null,
      description: "Independent utterances must commute",
      sourceTrace: [a.u, b.u],
      followupTrace: [b.u, a.u],
      writeSets: { source: [a.W, b.W], followup: [b.W, a.W] },
    },
  ];
}

/** MR_REV: u_f then inv(u_f) from σ₀, with W(u_f) ⊆ C_rev (Eq. 4.17). */
function revInstances(): MrInstance[] {
  const forward = { u: "hide out-of-stock items", W: ["inStockOnly"] as ControlId[] };
  const inverse = "show out-of-stock items again";
  if (!forward.W.every((c) => C_REV.includes(c))) return [];
  return [
    {
      relation: "MR_REV",
      predicate: "Rev",
      legacyName: null,
      description: "An utterance and its inverse must return to σ₀",
      sourceTrace: [],
      followupTrace: [forward.u, inverse],
      writeSets: { source: [], followup: [forward.W, forward.W] },
    },
  ];
}

/**
 * MR_COMP: a multi-turn sequence s against one utterance u_s that composes it
 * (Eq. comp). The second instance is idempotence, s = ⟨u, u⟩ with u_s = u.
 */
function compInstances(): MrInstance[] {
  const turns = [
    { u: "show electronics", W: ["category"] as ControlId[] },
    { u: "under $100", W: ["maxPrice"] as ControlId[] },
    { u: "sort by rating", W: ["sort"] as ControlId[] },
  ];
  const repeated = { u: "sort by rating", W: ["sort"] as ControlId[] };
  return [
    {
      relation: "MR_COMP",
      predicate: "Comp",
      legacyName: null,
      description: "A request spread over turns must match the same request in one turn",
      sourceTrace: turns.map((t) => t.u),
      followupTrace: ["show electronics under $100 sorted by rating"],
      writeSets: {
        source: turns.map((t) => t.W),
        followup: [turns.flatMap((t) => t.W)],
      },
    },
    {
      relation: "MR_COMP",
      predicate: "Comp (idempotence)",
      legacyName: "Idempotency",
      description: "Repeating an absolute request must change nothing",
      sourceTrace: [repeated.u, repeated.u],
      followupTrace: [repeated.u],
      writeSets: { source: [repeated.W, repeated.W], followup: [repeated.W] },
    },
  ];
}

/**
 * Context amnesia: the multi-turn stretch of MR_CA (§4.8). u1 sets a control,
 * then unrelated turns must not disturb it.
 */
function amnesiaInstances(): MrInstance[] {
  const u1 = { u: "show books", W: ["category"] as ControlId[] };
  const filler = [
    { u: "sort by lowest price first", W: ["sort"] as ControlId[] },
    { u: "sort by name", W: ["sort"] as ControlId[] },
  ];
  return [
    {
      relation: "CONTEXT_AMNESIA",
      predicate: "Indep (multi-turn)",
      legacyName: null,
      description: "A control set earlier must survive unrelated later turns",
      sourceTrace: [u1.u],
      followupTrace: [u1.u, ...filler.map((f) => f.u)],
      writeSets: { source: [u1.W], followup: [u1.W, ...filler.map((f) => f.W)] },
    },
  ];
}

/**
 * Best-effort W for a free-text chat utterance.
 *
 * Only the MR instances carry a *declared* W read off a generation template
 * (Eq. 4.14); a hand-typed utterance has none, so this heuristic stands in.
 * It must err on the side of a *smaller* W, because W is the denominator of the
 * fp ⊆ W check — every control wrongly included silently suppresses a
 * command-over-reach report.
 *
 * In particular the bare word "rating" must NOT imply minRating: "sorted by
 * rating" asks only for an ordering. Treating it as a rating threshold masked
 * the Figure 1.2 fault, where the mediator sets minRating = 4 on an utterance
 * that never requested it.
 */
export function inferWriteSet(u: string): ControlId[] {
  const t = u.toLowerCase();
  const W: ControlId[] = [];

  if (/electronics|books|clothing|home|sports|categor/.test(t)) W.push("category");
  if (/\$|under|below|less than|cheap|price|expensive|budget/.test(t)) W.push("maxPrice");

  // A rating *threshold*: an explicit number of stars, or the phrases the
  // system prompt maps onto minRating. Not the bare word "rating".
  if (
    /\d(\.\d)?\s*(\+|star)/.test(t) ||
    /\bstars?\b/.test(t) ||
    /(highly|top|best)\s+rated\b/.test(t) ||
    /min(imum)?\s+rating/.test(t) ||
    /rating\s+(of|above|over|at\s+least)/.test(t)
  ) {
    W.push("minRating");
  }

  if (/in stock|out.of.stock|available/.test(t)) W.push("inStockOnly");
  if (/sort|order(ed)?\s+by|first|alphabetical|by rating|by price|by name/.test(t)) W.push("sort");
  if (/clear|reset/.test(t)) W.push("clearFilters");
  return W;
}

/**
 * Ad-hoc cases from one typed utterance, for exploration in the Experiments
 * page. They run through the same engine as a frozen test set. Each is validated,
 * and any whose precondition fails is dropped. Their write sets come from
 * `inferWriteSet`, a heuristic, so results from ad-hoc cases are exploratory
 * and do not belong in a results table.
 */
export function adhocCases(base: string): MrCase[] {
  const out: MrCase[] = [];
  buildInstances(base).forEach((inst, i) => {
    const c: MrCase = {
      ...inst,
      id: `ADHOC-${String(i + 1).padStart(2, "0")}`,
      semanticGroup: `adhoc:${inst.relation}`,
      strata: inst.relation === "MR_CE" ? ["ce:surface", "adhoc"] : ["adhoc"],
      provenance: { generator: "manual", sources: ["adhoc"] },
    };
    if (validateCase(c).length === 0) out.push(c);
  });
  return out;
}

export function buildInstances(base: string): MrInstance[] {
  return [
    ...ceInstances(base),
    ...acInstances(base),
    ...caInstances(),
    ...revInstances(),
    ...compInstances(),
    ...amnesiaInstances(),
  ];
}

// ── Runner (Algorithm 1) ────────────────────────────────────────────────────

export interface TraceOptions {
  model?: string;
  sessionId: string;
  relation: RelationName;
  role: TraceRole;
  trial: number;
  fetchImpl?: FetchLike;
  headers?: Record<string, string>;
  overrides?: Overrides;
}

export async function runTrace(
  P: PromptConfig,
  utterances: string[],
  writeSets: ControlId[][],
  opts: TraceOptions,
): Promise<TraceResult> {
  // ResetApp before each trace (Algorithm 1 lines 9 and 11).
  let state = resetState(P);
  const records: TurnRecord[] = [];

  for (let i = 0; i < utterances.length; i++) {
    const outcome = await runTurn(state, utterances[i], {
      ...(opts.model ? { model: opts.model } : {}),
      ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
      ...(opts.headers ? { headers: opts.headers } : {}),
      ...(opts.overrides ? { overrides: opts.overrides } : {}),
      sessionId: opts.sessionId,
      turnIndex: i,
      kind: "mr",
      relation: opts.relation,
      role: opts.role,
      trial: opts.trial,
      writeSet: writeSets[i] ?? null,
    });
    state = outcome.state;
    records.push(outcome.record);
  }

  return { state, records };
}

export interface TrialResult {
  source: TraceResult;
  followup: TraceResult;
  outcome: CheckResult;
}

/**
 * One trial of one instance: both traces, each from a fresh σ₀, then Check.
 * Shared by the panel and the headless sweep.
 */
export async function runTrial(
  P: PromptConfig,
  instance: MrInstance,
  opts: Omit<TraceOptions, "role" | "relation">,
): Promise<TrialResult> {
  const base = { ...opts, relation: instance.relation };
  const source = await runTrace(P, instance.sourceTrace, instance.writeSets.source, {
    ...base,
    role: "source",
  });
  const followup = await runTrace(P, instance.followupTrace, instance.writeSets.followup, {
    ...base,
    role: "followup",
  });
  return { source, followup, outcome: check(instance, source, followup) };
}

