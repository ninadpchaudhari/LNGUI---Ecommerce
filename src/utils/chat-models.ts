/** The chat panel's models and settings. */

/**
 * The models the chat offers, each with its publisher's recommended sampling.
 * Only the parameters a publisher recommends are sent; the rest stay unset.
 */
export const CHAT_MODELS = [
  // OpenAI's API defaults.
  { label: "GPT-4o mini · OpenRouter", provider: "openrouter", model: "openai/gpt-4o-mini", temperature: "1", topP: "1" },
  // Anthropic's default temperature; Claude models take temperature or top_p, not both.
  { label: "Claude Haiku 5.5 · OpenRouter", provider: "openrouter", model: "anthropic/claude-haiku-5.5", temperature: "1", topP: "" },
  // Meta's generation config for Llama 3.2 Instruct.
  { label: "Llama 3.2 3B · Ollama", provider: "ollama", model: "llama3.2:latest", temperature: "0.6", topP: "0.9" },
  // Qwen's model card, thinking mode (the default), general tasks.
  { label: "Qwen3.5 4B · Ollama", provider: "ollama", model: "qwen3.5:4b", temperature: "1", topP: "0.95" },
] as const;

/** The chat's condition: what an experiment condition states, for one session. */
export interface ChatSettings {
  provider: "openrouter" | "ollama";
  model: string;
  /** A prompts/*.txt name. */
  prompt: string;
  /** Empty means not sent. At least one of the two must be set. */
  temperature: string;
  topP: string;
}

/** A model's entry from CHAT_MODELS, as settings. */
export const settingsFor = (m: (typeof CHAT_MODELS)[number], prompt: string): ChatSettings =>
  ({ provider: m.provider, model: m.model, prompt, temperature: m.temperature, topP: m.topP });
