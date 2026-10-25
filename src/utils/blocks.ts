/**
 * The Experiments page's configuration blocks: one block is one condition of
 * the experiment file. Kept out of the component, with no Vite-only imports,
 * so scripts/lib/ui-cli.test.ts can check that a file gives the page and the
 * CLI the same conditions.
 */
import type { ExperimentCondition } from "../../shared/experiment.ts";
import { effectiveEnv } from "../../shared/experiment.ts";
import { MODELS, fixedSampling } from "../../shared/models.ts";
import type { Overrides } from "../../shared/overrides.ts";
import { normalizePrompt, type PromptEntry } from "../../shared/prompt-text.ts";
import type { Condition } from "./sweep.ts";

export const slug = (s: string) => s.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "");
export const shortModel = (m: string) => slug(m.split("/").pop()!.replace(/:/g, "-"));

/** A model choice: which provider serves it, and the provider's model id. */
export interface ModelChoice {
  provider: "openrouter" | "ollama";
  model: string;
}
export const keyOf = (m: ModelChoice) => `${m.provider}:${m.model}`;

/** A condition as the page holds it: settings plus the prompt it runs under. */
export interface PageCondition {
  id: string;
  env: Overrides;
  prompt: { name: string; text: string };
}

/** What the sweep engine and the server see: the prompt text rides in the overrides. */
export const toEngine = (c: PageCondition): Condition => ({ id: c.id, env: { ...c.env, SYSTEM_PROMPT: c.prompt.text } });

/** The model select's value for the local parser; model values are `${provider}:${model}`. */
export const LOCAL = "local";

/** One configuration as the page shows it: exactly one condition of the experiment file. */
export interface Block {
  /** React key; stable while the block is edited. */
  key: number;
  /** Empty: use autoId(block). */
  id: string;
  /** LOCAL or `${provider}:${model}`. */
  model: string;
  prompt: string;
  /** Empty: not sent. */
  temperature: string;
  topP: string;
  history: "full" | "last-k" | "none";
  maxTurns: string;
}

/** The condition keys a block sets; anything else in a loaded file is dropped. */
export const BLOCK_KEYS = new Set(["LLM_PROVIDER", "LLM_MODEL", "LLM_TEMPERATURE", "LLM_TOP_P", "HISTORY_POLICY", "HISTORY_MAX_TURNS", "LOCAL_TEST_MODE", "LNGUI_COMMAND_MODE"]);

export const splitModel = (value: string) => {
  const i = value.indexOf(":");
  return { provider: value.slice(0, i), model: value.slice(i + 1) };
};

/** Whether the block's model takes temperature and top_p. */
export const takesSampling = (model: string) => model !== LOCAL && !fixedSampling(splitModel(model).provider, splitModel(model).model);

let nextBlockKey = 1;
/** A block for a model, with that model's recommended sampling. */
export function newBlock(model: string, prompt: string): Block {
  const entry = MODELS.find((m) => keyOf(m) === model);
  return {
    key: nextBlockKey++, id: "", model, prompt,
    temperature: entry?.sampling?.temperature ?? "", topP: entry?.sampling?.topP ?? "",
    history: "full", maxTurns: "3",
  };
}

/** A copy for Duplicate: same settings, its own key, id back to automatic. */
export const copyBlock = (b: Block): Block => ({ ...b, key: nextBlockKey++, id: "" });

/** The id a block gets until one is typed: what it runs, in a few words. */
export function autoId(b: Block): string {
  const parts = [b.model === LOCAL ? "local" : shortModel(splitModel(b.model).model), b.prompt];
  if (takesSampling(b.model)) {
    if (b.temperature.trim()) parts.push(`t${b.temperature.trim()}`);
    if (b.topP.trim()) parts.push(`p${b.topP.trim()}`);
  }
  if (b.history === "last-k") parts.push(`last${b.maxTurns}`);
  if (b.history === "none") parts.push("nohistory");
  return slug(parts.join("-"));
}

/** The condition a block runs. Sampling is sent only to a model that takes it. Null: its prompt is gone. */
export function blockCondition(b: Block, prompt: PromptEntry | null): PageCondition | null {
  if (!prompt) return null;
  const env: Overrides = {};
  if (b.model === LOCAL) env.LOCAL_TEST_MODE = "true";
  else {
    const { provider, model } = splitModel(b.model);
    env.LLM_PROVIDER = provider;
    env.LLM_MODEL = model;
    if (takesSampling(b.model) && b.temperature.trim()) env.LLM_TEMPERATURE = b.temperature.trim();
    if (takesSampling(b.model) && b.topP.trim()) env.LLM_TOP_P = b.topP.trim();
  }
  env.HISTORY_POLICY = b.history;
  if (b.history === "last-k") env.HISTORY_MAX_TURNS = b.maxTurns;
  env.LNGUI_COMMAND_MODE = prompt.implementation;
  // The CLI sends a file's condition through the same function.
  return { id: b.id.trim() || autoId(b), env: effectiveEnv(env).env, prompt: { name: prompt.name, text: normalizePrompt(prompt.text) } };
}


/** One block per condition of a loaded file, ids as written, and what could not be kept. */
export function blocksFromConditions(conditions: readonly ExperimentCondition[], prompts: readonly PromptEntry[]): { blocks: Block[]; notes: string[] } {
  const blocks: Block[] = [];
  const notes: string[] = [];
  for (const c of conditions) {
    const pname = c.prompt.file.replace(/^prompts\//, "").replace(/\.txt$/, "");
    if (!prompts.some((p) => p.name === pname)) {
      notes.push(`${c.id}: ${c.prompt.file} is not in prompts/, so this configuration is left out.`);
      continue;
    }
    const unused = Object.keys(c.env).filter((k) => !BLOCK_KEYS.has(k));
    if (unused.length) notes.push(`${c.id}: ${unused.join(", ")} cannot be set on this page and is dropped.`);
    blocks.push({
      ...newBlock(c.env.LOCAL_TEST_MODE === "true" ? LOCAL : `${c.env.LLM_PROVIDER ?? "openrouter"}:${c.env.LLM_MODEL ?? ""}`, pname),
      id: c.id,
      temperature: c.env.LLM_TEMPERATURE ?? "",
      topP: c.env.LLM_TOP_P ?? "",
      history: (c.env.HISTORY_POLICY as Block["history"]) ?? "full",
      maxTurns: c.env.HISTORY_MAX_TURNS ?? "3",
    });
  }
  return { blocks, notes };
}
