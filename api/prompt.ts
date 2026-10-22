/**
 * Q — the command language the mediator must emit — and the hashes that
 * identify P's prompt and schema.
 *
 * The system prompt is an input to the experiment, so it is plain text and
 * never a named variant. The server default is prompts/default.txt, compiled
 * into shared/default-prompt.generated.ts. A request can carry its own text
 * (shared/overrides.ts, key SYSTEM_PROMPT). In both cases systemPromptHash is
 * the hash of the exact text sent, which is what tells two prompts apart in
 * every record. §2.3.2 is the reason: "Each model swap, prompt revision, or
 * schema change silently alters that mapping without producing a code diff
 * that anyone can review."
 *
 * `clearFilters` is always part of Q: it is one of the application's finite
 * commands, so the mediator can always reach it.
 */
import { z } from "zod/v4";
import { hashString } from "../shared/contract.ts";
import { CATEGORY_VALUES, SORT_VALUES } from "../shared/surface.generated.ts";

/**
 * Numeric fields are deliberately permissive: an out-of-domain value such as
 * minRating 4.2 must be *representable* in q so that Apply can reject it and
 * the trace can attribute the fault to the mediator. Rejecting it here would
 * instead trigger the repair loop and hide the mediator's actual output.
 */
export function buildCommandSchema(mode: "diff" | "full" = "diff") {
  const fields = z.object({
    category: z.enum(CATEGORY_VALUES).nullable(),
    maxPrice: z.number().nullable(),
    minRating: z.number().nullable(),
    inStockOnly: z.boolean().nullable(),
  }).strict();
  const base = {
    filters: mode === "full" ? fields : fields.partial(),
    sort: mode === "full" ? z.enum(SORT_VALUES).nullable() : z.enum(SORT_VALUES).nullable().optional(),
    explanation: z.string(),
  };
  // null means "do not clear", as earlier prompts (prompts/default-clear.txt) ask for.
  return z.object({ ...base, clearFilters: z.boolean().nullable().optional() }).strict();
}

// `clearFilters: true` stays in the shape so the hash matches earlier runs that had it on.
export function commandSchemaShape(mode: "diff" | "full" = "diff"): unknown {
  return { semantics: mode === "full" ? "full-state-v1" : "partial-update-v1", omitted: mode === "full" ? "invalid" : "preserve", null: "reset-to-default", categories: CATEGORY_VALUES, sorts: SORT_VALUES, clearFilters: true };
}

export function promptHashes(
  systemPrompt: string,
  mode: "diff" | "full" = "diff",
): { systemPromptHash: string; commandSchemaHash: string } {
  return {
    systemPromptHash: hashString(systemPrompt),
    commandSchemaHash: hashString(JSON.stringify(commandSchemaShape(mode))),
  };
}
