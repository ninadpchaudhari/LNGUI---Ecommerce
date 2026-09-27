/**
 * The transition semantics of Eq. 4.7:
 *
 *     u --M--> q ∈ Q --Apply--> V′ ∈ Val(C) --A--> D′
 *
 * Apply and A live here as separate named functions because that boundary is
 * what localizes a fault: everything left of q is language mediation, where
 * mediator defects live; everything right of it is ordinary catalog code
 * applying a well-formed filter (§4.5, §A.3).
 *
 * M is the only stage that touches the network, so it lives with the HTTP
 * client in `src/utils/mediator.ts`; this module stays pure and therefore
 * usable from both runtimes.
 */
import {
  CONTROL_IDS,
  V0,
  type ControlId,
  type ControlValue,
  type Valuation,
} from "./surface.generated.ts";
import { products, TOTAL_PRODUCTS, type Product } from "./catalog.ts";
import {
  footprint,
  inDomain,
  type ApplyResult,
  type Command,
  type DataState,
  type History,
  type HistoryTurn,
  type PromptConfig,
  type RejectedAssignment,
  type SystemState,
} from "./contract.ts";

// ── Apply: q → V′ ───────────────────────────────────────────────────────────

/**
 * The assignments a command requests, as a partial valuation. Flattens the
 * wire shape (`filters.*` plus `sort`) onto control ids.
 */
function requestedAssignments(q: Command): Array<[ControlId, ControlValue]> {
  return [
    ["category", q.filters.category as ControlValue],
    ["maxPrice", q.filters.maxPrice],
    ["minRating", q.filters.minRating],
    ["inStockOnly", q.filters.inStockOnly],
    ["sort", q.sort as ControlValue],
  ];
}

/**
 * Apply — deterministic, total, and pure.
 *
 * Per §4.5 a rejected command leaves the valuation unchanged and a partially
 * executed one updates only the controls it successfully targets, so
 * out-of-domain assignments are dropped individually and reported rather than
 * silently coerced. A mediator that emits `minRating: 4.2` is a mediator fault;
 * clamping it here would hide that.
 *
 * `clearFilters` is handled first: when invoked it resets all of C to V₀ and
 * sets its own sticky flag, so any subsequent assignments in the same command
 * still apply on top of the cleared state.
 */
export function applyCommand(
  V: Valuation,
  q: Command,
  options: { clearActionEnabled: boolean },
): ApplyResult {
  const applied: ControlId[] = [];
  const rejected: RejectedAssignment[] = [];
  let next: Valuation = { ...V };

  if (q.clearFilters === true) {
    if (options.clearActionEnabled) {
      next = { ...V0, clearFilters: "invoked" } as Valuation;
      for (const c of CONTROL_IDS) {
        if (next[c] !== V[c]) applied.push(c);
      }
    } else {
      rejected.push({ control: "clearFilters", value: true, reason: "action-disabled" });
    }
  }

  for (const [control, requested] of requestedAssignments(q)) {
    if (requested !== null && !inDomain(control, requested)) {
      rejected.push({ control, value: requested, reason: "out-of-domain" });
      continue;
    }

    // The mediator is instructed to return null for any field the user did not
    // mention, which means "no constraint from this field" — that is V₀(c), not
    // necessarily ⊥. For category, minRating and sort V₀ is ⊥ so the two
    // coincide; for maxPrice it is 500 and for inStockOnly it is false. This
    // reproduces the reducer that previously lived inline in App.tsx.
    //
    // A consequence worth knowing: because every command carries every field,
    // every command fully determines V. There is no partial command on this
    // wire format.
    const value = requested === null ? V0[control] : requested;

    if (next[control] !== value) {
      next = { ...next, [control]: value } as Valuation;
      if (!applied.includes(control)) applied.push(control);
    }
  }

  return { V: next, applied, rejected };
}

// ── A: V′ → D′ ──────────────────────────────────────────────────────────────

function matches(p: Product, V: Valuation): boolean {
  if (V.category !== null && p.category !== V.category) return false;
  if (V.maxPrice !== null && p.price > V.maxPrice) return false;
  if (V.minRating !== null && p.rating < V.minRating) return false;
  if (V.inStockOnly === true && !p.inStock) return false;
  return true;
}

function ordered(list: Product[], sort: Valuation["sort"]): Product[] {
  if (sort === null) return list;
  const out = [...list];
  switch (sort) {
    case "price_asc":
      return out.sort((a, b) => a.price - b.price);
    case "price_desc":
      return out.sort((a, b) => b.price - a.price);
    case "rating_desc":
      return out.sort((a, b) => b.rating - a.rating);
    case "name_asc":
      return out.sort((a, b) => a.name.localeCompare(b.name));
  }
}

/** A — the application logic: D′ = A(V′). Pure and deterministic. */
export function renderData(V: Valuation): DataState {
  const shown = ordered(products.filter((p) => matches(p, V)), V.sort);
  return {
    productIds: shown.map((p) => p.id),
    count: shown.length,
    total: TOTAL_PRODUCTS,
  };
}

/** The products themselves, for rendering. Same filter and order as `renderData`. */
export function visibleProducts(V: Valuation): Product[] {
  return ordered(products.filter((p) => matches(p, V)), V.sort);
}

// ── σ₀ and the state transition (Eq. 4.9) ───────────────────────────────────

/** ResetApp: σ₀ — V₀, empty H, the fixed runtime configuration, canonical D. */
export function resetState(P: PromptConfig): SystemState {
  const V = { ...V0 } as Valuation;
  return { V, H: [], P, D: renderData(V) };
}

export interface StepResult {
  state: SystemState;
  apply: ApplyResult;
  /** fp(u,σ) for this transition. */
  fp: ControlId[];
}

/**
 * σ --u--> σ′ = ⟨V′, H ⊕ ⟨u,q,V′,D′⟩, P, D′⟩ (Eq. 4.9).
 *
 * Takes an already-emitted q so that the impure stage M stays out of this
 * module. A null q (the mediator failed) leaves V and D untouched but still
 * appends the turn, because a failed turn is part of the history the next
 * inference sees.
 */
export function step(
  state: SystemState,
  u: string,
  q: Command | null,
  options: { clearActionEnabled: boolean },
): StepResult {
  const apply: ApplyResult =
    q === null
      ? { V: state.V, applied: [], rejected: [] }
      : applyCommand(state.V, q, options);

  const D = renderData(apply.V);
  const turn: HistoryTurn = { u, q, V: apply.V, D };
  const H: History = [...state.H, turn];

  return {
    state: { V: apply.V, H, P: state.P, D },
    apply,
    fp: footprint(state.V, apply.V),
  };
}
