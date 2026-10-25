/**
 * The RQ1 table for a recorded run: per configuration and relation, trials
 * failed by the MR checker, by the implicit oracle and, when judge.jsonl is
 * present, by the LLM judge, with the overlaps. No model calls.
 *
 *   npm run oracles -- runs/<dir> [--format md|latex|csv] [--out file]
 */
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import type { TurnRecord } from "../shared/contract.ts";
import { oracleTable, type JudgeRow } from "../shared/oracles.ts";
import { render, type Format } from "../shared/report.ts";
import { readTrials } from "./lib/sweep.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { format: { type: "string", default: "md" }, out: { type: "string" } },
});
const runDir = positionals[0];
if (!runDir) {
  console.error("usage: npm run oracles -- runs/<dir> [--format md|latex|csv]");
  process.exit(1);
}
const lines = async (path: string) => (await readFile(path, "utf8")).split("\n").filter((l) => l.trim());

const trials = await readTrials(join(runDir, "trials.jsonl"));
const turns = new Map<string, TurnRecord>();
for (const l of await lines(join(runDir, "turns.jsonl"))) {
  const t = JSON.parse(l) as TurnRecord;
  turns.set(t.id, t);
}
let judged: Map<string, JudgeRow> | null = null;
let judgeLine = "";
if (existsSync(join(runDir, "judge.jsonl"))) {
  judged = new Map();
  for (const l of await lines(join(runDir, "judge.jsonl"))) {
    const r = JSON.parse(l) as JudgeRow;
    judged.set(r.turnId, r);
  }
  const judges = new Set([...judged.values()].map((r) => `${r.judge.model}, reasoning ${r.judge.reasoningEffort}, prompt ${r.judge.promptSha256.slice(0, 12)}`));
  if (judges.size > 1) {
    console.error(`judge.jsonl mixes judges: ${[...judges].join("; ")}`);
    process.exit(1);
  }
  judgeLine = `Judge: ${[...judges][0]}. A trial fails the judge when any of its turns does; trials with an unjudged or unreadable turn are left out of the judge columns.`;
}

const runId = trials[0]?.runId ?? runDir;
const table = oracleTable(trials, turns, judged, `Oracles: ${runId}`);
let text = render(table, values.format as Format);
if (values.format === "md") {
  text = `Run ${runId}. MR: the relation's verdict (the report's failures). Implicit: a turn errored, was malformed or had a value rejected.\n${judgeLine}\n\n${text}`;
}
if (values.out) await writeFile(values.out, text + "\n");
else process.stdout.write(text + "\n");
