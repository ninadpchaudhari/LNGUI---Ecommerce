/**
 * The system prompt is plain text. It is an input to the experiment, so it is
 * never selected by a name. An experiment condition carries the whole text, and
 * every record carries its hash.
 *
 * Prompt files (prompts/*.txt) are normalized before use, so an editor that
 * adds a trailing newline or uses CRLF does not change the prompt or its hash.
 */
import { hashString } from "./contract.ts";

/** CRLF to LF, and no trailing newlines. This is the text the model receives. */
export function normalizePrompt(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\n+$/, "");
}

/** The hash recorded in P as systemPromptHash. */
export function promptHash(text: string): string {
  return hashString(normalizePrompt(text));
}

/** SHA-256 of the normalized text, hex. Experiment files pin prompt files with it. */
export async function promptSha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(normalizePrompt(text));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Lowercase letters, digits, dot, dash and underscore: safe in a file name and a condition id. */
export const PROMPT_NAME_RE = /^[\w.-]+$/;
