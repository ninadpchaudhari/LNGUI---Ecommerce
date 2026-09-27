/**
 * Re-export of the shared model types, plus the few types that are purely
 * presentational and therefore have no place in `shared/`.
 */
export type * from "../../shared/contract.ts";

/** A rendered chat bubble. Distinct from a HistoryTurn, which is σ's H. */
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  /** Links a bubble back to its TurnRecord, so the panel and transcript agree. */
  turnId?: string;
  isError?: boolean;
}
