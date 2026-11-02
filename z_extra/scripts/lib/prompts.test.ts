import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { experimentSchema } from "../../shared/experiment.ts";
import { promptSha256 } from "../../shared/prompt-text.ts";
import { loadConditions } from "./prompts.ts";

const base = (conditions: unknown[]) => ({
  name: "t", cases: "cases/pilot.jsonl", n: 1, seed: 1, concurrency: 1, maxInfraRetries: 0, conditions,
});
const SHA = "a".repeat(64);
/** Every model condition states its sampling. */
const T = { LLM_TEMPERATURE: "0" };

describe("experiment schema: the prompt is part of every condition", () => {
  test("a condition without a prompt is refused", () => {
    assert.equal(experimentSchema.safeParse(base([{ id: "c", env: T }])).success, false);
  });

  test("a prompt file must be in prompts/ and end in .txt", () => {
    for (const file of ["default.txt", "prompts/x.md", "../prompts/x.txt"]) {
      assert.equal(experimentSchema.safeParse(base([{ id: "c", prompt: { file, sha256: SHA }, env: T }])).success, false, file);
    }
    assert.ok(experimentSchema.safeParse(base([{ id: "c", prompt: { file: "prompts/x.txt", sha256: SHA }, env: T }])).success);
  });

  test("a model condition must set temperature or top_p; the local parser need not", () => {
    const cond = (env: Record<string, string>) => base([{ id: "c", prompt: { file: "prompts/x.txt", sha256: SHA }, env }]);
    assert.equal(experimentSchema.safeParse(cond({ LLM_MODEL: "m" })).success, false);
    assert.equal(experimentSchema.safeParse(cond({ LLM_TEMPERATURE: " " })).success, false, "blank is unset");
    assert.ok(experimentSchema.safeParse(cond({ LLM_TEMPERATURE: "0.8" })).success);
    assert.ok(experimentSchema.safeParse(cond({ LLM_TOP_P: "1" })).success);
    assert.ok(experimentSchema.safeParse(cond({ LOCAL_TEST_MODE: "true" })).success);
  });

  test("a model that takes no sampling settings needs none, and may be given some", () => {
    const cond = (env: Record<string, string>) => base([{ id: "c", prompt: { file: "prompts/x.txt", sha256: SHA }, env }]);
    const nano = { LLM_PROVIDER: "openrouter", LLM_MODEL: "openai/gpt-5-nano", LLM_REASONING_EFFORT: "minimal" };
    assert.ok(experimentSchema.safeParse(cond(nano)).success);
    assert.ok(experimentSchema.safeParse(cond({ ...nano, LLM_TEMPERATURE: "0" })).success, "dropped on loading, not refused");
  });

  test("a reasoning model states an effort it takes; other models take none", () => {
    const cond = (env: Record<string, string>) => base([{ id: "c", prompt: { file: "prompts/x.txt", sha256: SHA }, env }]);
    const nano = { LLM_PROVIDER: "openrouter", LLM_MODEL: "openai/gpt-5-nano" };
    assert.equal(experimentSchema.safeParse(cond(nano)).success, false, "effort required");
    assert.equal(experimentSchema.safeParse(cond({ ...nano, LLM_REASONING_EFFORT: "none" })).success, false, "nano cannot turn reasoning off");
    assert.ok(experimentSchema.safeParse(cond({ ...nano, LLM_REASONING_EFFORT: "minimal" })).success);
    const mini = { LLM_PROVIDER: "openrouter", LLM_MODEL: "openai/gpt-4o-mini", ...T };
    assert.equal(experimentSchema.safeParse(cond({ ...mini, LLM_REASONING_EFFORT: "low" })).success, false, "no reasoning to set");
  });

  test("prompt text is never put in env", () => {
    const r = experimentSchema.safeParse(base([{ id: "c", prompt: { file: "prompts/x.txt", sha256: SHA }, env: { SYSTEM_PROMPT: "hi" } }]));
    assert.equal(r.success, false);
  });
});

describe("loadConditions", () => {
  async function inTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
    const dir = await mkdtemp(join(tmpdir(), "lngui-prompts-"));
    const cwd = process.cwd();
    try {
      await mkdir(join(dir, "prompts"));
      process.chdir(dir);
      return await fn(dir);
    } finally {
      process.chdir(cwd);
      await rm(dir, { recursive: true, force: true });
    }
  }

  test("sends the file's normalized text with the condition", async () => {
    await inTempDir(async () => {
      await writeFile("prompts/a.txt", "Line one\r\nLine two\n\n");
      const sha256 = await promptSha256("Line one\nLine two");
      const parsed = experimentSchema.parse(base([{ id: "c", prompt: { file: "prompts/a.txt", sha256 }, env: { ...T, HISTORY_POLICY: "full" } }]));
      const { conditions, prompts } = await loadConditions(parsed.conditions);
      assert.equal(conditions[0].env.SYSTEM_PROMPT, "Line one\nLine two");
      assert.equal(conditions[0].env.HISTORY_POLICY, "full");
      assert.equal(prompts.length, 1);
    });
  });

  test("drops sampling settings a model does not take; the schema refuses conditions that become the same run", async () => {
    await inTempDir(async () => {
      await writeFile("prompts/a.txt", "Hi");
      const sha256 = await promptSha256("Hi");
      const haiku = { LLM_PROVIDER: "openrouter", LLM_MODEL: "anthropic/claude-haiku-5.5", LLM_REASONING_EFFORT: "none", HISTORY_POLICY: "full" };
      const one = experimentSchema.parse(base([{ id: "h", prompt: { file: "prompts/a.txt", sha256 }, env: { ...haiku, LLM_TEMPERATURE: "0", LLM_TOP_P: "1" } }]));
      const loaded = await loadConditions(one.conditions);
      assert.equal(loaded.conditions[0].env.LLM_TEMPERATURE, undefined);
      assert.equal(loaded.conditions[0].env.LLM_TOP_P, undefined);
      assert.equal(loaded.warnings.length, 1);

      const two = experimentSchema.safeParse(base([
        { id: "h-t0", prompt: { file: "prompts/a.txt", sha256 }, env: { ...haiku, LLM_TEMPERATURE: "0" } },
        { id: "h-t1", prompt: { file: "prompts/a.txt", sha256 }, env: { ...haiku, LLM_TEMPERATURE: "1" } },
      ]));
      assert.equal(two.success, false);
      assert.match(two.error!.issues.map((i) => i.message).join(), /h-t0 and h-t1 are the same run/);
    });
  });

  test("refuses a file whose text changed since the experiment was designed", async () => {
    await inTempDir(async () => {
      await writeFile("prompts/a.txt", "edited after the experiment was written");
      const parsed = experimentSchema.parse(base([{ id: "c", prompt: { file: "prompts/a.txt", sha256: SHA }, env: T }]));
      await assert.rejects(loadConditions(parsed.conditions), /not the prompt this experiment was designed for/);
    });
  });

  test("the header sets the implementation and never reaches the model", async () => {
    await inTempDir(async () => {
      await writeFile("prompts/a.txt", "---\nimplementation: full\n---\nSend every field.\n");
      const sha256 = await promptSha256("Send every field.");
      const parsed = experimentSchema.parse(base([{ id: "c", prompt: { file: "prompts/a.txt", sha256 }, env: T }]));
      const { conditions, prompts } = await loadConditions(parsed.conditions);
      assert.equal(conditions[0].env.SYSTEM_PROMPT, "Send every field.");
      assert.equal(conditions[0].env.LNGUI_COMMAND_MODE, "full");
      assert.equal(prompts[0].implementation, "full");
    });
  });

  test("refuses a condition whose mode contradicts its prompt's header", async () => {
    await inTempDir(async () => {
      await writeFile("prompts/a.txt", "---\nimplementation: diff\n---\nSend only changes.");
      const sha256 = await promptSha256("Send only changes.");
      const parsed = experimentSchema.parse(base([{ id: "c", prompt: { file: "prompts/a.txt", sha256 }, env: { ...T, LNGUI_COMMAND_MODE: "full" } }]));
      await assert.rejects(loadConditions(parsed.conditions), /declares implementation diff/);
    });
  });

  test("reports a missing file by condition", async () => {
    await inTempDir(async () => {
      const parsed = experimentSchema.parse(base([{ id: "c1", prompt: { file: "prompts/none.txt", sha256: SHA }, env: T }]));
      await assert.rejects(loadConditions(parsed.conditions), /configuration c1: cannot read prompts\/none.txt/);
    });
  });
});
