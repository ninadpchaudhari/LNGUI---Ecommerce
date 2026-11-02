/**
 * The Experiments page and the CLI read one experiment file. This checks that
 * they also send the same conditions from it: the page through its
 * configuration blocks (src/utils/blocks.ts), the CLI through loadConditions.
 * The parity test in sweep.test.ts then checks that the same conditions give
 * the same trial outcomes over either transport.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

import { experimentSchema, type Experiment } from "../../shared/experiment.ts";
import { parsePromptFile, promptSha256, type PromptEntry } from "../../shared/prompt-text.ts";
import { blockCondition, blocksFromConditions, toEngine } from "../../src/utils/blocks.ts";
import { loadConditions } from "./prompts.ts";

/** prompts/*.txt as the page bundles them (src/utils/prompts.ts). */
const PROMPTS: PromptEntry[] = readdirSync("prompts").filter((f) => f.endsWith(".txt")).map((f) => {
  const { text, implementation } = parsePromptFile(readFileSync(`prompts/${f}`, "utf8"));
  return { name: f.replace(/\.txt$/, ""), text, implementation: implementation ?? "diff" };
});

async function both(e: Experiment) {
  const cli = (await loadConditions(e.conditions)).conditions.map(({ id, env }) => ({ id, env }));
  const { blocks, notes } = blocksFromConditions(e.conditions, PROMPTS);
  assert.deepEqual(notes, [], "the page keeps every condition of the file");
  const page = blocks.map((b) => toEngine(blockCondition(b, PROMPTS.find((p) => p.name === b.prompt)!)!));
  return { cli, page };
}

test("every committed experiment file gives the page and the CLI the same conditions", async () => {
  const files = readdirSync("experiments").filter((f) => f.endsWith(".json"));
  assert.ok(files.length > 0);
  for (const f of files) {
    const e = experimentSchema.parse(JSON.parse(readFileSync(`experiments/${f}`, "utf8")));
    const { cli, page } = await both(e);
    assert.deepEqual(page, cli, f);
  }
});

test("so do the awkward cases: local parser, sampling a model ignores, reasoning effort, last-k, top_p only, Ollama, no history policy", async () => {
  const ref = async (name: string) => ({
    file: `prompts/${name}.txt`,
    sha256: await promptSha256(PROMPTS.find((p) => p.name === name)!.text),
  });
  const e = experimentSchema.parse({
    name: "awkward", cases: "cases/pilot.jsonl", n: 1,
    conditions: [
      { id: "local", prompt: await ref("student-x"), env: { LOCAL_TEST_MODE: "true", HISTORY_POLICY: "full" } },
      { id: "haiku", prompt: await ref("default"), env: { LLM_PROVIDER: "openrouter", LLM_MODEL: "anthropic/claude-haiku-5.5", LLM_TEMPERATURE: "0.5", LLM_REASONING_EFFORT: "none", HISTORY_POLICY: "full" } },
      { id: "mini-last2", prompt: await ref("default"), env: { LLM_PROVIDER: "openrouter", LLM_MODEL: "openai/gpt-4o-mini", LLM_TOP_P: "0.9", HISTORY_POLICY: "last-k", HISTORY_MAX_TURNS: "2" } },
      { id: "qwen-nohistory-key", prompt: await ref("default"), env: { LLM_PROVIDER: "ollama", LLM_MODEL: "qwen3.5:4b", LLM_TEMPERATURE: "0.7", LLM_TOP_P: "0.8", LLM_REASONING_EFFORT: "none" } },
    ],
  });
  const { cli, page } = await both(e);
  assert.deepEqual(page, cli);
  // And what both send is what was meant:
  const haiku = cli.find((c) => c.id === "haiku")!.env;
  assert.equal(haiku.LLM_TEMPERATURE, undefined, "a model that takes no sampling gets none");
  assert.equal(cli.find((c) => c.id === "qwen-nohistory-key")!.env.HISTORY_POLICY, "full", "the history default is stated");
});
