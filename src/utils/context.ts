/**
 * The messages a model call received, rebuilt from the turn records. The
 * server builds them from the same two functions (api/command.ts): the
 * earlier turns of the trace, cut by the history policy (effectiveHistory),
 * each rendered as the user's message and the command returned
 * (renderHistory), between the system prompt and the new message.
 */
import { renderHistory, type ChatMessage } from "../../shared/history.ts";
import type { History, TurnRecord } from "../../shared/contract.ts";
import { COMMITTED_PROMPTS } from "./prompts.ts";
import { promptHash } from "../../shared/prompt-text.ts";

export interface SentContext {
  messages: ChatMessage[];
  /** Why the rebuild may not match what was sent; null when it does. */
  problem: string | null;
}

/** Sweep records carry the case and attempt; chat records do not. */
type Tagged = TurnRecord & { caseId?: string; attempt?: number };

/** The earlier turns of the same trace among `all`, oldest first. */
export function earlierTurns(turn: TurnRecord, all: readonly TurnRecord[]): TurnRecord[] {
  const t = turn as Tagged;
  return (all as readonly Tagged[])
    .filter((r) => r.sessionId === t.sessionId && r.trial === t.trial && r.role === t.role
      && r.caseId === t.caseId && r.attempt === t.attempt && r.turnIndex < t.turnIndex)
    .sort((a, b) => a.turnIndex - b.turnIndex);
}

export function sentContext(turn: TurnRecord, earlier: readonly TurnRecord[]): SentContext | null {
  const m = turn.meta;
  if (!m || m.attempts.length === 0) return null;
  const system = COMMITTED_PROMPTS.find((p) => promptHash(p.text) === m.P.systemPromptHash)?.text
    ?? `(prompt ${m.P.systemPromptHash}: its text is not in prompts/, see the run's manifest)`;
  const H: History = earlier.map((r) => ({ u: r.u, q: r.q, V: r.vAfter, D: r.dAfter }));
  // effectiveHistory keeps a suffix of H; the record says how long it was.
  const sent = H.slice(H.length - Math.min(m.historyTurnsEffective, H.length));
  const problem = earlier.length === m.historyTurnsDisplayed
    ? null
    : `The call had ${m.historyTurnsDisplayed} earlier turn(s); ${earlier.length} are loaded here, so the history below may be incomplete.`;
  return {
    messages: [
      { role: "system", content: system },
      ...renderHistory(sent),
      { role: "user", content: m.attempts[0].userPrompt },
    ],
    problem,
  };
}
