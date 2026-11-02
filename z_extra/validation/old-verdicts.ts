/**
 * The old relations' verdicts on random outcomes, for checking harness/relations.py against them (same-verdicts.py).
 *
 * For every case of the old pilot set, made-up runs: each sentence does what it should, nothing, something extra, or
 * something wrong, picked at random, with values from each control's domain. Each run is applied with the old app
 * logic, judged by the old check() (shared/relations.ts at commit 5d3d6ba), and written as one JSON line.
 *
 *     git worktree add --detach <old> 5d3d6ba && ln -s "$PWD/app/node_modules" <old>/node_modules
 *     (cd app && npx tsx ../z_extra/validation/old-verdicts.ts <old> 1000) > old-verdicts.jsonl     (1000 runs per case)
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const [oldRoot, perCase = "1000"] = process.argv.slice(2);
const old = (path: string) => import(pathToFileURL(`${oldRoot}/${path}`).href);
const { parseCasesJsonl } = await old("shared/cases.ts");
const { check } = await old("shared/relations.ts");
const { renderData, resetState } = await old("shared/transition.ts");
const { footprint } = await old("shared/contract.ts");
const { CONTROLS, CONTROL_IDS, V0 } = await old("shared/surface.generated.ts");

type V = Record<string, unknown>;

// mulberry32, seeded, so the file is the same every time
let seed = 20261102;
const random = () => {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = Math.imul(seed ^ (seed >>> 15), seed | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(random() * xs.length)];

/** A value from Dom(c), or ⊥ where the control allows it. */
function anyValue(c: string): unknown {
  const d = CONTROLS[c].domain;
  if (d.kind === "enum") return pick([...d.values.map((v: { value: unknown }) => v.value), null]);
  if (d.kind === "number") return pick([25, 50, 100, 200, 500, Math.floor(random() * 501)]);
  if (d.kind === "boolean") return pick([true, false]);
  return pick(["invoked", null]);
}

/** One sentence's outcome: V after it. `meant` is what the sentence asks for. */
function outcome(V: V, meant: V): V {
  const r = random();
  if (r < 0.6) return { ...V, ...meant }; // does what it should
  if (r < 0.72) return V; // does nothing
  if (r < 0.84) {
    const c = pick(CONTROL_IDS as string[]);
    return { ...V, ...meant, [c]: anyValue(c) }; // something extra
  }
  if (r < 0.96) return { ...V, ...Object.fromEntries(Object.keys(meant).map((c) => [c, anyValue(c)])) }; // something wrong
  return { ...V0 }; // starts over
}

function side(sentences: string[], meant: V[]) {
  let V: V = { ...V0 };
  const records = [], turns = [];
  for (let i = 0; i < sentences.length; i++) {
    const next = outcome(V, meant[i]);
    const fp = footprint(V, next);
    records.push({ ok: true, fp, writeSet: Object.keys(meant[i]) });
    turns.push(fp);
    V = next;
  }
  const state = { ...resetState({}), V, D: renderData(V) };
  return { result: { state, records }, json: { turns, end: V, shown: state.D.productIds } };
}

const { cases, problems } = parseCasesJsonl(readFileSync(`${oldRoot}/cases/pilot.jsonl`, "utf8"));
if (problems.length) throw new Error(problems.join("\n"));
const shownAtStart = renderData({ ...V0 }).productIds;

for (const c of cases) {
  for (let n = 0; n < Number(perCase); n++) {
    // What each control "should" become in this run: shared by both sides, so a well-behaved run passes.
    const target: V = Object.fromEntries((CONTROL_IDS as string[]).map((k) => [k, anyValue(k)]));
    const meantBy = (ws: string[][], isFollowup: boolean) =>
      ws.map((w, i) => {
        const meant: V = Object.fromEntries(w.map((k) => [k, target[k]]));
        if (c.relation === "MR_REV" && i === 1) for (const k of w) meant[k] = V0[k]; // the inverse: back to the start
        if (c.relation === "MR_AC" && isFollowup && c.refinement) meant[c.refinement.control] = c.refinement.value;
        return meant;
      });
    const s = side(c.sourceTrace, meantBy(c.writeSets.source, false));
    const f = side(c.followupTrace, meantBy(c.writeSets.followup, true));
    const verdict = check(c, s.result, f.result);
    console.log(JSON.stringify({ case: c.id, holds: verdict.holds, source: s.json, followup: f.json, shownAtStart }));
  }
}
