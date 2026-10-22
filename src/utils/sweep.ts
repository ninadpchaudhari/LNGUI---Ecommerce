/**
 * The sweep engine: every frozen case, under every condition, N times.
 *
 * This is the only MR runner. The Experiments page drives it from the browser
 * and scripts/sweep.ts drives it from Node. The two differ only in what they
 * plug in:
 *
 *   transport  how a request reaches the API handler (browser fetch, or the
 *              handler called in-process) plus any auth header
 *   sink       where trial rows and turn records go (memory and /api/runs,
 *              or JSONL files)
 *
 * A condition's P travels as request overrides (shared/overrides.ts), so both
 * front ends resolve P through the same router code.
 *
 * Trials run in complete rounds. Round r runs each (condition, case) pair
 * once, in a seeded shuffled order, and finishes before round r + 1 starts,
 * so drift over the run spreads across cases instead of landing on whichever
 * case happened to run last. Every case is repeated, including cases that
 * passed the first time. RQ2 needs the full cohort.
 */
import { promptConfigFrom, type AppConfig, type PromptConfig, type TurnRecord } from "../../shared/contract.ts";
import type { MrCase } from "../../shared/cases.ts";
import type { Overrides } from "../../shared/overrides.ts";
import { rng, shuffle } from "../../shared/random.ts";
import { trialKey, type TrialRow } from "../../shared/trials.ts";
import type { FetchLike } from "./api.ts";
import { runTrial } from "./relations.ts";

export interface Condition {
  id: string;
  /** P overrides for this condition, e.g. LLM_TEMPERATURE, HISTORY_POLICY. The prompt text is added as SYSTEM_PROMPT. */
  env: Overrides;
}

export interface Transport {
  /** Defaults to the global fetch with relative URLs. */
  fetchImpl?: FetchLike;
  /** Extra headers on every request. */
  headers?: Record<string, string>;
  /** Awaited after each round: background work the handler scheduled. */
  drain?: () => Promise<void>;
}

export interface ConditionRuntime {
  condition: Condition;
  config: AppConfig;
  P: PromptConfig;
  model: string;
  transport: Transport;
}

/** A turn record tagged with where it belongs in the run. */
export type TaggedTurn = TurnRecord & { runId: string; conditionId: string; caseId: string; attempt: number };

export interface TrialSink {
  turns(records: TaggedTurn[]): Promise<void> | void;
  trial(row: TrialRow): Promise<void> | void;
  flush?(): Promise<void>;
}

async function doFetch(transport: Transport, path: string, init: RequestInit): Promise<Response> {
  const f: FetchLike = transport.fetchImpl ?? ((input, i) => fetch(input, i));
  return f(path, init);
}

/** Resolves a condition's P by asking the server, with the condition's overrides applied. */
export async function openCondition(condition: Condition, transport: Transport): Promise<ConditionRuntime> {
  const res = await doFetch(transport, "/api/config", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...transport.headers },
    body: JSON.stringify({ overrides: condition.env }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`condition ${condition.id}: GET /api/config failed (${res.status}) ${body.slice(0, 300)}`);
  }
  const config = (await res.json()) as AppConfig;
  return { condition, config, P: promptConfigFrom(config, config.defaultModel), model: config.defaultModel, transport };
}

export interface SweepOptions {
  runId: string;
  cases: readonly MrCase[];
  conditions: readonly ConditionRuntime[];
  n: number;
  seed: number;
  concurrency: number;
  maxInfraRetries: number;
  sink: TrialSink;
  /** Keys already completed (pass or fail); these are skipped on resume. */
  done?: ReadonlySet<string>;
  onTrial?: (row: TrialRow, progress: { done: number; total: number; round: number }) => void;
  /** Stops scheduling new trials; trials in flight finish and are recorded. */
  signal?: AbortSignal;
  /** Delay before an infrastructure retry; overridable for tests. */
  backoffMs?: (attempt: number) => number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function runOne(c: MrCase, rt: ConditionRuntime, trial: number, opts: SweepOptions): Promise<TrialRow> {
  for (let attempt = 1; ; attempt++) {
    const started = Date.now();
    const { source, followup, outcome } = await runTrial(rt.P, c, {
      sessionId: `${opts.runId}/${rt.condition.id}`,
      trial,
      ...(rt.transport.fetchImpl ? { fetchImpl: rt.transport.fetchImpl } : {}),
      ...(rt.transport.headers ? { headers: rt.transport.headers } : {}),
      overrides: rt.condition.env,
    });
    const latencyMs = Date.now() - started;
    const records = [...source.records, ...followup.records];

    await opts.sink.turns(
      records.map((r) => ({ ...r, runId: opts.runId, conditionId: rt.condition.id, caseId: c.id, attempt })),
    );

    let tokens: number | null = null;
    let costUsd: number | null = null;
    for (const r of records) {
      const u = r.meta?.usageTotal;
      if (typeof u?.totalTokens === "number") tokens = (tokens ?? 0) + u.totalTokens;
      if (typeof u?.costUsd === "number") costUsd = (costUsd ?? 0) + u.costUsd;
    }
    const attempts = records.flatMap((r) => r.meta?.attempts ?? []);

    const row: TrialRow = {
      schemaVersion: 1,
      runId: opts.runId,
      conditionId: rt.condition.id,
      commandMode: rt.config.commandMode,
      mode: rt.config.mode,
      provider: rt.config.provider,
      caseId: c.id,
      relation: c.relation,
      semanticGroup: c.semanticGroup,
      strata: c.strata,
      trial,
      attempt,
      status: outcome.infra ? "infra" : outcome.holds ? "pass" : "fail",
      reason: outcome.reason,
      invocations: records.length,
      tokens,
      costUsd,
      latencyMs,
      overReach: records.some((r) => r.flags.commandOverReach),
      overReachControls: [...new Set(records.flatMap((r) => r.flags.overReachControls))],
      contextIntact: records.every((r) => r.flags.contextIntact),
      resolvedModels: [...new Set(attempts.map((a) => a.resolvedModel).filter((m): m is string => !!m))],
      providers: [...new Set(attempts.map((a) => a.providerName).filter((p): p is string => !!p))],
      observations: {
        source: { V: source.state.V, D: source.state.D },
        followup: { V: followup.state.V, D: followup.state.D },
      },
      turnIds: records.map((r) => r.id),
      createdAt: new Date().toISOString(),
    };

    const retry = outcome.infra && attempt <= opts.maxInfraRetries && !opts.signal?.aborted;
    if (!retry) {
      await opts.sink.trial(row);
      return row;
    }
    await sleep(opts.backoffMs ? opts.backoffMs(attempt) : 1000 * 2 ** attempt);
  }
}

/** Runs the sweep and returns the rows it produced (not including skipped ones). */
export async function runSweep(opts: SweepOptions): Promise<TrialRow[]> {
  const done = opts.done ?? new Set<string>();
  const next = rng(opts.seed);
  const total = opts.cases.length * opts.conditions.length * opts.n;
  let completed = done.size;
  const produced: TrialRow[] = [];

  for (let round = 1; round <= opts.n; round++) {
    // Shuffle every round, even when resuming, so the order is a function of
    // the seed alone and a resumed run matches an uninterrupted one.
    const order = shuffle(
      opts.conditions.flatMap((rt) => opts.cases.map((c) => ({ rt, c }))),
      next,
    ).filter(({ rt, c }) => !done.has(trialKey({ conditionId: rt.condition.id, caseId: c.id, trial: round })));
    if (opts.signal?.aborted) break;

    let cursor = 0;
    const worker = async () => {
      while (cursor < order.length && !opts.signal?.aborted) {
        const { rt, c } = order[cursor++];
        const row = await runOne(c, rt, round, opts);
        produced.push(row);
        completed += 1;
        opts.onTrial?.(row, { done: completed, total, round });
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, opts.concurrency) }, worker));
    await Promise.all([...new Set(opts.conditions.map((rt) => rt.transport.drain))].map((d) => d?.()));
  }

  await opts.sink.flush?.();
  return produced;
}

/** Mediator utterance executions the sweep will issue, before retries. */
export function plannedInvocations(cases: readonly MrCase[], conditions: number, n: number): number {
  return cases.reduce((s, c) => s + c.sourceTrace.length + c.followupTrace.length, 0) * conditions * n;
}

/** An in-memory sink, for the browser and for tests. */
export function memorySink(): TrialSink & { rows: TrialRow[]; turnRecords: TaggedTurn[] } {
  const rows: TrialRow[] = [];
  const turnRecords: TaggedTurn[] = [];
  return {
    rows,
    turnRecords,
    turns: (records) => {
      turnRecords.push(...records);
    },
    trial: (row) => {
      rows.push(row);
    },
  };
}
