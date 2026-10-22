/**
 * The server's default system prompt: the app's original prompt, the one
 * Figure 1.2 was recorded with (fnv1a32:5a348657). Kept identical to
 * prompts/default.txt (after its header); a test fails if the two differ.
 * The tightened prompts live in prompts/enhanced-*.txt and are chosen per
 * experiment condition.
 */
import type { CommandMode } from "./contract.ts";

/** The implementation prompts/default.txt declares: it asks for every field. */
export const DEFAULT_IMPLEMENTATION: CommandMode = "full";

export const DEFAULT_SYSTEM_PROMPT = `You are a product filter assistant. Given a user's natural language request, output ONLY a JSON object matching this schema:

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
