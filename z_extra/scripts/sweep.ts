/**
 * `npm run sweep`: runs an experiment file headlessly, with the same engine as
 * the Experiments page (src/utils/sweep.ts), calling the API handler in-process.
 *
 *   npm run sweep -- experiments/<name>.json [--dry-run] [--langfuse]
 *
 * Writes runs/<name>/ (running the experiment again replaces it):
 *   manifest.json  experiment, cases hash, git commit, prompt texts, resolved P per configuration
 *   trials.jsonl   one row per trial
 *   turns.jsonl    every TurnRecord
 *
 * Then: npm run report -- runs/<name>
 */
import "dotenv/config";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { parseCasesJsonl } from "../shared/cases.ts";
import { experimentSchema } from "../shared/experiment.ts";
import { LANGFUSE_HEADER } from "../shared/overrides.ts";
import { openCondition, plannedInvocations, runSweep, type ConditionRuntime } from "../src/utils/sweep.ts";
import { inProcessTransport } from "./lib/inprocess.ts";
import { fileSink } from "./lib/sweep.ts";
import { loadConditions } from "./lib/prompts.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    "dry-run": { type: "boolean", default: false },
    langfuse: { type: "boolean", default: false },
  },
});

function stop(message: string): never {
  console.error(message);
  process.exit(1);
}

/** The output of a git command, or null outside a repository. */
function git(command: string): string | null {
  try {
    return execSync(`git ${command}`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return null;
  }
}

// 1. Read the experiment file.
const experimentPath = positionals[0];
if (!experimentPath) stop("usage: npm run sweep -- experiments/<name>.json [--dry-run] [--langfuse]");
const parsed = experimentSchema.safeParse(JSON.parse(await readFile(experimentPath, "utf8")));
if (!parsed.success) {
  const messages = parsed.error.issues.map((issue) => issue.message);
  stop(`experiment file has problems:\n  ${messages.join("\n  ")}`);
}
const experiment = parsed.data;

// 2. Read the cases file and check it is the one the experiment pins.
const casesText = await readFile(experiment.cases, "utf8");
const casesSha256 = createHash("sha256").update(casesText).digest("hex");
const { cases, problems } = parseCasesJsonl(casesText);
if (problems.length > 0) stop(`cases file has problems:\n  ${problems.join("\n  ")}`);
if (!experiment.casesSha256) {
  console.warn("! experiment has no casesSha256; the test set is not pinned");
} else if (experiment.casesSha256 !== casesSha256) {
  stop(
    `${experiment.cases} is not the test set this experiment was designed for ` +
      `(expected ${experiment.casesSha256.slice(0, 12)}…, found ${casesSha256.slice(0, 12)}…)`,
  );
}

// 3. Read each configuration's prompt file and check it against its pinned hash.
const loaded = await loadConditions(experiment.conditions).catch((e: Error) => stop(e.message));
for (const warning of loaded.warnings) console.warn(`! ${warning}`);

// 4. Ask the API for each configuration's P, and refuse a configuration that would not run as written.
// Tracing is off unless --langfuse; turns.jsonl already holds every attempt.
// The Experiments page sends the same header.
const transport = inProcessTransport({ [LANGFUSE_HEADER]: values.langfuse ? "on" : "off" });
const runtimes: ConditionRuntime[] = [];
for (const condition of loaded.conditions) {
  const runtime = await openCondition(condition, transport);
  if (runtime.config.mode === "local-test" && condition.env.LOCAL_TEST_MODE !== "true") {
    stop(`configuration ${condition.id} resolved to LOCAL_TEST_MODE from .env; set it explicitly in the configuration if intended`);
  }
  if (runtime.config.mode === "llm" && runtime.config.provider === "none") {
    stop(`configuration ${condition.id}: no API key (OPEN_ROUTER_API_KEY or OPENAI_API_KEY)`);
  }
  runtimes.push(runtime);
}

// 5. Print the plan. A dry run stops here.
const planned = plannedInvocations(cases, runtimes.length, experiment.n);
console.log(`experiment ${experiment.name}: ${cases.length} cases × ${runtimes.length} configuration(s) × N=${experiment.n}`);
console.log(`cases ${experiment.cases} sha256 ${casesSha256.slice(0, 16)}…`);
for (const runtime of runtimes) {
  const c = runtime.config;
  const promptFile = experiment.conditions.find((x) => x.id === runtime.condition.id)!.prompt.file;
  const reasoning = c.reasoningEffort ? ` reasoning=${c.reasoningEffort}` : "";
  console.log(
    `  ${runtime.condition.id.padEnd(22)} mode=${c.mode} model=${runtime.model} provider=${c.provider} ` +
      `prompt=${promptFile} ${c.systemPromptHash.replace("fnv1a32:", "#")} ` +
      `T=${c.temperature ?? "default"} top_p=${c.topP ?? "default"}${reasoning} history=${c.historyPolicy}`,
  );
}
console.log(`≈${planned} mediator calls before retries (judge calls not included)`);
if (values["dry-run"]) process.exit(0);

// 6. Empty runs/<name>/ and write the manifest.
const outDir = join("runs", experiment.name);
const startedAt = new Date().toISOString();
const runId = `${experiment.name}-${startedAt.replace(/[:.]/g, "-")}`;
await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });
// The exact prompt texts, so a run can be reproduced from its manifest.
const prompts: Record<string, { file: string; sha256: string; text: string }> = {};
for (const p of loaded.prompts) prompts[p.hash] = { file: p.file, sha256: p.sha256, text: p.text };
const manifest = {
  runId,
  runner: "cli",
  langfuse: values.langfuse,
  experimentPath,
  experiment,
  casesSha256,
  caseCount: cases.length,
  plannedInvocations: planned,
  git: { commit: git("rev-parse HEAD"), branch: git("rev-parse --abbrev-ref HEAD"), dirty: (git("status --porcelain") ?? "") !== "" },
  node: process.version,
  startedAt,
  prompts,
  conditions: runtimes.map((runtime) => ({
    id: runtime.condition.id,
    model: runtime.model,
    P: runtime.P,
    mode: runtime.config.mode,
    provider: runtime.config.provider,
  })),
};
await writeFile(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

// 7. Run every case under every configuration N times, printing progress.
let fails = 0;
let infra = 0;
let tokens = 0;
const tty = process.stdout.isTTY;
const rows = await runSweep({
  runId,
  cases,
  conditions: runtimes,
  n: experiment.n,
  seed: experiment.seed,
  concurrency: experiment.concurrency,
  maxInfraRetries: experiment.maxInfraRetries,
  sink: fileSink(join(outDir, "trials.jsonl"), join(outDir, "turns.jsonl")),
  onTrial: (row, progress) => {
    if (row.status === "fail") fails += 1;
    if (row.status === "infra") infra += 1;
    tokens += row.tokens ?? 0;
    const line = `round ${progress.round}/${experiment.n}  ${progress.done}/${progress.total} trials  fails ${fails}  infra ${infra}  tokens ${tokens}`;
    if (tty) process.stdout.write(`\r${line}`);
    else if (progress.done % 50 === 0 || progress.done === progress.total) console.log(line);
  },
});
if (tty) process.stdout.write("\n");

// 8. Record when the run finished.
const finished = { ...manifest, finishedAt: new Date().toISOString() };
await writeFile(join(outDir, "manifest.json"), JSON.stringify(finished, null, 2) + "\n");
console.log(`${rows.length} trial(s) written to ${outDir}`);
console.log(`next: npm run report -- ${outDir}`);
