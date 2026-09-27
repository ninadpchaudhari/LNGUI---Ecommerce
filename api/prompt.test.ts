/**
 * Guards P against silent revision.
 *
 * The baseline prompt is the one in force when Figure 1.2 was recorded. The
 * mapping is sensitive enough that adding a single rule line changes which
 * fault the benchmark exhibits — measured on gpt-4o-mini at temperature 0,
 * either the clearFilters field or the preserve-context rule is individually
 * enough to make the lowercase utterance set minRating=4, which destroys the
 * case-invariance violation.
 *
 * So the baseline text is pinned character for character against the prompt as
 * it stood in the pre-change commit. If this test fails, Figure 1.2 has to be
 * re-recorded or the change reverted; it must not be updated casually.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { buildSystemPrompt, effectiveClearAction, promptHashes } from "./prompt.ts";

/** Verbatim from master:api/command.ts. Do not reformat. */
const ORIGINAL = `You are a product filter assistant. Given a user's natural language request, output ONLY a JSON object matching this schema:

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

describe("the baseline prompt is pinned to the recorded original", () => {
  test("matches character for character, even with the clear action configured on", () => {
    assert.equal(buildSystemPrompt("baseline", true), ORIGINAL);
    assert.equal(buildSystemPrompt("baseline", false), ORIGINAL);
  });

  test("mentions neither clearFilters nor the preserve-context rule", () => {
    const p = buildSystemPrompt("baseline", true);
    assert.ok(!p.includes("clearFilters"), "the clear field alone changes the mapping");
    assert.ok(!p.includes("Preserve constraints"), "the preserve rule alone changes the mapping");
  });
});

describe("the extended prompt is a distinct, declared condition", () => {
  test("adds the preserve-context rule", () => {
    assert.ok(buildSystemPrompt("extended", false).includes("Preserve constraints"));
  });

  test("adds clearFilters only when the flag is also on", () => {
    assert.ok(buildSystemPrompt("extended", true).includes("clearFilters"));
    assert.ok(!buildSystemPrompt("extended", false).includes("clearFilters"));
  });

  test("differs from baseline, so systemPromptHash separates the conditions", () => {
    const a = promptHashes("baseline", true).systemPromptHash;
    const b = promptHashes("extended", true).systemPromptHash;
    assert.notEqual(a, b, "the two conditions must be distinguishable in every record");
  });

  test("the baseline hash does not depend on the clear-action flag", () => {
    assert.equal(
      promptHashes("baseline", true).systemPromptHash,
      promptHashes("baseline", false).systemPromptHash,
    );
  });
});

describe("effectiveClearAction", () => {
  test("c₆ is not expressible in Q under baseline", () => {
    assert.equal(effectiveClearAction("baseline", true), false);
    assert.equal(effectiveClearAction("baseline", false), false);
  });

  test("under extended it follows the flag", () => {
    assert.equal(effectiveClearAction("extended", true), true);
    assert.equal(effectiveClearAction("extended", false), false);
  });
});
