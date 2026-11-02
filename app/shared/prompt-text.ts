/**
 * The system prompt is plain text. It is an input to the experiment, so it is
 * never selected by a name. An experiment condition carries the whole text, and
 * every record carries its hash.
 *
 * Prompt files (prompts/*.txt) are normalized before use, so an editor that
 * adds a trailing newline or uses CRLF does not change the prompt or its hash.
 *
 * A prompt file may start with a header naming its implementation, the reply
 * format it asks the model for:
 *
 *   ---
 *   implementation: full
 *   ---
 *   You are a product filter assistant. …
 *
 * The header is never sent to the model, and hashes cover only the text after
 * it. The implementation is part of the prompt rather than a separate setting,
 * because the prompt is what tells the model to send every field or only the
 * changed ones.
 */
import { hashString, type CommandMode } from "./contract.ts";

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

/** A prompt file: its declared implementation (null when it has no header) and the text the model receives. */
export interface PromptFile {
  implementation: CommandMode | null;
  text: string;
}

const HEADER = /^---\n([\s\S]*?)\n?---\n/;

/** Splits a prompt file into its header and the normalized text. Throws on a header it cannot read. */
export function parsePromptFile(raw: string): PromptFile {
  const s = raw.replace(/\r\n/g, "\n");
  const m = s.match(HEADER);
  if (!m) return { implementation: null, text: normalizePrompt(s) };
  let implementation: CommandMode | null = null;
  for (const line of m[1].split("\n")) {
    if (line.trim() === "") continue;
    const kv = line.match(/^(\w+):\s*(.*?)\s*$/);
    if (!kv) throw new Error(`prompt header: cannot read "${line}"`);
    if (kv[1] !== "implementation") throw new Error(`prompt header: unknown key "${kv[1]}" (only implementation is allowed)`);
    if (kv[2] !== "diff" && kv[2] !== "full") throw new Error(`prompt header: implementation must be diff or full, not "${kv[2]}"`);
    implementation = kv[2];
  }
  return { implementation, text: normalizePrompt(s.slice(m[0].length)) };
}

/** The file form of a prompt: the header, when there is an implementation, then the text. */
export function formatPromptFile(p: PromptFile): string {
  return (p.implementation ? `---\nimplementation: ${p.implementation}\n---\n` : "") + normalizePrompt(p.text) + "\n";
}

/** Lowercase letters, digits, dot, dash and underscore: safe in a file name and a condition id. */
export const PROMPT_NAME_RE = /^[\w.-]+$/;

/** A prompts/*.txt file as the Experiments page and the chat use it. The text is sent exactly as written. */
export interface PromptEntry {
  name: string;
  text: string;
  /** The reply format the prompt asks for, which sets LNGUI_COMMAND_MODE. */
  implementation: CommandMode;
}
