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

describe("experiment schema: the prompt is part of every condition", () => {
  test("a condition without a prompt is refused", () => {
    assert.equal(experimentSchema.safeParse(base([{ id: "c", env: {} }])).success, false);
  });

  test("a prompt file must be in prompts/ and end in .txt", () => {
    for (const file of ["default.txt", "prompts/x.md", "../prompts/x.txt"]) {
      assert.equal(experimentSchema.safeParse(base([{ id: "c", prompt: { file, sha256: SHA }, env: {} }])).success, false, file);
    }
    assert.ok(experimentSchema.safeParse(base([{ id: "c", prompt: { file: "prompts/x.txt", sha256: SHA }, env: {} }])).success);
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
      const parsed = experimentSchema.parse(base([{ id: "c", prompt: { file: "prompts/a.txt", sha256 }, env: { HISTORY_POLICY: "full" } }]));
      const { conditions, prompts } = await loadConditions(parsed.conditions);
      assert.equal(conditions[0].env.SYSTEM_PROMPT, "Line one\nLine two");
      assert.equal(conditions[0].env.HISTORY_POLICY, "full");
      assert.equal(prompts.length, 1);
    });
  });

  test("refuses a file whose text changed since the experiment was designed", async () => {
    await inTempDir(async () => {
      await writeFile("prompts/a.txt", "edited after the experiment was written");
      const parsed = experimentSchema.parse(base([{ id: "c", prompt: { file: "prompts/a.txt", sha256: SHA }, env: {} }]));
      await assert.rejects(loadConditions(parsed.conditions), /not the prompt this experiment was designed for/);
    });
  });

  test("reports a missing file by condition", async () => {
    await inTempDir(async () => {
      const parsed = experimentSchema.parse(base([{ id: "c1", prompt: { file: "prompts/none.txt", sha256: SHA }, env: {} }]));
      await assert.rejects(loadConditions(parsed.conditions), /condition c1: cannot read prompts\/none.txt/);
    });
  });
});
