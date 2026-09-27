/**
 * The four metamorphic relations of Table 4.1, plus the repeated-input
 * diagnostic of §5.4, run under the (N, ε) rule of Eq. 4.18.
 *
 * Each relation pairs a *precondition* — a semantic predicate over utterances,
 * evaluated from generation labels only — with a *postcondition* over
 * observations O(σ) = ⟨V, D⟩. A mediator that mishandles an utterance cannot
 * falsify a precondition; it can only fail the relation (§A.4).
 *
 * Replaces the previous five-relation set, which was not conformant: Case
 * Invariance, Synonym Prefix, Format Suffix and "Commutativity" (which
 * reordered clauses inside a single utterance) are all MR_SE instances, and
 * Idempotency is the repeated-input stability diagnostic rather than an MR.
 */
import {
  CORE_RELATIONS,
  covMR,
  covNL,
  dataEqual,
  dataSubset,
  observationallyEqual,
  pointUpdate,
  valuationEqual,
  verdictFor,
  type ControlId,
  type MrCaseRecord,
  type MrVerdict,
  type Observation,
  type PromptConfig,
  type RelationName,
  type SystemState,
  type TraceRole,
  type TurnRecord,
} from "../../shared/contract.ts";
import { C_REV, type ControlValue } from "../../shared/surface.generated.ts";
import { resetState } from "../../shared/transition.ts";
import { runTurn } from "./mediator.ts";

// ── Instances ───────────────────────────────────────────────────────────────

/**
 * One executable MR instance: two traces plus the labels Check needs.
 *
 * `writeSets` are declared before execution (Eq. 4.14), which is what makes the
 * fp ⊆ W standing check meaningful.
 */
export interface MrInstance {
  relation: RelationName;
  predicate: string;
  /** Label from the pre-conformance set, kept so old exports can be joined. */
  legacyName: string | null;
  description: string;
  sourceTrace: string[];
  followupTrace: string[];
  writeSets: { source: ControlId[][]; followup: ControlId[][] };
  /** MR_AC only: the (d, w) that δ is expected to assign (Eq. 4.13). */
  refinement?: { control: ControlId; value: ControlValue };
}

/**
 * MR_SE instances via surface-form transforms. Each transform preserves the
 * target by construction, so Syn(u1, u2) holds without human review.
 */
function seInstances(base: string): MrInstance[] {
  const W = inferWriteSet(base);
  const mk = (legacy: string, variant: string, description: string): MrInstance => ({
    relation: "MR_SE",
    predicate: "Syn",
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

  // Clause reordering within one utterance: still MR_SE, not MR_CA, because it
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

export function buildInstances(base: string): MrInstance[] {
  return [
    ...seInstances(base),
    ...acInstances(base),
    ...caInstances(),
    ...revInstances(),
    ...amnesiaInstances(),
  ];
}

// ── Check ───────────────────────────────────────────────────────────────────

export interface TrialOutcome {
  holds: boolean;
  reason: string;
  sourceObservation: Observation | null;
  followupObservation: Observation | null;
  turnIds: string[];
  latencyMs: number;
  tokens: number | null;
  invocations: number;
}

/**
 * The postconditions of Table 4.1. Note the two distinct D comparators:
 * equality for MR_SE/MR_CA/MR_REV, containment for MR_AC.
 */
function check(
  instance: MrInstance,
  source: { state: SystemState; records: TurnRecord[] },
  followup: { state: SystemState; records: TurnRecord[] },
): { holds: boolean; reason: string } {
  const o1: Observation = { V: source.state.V, D: source.state.D };
  const o2: Observation = { V: followup.state.V, D: followup.state.D };

  const failedTurn = [...source.records, ...followup.records].find((r) => !r.ok);
  if (failedTurn) {
    return { holds: false, reason: `mediator error: ${failedTurn.error ?? "unknown"}` };
  }

  switch (instance.relation) {
    case "MR_SE":
    case "MR_CA":
    case "MR_REV": {
      if (observationallyEqual(o1, o2)) return { holds: true, reason: "O(σ′) = O(σ″)" };
      const vDiff = !valuationEqual(o1.V, o2.V);
      const dDiff = !dataEqual(o1.D, o2.D);
      return {
        holds: false,
        reason: vDiff && dDiff
          ? "V and D both differ"
          : vDiff
            ? "V differs (D matched)"
            : "D differs (V matched)",
      };
    }

    case "MR_AC": {
      // V_ur = V_ub[d ↦ w] ∧ D_ur ⊆ D_ub
      const r = instance.refinement;
      if (!r) return { holds: false, reason: "MR_AC instance is missing its refinement target" };
      const expected = pointUpdate(o1.V, r.control, r.value);
      const vOk = valuationEqual(o2.V, expected);
      const dOk = dataSubset(o2.D, o1.D);
      if (vOk && dOk) return { holds: true, reason: "V point-updated and D contained" };
      if (!vOk && !dOk) return { holds: false, reason: "constraint leaked and D not contained" };
      return {
        holds: false,
        reason: vOk
          ? `D not contained in the base result set (${o1.D.count} → ${o2.D.count})`
          : "V is not the expected point update — an earlier constraint moved",
      };
    }

    case "CONTEXT_AMNESIA": {
      // ∃c ∈ fp(u1,σ). σ″.V(c) ≠ σ′.V(c), with W(u2) ∩ fp(u1,σ) = ∅.
      const established = source.records[0]?.fp ?? [];
      const laterWrites = new Set(
        followup.records.slice(1).flatMap((r) => r.writeSet ?? []),
      );
      const shouldPersist = established.filter((c) => !laterWrites.has(c));
      const lost = shouldPersist.filter((c) => source.state.V[c] !== followup.state.V[c]);
      return lost.length === 0
        ? { holds: true, reason: "earlier constraints survived" }
        : { holds: false, reason: `silently lost: ${lost.join(", ")}` };
    }
  }
}

// ── Runner (Algorithm 1) ────────────────────────────────────────────────────

async function runTrace(
  P: PromptConfig,
  utterances: string[],
  writeSets: ControlId[][],
  opts: {
    model?: string;
    sessionId: string;
    relation: RelationName;
    role: TraceRole;
    trial: number;
  },
): Promise<{ state: SystemState; records: TurnRecord[] }> {
  // ResetApp before each trace (Algorithm 1 lines 9 and 11).
  let state = resetState(P);
  const records: TurnRecord[] = [];

  for (let i = 0; i < utterances.length; i++) {
    const outcome = await runTurn(state, utterances[i], {
      ...(opts.model ? { model: opts.model } : {}),
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

export interface RunOptions {
  n: number;
  epsilon: number;
  model?: string;
  sessionId: string;
  P: PromptConfig;
  onTurn?: (record: TurnRecord) => void;
  onCase?: (record: MrCaseRecord) => void;
  onProgress?: (done: number, total: number) => void;
}

export interface RunSummary {
  cases: MrCaseRecord[];
  covNL: number;
  covMR: number;
  invocations: number;
}

/**
 * Algorithm 1. For each instance, run both traces N times from a reset state
 * and report a verdict from the failure rate against ε (Eq. 4.18).
 *
 * There is no WEAK_PASS: under O(σ) = ⟨V,D⟩ a V difference is a violation.
 * "skipped" means the precondition did not hold, which is a different thing and
 * is excluded from Cov_MR.
 */
export async function runRelations(
  base: string,
  options: RunOptions,
): Promise<RunSummary> {
  const instances = buildInstances(base);
  const cases: MrCaseRecord[] = [];
  const footprints: ControlId[][] = [];
  let invocations = 0;
  let done = 0;

  for (const instance of instances) {
    const startedAt = Date.now();
    const evidence: string[] = [];
    let fails = 0;
    let tokens: number | null = null;
    let firstFailureMs: number | null = null;
    let lastReason = "";

    for (let trial = 1; trial <= options.n; trial++) {
      const source = await runTrace(options.P, instance.sourceTrace, instance.writeSets.source, {
        ...(options.model ? { model: options.model } : {}),
        sessionId: options.sessionId,
        relation: instance.relation,
        role: "source",
        trial,
      });
      const followup = await runTrace(
        options.P,
        instance.followupTrace,
        instance.writeSets.followup,
        {
          ...(options.model ? { model: options.model } : {}),
          sessionId: options.sessionId,
          relation: instance.relation,
          role: "followup",
          trial,
        },
      );

      for (const r of [...source.records, ...followup.records]) {
        invocations += 1;
        evidence.push(r.id);
        footprints.push(r.fp);
        const t = r.meta?.usageTotal?.totalTokens;
        if (typeof t === "number") tokens = (tokens ?? 0) + t;
        options.onTurn?.(r);
      }

      const outcome = check(instance, source, followup);
      lastReason = outcome.reason;
      if (!outcome.holds) {
        fails += 1;
        if (firstFailureMs === null) firstFailureMs = Date.now() - startedAt;
      }
    }

    const verdict: MrVerdict = verdictFor(fails, options.n, options.epsilon);
    const record: MrCaseRecord = {
      schemaVersion: 1,
      id: crypto.randomUUID(),
      sessionId: options.sessionId,
      createdAt: new Date().toISOString(),
      relation: instance.relation,
      predicate: instance.predicate,
      legacyName: instance.legacyName,
      sourceTrace: instance.sourceTrace,
      followupTrace: instance.followupTrace,
      n: options.n,
      epsilon: options.epsilon,
      fails,
      failureRate: options.n > 0 ? fails / options.n : 0,
      verdict,
      skipReason: verdict === "skipped" ? lastReason : null,
      covNL: 0,
      covMR: 0,
      firstFailureMs,
      mediatorInvocations:
        (instance.sourceTrace.length + instance.followupTrace.length) * options.n,
      totalTokens: tokens,
      evidenceTurnIds: evidence,
    };
    cases.push(record);
    done += 1;
    options.onProgress?.(done, instances.length);
  }

  // Coverage is a property of the whole sweep, so it is stamped once all cases
  // are in and then back-filled onto each record.
  const nl = covNL(footprints);
  const mr = covMR(cases);
  for (const c of cases) {
    c.covNL = nl;
    c.covMR = mr;
    options.onCase?.(c);
  }

  return { cases, covNL: nl, covMR: mr, invocations };
}

export { CORE_RELATIONS };
