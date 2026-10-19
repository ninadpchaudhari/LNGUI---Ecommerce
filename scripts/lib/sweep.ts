/**
 * Node-side pieces of a sweep: a sink that appends JSONL files, and reading
 * trial rows back for resume and reporting. The engine itself is
 * src/utils/sweep.ts, shared with the browser.
 */
import { appendFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { parseTrialsJsonl, type TrialRow } from "../../shared/trials.ts";
import type { TrialSink } from "../../src/utils/sweep.ts";

/** Reads trial rows; the last row for a key wins. */
export async function readTrials(path: string): Promise<TrialRow[]> {
  if (!existsSync(path)) return [];
  return parseTrialsJsonl(await readFile(path, "utf8"));
}

/** Appends lines in call order, one write at a time. */
class JsonlWriter {
  private chain: Promise<void> = Promise.resolve();
  private readonly path: string;
  constructor(path: string) {
    this.path = path;
  }
  write(rows: readonly unknown[]): Promise<void> {
    if (rows.length === 0) return this.chain;
    const text = rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
    this.chain = this.chain.then(() => appendFile(this.path, text));
    return this.chain;
  }
  flush(): Promise<void> {
    return this.chain;
  }
}

/** trials.jsonl and turns.jsonl, appended as the engine reports them. */
export function fileSink(trialsPath: string, turnsPath: string): TrialSink {
  const trials = new JsonlWriter(trialsPath);
  const turns = new JsonlWriter(turnsPath);
  return {
    turns: (records) => turns.write(records),
    trial: (row) => trials.write([row]),
    flush: async () => {
      await trials.flush();
      await turns.flush();
    },
  };
}
