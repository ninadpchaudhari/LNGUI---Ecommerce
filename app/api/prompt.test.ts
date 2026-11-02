/** Tests for the command interface and the committed prompts. */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { DEFAULT_IMPLEMENTATION, DEFAULT_SYSTEM_PROMPT } from "../shared/default-prompt.ts";
import { formatPromptFile, normalizePrompt, parsePromptFile, promptHash, promptSha256 } from "../shared/prompt-text.ts";
import { readdirSync } from "node:fs";
import { CATEGORY_VALUES, SORT_VALUES } from "../shared/surface.generated.ts";
import { resolveCommandMode, resolveSystemPrompt } from "./config.ts";
import { buildCommandSchema, commandSchemaShape, promptHashes } from "./prompt.ts";

const DEFAULT = DEFAULT_SYSTEM_PROMPT;

const parsed = (name: string) => parsePromptFile(readFileSync(`prompts/${name}.txt`, "utf8"));
const file = (name: string) => parsed(name).text;

describe("prompt files declare their implementation", () => {
  test("every committed prompt has a header, and the default's matches the server", () => {
    for (const f of readdirSync("prompts").filter((n) => n.endsWith(".txt"))) {
      assert.ok(parsed(f.replace(/\.txt$/, "")).implementation, `${f} declares no implementation`);
    }
    assert.equal(parsed("default").implementation, DEFAULT_IMPLEMENTATION);
    assert.equal(parsed("student-x").implementation, "full");
  });

  test("the header is not part of the text, so hashes cover only what the model receives", () => {
    const p = parsePromptFile("---\r\nimplementation: full\r\n---\r\nHello\r\n");
    assert.deepEqual(p, { implementation: "full", text: "Hello" });
    assert.deepEqual(parsePromptFile(formatPromptFile(p)), p);
    assert.deepEqual(parsePromptFile("No header\n"), { implementation: null, text: "No header" });
  });

  test("an unreadable header is an error, not silently prompt text", () => {
    assert.throws(() => parsePromptFile("---\nimplementation: partial\n---\nx"), /diff or full/);
    assert.throws(() => parsePromptFile("---\nmodel: x\n---\nx"), /unknown key/);
  });

  test("with no prompt or mode in the request, the server uses the default prompt's implementation", () => {
    assert.equal(resolveCommandMode({}), DEFAULT_IMPLEMENTATION);
    assert.equal(resolveCommandMode({ SYSTEM_PROMPT: "custom" }), "diff");
    assert.equal(resolveCommandMode({ LNGUI_COMMAND_MODE: "diff" }), "diff");
  });
});

describe("committed prompts", () => {
  test("the server default is prompts/default.txt and names every category and sort", () => {
    assert.equal(DEFAULT, file("default"));
    assert.ok(DEFAULT.includes(JSON.stringify(CATEGORY_VALUES)));
    assert.ok(DEFAULT.includes(JSON.stringify(SORT_VALUES)));
  });

  test("student-x is the original prompt, the one Figure 1.2 was recorded with", () => {
    assert.equal(promptHash(file("student-x")), "fnv1a32:5a348657");
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
  test("both modes accept it, as null too", () => {
    for (const mode of ["diff", "full"] as const) assert.ok("clearFilters" in buildCommandSchema(mode).shape);
    assert.ok(buildCommandSchema().safeParse({ filters: {}, clearFilters: null, explanation: "x" }).success);
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
  test("mode never picks the prompt, but does change the schema fingerprint", () => {
    assert.equal(resolveSystemPrompt({ LNGUI_COMMAND_MODE: "full" }), DEFAULT);
    assert.notEqual(promptHashes(DEFAULT, "diff").commandSchemaHash,
      promptHashes(DEFAULT, "full").commandSchemaHash);
    assert.equal(resolveSystemPrompt({ LNGUI_COMMAND_MODE: "full", SYSTEM_PROMPT: "custom" }), "custom");
  });
});
