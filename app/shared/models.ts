/**
 * The models the chat panel and the Experiments page offer, and each one's
 * sampling. Shared with the experiment schema, which checks a condition's
 * sampling against the model it names.
 */

export interface ModelEntry {
  label: string;
  provider: "openrouter" | "ollama";
  model: string;
  /**
   * The publisher's recommended temperature and top_p ("" = not sent), or
   * null for a model that accepts neither: OpenRouter drops them unsent, so a
   * condition that set them would record a sampling the model never used.
   */
  sampling: { temperature: string; topP: string } | null;
  /**
   * The reasoning efforts the provider accepts for the model, lowest first, or
   * null for a model without reasoning. A configuration of a reasoning model
   * must state one; the page and the chat start from the lowest.
   */
  reasoning: readonly string[] | null;
}

export const MODELS: readonly ModelEntry[] = [
  // OpenAI publishes no recommended sampling for GPT-4o mini; these are the API's defaults
  // (temperature 1, top_p 1): https://platform.openai.com/docs/api-reference/chat/create
  { label: "GPT-4o mini · OpenRouter", provider: "openrouter", model: "openai/gpt-4o-mini", sampling: { temperature: "1", topP: "1" }, reasoning: null },

  // Reasoning model; OpenRouter lists no temperature or top_p, and efforts minimal, low, medium, high:
  // https://openrouter.ai/api/v1/models (checked 2026-10-25)
  { label: "GPT-5 nano · OpenRouter", provider: "openrouter", model: "openai/gpt-5-nano", sampling: null, reasoning: ["minimal", "low", "medium", "high"] },

  // OpenRouter lists no temperature or top_p, and efforts none to max:
  // https://openrouter.ai/api/v1/models (checked 2026-10-25)
  { label: "Claude Haiku 5.5 · OpenRouter", provider: "openrouter", model: "anthropic/claude-haiku-5.5", sampling: null, reasoning: ["none", "low", "medium", "high", "xhigh", "max"] },

  // Meta's reference defaults for Llama 3 chat completion (temperature 0.6, top_p 0.9):
  // https://github.com/meta-llama/llama-models/blob/main/models/llama3/generation.py
  { label: "Llama 3.2 3B · OpenRouter", provider: "openrouter", model: "meta-llama/llama-3.2-3b-instruct", sampling: { temperature: "0.6", topP: "0.9" }, reasoning: null },

  // Qwen's card, non-thinking mode, general tasks (temperature 0.7, top_p 0.8), because the lowest
  // effort, "none", turns thinking off. With thinking on the card says 1.0 and 0.95:
  // https://huggingface.co/Qwen/Qwen3.5-9B
  // OpenRouter has no Qwen3.5 4B; 9B is the smallest. OpenRouter lists no efforts for it; "none" turns
  // thinking off (the 2026-10-25 run averaged 65 completion tokens for a 190-character reply).
  { label: "Qwen3.5 9B · OpenRouter", provider: "openrouter", model: "qwen/qwen3.5-9b", sampling: { temperature: "0.7", topP: "0.8" }, reasoning: ["none", "low", "medium", "high"] },

  // As Llama 3.2 3B on OpenRouter.
  { label: "Llama 3.2 3B · Ollama", provider: "ollama", model: "llama3.2:latest", sampling: { temperature: "0.6", topP: "0.9" }, reasoning: null },

  // As Qwen3.5 9B: https://huggingface.co/Qwen/Qwen3.5-4B
  // Ollama's thinking is on or off for this model: "none" turns it off, any other effort turns it on
  // (https://docs.ollama.com/api/openai-compatibility). Thinks by default when nothing is sent.
  { label: "Qwen3.5 4B · Ollama", provider: "ollama", model: "qwen3.5:4b", sampling: { temperature: "0.7", topP: "0.8" }, reasoning: ["none", "high"] },
];

/** Whether a model takes no temperature or top_p. Unlisted models are assumed to take them. */
export const fixedSampling = (provider: string | undefined, model: string | undefined): boolean =>
  MODELS.some((m) => m.provider === (provider ?? "openrouter") && m.model === model && m.sampling === null);

/** The reasoning efforts a model takes, lowest first; null when it has none or is not listed. */
export const reasoningEfforts = (provider: string | undefined, model: string | undefined): readonly string[] | null =>
  MODELS.find((m) => m.provider === (provider ?? "openrouter") && m.model === model)?.reasoning ?? null;
