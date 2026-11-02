import type { ControlId } from "../../shared/contract.ts";

/**
 * Best-effort W for a free-text chat utterance.
 *
 * Only the MR cases carry a *declared* W read off a generation template
 * (Eq. 4.14); a hand-typed utterance has none, so this heuristic stands in.
 * It must err on the side of a *smaller* W, because W is the denominator of the
 * fp ⊆ W check — every control wrongly included silently suppresses a
 * command-over-reach report.
 *
 * In particular the bare word "rating" must NOT imply minRating: "sorted by
 * rating" asks only for an ordering. Treating it as a rating threshold masked
 * the Figure 1.2 fault, where the mediator sets minRating = 4 on an utterance
 * that never requested it.
 */
export function inferWriteSet(u: string): ControlId[] {
  const t = u.toLowerCase();
  const W: ControlId[] = [];

  if (/electronics|books|clothing|home|sports|categor/.test(t)) W.push("category");
  if (/\$|under|below|less than|cheap|price|expensive|budget/.test(t)) W.push("maxPrice");

  // A rating *threshold*: an explicit number of stars, or the phrases the
  // system prompt maps onto minRating. Not the bare word "rating".
  if (
    /\d(\.\d)?\s*(\+|star)/.test(t) ||
    /\bstars?\b/.test(t) ||
    /(highly|top|best)\s+rated\b/.test(t) ||
    /min(imum)?\s+rating/.test(t) ||
    /rating\s+(of|above|over|at\s+least)/.test(t)
  ) {
    W.push("minRating");
  }

  if (/in stock|out.of.stock|available/.test(t)) W.push("inStockOnly");
  if (/sort|order(ed)?\s+by|first|alphabetical|by rating|by price|by name/.test(t)) W.push("sort");
  if (/clear|reset/.test(t)) W.push("clearFilters");
  return W;
}
