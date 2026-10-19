/**
 * A frozen MR case: one fixed instance of a relation, stored one per line in a
 * cases file (JSONL) and executed unchanged on every trial.
 *
 * A case is an `MrInstance` plus what the analysis needs: a stable id, the
 * semantic situation it belongs to (repeats and rewordings of one situation
 * are not independent evidence), strata tags, and provenance. Its wording,
 * values and write sets are fixed before the sweep runs; a reworded case is a
 * new case, never a new trial.
 *
 * `validateCase` checks each relation's precondition from generation labels
 * alone (§A.4). A mediator cannot falsify a precondition; it can only fail the
 * relation, so a case that does not satisfy its precondition must never reach
 * the sweep.
 */
import { z } from "zod";
import { inDomain, type RelationName } from "./contract.ts";
import { C_CON, C_REV, CONTROL_IDS, type ControlId } from "./surface.generated.ts";
import type { MrInstance } from "./relations.ts";

const RELATIONS = [
  "MR_CE",
  "MR_AC",
  "MR_CA",
  "MR_REV",
  "MR_COMP",
  "CONTEXT_AMNESIA",
] as const satisfies readonly RelationName[];

const controlId = z.enum(CONTROL_IDS as unknown as [ControlId, ...ControlId[]]);
const writeSet = z.array(controlId);

export const caseSchema = z.object({
  id: z.string().min(1),
  relation: z.enum(RELATIONS),
  predicate: z.string().min(1),
  /** Cases sharing a group test the same semantic situation (bootstrap unit). */
  semanticGroup: z.string().min(1),
  strata: z.array(z.string()).default([]),
  legacyName: z.string().nullable().default(null),
  description: z.string(),
  sourceTrace: z.array(z.string().min(1)),
  followupTrace: z.array(z.string().min(1)),
  writeSets: z.object({ source: z.array(writeSet), followup: z.array(writeSet) }),
  refinement: z
    .object({ control: controlId, value: z.union([z.string(), z.number(), z.boolean(), z.null()]) })
    .optional(),
  provenance: z.object({
    generator: z.enum(["template", "transform", "goldSyn", "manual"]),
    /** Template, clause or transform ids the case was built from. */
    sources: z.array(z.string()).default([]),
  }),
});

export type MrCase = z.infer<typeof caseSchema>;

// Compile-time guarantee that a case can be run wherever an instance can.
const _caseIsInstance = (c: MrCase): MrInstance => c;
void _caseIsInstance;

const sameSet = (a: readonly ControlId[], b: readonly ControlId[]): boolean =>
  a.length === b.length && a.every((c) => b.includes(c));

const union = (sets: readonly (readonly ControlId[])[]): ControlId[] =>
  [...new Set(sets.flat())];

/**
 * The precondition of each relation, read off the labels (Table 4.1).
 * Returns the problems found; an empty array means the case is admissible.
 */
export function validateCase(c: MrCase): string[] {
  const problems: string[] = [];
  const src = c.sourceTrace;
  const fol = c.followupTrace;
  const W = c.writeSets;

  if (W.source.length !== src.length) problems.push("writeSets.source does not match sourceTrace");
  if (W.followup.length !== fol.length) problems.push("writeSets.followup does not match followupTrace");
  if (problems.length > 0) return problems;

  switch (c.relation) {
    case "MR_CE": {
      // Para(u1, u2): one utterance each, same target.
      if (src.length !== 1 || fol.length !== 1) problems.push("MR_CE needs one utterance per trace");
      else if (!sameSet(W.source[0], W.followup[0])) problems.push("MR_CE traces declare different targets");
      else if (src[0] === fol[0]) problems.push("MR_CE utterances are identical");
      break;
    }
    case "MR_AC": {
      // Refine(u_r, u_b, δ) ∧ target(δ) = {(d, w)}, d ∈ C_con, d ∉ W(u_b).
      const r = c.refinement;
      if (src.length !== 1 || fol.length !== 1) {
        problems.push("MR_AC needs one utterance per trace");
      } else if (!r) {
        problems.push("MR_AC needs a refinement target");
      } else {
        if (!C_CON.includes(r.control)) problems.push(`MR_AC refines ${r.control}, which is not in C_con`);
        if (W.source[0].includes(r.control)) problems.push(`MR_AC base already writes ${r.control}`);
        if (!inDomain(r.control, r.value)) problems.push(`MR_AC value ${String(r.value)} is outside Dom(${r.control})`);
        if (!sameSet(W.followup[0], union([W.source[0], [r.control]]))) {
          problems.push("MR_AC follow-up W must be W(u_b) ∪ {d}");
        }
        if (!fol[0].startsWith(src[0])) problems.push("MR_AC follow-up must extend the base utterance");
      }
      break;
    }
    case "MR_CA": {
      // Indep(u1, u2): disjoint write sets, issued in both orders.
      if (src.length !== 2 || fol.length !== 2) {
        problems.push("MR_CA needs two utterances per trace");
      } else {
        if (src[0] !== fol[1] || src[1] !== fol[0]) problems.push("MR_CA follow-up must reverse the source");
        if (W.source[0].some((x) => W.source[1].includes(x))) problems.push("MR_CA write sets overlap");
        if (W.source[0].length === 0 || W.source[1].length === 0) problems.push("MR_CA utterance writes nothing");
      }
      break;
    }
    case "MR_REV": {
      // Rev(u_f, u_i) from σ₀: forward then inverse, W(u_f) ⊆ C_rev.
      if (src.length !== 0 || fol.length !== 2) {
        problems.push("MR_REV compares σ₀ with forward + inverse");
      } else {
        const notRev = W.followup[0].filter((x) => !C_REV.includes(x));
        if (notRev.length > 0) problems.push(`MR_REV forward writes irreversible ${notRev.join(", ")}`);
        if (!sameSet(W.followup[0], W.followup[1])) problems.push("MR_REV inverse must write what forward wrote");
      }
      break;
    }
    case "MR_COMP": {
      // Comp(s, u_s): target(u_s) = target(s).
      if (src.length < 2 || fol.length !== 1) {
        problems.push("MR_COMP needs a sequence of ≥ 2 turns and one composed utterance");
      } else if (!sameSet(W.followup[0], union(W.source))) {
        problems.push("MR_COMP composed W must equal the union of the sequence's W");
      }
      break;
    }
    case "CONTEXT_AMNESIA": {
      if (src.length !== 1 || fol.length < 2 || fol[0] !== src[0]) {
        problems.push("CONTEXT_AMNESIA follow-up must start with the source utterance");
      } else {
        const established = W.source[0];
        const later = union(W.followup.slice(1));
        if (established.some((x) => later.includes(x))) problems.push("CONTEXT_AMNESIA later turns overwrite u1");
      }
      break;
    }
  }
  return problems;
}

export interface ParsedCases {
  cases: MrCase[];
  problems: string[];
}

/** Parse and validate a cases file. Duplicate ids are a problem. */
export function parseCasesJsonl(text: string): ParsedCases {
  const cases: MrCase[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();

  text.split("\n").forEach((line, i) => {
    if (line.trim() === "") return;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      problems.push(`line ${i + 1}: not JSON`);
      return;
    }
    const parsed = caseSchema.safeParse(raw);
    if (!parsed.success) {
      problems.push(`line ${i + 1}: ${parsed.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("; ")}`);
      return;
    }
    const c = parsed.data;
    if (seen.has(c.id)) problems.push(`line ${i + 1}: duplicate id ${c.id}`);
    seen.add(c.id);
    for (const p of validateCase(c)) problems.push(`${c.id}: ${p}`);
    cases.push(c);
  });

  return { cases, problems };
}

export function toJsonl(cases: readonly MrCase[]): string {
  return cases.map((c) => JSON.stringify(c)).join("\n") + "\n";
}
