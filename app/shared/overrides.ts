/**
 * Per-request overrides of P: the settings an experimental condition pins.
 *
 * A condition is a set of environment keys (system prompt, temperature,
 * history policy, model). Every runner sends them the same way, as an
 * `overrides` object in the JSON body of POST /api/command and POST
 * /api/config, and the router merges them over the server's environment before
 * any handler resolves P. The browser and the headless sweep therefore resolve
 * P through one code path. The body carries them rather than a header so the
 * system prompt has no practical length limit.
 *
 * Only the keys below may be overridden. API keys, tokens and storage
 * bindings never travel in a request.
 */
/**
 * `off` disables Langfuse tracing for a request; `on` (or no header) traces
 * when the server has Langfuse keys. Tracing is observability only and never
 * part of P.
 */
export const LANGFUSE_HEADER = "x-lngui-langfuse";

/**
 * When a request carries overrides, every key below that the overrides do not
 * set is treated as unset. The server's .env never fills it. An unset key
 * takes its code default, and an unset temperature or top_p is left out of
 * the model call so the provider's own default applies.
 */
export const OVERRIDE_KEYS = [
  "LLM_PROVIDER",
  "LLM_MODEL",
  "OPENROUTER_MODEL",
  "OPENAI_MODEL",
  "OLLAMA_MODEL",
  "SYSTEM_PROMPT",
  "LNGUI_COMMAND_MODE",
  "LLM_TEMPERATURE",
  "LLM_TOP_P",
  "LLM_REASONING_EFFORT",
  "HISTORY_POLICY",
  "HISTORY_MAX_TURNS",
  "LOCAL_TEST_MODE",
] as const;

export type OverrideKey = (typeof OVERRIDE_KEYS)[number];
export type Overrides = Partial<Record<OverrideKey, string>>;

const isKey = (k: string): k is OverrideKey => (OVERRIDE_KEYS as readonly string[]).includes(k);

/**
 * Validates an overrides object. Unknown keys and empty values are problems,
 * never silently dropped: an override that does not apply would make a
 * condition report a P it did not run under.
 */
export function checkOverrides(raw: unknown): { overrides: Overrides; problems: string[] } {
  const problems: string[] = [];
  const overrides: Overrides = {};
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { overrides, problems: ["overrides must be an object of string values"] };
  }
  for (const [k, v] of Object.entries(raw)) {
    if (k === "CLEAR_ACTION_ENABLED") {
      problems.push("CLEAR_ACTION_ENABLED was removed: clearFilters is always part of the command language");
      continue;
    }
    if (!isKey(k)) {
      problems.push(`${k} cannot be overridden (allowed: ${OVERRIDE_KEYS.join(", ")})`);
      continue;
    }
    if (typeof v !== "string" || v.trim() === "") {
      problems.push(`${k} must be a non-empty string`);
      continue;
    }
    if (k === "LNGUI_COMMAND_MODE" && !["diff", "full"].includes(v.trim())) {
      problems.push("LNGUI_COMMAND_MODE must be diff or full");
      continue;
    }
    if (k === "SYSTEM_PROMPT") {
      // Kept exactly as sent: trimming would change the prompt's hash.
      overrides[k] = v;
      continue;
    }
    overrides[k] = v.trim();
  }
  return { overrides, problems };
}
