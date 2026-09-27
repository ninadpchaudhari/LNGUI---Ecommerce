/**
 * P — the system prompt and the command schema Q, plus their hashes.
 *
 * In their own module because both the command handler and GET /api/config
 * must report the *same* systemPromptHash; otherwise the client cannot tell
 * whether P drifted mid-session, which is the thing §5.7 needs held fixed.
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

/** The shape that `commandSchemaHash` digests. */
export function commandSchemaShape(clearEnabled: boolean): unknown {
  return {
    categories: CATEGORY_VALUES,
    sorts: SORT_VALUES,
    clearFilters: clearEnabled,
  };
}

export function buildSystemPrompt(clearEnabled: boolean): string {
  const clearField = clearEnabled
    ? `,\n  "clearFilters": <true only when the user asks to clear/reset all filters, else null>`
    : "";
  const clearRule = clearEnabled
    ? `\n- "clear filters" / "reset everything" means clearFilters = true. Only use it for an explicit request to clear.`
    : "";

  return `You are a product filter assistant. Given a user's natural language request, output ONLY a JSON object matching this schema:

{
  "filters": {
    "category": <one of ${JSON.stringify(CATEGORY_VALUES)} or null>,
    "maxPrice": <number or null>,
    "minRating": <number or null>,
    "inStockOnly": <boolean or null>
  },
  "sort": <one of ${JSON.stringify(SORT_VALUES)} or null>${clearField},
  "explanation": "<short summary of what you set>"
}

Rules:
- If the user does NOT mention a field, return null for it. Do NOT invent constraints.
- category must be exactly one of the known values or null.
- sort must be exactly one of the known values or null.
- "under $X" or "less than $X" means maxPrice = X.
- "highly rated" / "top rated" means minRating >= 4.0 and/or sort "rating_desc".
- "in stock" / "available" means inStockOnly = true.${clearRule}
- Earlier turns of the conversation are provided for context. Preserve constraints
  the user established earlier unless the current request changes them.
- Output ONLY the JSON object. No markdown fences, no extra text.`;
}

export function promptHashes(clearEnabled: boolean): {
  systemPromptHash: string;
  commandSchemaHash: string;
} {
  return {
    systemPromptHash: hashString(buildSystemPrompt(clearEnabled)),
    commandSchemaHash: hashString(JSON.stringify(commandSchemaShape(clearEnabled))),
  };
}
