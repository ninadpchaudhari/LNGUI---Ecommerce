/**
 * The LLM-as-judge oracle (proposal §5.3, RQ1). For each turn of a recorded
 * run it asks a judge model whether the filters after the turn are what the
 * user wants, given the user's requests so far. It reads turns.jsonl and
 * writes judge.jsonl; it never touches the mediator, the records or the MR
 * verdicts. Resumable: a turn with a pass, fail or invalid verdict is not
 * asked again; a failed call is.
 */
import { appendFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import OpenAI from "openai";
import type { TurnRecord, Valuation } from "../../shared/contract.ts";
import type { JudgeRow } from "../../shared/oracles.ts";
import type { TrialRow } from "../../shared/trials.ts";
import { V0 } from "../../shared/surface.generated.ts";

export const JUDGE_PROMPT_FILE = "judge/judge.txt";

export interface JudgeSettings {
  model: string;
  reasoningEffort: string;
  /** Caps reasoning and answer together, so each call has a known worst-case price. */
  maxTokens: number;
  promptFile: string;
  promptSha256: string;
}

const value = (control: keyof Valuation, v: unknown) =>
  v === null || v === undefined ? "none" : control === "maxPrice" && v === V0.maxPrice ? `${v} (no limit)` : String(v);

/** The filters as the judge reads them; clearFilters is an action, not a filter. */
export function filtersText(V: Valuation): string {
  return (["category", "maxPrice", "minRating", "inStockOnly", "sort"] as const).map((c) => `${c}: ${value(c, V[c])}`).join(", ");
}

/** What the judge sees for one turn: the user's requests so far, and the filters before and after the latest. */
export function judgeMessage(turn: TurnRecord, earlier: readonly TurnRecord[]): string {
  const lines = [
    "The user's earlier requests in this conversation, oldest first:",
    ...(earlier.length ? earlier.map((t, i) => `${i + 1}. "${t.u}"`) : ["(none)"]),
    "",
    `Latest request: "${turn.u}"`,
    "",
    `Filters before the latest request: ${filtersText(turn.vBefore)}`,
    `Filters after the latest request: ${filtersText(turn.vAfter)}`,
  ];
  if (!turn.ok) lines.push("", "The assistant produced no usable reply to the latest request, so the filters did not change.");
  return lines.join("\n");
}

/** The verdict in a judge reply, or null when the reply cannot be read. */
export function parseJudgeReply(raw: string): { verdict: "pass" | "fail"; reason: string } | null {
  const text = raw.match(/\{[\s\S]*\}/)?.[0];
  if (!text) return null;
  try {
    const o = JSON.parse(text) as { verdict?: unknown; reason?: unknown };
    if (o.verdict !== "pass" && o.verdict !== "fail") return null;
    return { verdict: o.verdict, reason: typeof o.reason === "string" ? o.reason : "" };
  } catch {
    return null;
  }
}

export interface JudgeJob {
  trial: TrialRow;
  turn: TurnRecord;
  earlier: TurnRecord[];
}

/**
 * Every turn to judge: each non-infra trial of the chosen configurations (all
 * when null), in trial order, skipping turns already answered. Earlier turns
 * are those before it in the same trace.
 */
export function plannedJobs(
  trials: readonly TrialRow[],
  turns: ReadonlyMap<string, TurnRecord>,
  configurations: ReadonlySet<string> | null,
  done: ReadonlySet<string>,
): { jobs: JudgeJob[]; missingTurns: number } {
  const jobs: JudgeJob[] = [];
  let missingTurns = 0;
  for (const trial of trials) {
    if (trial.status === "infra" || (configurations && !configurations.has(trial.conditionId))) continue;
    const records = trial.turnIds.map((id) => turns.get(id));
    if (records.some((r) => r === undefined)) {
      missingTurns += records.filter((r) => r === undefined).length;
      continue;
    }
    const ordered = records as TurnRecord[];
    ordered.forEach((turn, i) => {
      if (done.has(turn.id)) return;
      jobs.push({ trial, turn, earlier: ordered.slice(0, i).filter((r) => r.role === turn.role) });
    });
  }
  return { jobs, missingTurns };
}

/** Rows already in judge.jsonl. Refuses a file written by a different judge, so one table never mixes two. */
export async function readJudged(path: string, settings: JudgeSettings): Promise<Map<string, JudgeRow>> {
  const out = new Map<string, JudgeRow>();
  if (!existsSync(path)) return out;
  for (const line of (await readFile(path, "utf8")).split("\n")) {
    if (!line.trim()) continue;
    const row = JSON.parse(line) as JudgeRow;
    const j = row.judge;
    if (j.model !== settings.model || j.reasoningEffort !== settings.reasoningEffort || j.maxTokens !== settings.maxTokens || j.promptSha256 !== settings.promptSha256) {
      throw new Error(`${path} was written by a different judge (${j.model}, reasoning ${j.reasoningEffort}, prompt ${j.promptSha256.slice(0, 12)}…); move it aside first`);
    }
    out.set(row.turnId, row); // the last row for a turn wins, so a retried error is replaced
  }
  return out;
}

/** Turns a later run should not ask again: every answered one. A failed call is asked again. */
export const answered = (judged: ReadonlyMap<string, JudgeRow>) =>
  new Set([...judged.values()].filter((r) => r.verdict !== "error").map((r) => r.turnId));

export async function judgeOne(client: OpenAI, settings: JudgeSettings, system: string, job: JudgeJob): Promise<JudgeRow> {
  const started = Date.now();
  const base = {
    schemaVersion: 1 as const, runId: job.trial.runId, conditionId: job.trial.conditionId,
    caseId: job.trial.caseId, trial: job.trial.trial, turnId: job.turn.id,
  };
  const judge = {
    provider: "openrouter" as const, model: settings.model, reasoningEffort: settings.reasoningEffort,
    maxTokens: settings.maxTokens, promptFile: settings.promptFile, promptSha256: settings.promptSha256,
  };
  try {
    const res = await client.chat.completions.create({
      model: settings.model,
      max_tokens: settings.maxTokens,
      // OpenRouter's reasoning parameter; the SDK passes fields it does not type through.
      ...({ reasoning: { effort: settings.reasoningEffort } } as object),
      messages: [
        { role: "system", content: system },
        { role: "user", content: judgeMessage(job.turn, job.earlier) },
      ],
    });
    const raw = res.choices[0]?.message?.content?.trim() ?? "";
    const parsed = parseJudgeReply(raw);
    const extra = res as unknown as { usage?: { cost?: number } };
    return {
      ...base,
      verdict: parsed?.verdict ?? "invalid",
      reason: parsed?.reason ?? null,
      raw,
      judge: { ...judge, resolvedModel: res.model ?? null },
      usage: { promptTokens: res.usage?.prompt_tokens ?? null, completionTokens: res.usage?.completion_tokens ?? null, costUsd: extra.usage?.cost ?? null },
      latencyMs: Date.now() - started,
      createdAt: new Date().toISOString(),
    };
  } catch (e) {
    return {
      ...base, verdict: "error", reason: e instanceof Error ? e.message : String(e), raw: null,
      judge: { ...judge, resolvedModel: null }, usage: null, latencyMs: Date.now() - started, createdAt: new Date().toISOString(),
    };
  }
}

/** Judges every job, `concurrency` at a time, appending each row to `outPath` as it arrives. */
export async function runJudge(
  client: OpenAI,
  settings: JudgeSettings,
  system: string,
  jobs: readonly JudgeJob[],
  outPath: string,
  concurrency: number,
  onRow?: (row: JudgeRow, done: number) => void,
): Promise<JudgeRow[]> {
  const rows: JudgeRow[] = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < jobs.length) {
      const row = await judgeOne(client, settings, system, jobs[cursor++]);
      await appendFile(outPath, JSON.stringify(row) + "\n");
      rows.push(row);
      onRow?.(row, rows.length);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  return rows;
}
