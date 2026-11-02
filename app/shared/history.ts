/**
 * How H becomes the mediator's effective context.
 *
 * Lives in `shared/` so the client can reproduce, exactly, the context the
 * server sent — which is what lets the trace panel answer "did the model forget,
 * or was it never told?" without a second round trip.
 */
import type { History, HistoryPolicy } from "./contract.ts";

export interface HistoryConfig {
  policy: HistoryPolicy;
  maxTurns: number | null;
}

export type ChatRole = "system" | "user" | "assistant";
export interface ChatMessage {
  role: ChatRole;
  content: string;
}

/**
 * Selects the turns of H that actually reach the mediator.
 *
 * This is the dial that induces Context Amnesia (§4.8):
 *   - "full"   every prior turn; the reference condition
 *   - "last-k" truncation, the mechanism §1.2 describes
 *   - "none"   nothing is sent — the display-only-history fault, which is
 *              amnesia at k = 0 and fires the §4.8 signature on every
 *              multi-turn trace
 */
export function effectiveHistory(H: History, config: HistoryConfig): History {
  if (config.policy === "none") return [];
  if (config.policy === "last-k") {
    const k = config.maxTurns ?? 0;
    return k <= 0 ? [] : H.slice(-k);
  }
  return H;
}

/**
 * Renders the selected turns as alternating messages, with the emitted command
 * as the assistant turn — mirroring §4.5's note that the mediator's own tool
 * calls appear as assistant turns in its context at the next inference.
 */
export function renderHistory(turns: History): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const turn of turns) {
    out.push({ role: "user", content: turn.u });
    out.push({
      role: "assistant",
      content: turn.q === null ? '{"error":"no command emitted"}' : JSON.stringify(turn.q),
    });
  }
  return out;
}
