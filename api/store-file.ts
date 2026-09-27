/**
 * File-backed TurnStore for the Express dev server, which has no D1 binding.
 *
 * Append-only JSONL plus an in-process cache. Zero dependencies, and
 * `node:fs/promises` is imported lazily *inside* the factory so the identifier
 * never enters the Worker's import graph.
 */
import type { MrCaseRecord, TurnRecord } from "../shared/contract.ts";
import {
  clampLimit,
  decodeCursor,
  encodeCursor,
  type Page,
  type TurnListQuery,
  type TurnStore,
} from "./store.ts";

interface Row<T> {
  createdMs: number;
  id: string;
  record: T;
}

function ms(createdAt: string): number {
  const t = Date.parse(createdAt);
  return Number.isFinite(t) ? t : 0;
}

/** (created_ms DESC, id DESC) — the same order the D1 index provides. */
function byRecency<T>(a: Row<T>, b: Row<T>): number {
  if (a.createdMs !== b.createdMs) return b.createdMs - a.createdMs;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

function paginate<T>(rows: Row<T>[], query: TurnListQuery): Page<T> {
  let eligible = rows;
  if (query.cursor) {
    const after = decodeCursor(query.cursor);
    if (after) {
      eligible = eligible.filter(
        (r) =>
          r.createdMs < after.createdMs ||
          (r.createdMs === after.createdMs && r.id < after.id),
      );
    }
  }
  const page = eligible.slice(0, query.limit);
  const last = page[page.length - 1];
  return {
    items: page.map((r) => r.record),
    nextCursor:
      page.length === query.limit && last ? encodeCursor(last.createdMs, last.id) : null,
  };
}

export async function createFileTurnStore(filePath: string): Promise<TurnStore> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");

  const turns: Row<TurnRecord>[] = [];
  const cases: Row<MrCaseRecord>[] = [];
  let loaded = false;
  let degraded = false;

  const casesPath = filePath.replace(/\.jsonl$/, "") + ".cases.jsonl";

  const load = async () => {
    if (loaded) return;
    loaded = true;
    for (const [file, sink] of [
      [filePath, turns],
      [casesPath, cases],
    ] as const) {
      try {
        const text = await fs.readFile(file, "utf8");
        for (const line of text.split("\n")) {
          if (line.trim().length === 0) continue;
          try {
            const record = JSON.parse(line) as { id: string; createdAt: string };
            (sink as Row<unknown>[]).push({
              createdMs: ms(record.createdAt),
              id: record.id,
              record,
            });
          } catch {
            // Skip a torn line rather than failing the whole read.
          }
        }
      } catch {
        // Missing file on first run is normal.
      }
    }
    turns.sort(byRecency);
    cases.sort(byRecency);
  };

  const append = async (file: string, record: unknown) => {
    if (degraded) return;
    try {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.appendFile(file, JSON.stringify(record) + "\n", "utf8");
    } catch (e) {
      // Degrade to in-memory rather than failing the request: losing the replay
      // log is bad, but dropping the user's turn is worse.
      degraded = true;
      console.warn(
        `[store-file] cannot write ${file}; continuing in memory only:`,
        e instanceof Error ? e.message : e,
      );
    }
  };

  return {
    kind: "file",

    async putTurn(record) {
      await load();
      turns.push({ createdMs: ms(record.createdAt), id: record.id, record });
      turns.sort(byRecency);
      await append(filePath, record);
    },

    async listTurns(query) {
      await load();
      let rows = turns;
      if (query.sessionId) rows = rows.filter((r) => r.record.sessionId === query.sessionId);
      if (query.kind) rows = rows.filter((r) => r.record.kind === query.kind);
      return paginate(rows, { ...query, limit: clampLimit(String(query.limit)) });
    },

    async getTurn(id) {
      await load();
      return turns.find((r) => r.id === id)?.record ?? null;
    },

    async putMrCase(record) {
      await load();
      cases.push({ createdMs: ms(record.createdAt), id: record.id, record });
      cases.sort(byRecency);
      await append(casesPath, record);
    },

    async listMrCases(query) {
      await load();
      let rows = cases;
      if (query.sessionId) rows = rows.filter((r) => r.record.sessionId === query.sessionId);
      return paginate(rows, { ...query, limit: clampLimit(String(query.limit)) });
    },

    async clear(sessionId) {
      await load();
      const keepTurn = (r: Row<TurnRecord>) =>
        sessionId !== undefined && r.record.sessionId !== sessionId;
      const keepCase = (r: Row<MrCaseRecord>) =>
        sessionId !== undefined && r.record.sessionId !== sessionId;

      const remainingTurns = turns.filter(keepTurn);
      const remainingCases = cases.filter(keepCase);
      turns.length = 0;
      turns.push(...remainingTurns);
      cases.length = 0;
      cases.push(...remainingCases);

      if (degraded) return;
      try {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(
          filePath,
          turns.map((r) => JSON.stringify(r.record)).join("\n") + (turns.length ? "\n" : ""),
          "utf8",
        );
        await fs.writeFile(
          casesPath,
          cases.map((r) => JSON.stringify(r.record)).join("\n") + (cases.length ? "\n" : ""),
          "utf8",
        );
      } catch {
        degraded = true;
      }
    },
  };
}
