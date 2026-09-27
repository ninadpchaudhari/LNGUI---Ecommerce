/**
 * Every type that crosses the wire, plus the pure operations of the formal
 * model. Dependency-free and imported by both `api/**` and `src/**`, so the
 * client and server can never disagree about a verdict.
 *
 * Equation numbers refer to Chapter 4 of the dissertation proposal.
 */
import {
  CATEGORY_VALUES,
  CONTROL_IDS,
  CONTROLS,
  SORT_VALUES,
  V0,
  type ControlId,
  type ControlValue,
  type Valuation,
} from "./surface.generated.ts";

/** Dom(category) and Dom(sort) minus ⊥, as literal unions. */
export type CategoryValue = (typeof CATEGORY_VALUES)[number];
export type SortValue = (typeof SORT_VALUES)[number];

export type {
  ControlId,
  ControlValue,
  Valuation,
} from "./surface.generated.ts";

export const SCHEMA_VERSION = 1;

// ── σ = ⟨V, H, P, D⟩ (Eq. 4.4) ───────────────────────────────────────────────

/**
 * D — the display state: the result set currently rendered.
 *
 * `productIds` is *ordered*, because `sort` is a control and therefore order is
 * semantic. See `dataEqual` vs `dataSubset`.
 */
export interface DataState {
  productIds: number[];
  count: number;
  total: number;
}

/** One appended turn of H: ⟨u, q, V′, D′⟩ (Eq. 4.9). */
export interface HistoryTurn {
  u: string;
  q: Command | null;
  V: Valuation;
  D: DataState;
}

/** H — the effective context state. */
export type History = HistoryTurn[];

/** How H is rendered into the prompt. Part of P, and the dial for §4.8 amnesia. */
export type HistoryPolicy = "full" | "last-k" | "none";

/**
 * Which system prompt is in force. `baseline` is the prompt as recorded with
 * Figure 1.2; `extended` adds the preserve-context rule and the clearFilters
 * field. The two are not interchangeable — see api/prompt.ts.
 */
export type PromptVariant = "baseline" | "extended";

/**
 * P — prompt and runtime configuration.
 *
 * Deliberately *not* part of `Observation`: §A.2 states H and P "are not shown
 * and so never enter a verdict". P is provenance, recorded so that a violation
 * can be attributed to a mediator version and context policy (§4.17).
 */
export interface PromptConfig {
  requestedModel: string;
  /** What the provider actually served; may differ after routing. */
  resolvedModel: string | null;
  temperature: number;
  topP: number;
  systemPromptHash: string;
  commandSchemaHash: string;
  promptVariant: PromptVariant;
  historyPolicy: HistoryPolicy;
  historyMaxTurns: number | null;
  clearActionEnabled: boolean;
}

export interface SystemState {
  V: Valuation;
  H: History;
  P: PromptConfig;
  D: DataState;
}

/** O(σ) = ⟨V, D⟩ (Eq. 4.5). H and P are excluded by construction. */
export interface Observation {
  V: Valuation;
  D: DataState;
}

// ── Q — the command language ────────────────────────────────────────────────

/**
 * q ∈ Q, the command the mediator emits. This is what "Show last command JSON"
 * prints, and the boundary between M and Apply (Eq. 4.7).
 *
 * The nesting under `filters` is the established wire shape. Note that
 * Appendix A.1 documents a *flat* shape; the appendix is out of step with the
 * implementation, not the reverse.
 */
export interface CommandFilters {
  /** Constrained to Dom(category): zod validates the enum before a Command exists. */
  category: CategoryValue | null;
  /**
   * Numerics are intentionally wider than their domains, so that a mediator
   * emitting e.g. minRating 4.2 is representable in q and can be *rejected* by
   * Apply rather than hidden behind a schema error.
   */
  maxPrice: number | null;
  minRating: number | null;
  inStockOnly: boolean | null;
}

export interface Command {
  filters: CommandFilters;
  sort: SortValue | null;
  /** Present only when CLEAR_ACTION_ENABLED; absent from the schema otherwise. */
  clearFilters?: boolean | null;
  explanation: string;
}

// ── Apply — outcome of applying q to V ──────────────────────────────────────

/** Why a requested assignment was not applied. */
export type RejectionReason = "out-of-domain" | "unknown-control" | "action-disabled";

export interface RejectedAssignment {
  control: ControlId;
  value: unknown;
  reason: RejectionReason;
}

/**
 * §4.5: a command the application rejects leaves the valuation unchanged, and a
 * partially executed command updates only the controls it successfully targets.
 * Both outcomes are reported, because "rejected" is a distinct observable from
 * "applied" and the difference localizes the fault.
 */
export interface ApplyResult {
  V: Valuation;
  applied: ControlId[];
  rejected: RejectedAssignment[];
}

// ── Execution metadata (P provenance + per-attempt record) ──────────────────

export type LlmProvider = "openrouter" | "openai" | "local-test" | "none";
export type RunMode = "llm" | "local-test";
export type AttemptName = "initial" | "repair";
export type AttemptOutcome = "parsed" | "schema-invalid" | "json-invalid" | "llm-error";
export type ModelSource = "client" | "env-default" | "code-default";

export interface TokenUsage {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  costUsd: number | null;
}

export interface AttemptRecord {
  attempt: number;
  name: AttemptName;
  startedAt: string;
  latencyMs: number;
  requestedModel: string;
  resolvedModel: string | null;
  /** Provider generation id, e.g. OpenRouter's `gen-…`. */
  responseId: string | null;
  /** OpenRouter's upstream provider, when reported. */
  providerName: string | null;
  finishReason: string | null;
  /** The exact user message sent, including any rendered history. */
  userPrompt: string;
  rawText: string | null;
  rawTruncated: boolean;
  usage: TokenUsage | null;
  outcome: AttemptOutcome;
  errorMessage: string | null;
}

export interface LangfuseMeta {
  enabled: boolean;
  traceId: string | null;
  url: string | null;
}

export type CommandErrorCode =
  | "bad_request"
  | "model_not_allowed"
  | "missing_api_key"
  | "llm_error"
  | "invalid_json"
  | "schema_invalid"
  | "internal";

export interface CommandMeta {
  schemaVersion: number;
  /** Also used as the Langfuse trace id, so the two records join on one key. */
  requestId: string;
  timestamp: string;
  mode: RunMode;
  provider: LlmProvider;
  baseURL: string | null;
  modelSource: ModelSource;
  P: PromptConfig;
  attempts: AttemptRecord[];
  repaired: boolean;
  totalLatencyMs: number;
  usageTotal: TokenUsage | null;
  /** Turns present in H as sent vs. as displayed; see `contextIntact`. */
  historyTurnsEffective: number;
  historyTurnsDisplayed: number;
  langfuse: LangfuseMeta;
  error: { code: CommandErrorCode; message: string; detail?: string } | null;
}

/** 200 response: command fields stay at the top level, `meta` is additive. */
export interface CommandResponse extends Command {
  meta: CommandMeta;
}

/** Non-2xx response. `meta` is present on every failure path too. */
export interface CommandErrorResponse {
  error: string;
  detail?: string;
  firstResponse?: string;
  secondResponse?: string;
  validationError?: string;
  raw?: string;
  meta: CommandMeta;
}

// ── Standing assertions (§4.6) — reported outside the fault taxonomy ────────

export interface StandingFlags {
  /** fp(u,σ) ⊆ W(u). False means the mediator moved an undeclared control. */
  commandOverReach: boolean;
  overReachControls: ControlId[];
  /** |H_effective| = |H_displayed|. False means the transcript is not the context. */
  contextIntact: boolean;
}

// ── Persisted records ───────────────────────────────────────────────────────

export type TurnKind = "chat" | "mr";
export type TraceRole = "source" | "followup";

/** One transition: the reproducible replay unit of §4.17 step 5. */
export interface TurnRecord {
  schemaVersion: number;
  id: string;
  sessionId: string;
  createdAt: string;
  turnIndex: number;
  kind: TurnKind;
  /** MR context, null for plain chat turns. */
  relation: string | null;
  role: TraceRole | null;
  trial: number | null;
  u: string;
  q: Command | null;
  vBefore: Valuation;
  vAfter: Valuation;
  dBefore: DataState;
  dAfter: DataState;
  /** fp(u,σ) — the controls whose values actually changed (Eq. 4.15). */
  fp: ControlId[];
  /** W(u) — declared before execution, null when the utterance is unlabelled. */
  writeSet: ControlId[] | null;
  applied: ControlId[];
  rejected: RejectedAssignment[];
  flags: StandingFlags;
  ok: boolean;
  error: string | null;
  meta: CommandMeta | null;
}

export type MrVerdict = "pass" | "fail" | "skipped";
export type RelationName = "MR_SE" | "MR_AC" | "MR_CA" | "MR_REV" | "CONTEXT_AMNESIA";

/** One MR test case over N trials: the report T of Algorithm 1. */
export interface MrCaseRecord {
  schemaVersion: number;
  id: string;
  sessionId: string;
  createdAt: string;
  relation: RelationName;
  predicate: string;
  /** Legacy label from the pre-conformance relation set, for joining old exports. */
  legacyName: string | null;
  sourceTrace: string[];
  followupTrace: string[];
  n: number;
  epsilon: number;
  fails: number;
  failureRate: number;
  verdict: MrVerdict;
  /** Reason the precondition did not hold, when verdict is "skipped". */
  skipReason: string | null;
  covNL: number;
  covMR: number;
  firstFailureMs: number | null;
  mediatorInvocations: number;
  totalTokens: number | null;
  /** E — turn ids for every trial, for replay (Algorithm 1 line 14). */
  evidenceTurnIds: string[];
}

// ── /api/config ─────────────────────────────────────────────────────────────

export interface AppConfig {
  schemaVersion: number;
  mode: RunMode;
  provider: LlmProvider;
  baseURL: string | null;
  defaultModel: string;
  models: string[];
  allowAnyModel: boolean;
  temperature: number;
  topP: number;
  systemPromptHash: string;
  commandSchemaHash: string;
  promptVariant: PromptVariant;
  historyPolicy: HistoryPolicy;
  historyMaxTurns: number | null;
  clearActionEnabled: boolean;
  langfuseEnabled: boolean;
  persistence: "d1" | "file" | "none";
  /** C, Dom and V₀, so the client never hardcodes the control surface. */
  controls: typeof CONTROLS;
  v0: Valuation;
}

// ═══════════════════════════════════════════════════════════════════════════
// Pure operations
// ═══════════════════════════════════════════════════════════════════════════

/** A fresh, mutable copy of V₀. */
export function resetValuation(): Valuation {
  return { ...V0 } as Valuation;
}

/** active(V) = {c ∈ C : V(c) ≠ ⊥} (Eq. 4.3). */
export function active(V: Valuation): ControlId[] {
  return CONTROL_IDS.filter((c) => V[c] !== null);
}

/**
 * V[d ↦ w] (Eq. 4.13): identical to V except that d now holds w.
 * Nothing else moves — that is the whole content of the equation.
 */
export function pointUpdate(V: Valuation, d: ControlId, w: ControlValue): Valuation {
  return { ...V, [d]: w } as Valuation;
}

/** fp(u,σ) = {c ∈ C : σ′.V(c) ≠ σ.V(c)} (Eq. 4.15). */
export function footprint(before: Valuation, after: Valuation): ControlId[] {
  return CONTROL_IDS.filter((c) => before[c] !== after[c]);
}

/** The standing check fp(u,σ) ⊆ W(u) (§4.6). Returns the offending controls. */
export function overReach(fp: readonly ControlId[], writeSet: readonly ControlId[]): ControlId[] {
  return fp.filter((c) => !writeSet.includes(c));
}

/** Whether a value lies in Dom(c) ∪ {⊥}. Used by Apply to reject assignments. */
export function inDomain(control: ControlId, value: ControlValue): boolean {
  if (value === null) return true;
  const domain = CONTROLS[control].domain;
  switch (domain.kind) {
    case "enum":
      return domain.values.some((v) => v.value === value);
    case "number":
      return typeof value === "number" && Number.isFinite(value) &&
        value >= domain.min && value <= domain.max;
    case "boolean":
      return typeof value === "boolean";
    case "action":
      return value === "invoked";
  }
}

export function valuationEqual(a: Valuation, b: Valuation): boolean {
  return CONTROL_IDS.every((c) => a[c] === b[c]);
}

/**
 * Ordered equality of D. Used by MR_SE, MR_CA and MR_REV, whose postconditions
 * are O(σ′) = O(σ″) — and `sort` is a control, so a permutation is a real
 * difference, not noise.
 */
export function dataEqual(a: DataState, b: DataState): boolean {
  return (
    a.count === b.count &&
    a.total === b.total &&
    a.productIds.length === b.productIds.length &&
    a.productIds.every((id, i) => id === b.productIds[i])
  );
}

/**
 * Set containment D_sub ⊆ D_sup. Used *only* by MR_AC, whose postcondition is
 * containment rather than equality. Deliberately distinct from `dataEqual`:
 * collapsing the two silently breaks MR_AC.
 */
export function dataSubset(sub: DataState, sup: DataState): boolean {
  const supIds = new Set(sup.productIds);
  return sub.productIds.every((id) => supIds.has(id));
}

/** O(σ) (Eq. 4.5). */
export function observe(state: SystemState): Observation {
  return { V: state.V, D: state.D };
}

/** σ₁ ≈ σ₂ ⟺ O(σ₁) = O(σ₂) (Eq. 4.6). */
export function observationallyEqual(a: Observation, b: Observation): boolean {
  return valuationEqual(a.V, b.V) && dataEqual(a.D, b.D);
}

/** Cov_NL(U) = |⋃ fp(u,σ₀)| / |C| (Eq. 4.19). */
export function covNL(footprints: ReadonlyArray<readonly ControlId[]>): number {
  const reached = new Set<ControlId>();
  for (const fp of footprints) for (const c of fp) reached.add(c);
  return reached.size / CONTROL_IDS.length;
}

/** The controls no utterance ever moved — the reachability gap §4.11 describes. */
export function unreachedControls(
  footprints: ReadonlyArray<readonly ControlId[]>,
): ControlId[] {
  const reached = new Set<ControlId>();
  for (const fp of footprints) for (const c of fp) reached.add(c);
  return CONTROL_IDS.filter((c) => !reached.has(c));
}

export const CORE_RELATIONS: readonly RelationName[] = ["MR_SE", "MR_AC", "MR_CA", "MR_REV"];

/**
 * Cov_MR(T) = |{MR_i ∈ R : T has a valid instance}| / |R| (Eq. 4.20).
 * "Valid" means the precondition held, so skipped cases do not count.
 */
export function covMR(cases: ReadonlyArray<{ relation: RelationName; verdict: MrVerdict }>): number {
  const exercised = new Set<RelationName>();
  for (const c of cases) {
    if (c.verdict !== "skipped" && CORE_RELATIONS.includes(c.relation)) exercised.add(c.relation);
  }
  return exercised.size / CORE_RELATIONS.length;
}

/**
 * Eq. 4.18: violation ⟺ fails/N > ε. Failure rates at or below ε are treated
 * as sampling noise rather than repeatable faults.
 */
export function verdictFor(fails: number, n: number, epsilon: number): MrVerdict {
  if (n <= 0) return "skipped";
  return fails / n > epsilon ? "fail" : "pass";
}

/**
 * FNV-1a 32-bit. Synchronous and dependency-free, so the same hash is available
 * in the Worker, in Node and in the browser without touching WebCrypto.
 */
export function hashString(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `fnv1a32:${(h >>> 0).toString(16).padStart(8, "0")}`;
}

/** Model ids accepted from the client. Narrow enough to keep junk out of P. */
export const MODEL_ID_RE = /^[A-Za-z0-9._:/-]{1,120}$/;
