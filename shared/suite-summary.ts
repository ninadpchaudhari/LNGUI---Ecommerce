/**
 * A test set broken down for people: one row per report group, the proposal’s relation
 * names, and examples from the actual test cases behind each operator.
 * Shared so every view describes a test set in the same words.
 */
import type { MrCase } from "./cases.ts";
import { reportGroup } from "./report.ts";
import { REFINEMENT_CLAUSES } from "./surface.generated.ts";

export interface OperatorRow {
  key: string;
  label: string;
  help: string;
  cases: number;
  example: Pick<MrCase, "id" | "sourceTrace" | "followupTrace">;
}

export interface SuiteRow {
  group: string;
  checks: string;
  cases: number;
  groups: number;
  utterances: number;
  operators: OperatorRow[];
}

const GROUPS: Array<{ group: string; checks: string; prefix: string[] }> = [
  { group: "MR_CE (para)", checks: "Control Equivalence", prefix: ["template-pair", "phrase-pair", "gold"] },
  { group: "MR_CE (surface)", checks: "Control Equivalence", prefix: ["transform:"] },
  { group: "MR_AC", checks: "Additive Constraining", prefix: ["delta:"] },
  { group: "MR_CA", checks: "Commuting Actions", prefix: ["pair:"] },
  { group: "MR_CA (context amnesia)", checks: "Commuting Actions", prefix: ["control:"] },
  { group: "MR_REV", checks: "Action Reversibility", prefix: ["control:"] },
  { group: "MR_COMP", checks: "Composition", prefix: ["turns:", "idempotence"] },
];

const TRANSFORMS: Record<string, [string, string]> = {
  uppercase: ["Uppercase", "The whole utterance in capitals."],
  synonymPrefix: ["Verb swap", "“show” replaced by “display”."],
  formatSuffix: ["Format suffix", "Appends “ in a table”, a presentation request that changes no control."],
  clauseReorder: ["Clause move", "Moves the trailing “sorted by …” clause to the front."],
};

function describe(tag: string): [string, string] {
  if (tag === "template-pair") return ["Request rephrasing", "Changes how the request is phrased while keeping the same control and value, e.g. “show books items” and “filter to books only”."];
  if (tag === "phrase-pair") return ["Value rephrasing", "Changes the wording of the requested value, e.g. “lowest price first” and “price low to high”."];
  if (tag === "gold") return ["Reviewed pair", "A hand-reviewed paraphrase pair from Gold_Syn in control-surface.yaml."];
  if (tag.startsWith("transform:")) {
    const id = tag.slice("transform:".length);
    return TRANSFORMS[id] ?? [id, `Surface transform ${id}.`];
  }
  if (tag.startsWith("delta:")) {
    const control = tag.slice("delta:".length);
    const clause = REFINEMENT_CLAUSES.find((c) => c.target === control);
    return [`Adds ${control}`, clause ? `Appends the clause “${clause.text.replace("{value}", "…")}”.` : `Appends a ${control} clause.`];
  }
  if (tag.startsWith("pair:")) {
    const [a, b] = tag.slice("pair:".length).split("|");
    return [`${a} × ${b}`, `One request on ${a} and one on ${b}, issued in both orders.`];
  }
  if (tag.startsWith("control:")) {
    const c = tag.slice("control:".length);
    return [c, `Cases built on the ${c} control.`];
  }
  if (tag === "turns:2") return ["Two turns", "A base request, then one clause as its own turn, against both joined into one utterance."];
  if (tag === "turns:3") return ["Three turns", "Base, clause and a sort as three turns, against one joined utterance."];
  if (tag === "idempotence") return ["Idempotence", "The same absolute request twice, against it once."];
  return [tag, tag];
}

export function summarizeSuite(cases: readonly MrCase[]): SuiteRow[] {
  const rows: SuiteRow[] = [];
  const order = [...GROUPS.map((g) => g.group), ...new Set(cases.map(reportGroup).filter((g) => !GROUPS.some((x) => x.group === g)))];
  for (const group of order) {
    const members = cases.filter((c) => reportGroup(c) === group);
    if (members.length === 0) continue;
    const spec = GROUPS.find((g) => g.group === group);
    const ops = new Map<string, MrCase[]>();
    for (const c of members) {
      const tag = c.strata.find((t) => spec?.prefix.some((p) => t === p || t.startsWith(p))) ?? "other";
      ops.set(tag, [...(ops.get(tag) ?? []), c]);
    }
    rows.push({
      group,
      checks: spec?.checks ?? "",
      cases: members.length,
      groups: new Set(members.map((c) => c.semanticGroup)).size,
      utterances: members.reduce((s, c) => s + c.sourceTrace.length + c.followupTrace.length, 0),
      operators: [...ops.entries()]
        .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
        .map(([key, examples]) => {
          const [label, help] = describe(key);
          const { id, sourceTrace, followupTrace } = examples[0];
          return { key, label, help, cases: examples.length, example: { id, sourceTrace, followupTrace } };
        }),
    });
  }
  return rows;
}
