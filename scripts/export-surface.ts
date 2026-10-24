/**
 * Writes this subject's surface description as JSON, for lngui-explorer.
 *
 *   npm run export:surface -- [out.json]      (default ./surface.json)
 *
 * Additive: reads shared/surface.generated.ts and the case schema, changes
 * nothing. The shape is lngui/docs/FORMATS.md section 6. Enum values are
 * written as plain values; their phrases go in the sibling `phrases` map.
 * `sha256` is the hash of control-surface.yaml, the file the generated
 * module came from.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { caseSchema } from "../shared/cases.ts";
import {
  CONTROL_LIST,
  GOLD_SYN,
  REFINEMENT_CLAUSES,
  SURFACE_TRANSFORMS,
  TEMPLATES,
} from "../shared/surface.generated.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// npm runs scripts from the package root; resolve a relative path against where it was typed.
const out = resolve(process.env.INIT_CWD ?? process.cwd(), process.argv[2] ?? "surface.json");

const yaml = readFileSync(resolve(ROOT, "control-surface.yaml"));
const phrases: Record<string, Record<string, string[]>> = {};

const surface = {
  subject: "ecommerce",
  sha256: createHash("sha256").update(yaml).digest("hex"),
  controls: CONTROL_LIST.map((c) => {
    if (c.domain.kind === "enum") {
      phrases[c.id] = Object.fromEntries(c.domain.values.map((v) => [String(v.value), [...v.phrases]]));
    }
    return {
      id: c.id,
      label: c.label,
      device: null,
      area: null,
      domain: c.domain.kind === "enum" ? { kind: "enum", values: c.domain.values.map((v) => v.value) } : c.domain,
      reset: c.reset,
      constraining: c.constraining,
      reversible: c.reversible,
    };
  }),
  devices: [],
  areas: {},
  relations: [...caseSchema.shape.relation.options],
  templates: TEMPLATES.map((t) => ({ id: t.id, text: t.text, slot: t.slot ?? null, writes: [...t.writes] })),
  refinementClauses: REFINEMENT_CLAUSES.map((r) => ({
    id: r.id,
    text: r.text,
    slot: r.slot ?? null,
    target: r.target,
    ...(r.value !== undefined ? { value: r.value } : {}),
  })),
  surfaceTransforms: SURFACE_TRANSFORMS.map(({ note: _note, ...t }) => t),
  goldPairs: GOLD_SYN.map((g) => ({ source: g.source, variant: g.variant, writes: [...g.writes] })),
  phrases,
};

writeFileSync(out, JSON.stringify(surface, null, 2) + "\n");
console.error(`wrote ${out}`);
