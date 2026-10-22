/**
 * M — the LLM mediator, and the only impure stage of Eq. 4.7.
 *
 * Kept apart from Apply and A (which live in shared/transition.ts and are pure)
 * because that is the boundary the fault model relies on: everything M produces
 * is q, and everything after q is deterministic application logic.
 */
import {
  footprint,
  overReach,
  type Command,
  type CommandMeta,
  type ControlId,
  type StandingFlags,
  type SystemState,
  type TurnRecord,
} from "../../shared/contract.ts";
import type { Overrides } from "../../shared/overrides.ts";
import { step } from "../../shared/transition.ts";
import { CommandApiError, sendCommand, type FetchLike } from "./api.ts";

export interface MediateResult {
  q: Command | null;
  meta: CommandMeta | null;
  ok: boolean;
  error: string | null;
}

/** M(σ, u) = q. Never throws: a mediator failure is data, not an exception. */
export async function mediate(
  state: SystemState,
  u: string,
  options: { model?: string; sessionId: string; fetchImpl?: FetchLike; headers?: Record<string, string>; overrides?: Overrides },
): Promise<MediateResult> {
  try {
    const res = await sendCommand(u, {
      ...(options.model ? { model: options.model } : {}),
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      ...(options.headers ? { headers: options.headers } : {}),
      ...(options.overrides ? { overrides: options.overrides } : {}),
      history: state.H,
      historyDisplayedCount: state.H.length,
      sessionId: options.sessionId,
    });
    const { meta, ...command } = res;
    return { q: command as Command, meta, ok: true, error: null };
  } catch (e) {
    if (e instanceof CommandApiError) {
      return { q: null, meta: e.meta, ok: false, error: e.message };
    }
    return { q: null, meta: null, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * The two standing assertions of §4.6, reported outside the fault taxonomy.
 *
 * contextIntact compares the turns the mediator actually received against the
 * turns on screen. A mismatch means the transcript is not the context, which
 * is the display-only-history fault.
 */
export function standingFlags(
  fp: readonly ControlId[],
  writeSet: readonly ControlId[] | null,
  meta: CommandMeta | null,
): StandingFlags {
  const offending = writeSet === null ? [] : overReach(fp, writeSet);
  return {
    commandOverReach: offending.length > 0,
    overReachControls: offending,
    contextIntact:
      meta === null ? true : meta.historyTurnsEffective === meta.historyTurnsDisplayed,
  };
}

export interface TurnOutcome {
  state: SystemState;
  record: TurnRecord;
}

/**
 * One full transition: M, then Apply, then A, recorded as a TurnRecord.
 *
 * σ′ is computed from the pure reducer and returned, rather than being read
 * back out of React state — the caller applies it. Reading it back after
 * setState would observe the previous render's values.
 */
export async function runTurn(
  state: SystemState,
  u: string,
  options: {
    model?: string;
    sessionId: string;
    turnIndex: number;
    kind?: TurnRecord["kind"];
    relation?: string | null;
    role?: TurnRecord["role"];
    trial?: number | null;
    writeSet?: ControlId[] | null;
    fetchImpl?: FetchLike;
    headers?: Record<string, string>;
    overrides?: Overrides;
  },
): Promise<TurnOutcome> {
  const before = state;
  const { q, meta, ok, error } = await mediate(state, u, {
    ...(options.model ? { model: options.model } : {}),
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    ...(options.headers ? { headers: options.headers } : {}),
    ...(options.overrides ? { overrides: options.overrides } : {}),
    sessionId: options.sessionId,
  });

  const result = step(state, u, q);
  const fp = footprint(before.V, result.state.V);
  const writeSet = options.writeSet ?? null;

  const record: TurnRecord = {
    schemaVersion: 1,
    id: meta?.requestId ?? crypto.randomUUID(),
    sessionId: options.sessionId,
    createdAt: new Date().toISOString(),
    turnIndex: options.turnIndex,
    kind: options.kind ?? "chat",
    relation: options.relation ?? null,
    role: options.role ?? null,
    trial: options.trial ?? null,
    u,
    q,
    vBefore: before.V,
    vAfter: result.state.V,
    dBefore: before.D,
    dAfter: result.state.D,
    fp,
    writeSet,
    applied: result.apply.applied,
    rejected: result.apply.rejected,
    flags: standingFlags(fp, writeSet, meta),
    ok,
    error,
    meta,
  };

  // P may have been resolved differently server-side (e.g. the model actually
  // served), so carry the reported P forward into σ′.
  const state2: SystemState = meta ? { ...result.state, P: meta.P } : result.state;

  return { state: state2, record };
}
