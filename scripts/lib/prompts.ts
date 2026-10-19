/**
 * Loads the prompt files an experiment names, verifies each against its pinned
 * hash, and turns experiment conditions into engine conditions that carry the
 * prompt text.
 */
import { readFile } from "node:fs/promises";
import type { ExperimentCondition } from "../../shared/experiment.ts";
import { normalizePrompt, promptHash, promptSha256 } from "../../shared/prompt-text.ts";
import type { Condition } from "../../src/utils/sweep.ts";

export interface LoadedPrompt {
  file: string;
  text: string;
  sha256: string;
  /** The hash recorded in P as systemPromptHash. */
  hash: string;
}

export interface LoadedConditions {
  conditions: Condition[];
  /** Every prompt used, by file, for the run manifest. */
  prompts: LoadedPrompt[];
}

export async function loadConditions(experimentConditions: readonly ExperimentCondition[]): Promise<LoadedConditions> {
  const byFile = new Map<string, LoadedPrompt>();
  const conditions: Condition[] = [];
  for (const c of experimentConditions) {
    let p = byFile.get(c.prompt.file);
    if (!p) {
      let raw: string;
      try {
        raw = await readFile(c.prompt.file, "utf8");
      } catch {
        throw new Error(`condition ${c.id}: cannot read ${c.prompt.file}`);
      }
      const text = normalizePrompt(raw);
      p = { file: c.prompt.file, text, sha256: await promptSha256(text), hash: promptHash(text) };
      byFile.set(c.prompt.file, p);
    }
    if (p.sha256 !== c.prompt.sha256) {
      throw new Error(
        `condition ${c.id}: ${c.prompt.file} is not the prompt this experiment was designed for ` +
          `(expected ${c.prompt.sha256.slice(0, 12)}…, found ${p.sha256.slice(0, 12)}…)`,
      );
    }
    conditions.push({ id: c.id, env: { ...c.env, SYSTEM_PROMPT: p.text } });
  }
  return { conditions, prompts: [...byFile.values()] };
}
