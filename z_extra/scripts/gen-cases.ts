/**
 * Generate a frozen cases file from Γ_app.
 *
 *   npm run gen:cases -- --out cases/pilot.jsonl [--groups 10] [--per-group 2] [--seed 1] [--no-amnesia]
 *
 * The strategy and its two documented deviations from the proposal are in
 * docs/case-generation.md.
 *
 * Writes the selected cases, plus `<out>.rejected.jsonl` listing candidates
 * that failed a precondition or were filtered out, so the acceptance log
 * survives alongside the test set. Prints the file's SHA-256: record it, and the
 * sweep will refuse to resume a run against a cases file that has changed.
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { toJsonl } from "../shared/cases.ts";
import { execSync } from "node:child_process";
import { generateCandidates, poolOf, selectCases } from "../shared/generate.ts";
import { reportGroup } from "../shared/report.ts";
import type { CasesManifest } from "../shared/experiment.ts";

const { values } = parseArgs({
  options: {
    out: { type: "string", default: "cases/pilot.jsonl" },
    groups: { type: "string", default: "10" },
    "per-group": { type: "string", default: "2" },
    seed: { type: "string", default: "1" },
    // Context amnesia is the multi-turn MR_CA fault class of Table 4.3, so it
    // is in the test set by default and reported as "MR_CA (multi-turn)".
    "no-amnesia": { type: "boolean", default: false },
  },
});

const out = values.out!;
const groups = Number(values.groups);
const perGroup = Number(values["per-group"]);
const seed = Number(values.seed);

const { candidates, rejected } = generateCandidates();
const relations = ["MR_CE", "MR_AC", "MR_CA", "CONTEXT_AMNESIA", "MR_REV", "MR_COMP"] as const;
const { cases, shortfalls } = selectCases(candidates, {
  seed,
  groups,
  perGroup,
  relations: values["no-amnesia"] ? relations.filter((r) => r !== "CONTEXT_AMNESIA") : relations,
});

await mkdir(dirname(out), { recursive: true });
const body = toJsonl(cases);
await writeFile(out, body);
const stem = out.replace(/\.jsonl$/, "");
const rejectedPath = `${stem}.rejected.jsonl`;
await writeFile(rejectedPath, rejected.map((r) => JSON.stringify(r)).join("\n") + "\n");
const sha256 = createHash("sha256").update(body).digest("hex");

const git = (cmd: string): string | null => {
  try {
    return execSync(`git ${cmd}`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return null;
  }
};
const rowCounts: Record<string, number> = {};
for (const c of cases) rowCounts[reportGroup(c)] = (rowCounts[reportGroup(c)] ?? 0) + 1;
const manifest: CasesManifest = {
  file: out,
  sha256,
  caseCount: cases.length,
  generator: { seed, groups, perGroup, amnesia: !values["no-amnesia"] },
  git: { commit: git("rev-parse HEAD"), dirty: (git("status --porcelain") ?? "") !== "" },
  createdAt: new Date().toISOString(),
  counts: rowCounts,
};
const manifestPath = `${stem}.manifest.json`;
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

const counts = new Map<string, { candidates: number; groups: Set<string>; selected: number }>();
for (const c of candidates) {
  const e = counts.get(poolOf(c)) ?? { candidates: 0, groups: new Set(), selected: 0 };
  e.candidates += 1;
  e.groups.add(c.semanticGroup);
  counts.set(poolOf(c), e);
}
for (const c of cases) counts.get(poolOf(c))!.selected += 1;

console.log(`pool              candidates  groups  selected`);
for (const [r, e] of counts) {
  console.log(`${r.padEnd(16)}  ${String(e.candidates).padStart(10)}  ${String(e.groups.size).padStart(6)}  ${String(e.selected).padStart(8)}`);
}
for (const s of shortfalls) {
  console.warn(`! ${s.pool}: only ${s.available} semantic group(s) available, ${s.requested} requested`);
}
console.log(`\n${cases.length} cases → ${out}`);
console.log(`${rejected.length} rejected candidates → ${rejectedPath}`);
console.log(`manifest → ${manifestPath}`);
console.log(`sha256 ${sha256}`);
