/**
 * D1-backed TurnStore for the Worker.
 *
 * Scalar columns are denormalized out of meta and σ so the research queries in
 * the README are plain SQL; the JSON blobs carry full fidelity for replay.
 */
import type { MrCaseRecord, TurnRecord } from "../shared/contract.ts";
import type { D1Like } from "./cf.ts";
import {
  decodeCursor,
  encodeCursor,
  type Page,
  type TurnListQuery,
  type TurnStore,
} from "./store.ts";

const TURN_COLUMNS = [
  "id", "session_id", "created_at", "created_ms", "turn_index", "kind", "relation", "role",
  "trial", "utterance", "ok",
  "mode", "provider", "base_url", "requested_model", "resolved_model", "provider_name",
  "temperature", "top_p", "system_prompt_hash", "command_schema_hash",
  "history_policy", "history_max_turns", "clear_action_enabled",
  "attempts_count", "repaired", "total_latency_ms",
  "prompt_tokens", "completion_tokens", "total_tokens", "cost_usd", "error_code", "error",
  "count_before", "count_after", "count_delta", "fp", "write_set", "controls_changed",
  "over_reach", "over_reach_controls", "context_intact", "history_effective", "history_displayed",
  "q_json", "v_before_json", "v_after_json", "d_before_json", "d_after_json", "meta_json",
] as const;

const bit = (b: boolean | null | undefined): number | null =>
  b === null || b === undefined ? null : b ? 1 : 0;

function turnValues(t: TurnRecord): unknown[] {
  const m = t.meta;
  const attempt = m?.attempts?.[m.attempts.length - 1] ?? null;
  const u = m?.usageTotal ?? null;
  return [
    t.id, t.sessionId, t.createdAt, Date.parse(t.createdAt) || 0, t.turnIndex, t.kind,
    t.relation, t.role, t.trial, t.u, bit(t.ok),
    m?.mode ?? null, m?.provider ?? null, m?.baseURL ?? null,
    m?.P.requestedModel ?? null, m?.P.resolvedModel ?? null, attempt?.providerName ?? null,
    m?.P.temperature ?? null, m?.P.topP ?? null,
    m?.P.systemPromptHash ?? null, m?.P.commandSchemaHash ?? null,
    m?.P.historyPolicy ?? null, m?.P.historyMaxTurns ?? null, bit(m?.P.clearActionEnabled),
    m?.attempts?.length ?? null, bit(m?.repaired), m?.totalLatencyMs ?? null,
    u?.promptTokens ?? null, u?.completionTokens ?? null, u?.totalTokens ?? null,
    u?.costUsd ?? null, m?.error?.code ?? null, t.error,
    t.dBefore?.count ?? null, t.dAfter?.count ?? null,
    (t.dAfter?.count ?? 0) - (t.dBefore?.count ?? 0),
    t.fp.join(","), t.writeSet === null ? null : t.writeSet.join(","), t.fp.length,
    bit(t.flags.commandOverReach), t.flags.overReachControls.join(","),
    bit(t.flags.contextIntact),
    m?.historyTurnsEffective ?? null, m?.historyTurnsDisplayed ?? null,
    JSON.stringify(t.q), JSON.stringify(t.vBefore), JSON.stringify(t.vAfter),
    JSON.stringify(t.dBefore), JSON.stringify(t.dAfter), JSON.stringify(m),
  ];
}

/** Rehydrates from the JSON blobs, which are authoritative for replay. */
function rowToTurn(row: Record<string, unknown>): TurnRecord {
  const parse = <T,>(v: unknown, fallback: T): T => {
    if (typeof v !== "string") return fallback;
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  };
  const list = (v: unknown): string[] =>
    typeof v === "string" && v.length > 0 ? v.split(",") : [];

  return {
    schemaVersion: 1,
    id: String(row.id),
    sessionId: String(row.session_id),
    createdAt: String(row.created_at),
    turnIndex: Number(row.turn_index ?? 0),
    kind: row.kind === "mr" ? "mr" : "chat",
    relation: (row.relation as string | null) ?? null,
    role: (row.role as TurnRecord["role"]) ?? null,
    trial: row.trial === null || row.trial === undefined ? null : Number(row.trial),
    u: String(row.utterance),
    q: parse(row.q_json, null),
    vBefore: parse(row.v_before_json, {} as TurnRecord["vBefore"]),
    vAfter: parse(row.v_after_json, {} as TurnRecord["vAfter"]),
    dBefore: parse(row.d_before_json, { productIds: [], count: 0, total: 0 }),
    dAfter: parse(row.d_after_json, { productIds: [], count: 0, total: 0 }),
    fp: list(row.fp) as TurnRecord["fp"],
    writeSet: row.write_set === null ? null : (list(row.write_set) as TurnRecord["fp"]),
    applied: [],
    rejected: [],
    flags: {
      commandOverReach: row.over_reach === 1,
      overReachControls: list(row.over_reach_controls) as TurnRecord["fp"],
      contextIntact: row.context_intact !== 0,
    },
    ok: row.ok === 1,
    error: (row.error as string | null) ?? null,
    meta: parse(row.meta_json, null),
  };
}

const CASE_COLUMNS = [
  "id", "session_id", "created_at", "created_ms", "relation", "predicate", "legacy_name",
  "source_trace", "followup_trace", "n", "epsilon", "fails", "failure_rate", "verdict",
  "skip_reason", "cov_nl", "cov_mr", "first_failure_ms", "mediator_invocations",
  "total_tokens", "evidence_turn_ids",
] as const;

function caseValues(c: MrCaseRecord): unknown[] {
  return [
    c.id, c.sessionId, c.createdAt, Date.parse(c.createdAt) || 0, c.relation, c.predicate,
    c.legacyName, JSON.stringify(c.sourceTrace), JSON.stringify(c.followupTrace),
    c.n, c.epsilon, c.fails, c.failureRate, c.verdict, c.skipReason,
    c.covNL, c.covMR, c.firstFailureMs, c.mediatorInvocations, c.totalTokens,
    JSON.stringify(c.evidenceTurnIds),
  ];
}

function rowToCase(row: Record<string, unknown>): MrCaseRecord {
  const arr = (v: unknown): string[] => {
    if (typeof v !== "string") return [];
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  };
  return {
    schemaVersion: 1,
    id: String(row.id),
    sessionId: String(row.session_id),
    createdAt: String(row.created_at),
    relation: row.relation as MrCaseRecord["relation"],
    predicate: String(row.predicate ?? ""),
    legacyName: (row.legacy_name as string | null) ?? null,
    sourceTrace: arr(row.source_trace),
    followupTrace: arr(row.followup_trace),
    n: Number(row.n ?? 0),
    epsilon: Number(row.epsilon ?? 0),
    fails: Number(row.fails ?? 0),
    failureRate: Number(row.failure_rate ?? 0),
    verdict: row.verdict as MrCaseRecord["verdict"],
    skipReason: (row.skip_reason as string | null) ?? null,
    covNL: Number(row.cov_nl ?? 0),
    covMR: Number(row.cov_mr ?? 0),
    firstFailureMs:
      row.first_failure_ms === null || row.first_failure_ms === undefined
        ? null
        : Number(row.first_failure_ms),
    mediatorInvocations: Number(row.mediator_invocations ?? 0),
    totalTokens:
      row.total_tokens === null || row.total_tokens === undefined
        ? null
        : Number(row.total_tokens),
    evidenceTurnIds: arr(row.evidence_turn_ids),
  };
}

const placeholders = (n: number) => new Array(n).fill("?").join(", ");

export function createD1TurnStore(db: D1Like): TurnStore {
  /**
   * Keyset pagination. The cursor predicate is expressed with explicit NULL
   * guards so one prepared statement serves both the first page and the rest.
   */
  const pageQuery = async <T,>(
    table: string,
    columns: readonly string[],
    query: TurnListQuery,
    extraFilters: Array<[string, unknown]>,
    map: (row: Record<string, unknown>) => T,
  ): Promise<Page<T>> => {
    const after = query.cursor ? decodeCursor(query.cursor) : null;
    const where: string[] = [];
    const binds: unknown[] = [];

    for (const [sql, value] of extraFilters) {
      if (value !== undefined && value !== null) {
        where.push(sql);
        binds.push(value);
      }
    }
    if (after) {
      where.push("(created_ms < ? OR (created_ms = ? AND id < ?))");
      binds.push(after.createdMs, after.createdMs, after.id);
    }

    const sql =
      `SELECT ${columns.join(", ")} FROM ${table}` +
      (where.length ? ` WHERE ${where.join(" AND ")}` : "") +
      ` ORDER BY created_ms DESC, id DESC LIMIT ?`;
    binds.push(query.limit);

    const { results } = await db
      .prepare(sql)
      .bind(...binds)
      .all<Record<string, unknown>>();

    const items = results.map(map);
    const lastRow = results[results.length - 1];
    return {
      items,
      nextCursor:
        results.length === query.limit && lastRow
          ? encodeCursor(Number(lastRow.created_ms), String(lastRow.id))
          : null,
    };
  };

  return {
    kind: "d1",

    async putTurn(record) {
      await db
        .prepare(
          `INSERT OR REPLACE INTO turns (${TURN_COLUMNS.join(", ")}) ` +
            `VALUES (${placeholders(TURN_COLUMNS.length)})`,
        )
        .bind(...turnValues(record))
        .run();
    },

    listTurns(query) {
      return pageQuery("turns", TURN_COLUMNS, query, [
        ["session_id = ?", query.sessionId],
        ["kind = ?", query.kind],
      ], rowToTurn);
    },

    async getTurn(id) {
      const row = await db
        .prepare(`SELECT ${TURN_COLUMNS.join(", ")} FROM turns WHERE id = ?`)
        .bind(id)
        .first<Record<string, unknown>>();
      return row ? rowToTurn(row) : null;
    },

    async putMrCase(record) {
      await db
        .prepare(
          `INSERT OR REPLACE INTO mr_cases (${CASE_COLUMNS.join(", ")}) ` +
            `VALUES (${placeholders(CASE_COLUMNS.length)})`,
        )
        .bind(...caseValues(record))
        .run();
    },

    listMrCases(query) {
      return pageQuery("mr_cases", CASE_COLUMNS, query, [
        ["session_id = ?", query.sessionId],
      ], rowToCase);
    },

    async clear(sessionId) {
      if (sessionId === undefined) {
        await db.batch([db.prepare("DELETE FROM turns"), db.prepare("DELETE FROM mr_cases")]);
        return;
      }
      await db.batch([
        db.prepare("DELETE FROM turns WHERE session_id = ?").bind(sessionId),
        db.prepare("DELETE FROM mr_cases WHERE session_id = ?").bind(sessionId),
      ]);
    },
  };
}
