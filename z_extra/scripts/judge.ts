/**
 * Ask an LLM judge about every turn of a recorded run (RQ1's LLM-as-judge
 * oracle). Writes <run>/judge.jsonl; resumable.
 *
 *   npm run judge -- runs/<dir> [--config id,id] [--model anthropic/claude-sonnet-5.5]
 *                   [--reasoning low] [--max-tokens 2048] [--concurrency 8] [--dry-run] [--yes]
 *
 * Costs money: without --yes it prints the plan and the price and stops.
 * Then: npm run oracles -- runs/<dir>
 */
import "dotenv/config";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import OpenAI from "openai";
import type { TurnRecord } from "../shared/contract.ts";
import { normalizePrompt, promptSha256 } from "../shared/prompt-text.ts";
import { readTrials } from "./lib/sweep.ts";
import { JUDGE_PROMPT_FILE, answered, judgeMessage, plannedJobs, readJudged, runJudge, type JudgeSettings } from "./lib/judge.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    config: { type: "string" },
    model: { type: "string", default: "anthropic/claude-sonnet-5.5" },
    reasoning: { type: "string", default: "low" },
    "max-tokens": { type: "string", default: "2048" },
    concurrency: { type: "string", default: "8" },
    "dry-run": { type: "boolean", default: false },
    yes: { type: "boolean", default: false },
  },
});
const die = (msg: string): never => {
  console.error(msg);
  process.exit(1);
};

const runDir = positionals[0] ?? die("usage: npm run judge -- runs/<dir> [--config id,id] [--dry-run] [--yes]");
const trials = await readTrials(join(runDir, "trials.jsonl"));
const turns = new Map<string, TurnRecord>();
for (const line of (await readFile(join(runDir, "turns.jsonl"), "utf8")).split("\n")) {
  if (line.trim()) {
    const t = JSON.parse(line) as TurnRecord;
    turns.set(t.id, t);
  }
}
const known = new Set(trials.map((t) => t.conditionId));
const configurations = values.config ? new Set(values.config.split(",").map((s) => s.trim())) : null;
for (const c of configurations ?? []) if (!known.has(c)) die(`no configuration ${c} in this run (have: ${[...known].join(", ")})`);

const system = normalizePrompt(await readFile(JUDGE_PROMPT_FILE, "utf8"));
const settings: JudgeSettings = {
  model: values.model!,
  reasoningEffort: values.reasoning!,
  maxTokens: Number(values["max-tokens"]),
  promptFile: JUDGE_PROMPT_FILE,
  promptSha256: await promptSha256(system),
};
const outPath = join(runDir, "judge.jsonl");
const judged = await readJudged(outPath, settings).catch((e: Error) => die(e.message));
const { jobs, missingTurns } = plannedJobs(trials, turns, configurations, answered(judged));

// Price and reasoning efforts from OpenRouter's public model list (no key needed).
type ModelInfo = { id: string; pricing: { prompt: string; completion: string }; reasoning?: { supported_efforts?: string[] } };
const info = await fetch("https://openrouter.ai/api/v1/models")
  .then((r) => r.json() as Promise<{ data: ModelInfo[] }>)
  .then((d) => d.data.find((m) => m.id === settings.model) ?? die(`OpenRouter has no model ${settings.model}`))
  .catch((e: Error) => (console.warn(`! could not read OpenRouter's model list (${e.message}); no price estimate`), null));
const efforts = info?.reasoning?.supported_efforts;
if (efforts && !efforts.includes(settings.reasoningEffort)) die(`${settings.model} takes reasoning ${efforts.join(", ")}, not ${settings.reasoningEffort}`);

const perConfig = new Map<string, number>();
for (const j of jobs) perConfig.set(j.trial.conditionId, (perConfig.get(j.trial.conditionId) ?? 0) + 1);
console.log(`judge ${settings.model} · reasoning ${settings.reasoningEffort} · max ${settings.maxTokens} tokens · prompt ${JUDGE_PROMPT_FILE} ${settings.promptSha256.slice(0, 12)}…`);
console.log(`${jobs.length} turns to judge (${judged.size} already in judge.jsonl)`);
for (const [c, n] of perConfig) console.log(`  ${c.padEnd(44)} ${n}`);
if (missingTurns) console.warn(`! ${missingTurns} turn records are missing from turns.jsonl; their trials are skipped`);
if (info) {
  const inTokens = jobs.reduce((s, j) => s + (system.length + judgeMessage(j.turn, j.earlier).length) / 4, 0);
  const price = (out: number) => inTokens * Number(info.pricing.prompt) + jobs.length * out * Number(info.pricing.completion);
  console.log(`≈ $${price(300).toFixed(2)} at ~300 output tokens a call; at most $${price(settings.maxTokens).toFixed(2)} if every call uses all ${settings.maxTokens}`);
}
if (values["dry-run"] || jobs.length === 0) process.exit(0);
if (!values.yes) die("This spends money. Add --yes to run it.");

const apiKey = process.env.OPEN_ROUTER_API_KEY || process.env.OPENROUTER_API_KEY || die("no OPEN_ROUTER_API_KEY in .env");
const client = new OpenAI({ apiKey, baseURL: process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1", timeout: 120_000 });
const tally = { fail: 0, invalid: 0, error: 0, cost: 0 };
await runJudge(client, settings, system, jobs, outPath, Number(values.concurrency), (row, done) => {
  if (row.verdict === "fail") tally.fail += 1;
  if (row.verdict === "invalid") tally.invalid += 1;
  if (row.verdict === "error") tally.error += 1;
  tally.cost += row.usage?.costUsd ?? 0;
  if (done % 25 === 0 || done === jobs.length) {
    process.stdout.write(`\rjudged ${done}/${jobs.length} · fail ${tally.fail} · unreadable ${tally.invalid} · call errors ${tally.error} · $${tally.cost.toFixed(2)}   `);
  }
});
console.log(`\nwrote ${outPath}${tally.error ? `; ${tally.error} calls failed, run again to retry them` : ""}`);
console.log(`next: npm run oracles -- ${runDir}`);
