/**
 * Reads control-surface.yaml (Γ_app, proposal §4.10.2) and emits
 * shared/surface.generated.ts.
 *
 * The generated module is committed so that neither the Vite build nor the
 * Cloudflare Worker needs a YAML parser at runtime. Re-run with:
 *
 *   npm run gen:surface
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { z } from "zod/v4";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const SOURCE = resolve(ROOT, "control-surface.yaml");
const TARGET = resolve(ROOT, "shared/surface.generated.ts");

// ── Schema for the YAML itself ───────────────────────────────────────────────

const EnumValue = z.object({
  value: z.union([z.string(), z.number()]),
  phrases: z.array(z.string()).min(1),
});

const Domain = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("enum"), values: z.array(EnumValue).min(1) }),
  z.object({ kind: z.literal("number"), min: z.number(), max: z.number() }),
  z.object({ kind: z.literal("boolean") }),
  z.object({ kind: z.literal("action") }),
]);

const Control = z.object({
  id: z.string(),
  label: z.string(),
  domain: Domain,
  reset: z.union([z.string(), z.number(), z.boolean(), z.null()]),
  constraining: z.boolean(),
  reversible: z.boolean(),
});

const Template = z.object({
  id: z.string(),
  text: z.string(),
  slot: z.string().optional(),
  writes: z.array(z.string()).min(1),
  predicates: z.array(z.enum(["syn", "indep", "refineBase", "rev"])).min(1),
  inverse: z.string().optional(),
  note: z.string().optional(),
});

const RefinementClause = z.object({
  id: z.string(),
  text: z.string(),
  slot: z.string().optional(),
  target: z.string(),
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
  note: z.string().optional(),
});

const SurfaceTransform = z.union([
  z.object({ id: z.string(), kind: z.literal("uppercase"), note: z.string().optional() }),
  z.object({
    id: z.string(),
    kind: z.literal("replacePrefix"),
    from: z.string(),
    to: z.string(),
    note: z.string().optional(),
  }),
  z.object({
    id: z.string(),
    kind: z.literal("append"),
    text: z.string(),
    note: z.string().optional(),
  }),
  z.object({
    id: z.string(),
    kind: z.literal("moveSortClauseFirst"),
    note: z.string().optional(),
  }),
]);

const GoldSynPair = z.object({
  source: z.string(),
  variant: z.string(),
  writes: z.array(z.string()).min(1),
  note: z.string().optional(),
});

const Surface = z.object({
  version: z.number(),
  controls: z.array(Control).min(1),
  templates: z.array(Template),
  refinementClauses: z.array(RefinementClause),
  surfaceTransforms: z.array(SurfaceTransform),
  goldSyn: z.array(GoldSynPair),
});

// ── Load and validate ───────────────────────────────────────────────────────

const raw = readFileSync(SOURCE, "utf8");
const parsed = Surface.safeParse(parse(raw));
if (!parsed.success) {
  console.error("control-surface.yaml failed validation:\n");
  console.error(z.prettifyError(parsed.error));
  process.exit(1);
}
const surface = parsed.data;
const ids = surface.controls.map((c) => c.id);

// ── Referential integrity, so a typo in the YAML fails the build ────────────

const problems: string[] = [];
const seen = new Set<string>();
for (const id of ids) {
  if (seen.has(id)) problems.push(`duplicate control id "${id}"`);
  seen.add(id);
}

const templateIds = new Set(surface.templates.map((t) => t.id));
const byId = new Map(surface.controls.map((c) => [c.id, c]));

const checkWrites = (where: string, writes: string[]) => {
  for (const w of writes) {
    if (!byId.has(w)) problems.push(`${where} writes unknown control "${w}"`);
  }
};

for (const t of surface.templates) {
  checkWrites(`template "${t.id}"`, t.writes);
  if (t.slot && !byId.has(t.slot)) {
    problems.push(`template "${t.id}" has slot for unknown control "${t.slot}"`);
  }
  if (t.slot && !t.writes.includes(t.slot)) {
    problems.push(`template "${t.id}" fills slot "${t.slot}" but does not declare writing it`);
  }
  if (t.text.includes("{value}") && !t.slot) {
    problems.push(`template "${t.id}" interpolates {value} but declares no slot`);
  }
  if (t.slot && !t.text.includes("{value}")) {
    problems.push(`template "${t.id}" declares slot "${t.slot}" but never interpolates {value}`);
  }
  if (t.inverse && !templateIds.has(t.inverse)) {
    problems.push(`template "${t.id}" names unknown inverse "${t.inverse}"`);
  }
  // Rev requires W(u_f) ⊆ C_rev (Eq. 4.17).
  if (t.predicates.includes("rev")) {
    const irreversible = t.writes.filter((w) => byId.get(w)?.reversible === false);
    if (irreversible.length > 0) {
      problems.push(
        `template "${t.id}" supports rev but writes irreversible control(s) ${irreversible.join(", ")}`,
      );
    }
  }
}

for (const clause of surface.refinementClauses) {
  if (!byId.has(clause.target)) {
    problems.push(`refinement clause "${clause.id}" targets unknown control "${clause.target}"`);
  } else if (!byId.get(clause.target)!.constraining) {
    // Refine requires target(δ) ∈ C_con (Eq. 4.12).
    problems.push(
      `refinement clause "${clause.id}" targets "${clause.target}", which is not in C_con`,
    );
  }
  if (!clause.slot && clause.value === undefined) {
    problems.push(`refinement clause "${clause.id}" has neither a slot nor a fixed value`);
  }
}

for (const pair of surface.goldSyn) checkWrites(`goldSyn pair "${pair.source}"`, pair.writes);

if (problems.length > 0) {
  console.error("control-surface.yaml is internally inconsistent:\n");
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

// ── Emit ─────────────────────────────────────────────────────────────────────

// Pretty-printed so the committed generated file stays reviewable and diffs
// cleanly when the YAML changes.
const lit = (v: unknown) => JSON.stringify(v, null, 2);
const union = ids.map((id) => lit(id)).join(" | ");

const out = `/**
 * GENERATED FILE — do not edit.
 *
 * Emitted from control-surface.yaml by scripts/gen-surface.ts.
 * Run \`npm run gen:surface\` after changing the YAML.
 *
 * Encodes Γ_app = ⟨C, Dom, V₀, C_rev, C_con, Templates, Gold_Syn⟩ (§4.10.2).
 */

export const SURFACE_VERSION = ${surface.version};

/** C — the control surface. |C| = ${ids.length} (Appendix A.1). */
export const CONTROL_IDS = ${lit(ids)} as const;
export type ControlId = ${union};

export type ControlValue = string | number | boolean | null;

/** Domains Dom(c). \`phrases[0]\` is the canonical natural-language surface form. */
export type ControlDomain =
  | { kind: "enum"; values: ReadonlyArray<{ value: string | number; phrases: readonly string[] }> }
  | { kind: "number"; min: number; max: number }
  | { kind: "boolean" }
  | { kind: "action" };

export interface ControlSpec {
  id: ControlId;
  label: string;
  domain: ControlDomain;
  /** V₀(c). \`null\` encodes ⊥ (absent/disabled). */
  reset: ControlValue;
  /** Member of C_con — acts as a monotone constraint on the result set. */
  constraining: boolean;
  /** Member of C_rev — can be restored to a previous value. */
  reversible: boolean;
}

export const CONTROLS: Readonly<Record<ControlId, ControlSpec>> = Object.freeze(${lit(
  Object.fromEntries(surface.controls.map((c) => [c.id, c])),
)}) as Readonly<Record<ControlId, ControlSpec>>;

export const CONTROL_LIST: readonly ControlSpec[] = CONTROL_IDS.map((id) => CONTROLS[id]);

/** V₀ — the reset valuation (§4.10.2). */
export const V0: Readonly<Record<ControlId, ControlValue>> = Object.freeze(${lit(
  Object.fromEntries(surface.controls.map((c) => [c.id, c.reset])),
)}) as Readonly<Record<ControlId, ControlValue>>;

/** C_con — constraining controls a refinement clause may target (Eq. 4.12). */
export const C_CON: readonly ControlId[] = ${lit(
  surface.controls.filter((c) => c.constraining).map((c) => c.id),
)};

/** C_rev — controls with a restorable previous value (Eq. 4.17). */
export const C_REV: readonly ControlId[] = ${lit(
  surface.controls.filter((c) => c.reversible).map((c) => c.id),
)};

export type PredicateName = "syn" | "indep" | "refineBase" | "rev";

export interface TemplateSpec {
  id: string;
  text: string;
  slot?: ControlId;
  /** W(u) — the intended write set, fixed before execution (Eq. 4.14). */
  writes: readonly ControlId[];
  predicates: readonly PredicateName[];
  inverse?: string;
  note?: string;
}

export const TEMPLATES: readonly TemplateSpec[] = Object.freeze(${lit(
  surface.templates,
)}) as readonly TemplateSpec[];

export interface RefinementClauseSpec {
  id: string;
  text: string;
  slot?: ControlId;
  target: ControlId;
  value?: string | number | boolean;
  note?: string;
}

export const REFINEMENT_CLAUSES: readonly RefinementClauseSpec[] = Object.freeze(${lit(
  surface.refinementClauses,
)}) as readonly RefinementClauseSpec[];

export type SurfaceTransformSpec =
  | { id: string; kind: "uppercase"; note?: string }
  | { id: string; kind: "replacePrefix"; from: string; to: string; note?: string }
  | { id: string; kind: "append"; text: string; note?: string }
  | { id: string; kind: "moveSortClauseFirst"; note?: string };

export const SURFACE_TRANSFORMS: readonly SurfaceTransformSpec[] = Object.freeze(${lit(
  surface.surfaceTransforms,
)}) as readonly SurfaceTransformSpec[];

export interface GoldSynPair {
  source: string;
  variant: string;
  /** Inherited from the source utterance's label (§4.6). */
  writes: readonly ControlId[];
  note?: string;
}

export const GOLD_SYN: readonly GoldSynPair[] = Object.freeze(${lit(
  surface.goldSyn,
)}) as readonly GoldSynPair[];
`;

mkdirSync(dirname(TARGET), { recursive: true });
writeFileSync(TARGET, out, "utf8");
console.log(
  `shared/surface.generated.ts written — |C| = ${ids.length} (${ids.join(", ")}), ` +
    `${surface.templates.length} templates, ${surface.refinementClauses.length} clauses, ` +
    `${surface.surfaceTransforms.length} transforms, ${surface.goldSyn.length} Gold_Syn pairs`,
);
