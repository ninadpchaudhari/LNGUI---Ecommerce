/**
 * The default system prompt, prompts/default.txt, is pinned character for
 * character. It is the app's first-commit prompt with exactly one line
 * removed, and this file says so, which keeps its provenance explicit. There
 * are no named variants: any other prompt is a separate text file with its own
 * hash, and an experiment pins each one by SHA-256.
 *
 * If the pin fails, the default prompt changed. Re-measure before accepting it.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { DEFAULT_SYSTEM_PROMPT } from "../shared/default-prompt.ts";
import { normalizePrompt, promptHash, promptSha256 } from "../shared/prompt-text.ts";
import { CATEGORY_VALUES, SORT_VALUES } from "../shared/surface.generated.ts";
import { resolveSystemPrompt } from "./config.ts";
import { buildCommandSchema, commandSchemaShape, promptHashes } from "./prompt.ts";

/** Verbatim from the app's first commit (21 Feb 2026). Do not reformat. */
const FIRST_COMMIT_PROMPT = `You are a product filter assistant. Given a user's natural language request, output ONLY a JSON object matching this schema:

{
  "filters": {
    "category": <one of ["electronics","books","clothing","home","sports"] or null>,
    "maxPrice": <number or null>,
    "minRating": <number or null>,
    "inStockOnly": <boolean or null>
  },
  "sort": <one of ["price_asc","price_desc","rating_desc","name_asc"] or null>,
  "explanation": "<short summary of what you set>"
}

Rules:
- If the user does NOT mention a field, return null for it. Do NOT invent constraints.
- category must be exactly one of the known values or null.
- sort must be exactly one of the known values or null.
- "under $X" or "less than $X" means maxPrice = X.
- "highly rated" / "top rated" means minRating >= 4.0 and/or sort "rating_desc".
- "in stock" / "available" means inStockOnly = true.
- Output ONLY the JSON object. No markdown fences, no extra text.`;

/** The one line the default prompt does not have. It looked like a patch added after a failure. */
const REMOVED_LINE = "- If the user does NOT mention a field, return null for it. Do NOT invent constraints.\n";
const DEFAULT = FIRST_COMMIT_PROMPT.replace(REMOVED_LINE, "");

describe("the default prompt is pinned", () => {
  test("it is the first-commit prompt minus exactly one line", () => {
    assert.ok(FIRST_COMMIT_PROMPT.includes(REMOVED_LINE));
    assert.equal(DEFAULT_SYSTEM_PROMPT, DEFAULT);
    assert.equal(FIRST_COMMIT_PROMPT.length - DEFAULT.length, REMOVED_LINE.length);
  });

  test("prompts/default.txt matches character for character", () => {
    assert.equal(normalizePrompt(readFileSync("prompts/default.txt", "utf8")), DEFAULT);
  });

  test("shared/default-prompt.ts holds the same text as the file", () => {
    assert.equal(DEFAULT_SYSTEM_PROMPT, normalizePrompt(readFileSync("prompts/default.txt", "utf8")));
  });

  test("its hash is pinned", () => {
    assert.equal(promptHash(DEFAULT), "fnv1a32:a48649b3");
  });

  test("it lists exactly the categories and sorts of the control surface", () => {
    assert.ok(DEFAULT.includes(JSON.stringify(CATEGORY_VALUES)));
    assert.ok(DEFAULT.includes(JSON.stringify(SORT_VALUES)));
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

describe("the command language is independent of the prompt text", () => {
  test("clearFilters is in the schema only when switched on", () => {
    assert.ok(!("clearFilters" in buildCommandSchema(false).shape));
    assert.ok("clearFilters" in buildCommandSchema(true).shape);
    assert.deepEqual((commandSchemaShape(true) as { clearFilters: boolean }).clearFilters, true);
  });

  test("the schema hash follows the switch and the prompt hash does not", () => {
    const off = promptHashes(DEFAULT, false);
    const on = promptHashes(DEFAULT, true);
    assert.equal(off.systemPromptHash, on.systemPromptHash);
    assert.notEqual(off.commandSchemaHash, on.commandSchemaHash);
  });
});
