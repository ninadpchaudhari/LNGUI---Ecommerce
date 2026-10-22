/** Tests for the versioned partial-update command interface and prompt. */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { DEFAULT_SYSTEM_PROMPT } from "../shared/default-prompt.ts";
import { normalizePrompt, promptHash, promptSha256 } from "../shared/prompt-text.ts";
import { CATEGORY_VALUES, SORT_VALUES } from "../shared/surface.generated.ts";
import { resolveSystemPrompt } from "./config.ts";
import { buildCommandSchema, commandSchemaShape, promptHashes } from "./prompt.ts";

const DEFAULT = DEFAULT_SYSTEM_PROMPT;

describe("partial-update prompt", () => {
  test("the server and experiment prompt agree", () => {
    assert.equal(DEFAULT, normalizePrompt(readFileSync("prompts/default.txt", "utf8")));
    assert.ok(DEFAULT.includes(JSON.stringify(CATEGORY_VALUES)));
    assert.ok(DEFAULT.includes(JSON.stringify(SORT_VALUES)));
  });
  test("schema preserves omitted fields and accepts explicit resets", () => {
    const schema = buildCommandSchema();
    assert.deepEqual(schema.parse({ filters: { maxPrice: 50 }, explanation: "price" }),
      { filters: { maxPrice: 50 }, explanation: "price" });
    assert.ok(schema.safeParse({ filters: { category: null }, clearFilters: true, explanation: "reset" }).success);
    assert.ok(!schema.safeParse({ filters: { unknown: 1 }, explanation: "bad" }).success);
  });
});

describe("prompt text", () => {
  test("normalization ignores CRLF and trailing newlines, so the hash does too", () => {
    assert.equal(normalizePrompt("a\r\nb\n\n"), "a\nb");
    assert.equal(promptHash("a\nb"), promptHash("a\r\nb\n"));
  });

  test("any edit changes the hash, and the sha256 follows the normalized text", async () => {
    assert.notEqual(promptHash(DEFAULT), promptHash(DEFAULT + " "), "a trailing space is a different prompt");
    assert.equal(await promptSha256("x\n"), await promptSha256("x"));
    assert.notEqual(await promptSha256("x"), await promptSha256("y"));
  });

  test("the server uses the default unless a text is given", () => {
    assert.equal(resolveSystemPrompt({}), DEFAULT);
    assert.equal(resolveSystemPrompt({ SYSTEM_PROMPT: "   " }), DEFAULT, "blank counts as unset");
    assert.equal(resolveSystemPrompt({ SYSTEM_PROMPT: "my prompt\n" }), "my prompt");
  });
});

describe("clearFilters is always part of the command language", () => {
  test("both modes accept it, and both prompts offer it", () => {
    for (const mode of ["diff", "full"] as const) assert.ok("clearFilters" in buildCommandSchema(mode).shape);
    assert.ok(DEFAULT.includes("clearFilters"));
    assert.ok(resolveSystemPrompt({ LNGUI_COMMAND_MODE: "full" }).includes("clearFilters"));
  });

  test("the schema fingerprint still records it as on, so hashes match earlier runs that had it on", () => {
    assert.equal((commandSchemaShape() as { clearFilters: boolean }).clearFilters, true);
  });
});

describe("paired update strategies", () => {
  test("full state requires every field; diff accepts a partial command", () => {
    const partial = { filters: { category: "books" }, explanation: "books" };
    assert.ok(buildCommandSchema("diff").safeParse(partial).success);
    assert.ok(!buildCommandSchema("full").safeParse(partial).success);
    assert.ok(buildCommandSchema("full").safeParse({
      filters: { category: "books", maxPrice: 500, minRating: null, inStockOnly: false },
      sort: null, explanation: "books",
    }).success);
  });
  test("mode selects the matching prompt and changes the schema fingerprint", () => {
    const full = resolveSystemPrompt({ LNGUI_COMMAND_MODE: "full" });
    assert.equal(full, normalizePrompt(readFileSync("prompts/full-state.txt", "utf8")));
    assert.notEqual(full, DEFAULT);
    assert.notEqual(promptHashes(DEFAULT, "diff").commandSchemaHash,
      promptHashes(DEFAULT, "full").commandSchemaHash);
    assert.equal(resolveSystemPrompt({ LNGUI_COMMAND_MODE: "full", SYSTEM_PROMPT: "custom" }), "custom");
  });
});
