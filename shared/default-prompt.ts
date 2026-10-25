/**
 * The server's default system prompt: the output schema and nothing else.
 * Kept identical to prompts/default.txt (after its header); a test fails if
 * the two differ. The app's original prompt, the one Figure 1.2 was recorded
 * with (fnv1a32:5a348657), is prompts/student-x.txt.
 */
import type { CommandMode } from "./contract.ts";

/** The implementation prompts/default.txt declares: it asks for every field. */
export const DEFAULT_IMPLEMENTATION: CommandMode = "full";

export const DEFAULT_SYSTEM_PROMPT = `You are a product filter assistant. Given a user's natural language requests, output ONLY a JSON object matching this schema:

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

Output ONLY the JSON object. No markdown fences, no extra text.`;
