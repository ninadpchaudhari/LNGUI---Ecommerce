/**
 * Loads the prompt files an experiment names, verifies each against its pinned
 * hash, and turns experiment conditions into engine conditions that carry the
 * prompt text and the implementation the prompt file declares.
 */
import { readFile } from "node:fs/promises";
import type { ExperimentCondition } from "../../shared/experiment.ts";
import type { CommandMode } from "../../shared/contract.ts";
import { parsePromptFile, promptHash, promptSha256 } from "../../shared/prompt-text.ts";
import type { Condition } from "../../src/utils/sweep.ts";
import { fixedSampling } from "../../shared/models.ts";

export interface LoadedPrompt {
  file: string;
  /** The text the model receives, without the file's header. */
  text: string;
  implementation: CommandMode | null;
  sha256: string;
  /** The hash recorded in P as systemPromptHash. */
  hash: string;
}

export interface LoadedConditions {
  conditions: Condition[];
  /** Every prompt used, by file, for the run manifest. */
  prompts: LoadedPrompt[];
  /** Settings dropped on loading, to print before the run. */
  warnings: string[];
}

export async function loadConditions(experimentConditions: readonly ExperimentCondition[]): Promise<LoadedConditions> {
  const byFile = new Map<string, LoadedPrompt>();
  const conditions: Condition[] = [];
  const warnings: string[] = [];
  for (const c of experimentConditions) {
    let p = byFile.get(c.prompt.file);
    if (!p) {
      let raw: string;
      try {
        raw = await readFile(c.prompt.file, "utf8");
      } catch {
        throw new Error(`condition ${c.id}: cannot read ${c.prompt.file}`);
      }
      let parsed;
      try {
        parsed = parsePromptFile(raw);
      } catch (e) {
        throw new Error(`condition ${c.id}: ${c.prompt.file}: ${(e as Error).message}`);
      }
      const { text, implementation } = parsed;
      p = { file: c.prompt.file, text, implementation, sha256: await promptSha256(text), hash: promptHash(text) };
      byFile.set(c.prompt.file, p);
    }
    if (p.sha256 !== c.prompt.sha256) {
      throw new Error(
        `condition ${c.id}: ${c.prompt.file} is not the prompt this experiment was designed for ` +
          `(expected ${c.prompt.sha256.slice(0, 12)}…, found ${p.sha256.slice(0, 12)}…)`,
      );
    }
    const declared = p.implementation;
    if (declared && c.env.LNGUI_COMMAND_MODE && c.env.LNGUI_COMMAND_MODE !== declared) {
      throw new Error(
        `condition ${c.id}: ${c.prompt.file} declares implementation ${declared}, ` +
          `but the condition sets LNGUI_COMMAND_MODE=${c.env.LNGUI_COMMAND_MODE}`,
      );
    }
    // A model that takes no temperature or top_p gets neither, so the record says "not sent".
    const env = { ...c.env };
    if (fixedSampling(env.LLM_PROVIDER, env.LLM_MODEL) && (env.LLM_TEMPERATURE || env.LLM_TOP_P)) {
      delete env.LLM_TEMPERATURE;
      delete env.LLM_TOP_P;
      warnings.push(`condition ${c.id}: ${env.LLM_MODEL} takes no temperature or top_p; ignoring them`);
    }
    conditions.push({
      id: c.id,
      env: { ...env, ...(declared ? { LNGUI_COMMAND_MODE: declared } : {}), SYSTEM_PROMPT: p.text },
    });
  }
  // Ignoring a setting can leave two conditions the same run; paying for both is a mistake.
  const seen = new Map<string, string>();
  for (const c of conditions) {
    const key = JSON.stringify(Object.entries(c.env).sort(([a], [b]) => a.localeCompare(b)));
    const twin = seen.get(key);
    if (twin) throw new Error(`conditions ${twin} and ${c.id} are the same run once ignored settings are dropped; keep one`);
    seen.set(key, c.id);
  }
  return { conditions, prompts: [...byFile.values()], warnings };
}
