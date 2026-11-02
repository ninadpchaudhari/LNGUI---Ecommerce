/**
 * Every prompts/*.txt in the repo, bundled when the page is built, for the
 * chat panel and the Experiments page alike. Each declares its implementation
 * in a header (shared/prompt-text.ts). The default comes first.
 */
import type { AppConfig } from "../../shared/contract.ts";
import { parsePromptFile, promptHash, type PromptEntry } from "../../shared/prompt-text.ts";

export type { PromptEntry } from "../../shared/prompt-text.ts";

export const COMMITTED_PROMPTS: PromptEntry[] = Object.entries(
  import.meta.glob("../../prompts/*.txt", { query: "?raw", import: "default", eager: true }) as Record<string, string>,
)
  .map(([path, raw]) => {
    const { text, implementation } = parsePromptFile(raw);
    // api/prompt.test.ts fails if a committed prompt has no header.
    return { name: path.split("/").pop()!.replace(/\.txt$/, ""), text, implementation: implementation ?? "diff" };
  })
  .sort((a, b) => (a.name === "default" ? -1 : b.name === "default" ? 1 : a.name.localeCompare(b.name)));

/** The prompt file a recorded systemPromptHash came from, or null for a text not in prompts/. */
export function promptNameOf(hash: string): string | null {
  return COMMITTED_PROMPTS.find((p) => promptHash(p.text) === hash)?.name ?? null;
}

/**
 * P in one line, as the Experiments page and the chat panel both show it. An
 * unset temperature or top_p was not sent, so the provider's default applied.
 */
export function describeP(P: AppConfig, prompt: string): string {
  const history = `history ${P.historyPolicy}${P.historyMaxTurns !== null ? ` k=${P.historyMaxTurns}` : ""}`;
  const update = `update ${P.commandMode ?? "diff"}`;
  if (P.mode === "local-test") return ["local parser", `prompt ${prompt}`, history, update].join(" · ");
  return [
    `${P.provider} ${P.defaultModel}`,
    `prompt ${prompt}`,
    `T ${P.temperature ?? "provider default"}`,
    `top_p ${P.topP ?? "provider default"}`,
    ...(P.reasoningEffort ? [`reasoning ${P.reasoningEffort}`] : []),
    history,
    update,
  ].join(" · ");
}
