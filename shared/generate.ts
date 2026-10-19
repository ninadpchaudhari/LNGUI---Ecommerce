/**
 * Template-driven generation G (§4.10.1): builds candidate MR cases from
 * Γ_app (control-surface.yaml, via surface.generated.ts) and selects a frozen
 * test set from them.
 *
 * Every candidate carries a semantic group. Two cases in one group test the
 * same control situation in different words or values, so they are clustered
 * in the analysis rather than counted as independent evidence.
 */
import {
  CONTROLS,
  GOLD_SYN,
  REFINEMENT_CLAUSES,
  SURFACE_TRANSFORMS,
  TEMPLATES,
  V0,
  type ControlId,
  type ControlValue,
  type RefinementClauseSpec,
  type SurfaceTransformSpec,
  type TemplateSpec,
  type Valuation,
} from "./surface.generated.ts";
import { pointUpdate } from "./contract.ts";
import { renderData } from "./transition.ts";
import { validateCase, type MrCase } from "./cases.ts";
import { rng, shuffle } from "./random.ts";

/**
 * Values for numeric slots. Dom(maxPrice) is [0, 500]; these are chosen so
 * each one excludes part of the catalog, since a value that excludes nothing
 * leaves D unchanged and tests only V.
 */
const MAX_PRICE_VALUES = [25, 50, 100, 200] as const;

/** The utterance of Figure 1.2, whose uppercase form set a spurious minRating. */
const FIGURE_1_2 = "show electronics under $100 sorted by rating";

/**
 * Targets of templates without a value slot. The YAML records W(u) for these
 * but not the value they assign, so the generator states it here.
 */
const FIXED_TARGETS: Record<string, Partial<Valuation>> = {
  "inStockOnly.hide": { inStockOnly: true },
  "inStockOnly.show": { inStockOnly: false },
};

interface SlotValue {
  value: ControlValue;
  phrases: readonly string[];
}

/** Dom(c) as fillable values, each with its surface phrases. */
export function slotValues(control: ControlId): SlotValue[] {
  const domain = CONTROLS[control].domain;
  switch (domain.kind) {
    case "enum":
      return domain.values.map((v) => ({ value: v.value, phrases: v.phrases }));
    case "number":
      return MAX_PRICE_VALUES.filter((v) => v >= domain.min && v <= domain.max).map((v) => ({
        value: v,
        phrases: [String(v)],
      }));
    case "boolean":
    case "action":
      return [];
  }
}

/** One filled utterance with its declared target. */
interface Utterance {
  u: string;
  W: ControlId[];
  target: Partial<Valuation>;
  /** Group key fragment, e.g. "category=books". */
  key: string;
  sources: string[];
}

function fill(text: string, phrase: string): string {
  return text.replace("{value}", phrase);
}

/** Every utterance a template yields: one per value and phrase. */
function realize(t: TemplateSpec, phraseIndex: "first" | "all" = "first"): Utterance[] {
  if (!t.slot) {
    const target = FIXED_TARGETS[t.id] ?? {};
    const key = Object.keys(target).length > 0
      ? Object.entries(target).map(([c, v]) => `${c}=${String(v)}`).join(",")
      : t.writes.join("+");
    return [{ u: t.text, W: [...t.writes], target, key, sources: [t.id] }];
  }
  const slot = t.slot;
  return slotValues(slot).flatMap((v) => {
    const phrases = phraseIndex === "all" ? v.phrases : v.phrases.slice(0, 1);
    return phrases.map((p) => ({
      u: fill(t.text, p),
      W: [...t.writes],
      target: { [slot]: v.value } as Partial<Valuation>,
      key: `${slot}=${String(v.value)}`,
      sources: [t.id],
    }));
  });
}

/** A refinement clause, filled. Used by MR_AC (appended) and MR_COMP (as a turn). */
function realizeClause(c: RefinementClauseSpec): Utterance[] {
  if (!c.slot) {
    const value = (c.value ?? null) as ControlValue;
    return [{
      u: c.text,
      W: [c.target],
      target: { [c.target]: value } as Partial<Valuation>,
      key: `${c.target}=${String(value)}`,
      sources: [c.id],
    }];
  }
  const slot = c.slot;
  return slotValues(slot).map((v) => ({
    u: fill(c.text, v.phrases[0]),
    W: [c.target],
    target: { [slot]: v.value } as Partial<Valuation>,
    key: `${slot}=${String(v.value)}`,
    sources: [c.id],
  }));
}

function applyTargets(...targets: Partial<Valuation>[]): Valuation {
  let V = { ...V0 } as Valuation;
  for (const t of targets) {
    for (const [c, v] of Object.entries(t)) V = pointUpdate(V, c as ControlId, v as ControlValue);
  }
  return V;
}

function transform(u: string, t: SurfaceTransformSpec): string | null {
  switch (t.kind) {
    case "uppercase":
      return u.toUpperCase();
    case "replacePrefix":
      return u.startsWith(t.from) ? t.to + u.slice(t.from.length) : null;
    case "append":
      return u + t.text;
    case "moveSortClauseFirst": {
      const m = u.match(/\b(sorted?\s+by\s+[\w\s]+)$/i);
      if (!m) return null;
      const rest = u.replace(m[0], "").replace(/\s+/g, " ").trim();
      return `${m[0]} ${rest}`;
    }
  }
}

const byPredicate = (p: TemplateSpec["predicates"][number]) =>
  TEMPLATES.filter((t) => t.predicates.includes(p));

type Candidate = Omit<MrCase, "id">;

export interface Rejection {
  relation: MrCase["relation"];
  description: string;
  reason: string;
}

export interface Candidates {
  candidates: Candidate[];
  rejected: Rejection[];
}

// ── MR_CE ───────────────────────────────────────────────────────────────────

/**
 * MR_CE cases come in two families, selected and reported separately:
 *
 *   ce:para     the proposal's Para generator: two templates (or two phrases)
 *               for one control and value, plus reviewed Gold_Syn pairs
 *   ce:surface  a fixed surface transform of one utterance (uppercase, verb
 *               swap, presentation suffix, clause move). The proposal names
 *               surface changes as a cause of phrasing sensitivity, and
 *               Figure 1.2 is one. See docs/case-generation.md.
 */
export type CeFamily = "ce:para" | "ce:surface";

function ceCandidates(): Candidate[] {
  const out: Candidate[] = [];
  const mk = (
    a: string,
    b: string,
    W: ControlId[],
    group: string,
    strata: string[],
    generator: MrCase["provenance"]["generator"],
    sources: string[],
    legacyName: string | null = null,
  ): Candidate => ({
    relation: "MR_CE",
    predicate: "Para",
    semanticGroup: `CE:${group}`,
    strata: [generator === "transform" ? "ce:surface" : "ce:para", ...strata],
    legacyName,
    description: `"${a}" ≡ "${b}"`,
    sourceTrace: [a],
    followupTrace: [b],
    writeSets: { source: [W], followup: [W] },
    provenance: { generator, sources },
  });

  const syn = byPredicate("syn");

  // Two templates sharing a target satisfy Para by construction.
  for (let i = 0; i < syn.length; i++) {
    for (let j = i + 1; j < syn.length; j++) {
      const [s, t] = [syn[i], syn[j]];
      if (s.slot !== t.slot || s.writes.join() !== t.writes.join()) continue;
      const left = realize(s);
      const right = realize(t);
      for (const l of left) {
        const r = right.find((x) => x.key === l.key);
        if (!r) continue;
        const strata = ["template-pair", s.slot ? CONTROLS[s.slot].domain.kind : "action"];
        out.push(mk(l.u, r.u, l.W, l.key, strata, "template", [s.id, t.id]));
      }
    }
  }

  // One template, two phrases of the same value (e.g. two sort phrasings).
  for (const t of syn) {
    if (!t.slot) continue;
    for (const v of slotValues(t.slot)) {
      if (v.phrases.length < 2) continue;
      const [a, b] = v.phrases.map((p) => fill(t.text, p));
      out.push(mk(a, b, [...t.writes], `${t.slot}=${String(v.value)}`, ["phrase-pair", "enum"], "template", [t.id]));
    }
  }

  // Surface transforms over single-control utterances.
  const legacy: Record<string, string> = {
    uppercase: "Case Invariance",
    synonymPrefix: "Synonym Prefix",
    formatSuffix: "Format Suffix",
    clauseReorder: "Commutativity",
  };
  for (const t of syn.filter((x) => x.writes.length === 1)) {
    for (const base of realize(t)) {
      for (const tr of SURFACE_TRANSFORMS) {
        const v = transform(base.u, tr);
        if (v === null || v === base.u) continue;
        out.push(mk(base.u, v, base.W, base.key, [`transform:${tr.id}`], "transform", [t.id, tr.id], legacy[tr.id] ?? null));
      }
    }
  }

  // Multi-control utterances in the Figure 1.2 shape, so clause reordering and
  // uppercasing are exercised on the case that motivated the benchmark.
  const sortPhrase = (s: string) =>
    (CONTROLS.sort.domain.kind === "enum"
      ? CONTROLS.sort.domain.values.find((v) => v.value === s)?.phrases[0]
      : undefined) ?? s;
  const composites: Array<{ cat: string; catPhrase: string; price: number; sort: string }> = [
    { cat: "electronics", catPhrase: "electronics", price: 100, sort: "rating_desc" },
    { cat: "books", catPhrase: "books", price: 50, sort: "price_asc" },
    { cat: "clothing", catPhrase: "clothing", price: 100, sort: "name_asc" },
    { cat: "home", catPhrase: "home goods", price: 50, sort: "rating_desc" },
    { cat: "sports", catPhrase: "sports gear", price: 50, sort: "price_desc" },
  ];
  for (const c of composites) {
    const base = `show ${c.catPhrase} under $${c.price} sorted by ${sortPhrase(c.sort)}`;
    const W: ControlId[] = ["category", "maxPrice", "sort"];
    const key = `category=${c.cat},maxPrice=${c.price},sort=${c.sort}`;
    for (const tr of SURFACE_TRANSFORMS) {
      const v = transform(base, tr);
      if (v === null || v === base) continue;
      // Figure 1.2 itself is pinned into every test set (see selectCases).
      const pinned = base === FIGURE_1_2 && tr.kind === "uppercase" ? ["pinned:figure-1.2"] : [];
      out.push(mk(base, v, W, key, ["multi-control", `transform:${tr.id}`, ...pinned], "transform", ["composite", tr.id], legacy[tr.id] ?? null));
    }
  }

  // Human-reviewed pairs.
  for (const g of GOLD_SYN) {
    out.push(mk(g.source, g.variant, [...g.writes], `gold:${g.source}`, ["gold"], "goldSyn", ["goldSyn"]));
  }
  return out;
}

// ── MR_AC ───────────────────────────────────────────────────────────────────

function acCandidates(rejected: Rejection[]): Candidate[] {
  const out: Candidate[] = [];
  for (const t of byPredicate("refineBase")) {
    for (const base of realize(t)) {
      for (const clause of REFINEMENT_CLAUSES) {
        if (base.W.includes(clause.target)) continue;
        for (const delta of realizeClause(clause)) {
          const u = `${base.u} ${delta.u}`;
          // Refinement must actually narrow a non-empty D, otherwise only V is
          // tested and the containment clause holds trivially.
          const Db = renderData(applyTargets(base.target));
          const Dr = renderData(applyTargets(base.target, delta.target));
          if (Dr.count === 0 || Dr.count >= Db.count) {
            rejected.push({
              relation: "MR_AC",
              description: u,
              reason: Dr.count === 0 ? "refined result set is empty" : "refinement does not narrow D",
            });
            continue;
          }
          const value = Object.values(delta.target)[0] as ControlValue;
          out.push({
            relation: "MR_AC",
            predicate: "Refine",
            semanticGroup: `AC:${base.W.join("+")}+${clause.target}`,
            strata: [`base:${base.W.join("+")}`, `delta:${clause.target}`],
            legacyName: null,
            description: `"${u}" refines "${base.u}" with ${clause.target}=${String(value)}`,
            sourceTrace: [base.u],
            followupTrace: [u],
            writeSets: { source: [base.W], followup: [[...base.W, clause.target]] },
            refinement: { control: clause.target, value },
            provenance: { generator: "template", sources: [...base.sources, ...delta.sources] },
          });
        }
      }
    }
  }
  return out;
}

// ── MR_CA ───────────────────────────────────────────────────────────────────

function caCandidates(): Candidate[] {
  const out: Candidate[] = [];
  const utterances = byPredicate("indep").filter((t) => t.writes.length === 1).flatMap((t) => realize(t));
  for (let i = 0; i < utterances.length; i++) {
    for (let j = i + 1; j < utterances.length; j++) {
      const [a, b] = [utterances[i], utterances[j]];
      if (a.W.some((c) => b.W.includes(c))) continue;
      const pair = [a.W[0], b.W[0]].sort().join("|");
      out.push({
        relation: "MR_CA",
        predicate: "Indep",
        semanticGroup: `CA:${pair}`,
        strata: [`pair:${pair}`],
        legacyName: null,
        description: `"${a.u}" and "${b.u}" commute`,
        sourceTrace: [a.u, b.u],
        followupTrace: [b.u, a.u],
        writeSets: { source: [a.W, b.W], followup: [b.W, a.W] },
        provenance: { generator: "template", sources: [...a.sources, ...b.sources] },
      });
    }
  }
  return out;
}

// ── MR_REV ──────────────────────────────────────────────────────────────────

function revCandidates(): Candidate[] {
  const out: Candidate[] = [];
  for (const t of byPredicate("rev")) {
    if (!t.inverse) continue;
    const inv = TEMPLATES.find((x) => x.id === t.inverse);
    if (!inv) continue;
    for (const f of realize(t)) {
      const i = realize(inv)[0];
      out.push({
        relation: "MR_REV",
        predicate: "Rev",
        semanticGroup: `REV:${f.W.join("+")}`,
        strata: [`control:${f.W.join("+")}`],
        legacyName: null,
        description: `"${i.u}" undoes "${f.u}"`,
        sourceTrace: [],
        followupTrace: [f.u, i.u],
        writeSets: { source: [], followup: [f.W, f.W] },
        provenance: { generator: "template", sources: [t.id, inv.id] },
      });
    }
  }
  return out;
}

// ── MR_COMP ─────────────────────────────────────────────────────────────────

function compCandidates(): Candidate[] {
  const out: Candidate[] = [];
  const sortTpl = TEMPLATES.find((t) => t.id === "sort.by");
  const sorts = sortTpl ? realize(sortTpl) : [];

  const mk = (turns: Utterance[], composed: string, strata: string[]): Candidate => {
    const controls = turns.flatMap((t) => t.W);
    return {
      relation: "MR_COMP",
      predicate: "Comp",
      semanticGroup: `COMP:${[...new Set(controls)].join("+")}:${turns.length}`,
      strata,
      legacyName: null,
      description: `${turns.map((t) => `"${t.u}"`).join(" → ")} ≡ "${composed}"`,
      sourceTrace: turns.map((t) => t.u),
      followupTrace: [composed],
      writeSets: { source: turns.map((t) => t.W), followup: [[...new Set(controls)]] },
      provenance: { generator: "template", sources: turns.flatMap((t) => t.sources) },
    };
  };

  for (const t of byPredicate("refineBase").filter((x) => x.slot)) {
    for (const base of realize(t)) {
      for (const clause of REFINEMENT_CLAUSES) {
        if (base.W.includes(clause.target)) continue;
        for (const delta of realizeClause(clause)) {
          // Two turns: base, then the clause on its own.
          out.push(mk([base, delta], `${base.u} ${delta.u}`, ["turns:2"]));
          // Three turns: base, clause, then a sort.
          for (const s of sorts) {
            const sortPhrase = s.u.replace(/^sort by /, "");
            out.push(mk([base, delta, s], `${base.u} ${delta.u} sorted by ${sortPhrase}`, ["turns:3"]));
          }
        }
      }
    }
  }

  // Idempotence: s = ⟨u, u⟩, u_s = u, for absolute single-control utterances.
  for (const t of byPredicate("syn").filter((x) => x.writes.length === 1)) {
    for (const u of realize(t)) {
      out.push({
        relation: "MR_COMP",
        predicate: "Comp (idempotence)",
        semanticGroup: `COMP:idem:${u.W.join("+")}`,
        strata: ["idempotence"],
        legacyName: "Idempotency",
        description: `"${u.u}" twice ≡ once`,
        sourceTrace: [u.u, u.u],
        followupTrace: [u.u],
        writeSets: { source: [u.W, u.W], followup: [u.W] },
        provenance: { generator: "template", sources: u.sources },
      });
    }
  }
  return out;
}

// ── Context amnesia (diagnostic) ────────────────────────────────────────────

function amnesiaCandidates(): Candidate[] {
  const out: Candidate[] = [];
  const sortTpl = TEMPLATES.find((t) => t.id === "sort.by");
  const sorts = sortTpl ? realize(sortTpl) : [];
  for (const t of byPredicate("refineBase").filter((x) => x.slot && x.slot !== "sort")) {
    for (const u1 of realize(t)) {
      for (let i = 0; i + 1 < sorts.length; i++) {
        const fillers = [sorts[i], sorts[i + 1]];
        out.push({
          relation: "CONTEXT_AMNESIA",
          predicate: "Indep (multi-turn)",
          semanticGroup: `CTX:${u1.W.join("+")}`,
          strata: [`control:${u1.W.join("+")}`],
          legacyName: null,
          description: `"${u1.u}" must survive ${fillers.length} unrelated turns`,
          sourceTrace: [u1.u],
          followupTrace: [u1.u, ...fillers.map((f) => f.u)],
          writeSets: { source: [u1.W], followup: [u1.W, ...fillers.map((f) => f.W)] },
          provenance: { generator: "template", sources: [...u1.sources, ...fillers.flatMap((f) => f.sources)] },
        });
      }
    }
  }
  return out;
}

/** Every admissible candidate, plus what was rejected and why. */
export function generateCandidates(): Candidates {
  const rejected: Rejection[] = [];
  const all = [
    ...ceCandidates(),
    ...acCandidates(rejected),
    ...caCandidates(),
    ...revCandidates(),
    ...compCandidates(),
    ...amnesiaCandidates(),
  ];

  // Dedupe on the traces themselves: two constructions can yield one case.
  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  for (const c of all) {
    const key = JSON.stringify([c.relation, c.sourceTrace, c.followupTrace]);
    if (seen.has(key)) continue;
    seen.add(key);
    const problems = validateCase({ ...c, id: "candidate" });
    if (problems.length > 0) {
      rejected.push({ relation: c.relation, description: c.description, reason: problems.join("; ") });
      continue;
    }
    candidates.push(c);
  }
  return { candidates, rejected };
}

export interface SelectOptions {
  seed: number;
  /** Distinct semantic groups per selection pool (see `poolOf`). */
  groups: number;
  /** Cases (wordings or values) per group. */
  perGroup: number;
  relations?: readonly MrCase["relation"][];
}

export interface Selection {
  cases: MrCase[];
  /** Pools with fewer groups than requested, and how many they had. */
  shortfalls: Array<{ pool: string; available: number; requested: number }>;
}

/**
 * Selection pools, in test set order. MR_CE splits into its two families so each
 * gets its own quota and its own report row.
 */
const POOLS: Array<{ pool: string; relation: MrCase["relation"]; prefix: string }> = [
  { pool: "MR_CE:para", relation: "MR_CE", prefix: "CEP" },
  { pool: "MR_CE:surface", relation: "MR_CE", prefix: "CES" },
  { pool: "MR_AC", relation: "MR_AC", prefix: "AC" },
  { pool: "MR_CA", relation: "MR_CA", prefix: "CA" },
  { pool: "CONTEXT_AMNESIA", relation: "CONTEXT_AMNESIA", prefix: "CTX" },
  { pool: "MR_REV", relation: "MR_REV", prefix: "REV" },
  { pool: "MR_COMP", relation: "MR_COMP", prefix: "COMP" },
];

/** The pool a candidate is selected from. */
export function poolOf(c: Pick<MrCase, "relation" | "strata">): string {
  if (c.relation === "MR_CE") return c.strata.includes("ce:surface") ? "MR_CE:surface" : "MR_CE:para";
  return c.relation;
}

/**
 * Seeded, stratified selection: up to `groups` semantic groups per pool,
 * then up to `perGroup` cases inside each. Deterministic for a given seed and
 * candidate set, so a test set can be regenerated and its hash checked.
 *
 * Candidates tagged `pinned:*` are always included, ahead of and in addition
 * to the random quota. Only Figure 1.2 is pinned: a pilot that cannot
 * reproduce the motivating failure cannot test it.
 */
export function selectCases(candidates: readonly Candidate[], opts: SelectOptions): Selection {
  const next = rng(opts.seed);
  const relations = new Set(opts.relations ?? POOLS.map((p) => p.relation));
  const cases: MrCase[] = [];
  const shortfalls: Selection["shortfalls"] = [];

  for (const { pool: poolName, relation, prefix } of POOLS) {
    if (!relations.has(relation)) continue;
    const inPool = candidates.filter((c) => poolOf(c) === poolName);
    const isPinned = (c: Candidate) => c.strata.some((t) => t.startsWith("pinned:"));
    const pool = inPool.filter((c) => !isPinned(c));
    const groups = [...new Set(pool.map((c) => c.semanticGroup))].sort();
    if (groups.length < opts.groups) {
      shortfalls.push({ pool: poolName, available: groups.length, requested: opts.groups });
    }
    const chosen = shuffle(groups, next).slice(0, opts.groups).sort();
    let n = 0;
    for (const m of inPool.filter(isPinned)) {
      n += 1;
      cases.push({ id: `${prefix}-${String(n).padStart(3, "0")}`, ...m });
    }
    for (const g of chosen) {
      const members = shuffle(pool.filter((c) => c.semanticGroup === g), next).slice(0, opts.perGroup);
      for (const m of members) {
        n += 1;
        cases.push({ id: `${prefix}-${String(n).padStart(3, "0")}`, ...m });
      }
    }
  }
  return { cases, shortfalls };
}
