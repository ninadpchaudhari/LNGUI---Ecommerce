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
}

export const MODELS: readonly ModelEntry[] = [
  // OpenAI's API defaults.
  { label: "GPT-4o mini · OpenRouter", provider: "openrouter", model: "openai/gpt-4o-mini", sampling: { temperature: "1", topP: "1" } },
  // Reasoning models; OpenRouter lists no temperature or top_p for either.
  { label: "GPT-5 nano · OpenRouter", provider: "openrouter", model: "openai/gpt-5-nano", sampling: null },
  { label: "Claude Haiku 5.5 · OpenRouter", provider: "openrouter", model: "anthropic/claude-haiku-5.5", sampling: null },
  // Meta's generation config for Llama 3.2 Instruct.
  { label: "Llama 3.2 3B · OpenRouter", provider: "openrouter", model: "meta-llama/llama-3.2-3b-instruct", sampling: { temperature: "0.6", topP: "0.9" } },
  // OpenRouter has no Qwen3.5 4B; 9B is the smallest. Qwen's card, thinking mode, general tasks.
  { label: "Qwen3.5 9B · OpenRouter", provider: "openrouter", model: "qwen/qwen3.5-9b", sampling: { temperature: "1", topP: "0.95" } },
  { label: "Llama 3.2 3B · Ollama", provider: "ollama", model: "llama3.2:latest", sampling: { temperature: "0.6", topP: "0.9" } },
  { label: "Qwen3.5 4B · Ollama", provider: "ollama", model: "qwen3.5:4b", sampling: { temperature: "1", topP: "0.95" } },
];

/** Whether a model takes no temperature or top_p. Unlisted models are assumed to take them. */
export const fixedSampling = (provider: string | undefined, model: string | undefined): boolean =>
  MODELS.some((m) => m.provider === (provider ?? "openrouter") && m.model === model && m.sampling === null);
