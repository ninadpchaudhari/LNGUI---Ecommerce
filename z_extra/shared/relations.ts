/**
 * The five core relations of Table 4.1 and the context-amnesia diagnostic:
 * instance shape and the postcondition check.
 *
 * Pure, so the browser panel and the headless sweep (scripts/sweep.ts) reach
 * the same verdict from the same observations. Running a trace needs M, which
 * is impure, and therefore stays in `src/utils/relations.ts`.
 */
import {
  dataEqual,
  dataSubset,
  observationallyEqual,
  pointUpdate,
  valuationEqual,
  type CommandErrorCode,
  type ControlId,
  type Observation,
  type RelationName,
  type SystemState,
  type TurnRecord,
} from "./contract.ts";
import type { ControlValue } from "./surface.generated.ts";

/**
 * One executable MR instance: two traces plus the labels Check needs.
 *
 * `writeSets` are declared before execution (Eq. 4.14), which is what makes the
 * fp ⊆ W standing check meaningful.
 */
export interface MrInstance {
  relation: RelationName;
  predicate: string;
  /** Label from the pre-conformance set, kept so old exports can be joined. */
  legacyName: string | null;
  description: string;
  sourceTrace: string[];
  followupTrace: string[];
  writeSets: { source: ControlId[][]; followup: ControlId[][] };
  /** MR_AC only: the (d, w) that δ is expected to assign (Eq. 4.13). */
  refinement?: { control: ControlId; value: ControlValue };
}

export interface TraceResult {
  state: SystemState;
  records: TurnRecord[];
}

export interface CheckResult {
  holds: boolean;
  reason: string;
  /**
   * True when the trial could not be judged because the infrastructure failed
   * (timeout, provider error, missing key). Such a trial says nothing about
   * the mediator, so the sweep retries it instead of counting it as a
   * violation. A malformed or schema-invalid command is the mediator's own
   * output and is *not* infrastructure.
   */
  infra: boolean;
}

/** Error codes that come from the plumbing rather than from M's output. */
const INFRA_ERROR_CODES: ReadonlySet<CommandErrorCode> = new Set<CommandErrorCode>([
  "bad_request",
  "model_not_allowed",
  "missing_api_key",
  "llm_error",
  "internal",
]);

/** Whether a failed turn failed for infrastructure reasons. */
export function isInfraFailure(record: TurnRecord): boolean {
  if (record.ok) return false;
  // No meta at all means the request never reached the handler (network).
  if (record.meta === null) return true;
  const code = record.meta.error?.code;
  return code === undefined || INFRA_ERROR_CODES.has(code);
}

/**
 * The postconditions of Table 4.1. Note the two distinct D comparators:
 * equality for MR_CE/MR_CA/MR_REV/MR_COMP, containment for MR_AC.
 */
export function check(
  instance: MrInstance,
  source: TraceResult,
  followup: TraceResult,
): CheckResult {
  const o1: Observation = { V: source.state.V, D: source.state.D };
  const o2: Observation = { V: followup.state.V, D: followup.state.D };

  const failedTurn = [...source.records, ...followup.records].find((r) => !r.ok);
  if (failedTurn) {
    const infra = isInfraFailure(failedTurn);
    return {
      holds: false,
      reason: `${infra ? "infrastructure" : "mediator"} error: ${failedTurn.error ?? "unknown"}`,
      infra,
    };
  }

  switch (instance.relation) {
    case "MR_CE":
    case "MR_CA":
    case "MR_REV":
    case "MR_COMP": {
      if (observationallyEqual(o1, o2)) {
        return { holds: true, reason: "O(σ′) = O(σ″)", infra: false };
      }
      const vDiff = !valuationEqual(o1.V, o2.V);
      const dDiff = !dataEqual(o1.D, o2.D);
      return {
        holds: false,
        reason: vDiff && dDiff
          ? "V and D both differ"
          : vDiff
            ? "V differs (D matched)"
            : "D differs (V matched)",
        infra: false,
      };
    }

    case "MR_AC": {
      // V_ur = V_ub[d ↦ w] ∧ D_ur ⊆ D_ub
      const r = instance.refinement;
      if (!r) {
        return { holds: false, reason: "MR_AC instance is missing its refinement target", infra: false };
      }
      const expected = pointUpdate(o1.V, r.control, r.value);
      const vOk = valuationEqual(o2.V, expected);
      const dOk = dataSubset(o2.D, o1.D);
      if (vOk && dOk) return { holds: true, reason: "V point-updated and D contained", infra: false };
      if (!vOk && !dOk) {
        return { holds: false, reason: "constraint leaked and D not contained", infra: false };
      }
      return {
        holds: false,
        reason: vOk
          ? `D not contained in the base result set (${o1.D.count} → ${o2.D.count})`
          : "V is not the expected point update — an earlier constraint moved",
        infra: false,
      };
    }

    case "CONTEXT_AMNESIA": {
      // ∃c ∈ fp(u1,σ). σ″.V(c) ≠ σ′.V(c), with W(u2) ∩ fp(u1,σ) = ∅.
      const established = source.records[0]?.fp ?? [];
      const laterWrites = new Set(
        followup.records.slice(1).flatMap((r) => r.writeSet ?? []),
      );
      const shouldPersist = established.filter((c) => !laterWrites.has(c));
      const lost = shouldPersist.filter((c) => source.state.V[c] !== followup.state.V[c]);
      return lost.length === 0
        ? { holds: true, reason: "earlier constraints survived", infra: false }
        : { holds: false, reason: `silently lost: ${lost.join(", ")}`, infra: false };
    }
  }
}
