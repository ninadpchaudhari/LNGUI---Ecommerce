/**
 * P — the system prompt and the command language Q, plus their hashes.
 *
 * In their own module because both the command handler and GET /api/config must
 * report the *same* systemPromptHash; otherwise the client cannot tell whether
 * P drifted mid-session, which is the thing §5.7 needs held fixed.
 *
 * ── Why there are two variants ───────────────────────────────────────────────
 *
 * The prompt cannot simultaneously avoid inventing constraints and preserve
 * constraints across turns. Measured on gpt-4o-mini at temperature 0, with
 * "show electronics under $100 sorted by rating":
 *
 *   baseline   lowercase -> minRating null, UPPERCASE -> minRating 4
 *              => Figure 1.2 reproduces: an MR_SE case-invariance violation
 *              but a two-turn refinement drops the earlier category
 *              => MR_AC constraint leakage, D widens 4 -> 13
 *
 *   extended   adds "preserve constraints the user established earlier"
 *              => the refinement works, D narrows 4 -> 2
 *              but minRating is now 4 in *both* cases
 *              => the case-invariance violation disappears
 *
 * Adding the clearFilters field alone has the same effect as the preserve rule:
 * either addition tips the mapping. So the variant is an explicit experimental
 * condition rather than a silent choice, and systemPromptHash distinguishes
 * them in every record. §2.3.2 is the reason this must be declared: "Each model
 * swap, prompt revision, or schema change silently alters that mapping without
 * producing a code diff that anyone can review."
 */
import { z } from "zod/v4";
import { hashString, type PromptVariant } from "../shared/contract.ts";
import { CATEGORY_VALUES, SORT_VALUES } from "../shared/surface.generated.ts";

/**
 * Whether c₆ is expressible in Q. Forced off under the baseline variant,
 * because the original prompt had no clear action and adding the field is by
 * itself enough to lose the Figure 1.2 violation.
 */
export function effectiveClearAction(variant: PromptVariant, configured: boolean): boolean {
  return variant === "extended" && configured;
}

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

/**
 * `baseline` is the prompt as it stood when Figure 1.2 was recorded, byte for
 * byte. Do not edit it without re-recording the figure — the mapping is
 * sensitive enough that adding a single rule line changes the fault.
 */
export function buildSystemPrompt(variant: PromptVariant, clearEnabled: boolean): string {
  const clear = effectiveClearAction(variant, clearEnabled);

  const clearField = clear
    ? `,\n  "clearFilters": <true only when the user asks to clear/reset all filters, else null>`
    : "";
  const clearRule = clear
    ? `\n- "clear filters" / "reset everything" means clearFilters = true. Only use it for an explicit request to clear.`
    : "";
  const preserveRule =
    variant === "extended"
      ? `\n- Earlier turns of the conversation are provided for context. Preserve constraints\n  the user established earlier unless the current request changes them.`
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
- "in stock" / "available" means inStockOnly = true.${clearRule}${preserveRule}
- Output ONLY the JSON object. No markdown fences, no extra text.`;
}

export function promptHashes(
  variant: PromptVariant,
  clearEnabled: boolean,
): { systemPromptHash: string; commandSchemaHash: string } {
  const clear = effectiveClearAction(variant, clearEnabled);
  return {
    systemPromptHash: hashString(buildSystemPrompt(variant, clearEnabled)),
    commandSchemaHash: hashString(JSON.stringify(commandSchemaShape(clear))),
  };
}
