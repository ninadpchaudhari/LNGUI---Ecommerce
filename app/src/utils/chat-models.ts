/** The chat panel's settings, built from the shared model list (shared/models.ts). */
import { fixedSampling, reasoningEfforts, type ModelEntry } from "../../shared/models.ts";

export { MODELS as CHAT_MODELS } from "../../shared/models.ts";

/** The chat's condition: what an experiment condition states, for one session. */
export interface ChatSettings {
  provider: "openrouter" | "ollama";
  model: string;
  /** A prompts/*.txt name. */
  prompt: string;
  /** Empty means not sent. At least one of the two must be set, unless the model takes neither. */
  temperature: string;
  topP: string;
  /** Empty for a model without reasoning. */
  reasoning: string;
}

/** A model's entry, as settings with its recommended sampling. */
export const settingsFor = (m: ModelEntry, prompt: string): ChatSettings =>
  ({ provider: m.provider, model: m.model, prompt, temperature: m.sampling?.temperature ?? "", topP: m.sampling?.topP ?? "", reasoning: m.reasoning?.[0] ?? "" });

/** Whether the chosen model takes no temperature or top_p. */
export const takesNoSampling = (s: ChatSettings): boolean => fixedSampling(s.provider, s.model);

/** The reasoning efforts the chosen model takes, lowest first, or null. */
export const chatEfforts = (s: ChatSettings) => reasoningEfforts(s.provider, s.model);
