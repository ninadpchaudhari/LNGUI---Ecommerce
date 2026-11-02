/**
 * Print a formatted results table for a sweep.
 *
 *   npm run report -- runs/<dir> [--format md|latex|csv] [--by mr|case] [--k 1,3,5] [--out file]
 *
 * `--by mr` (default) gives one row per condition × relation; `--by case`
 * gives one row per condition × case, for debugging.
 */
import { readFile, writeFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { readTrials } from "./lib/sweep.ts";
import { caseTable, render, reportTitle, summaryTable, type Format } from "../shared/report.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    format: { type: "string", default: "md" },
    by: { type: "string", default: "mr" },
    k: { type: "string", default: "1,3,5" },
    out: { type: "string" },
    title: { type: "string" },
  },
});

const target = positionals[0];
if (!target) {
  console.error("usage: npm run report -- <runDir | trials.jsonl> [--format md|latex|csv] [--by mr|case]");
  process.exit(1);
}
const format = values.format as Format;
if (!["md", "latex", "csv"].includes(format)) {
  console.error(`unknown --format ${format}`);
  process.exit(1);
}

const isDir = existsSync(target) && statSync(target).isDirectory();
const trialsPath = isDir ? join(target, "trials.jsonl") : target;
const rows = await readTrials(trialsPath);
if (rows.length === 0) {
  console.error(`no trials in ${trialsPath}`);
  process.exit(1);
}

let runId = rows[0].runId;
let header = "";
const manifestPath = isDir ? join(target, "manifest.json") : null;
if (manifestPath && existsSync(manifestPath)) {
  const m = JSON.parse(await readFile(manifestPath, "utf8"));
  runId = m.runId ?? runId;
  const conds = (m.conditions ?? [])
    .map((c: { id: string; model: string; mode: string; provider: string; P: { systemPromptHash: string; temperature: number | null; historyPolicy: string } }) =>
      `${c.id}: ${c.mode === "local-test" ? "LOCAL_TEST_MODE parser" : `${c.provider} ${c.model}`}, prompt ${c.P.systemPromptHash.replace("fnv1a32:", "#")}, T=${c.P.temperature ?? "default"}, history=${c.P.historyPolicy}`)
    .join("; ");
  header = `Run ${runId} · cases sha256 ${String(m.casesSha256).slice(0, 12)} · git ${String(m.git?.commit ?? "?").slice(0, 7)}${m.git?.dirty ? " (dirty)" : ""}\n${conds}`;
}

const ks = values.k!.split(",").map((s) => Number(s.trim())).filter((k) => Number.isInteger(k) && k > 0);
const title = values.title ?? reportTitle(runId, rows);
const table = values.by === "case" ? caseTable(rows, ks, title) : summaryTable(rows, ks, title);

let text = render(table, format);
if (format === "md" && header) text = `${header}\n\n${text}`;
text += "\n";

if (values.out) {
  await writeFile(values.out, text);
  console.error(`wrote ${values.out}`);
} else {
  process.stdout.write(text);
}
