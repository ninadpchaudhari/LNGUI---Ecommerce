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
 * Whether Q accepts `clearFilters` is a separate switch (CLEAR_ACTION_ENABLED).
 * It does not change the prompt text. A prompt that wants the model to clear
 * filters has to say so itself.
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
export function buildCommandSchema(clearEnabled: boolean) {
  const base = {
    filters: z.object({
      category: z.enum(CATEGORY_VALUES).nullable(),
      maxPrice: z.number().nullable(),
      minRating: z.number().nullable(),
      inStockOnly: z.boolean().nullable(),
    }),
    sort: z.enum(SORT_VALUES).nullable(),
    explanation: z.string(),
  };
  return clearEnabled
    ? z.object({ ...base, clearFilters: z.boolean().nullable().optional() })
    : z.object(base);
}

export function commandSchemaShape(clearEnabled: boolean): unknown {
  return { categories: CATEGORY_VALUES, sorts: SORT_VALUES, clearFilters: clearEnabled };
}

export function promptHashes(
  systemPrompt: string,
  clearEnabled: boolean,
): { systemPromptHash: string; commandSchemaHash: string } {
  return {
    systemPromptHash: hashString(systemPrompt),
    commandSchemaHash: hashString(JSON.stringify(commandSchemaShape(clearEnabled))),
  };
}
