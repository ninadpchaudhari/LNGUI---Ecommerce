/**
 * Headless MR sweep: the shared engine (src/utils/sweep.ts) with an
 * in-process transport and a JSONL file sink.
 *
 *   npm run sweep -- experiments/pilot.json [--dry-run] [--resume runs/<dir>] [--langfuse]
 *
 * Writes to runs/<name>-<time>/:
 *   manifest.json  experiment, cases hash, git commit, resolved P per condition
 *   trials.jsonl   one row per trial
 *   turns.jsonl    every TurnRecord
 *
 * Then: npm run report -- runs/<dir>
 */
import "dotenv/config";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { parseCasesJsonl } from "../shared/cases.ts";
import { experimentSchema } from "../shared/experiment.ts";
import { trialKey } from "../shared/trials.ts";
import { LANGFUSE_HEADER } from "../shared/overrides.ts";
import { openCondition, plannedInvocations, runSweep, type ConditionRuntime } from "../src/utils/sweep.ts";
import { inProcessTransport } from "./lib/inprocess.ts";
import { fileSink, readTrials } from "./lib/sweep.ts";
import { loadConditions } from "./lib/prompts.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    "dry-run": { type: "boolean", default: false },
    resume: { type: "string" },
    langfuse: { type: "boolean", default: false },
  },
});

const die = (msg: string): never => {
  console.error(msg);
  process.exit(1);
};

function git(cmd: string): string | null {
  try {
    return execSync(`git ${cmd}`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return null;
  }
}

// ── Load the experiment and the frozen cases ────────────────────────────────

const runDir = values.resume;
let experimentPath = positionals[0];
let manifest: Record<string, unknown> | null = null;
if (runDir) {
  manifest = JSON.parse(await readFile(join(runDir, "manifest.json"), "utf8"));
  experimentPath ??= manifest!.experimentPath as string;
}
if (!experimentPath) die("usage: npm run sweep -- <experiment.json> [--dry-run] [--resume <runDir>]");

const parsed = experimentSchema.safeParse(JSON.parse(await readFile(experimentPath, "utf8")));
if (!parsed.success) die(`experiment file has problems:\n  ${parsed.error.issues.map((i) => i.message).join("\n  ")}`);
const experiment = parsed.data!;

const casesText = await readFile(experiment.cases, "utf8");
const casesSha256 = createHash("sha256").update(casesText).digest("hex");
const { cases, problems } = parseCasesJsonl(casesText);
if (problems.length > 0) die(`cases file has problems:\n  ${problems.join("\n  ")}`);
if (experiment.casesSha256 && experiment.casesSha256 !== casesSha256) {
  die(`${experiment.cases} is not the test set this experiment was designed for (expected ${experiment.casesSha256.slice(0, 12)}…, found ${casesSha256.slice(0, 12)}…)`);
}
if (!experiment.casesSha256) console.warn("! experiment has no casesSha256; the test set is not pinned");
if (manifest && manifest.casesSha256 !== casesSha256) {
  die(`cases file changed since this run started (${String(manifest.casesSha256).slice(0, 12)}… → ${casesSha256.slice(0, 12)}…)`);
}

// ── Resolve P per condition, and refuse silent misconfiguration ─────────────

// Tracing is off unless --langfuse. turns.jsonl already holds every attempt.
// The Experiments page sends the same header, so both front ends agree.
const transport = inProcessTransport({ [LANGFUSE_HEADER]: values.langfuse ? "on" : "off" });
const runtimes: ConditionRuntime[] = [];
const loaded = await loadConditions(experiment.conditions).catch((e: Error) => die(e.message));
const { prompts } = loaded;
for (const w of loaded.warnings) console.warn(`! ${w}`);
for (const condition of loaded.conditions) {
  const rt = await openCondition(condition, transport);
  if (rt.config.mode === "local-test" && condition.env.LOCAL_TEST_MODE !== "true") {
    die(`configuration ${condition.id} resolved to LOCAL_TEST_MODE from .env; set it explicitly in the configuration if intended`);
  }
  if (rt.config.mode === "llm" && rt.config.provider === "none") {
    die(`configuration ${condition.id}: no API key (OPEN_ROUTER_API_KEY or OPENAI_API_KEY)`);
  }
  runtimes.push(rt);
}

const planned = plannedInvocations(cases, runtimes.length, experiment.n);
console.log(`experiment ${experiment.name}: ${cases.length} cases × ${runtimes.length} condition(s) × N=${experiment.n}`);
console.log(`cases ${experiment.cases} sha256 ${casesSha256.slice(0, 16)}…`);
for (const rt of runtimes) {
  const c = rt.config;
  const file = experiment.conditions.find((x) => x.id === rt.condition.id)!.prompt.file;
  console.log(
    `  ${rt.condition.id.padEnd(22)} mode=${c.mode} model=${rt.model} provider=${c.provider} ` +
      `prompt=${file} ${c.systemPromptHash.replace("fnv1a32:", "#")} ` +
      `T=${c.temperature ?? "default"} top_p=${c.topP ?? "default"} history=${c.historyPolicy}`,
  );
}
console.log(`≈${planned} mediator calls before retries (judge calls not included)`);
if (values["dry-run"]) process.exit(0);

// ── Run ─────────────────────────────────────────────────────────────────────

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = runDir ?? join("runs", `${experiment.name}-${stamp}`);
const runId = (manifest?.runId as string | undefined) ?? `${experiment.name}-${stamp}`;
await mkdir(outDir, { recursive: true });
const trialsPath = join(outDir, "trials.jsonl");
const turnsPath = join(outDir, "turns.jsonl");

if (!manifest) {
  manifest = {
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
    startedAt: new Date().toISOString(),
    // The exact prompt texts, so a run can be reproduced from its manifest.
    prompts: Object.fromEntries(prompts.map((p) => [p.hash, { file: p.file, sha256: p.sha256, text: p.text }])),
    conditions: runtimes.map((rt) => ({ id: rt.condition.id, model: rt.model, P: rt.P, mode: rt.config.mode, provider: rt.config.provider })),
  };
  await writeFile(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
}

const existing = await readTrials(trialsPath);
const done = new Set(existing.filter((r) => r.status !== "infra").map(trialKey));
if (done.size > 0) console.log(`resuming: ${done.size} trial(s) already complete`);

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
  sink: fileSink(trialsPath, turnsPath),
  done,
  onTrial: (row, p) => {
    if (row.status === "fail") fails += 1;
    if (row.status === "infra") infra += 1;
    tokens += row.tokens ?? 0;
    const line = `round ${p.round}/${experiment.n}  ${p.done}/${p.total} trials  fails ${fails}  infra ${infra}  tokens ${tokens}`;
    if (tty) process.stdout.write(`\r${line}`);
    else if (p.done % 50 === 0 || p.done === p.total) console.log(line);
  },
});
if (tty) process.stdout.write("\n");

await writeFile(join(outDir, "manifest.json"), JSON.stringify({ ...manifest, finishedAt: new Date().toISOString() }, null, 2) + "\n");
console.log(`${rows.length} trial(s) written to ${outDir}`);
console.log(`next: npm run report -- ${outDir}`);
