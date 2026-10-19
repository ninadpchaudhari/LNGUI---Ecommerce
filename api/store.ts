/**
 * Persistence interface for the two artifacts Chapter 4 asks for:
 *
 *   turns     — the reproducible replay log of §4.17 step 5
 *   mr_cases  — the test report T produced by Algorithm 1
 *
 * One interface, two implementations: D1 in the Worker and an append-only
 * JSONL file in the Express dev server. The endpoints are identical in both,
 * so the client cannot tell them apart.
 */
import type { MrCaseRecord, TurnRecord } from "../shared/contract.ts";
import { SCHEMA_VERSION } from "../shared/contract.ts";

export const MAX_RAW_CHARS = 8000;
export const MAX_UTTERANCE_CHARS = 4096;
export const MAX_PRODUCT_IDS = 500;
export const MAX_BODY_BYTES = 256 * 1024;

export interface TurnListQuery {
  limit: number;
  cursor?: string;
  sessionId?: string;
  kind?: string;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface TurnStore {
  kind: "d1" | "file";
  putTurn(record: TurnRecord): Promise<void>;
  listTurns(query: TurnListQuery): Promise<Page<TurnRecord>>;
  getTurn(id: string): Promise<TurnRecord | null>;
  putMrCase(record: MrCaseRecord): Promise<void>;
  listMrCases(query: TurnListQuery): Promise<Page<MrCaseRecord>>;
  clear(sessionId?: string): Promise<void>;
}

// ── Keyset cursor ───────────────────────────────────────────────────────────
// Ordering is (created_ms DESC, id DESC), so a cursor is the last row seen.
// Keyset rather than OFFSET so concurrent writes cannot shift a page.

export function encodeCursor(createdMs: number, id: string): string {
  return `${createdMs}:${id}`;
}

export function decodeCursor(cursor: string): { createdMs: number; id: string } | null {
  const idx = cursor.indexOf(":");
  if (idx <= 0) return null;
  const createdMs = Number(cursor.slice(0, idx));
  const id = cursor.slice(idx + 1);
  if (!Number.isFinite(createdMs) || id.length === 0) return null;
  return { createdMs, id };
}

export function clampLimit(raw: string | null): number {
  const n = raw === null ? 50 : Number(raw);
  if (!Number.isFinite(n)) return 50;
  return Math.min(100, Math.max(1, Math.floor(n)));
}

// ── Normalisation ───────────────────────────────────────────────────────────

class ValidationError extends Error {}
export { ValidationError };

function cap(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max);
}

/**
 * The shared write guard. Bounds every unbounded field before it reaches
 * storage, so one pathological model response cannot blow up a row. Raw model
 * text is truncated rather than dropped, with rawTruncated recording that it
 * happened.
 */
export function normalizeTurnRecord(input: unknown): TurnRecord {
  if (!input || typeof input !== "object") throw new ValidationError("turn must be an object");
  const t = input as Partial<TurnRecord>;

  if (typeof t.id !== "string" || t.id.length === 0) throw new ValidationError("turn.id required");
  if (typeof t.sessionId !== "string") throw new ValidationError("turn.sessionId required");
  if (typeof t.u !== "string") throw new ValidationError("turn.u required");
  if (typeof t.createdAt !== "string") throw new ValidationError("turn.createdAt required");
  if (!t.vBefore || !t.vAfter) throw new ValidationError("turn.vBefore and vAfter required");

  const trimD = (d: TurnRecord["dBefore"]) => ({
    ...d,
    productIds: (d?.productIds ?? []).slice(0, MAX_PRODUCT_IDS),
  });

  const meta = t.meta
    ? {
        ...t.meta,
        attempts: (t.meta.attempts ?? []).map((a) => {
          if (a.rawText === null || a.rawText === undefined) return a;
          const truncated = a.rawText.length > MAX_RAW_CHARS;
          return {
            ...a,
            rawText: truncated ? a.rawText.slice(0, MAX_RAW_CHARS) : a.rawText,
            rawTruncated: a.rawTruncated || truncated,
          };
        }),
      }
    : null;

  return {
    schemaVersion: SCHEMA_VERSION,
    id: t.id,
    sessionId: t.sessionId,
    createdAt: t.createdAt,
    turnIndex: typeof t.turnIndex === "number" ? t.turnIndex : 0,
    kind: t.kind === "mr" ? "mr" : "chat",
    relation: t.relation ?? null,
    role: t.role ?? null,
    trial: typeof t.trial === "number" ? t.trial : null,
    u: cap(t.u, MAX_UTTERANCE_CHARS),
    q: t.q ?? null,
    vBefore: t.vBefore,
    vAfter: t.vAfter,
    dBefore: trimD(t.dBefore as TurnRecord["dBefore"]),
    dAfter: trimD(t.dAfter as TurnRecord["dAfter"]),
    fp: t.fp ?? [],
    writeSet: t.writeSet ?? null,
    applied: t.applied ?? [],
    rejected: t.rejected ?? [],
    flags: t.flags ?? {
      commandOverReach: false,
      overReachControls: [],
      contextIntact: true,
    },
    ok: t.ok !== false,
    error: t.error ?? null,
    meta,
  };
}

export function normalizeMrCaseRecord(input: unknown): MrCaseRecord {
  if (!input || typeof input !== "object") throw new ValidationError("case must be an object");
  const c = input as Partial<MrCaseRecord>;
  if (typeof c.id !== "string" || c.id.length === 0) throw new ValidationError("case.id required");
  if (typeof c.sessionId !== "string") throw new ValidationError("case.sessionId required");
  if (typeof c.relation !== "string") throw new ValidationError("case.relation required");
  if (typeof c.createdAt !== "string") throw new ValidationError("case.createdAt required");

  const n = typeof c.n === "number" ? c.n : 0;
  const fails = typeof c.fails === "number" ? c.fails : 0;

  return {
    schemaVersion: SCHEMA_VERSION,
    id: c.id,
    sessionId: c.sessionId,
    createdAt: c.createdAt,
    relation: c.relation,
    predicate: c.predicate ?? "",
    legacyName: c.legacyName ?? null,
    sourceTrace: c.sourceTrace ?? [],
    followupTrace: c.followupTrace ?? [],
    n,
    epsilon: typeof c.epsilon === "number" ? c.epsilon : 0,
    fails,
    failureRate: n > 0 ? fails / n : 0,
    verdict: c.verdict ?? "skipped",
    skipReason: c.skipReason ?? null,
    covNL: typeof c.covNL === "number" ? c.covNL : 0,
    covMR: typeof c.covMR === "number" ? c.covMR : 0,
    firstFailureMs: typeof c.firstFailureMs === "number" ? c.firstFailureMs : null,
    mediatorInvocations: typeof c.mediatorInvocations === "number" ? c.mediatorInvocations : 0,
    totalTokens: typeof c.totalTokens === "number" ? c.totalTokens : null,
    evidenceTurnIds: c.evidenceTurnIds ?? [],
  };
}
