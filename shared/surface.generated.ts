/**
 * GENERATED FILE — do not edit.
 *
 * Emitted from control-surface.yaml by scripts/gen-surface.ts.
 * Run `npm run gen:surface` after changing the YAML.
 *
 * Encodes Γ_app = ⟨C, Dom, V₀, C_rev, C_con, Templates, Gold_Syn⟩ (§4.10.2).
 */

export const SURFACE_VERSION = 1;

/** C — the control surface. |C| = 6 (Appendix A.1). */
export const CONTROL_IDS = [
  "category",
  "maxPrice",
  "minRating",
  "inStockOnly",
  "sort",
  "clearFilters"
] as const;
export type ControlId = "category" | "maxPrice" | "minRating" | "inStockOnly" | "sort" | "clearFilters";

export type ControlValue = string | number | boolean | null;

/** Domains Dom(c). `phrases[0]` is the canonical natural-language surface form. */
export type ControlDomain =
  | { kind: "enum"; values: ReadonlyArray<{ value: string | number; phrases: readonly string[] }> }
  | { kind: "number"; min: number; max: number }
  | { kind: "boolean" }
  | { kind: "action" };

export interface ControlSpec {
  id: ControlId;
  label: string;
  domain: ControlDomain;
  /** V₀(c). `null` encodes ⊥ (absent/disabled). */
  reset: ControlValue;
  /** Member of C_con — acts as a monotone constraint on the result set. */
  constraining: boolean;
  /** Member of C_rev — can be restored to a previous value. */
  reversible: boolean;
}

export const CONTROLS: Readonly<Record<ControlId, ControlSpec>> = Object.freeze({
  "category": {
    "id": "category",
    "label": "Category",
    "domain": {
      "kind": "enum",
      "values": [
        {
          "value": "electronics",
          "phrases": [
            "electronics"
          ]
        },
        {
          "value": "books",
          "phrases": [
            "books"
          ]
        },
        {
          "value": "clothing",
          "phrases": [
            "clothing"
          ]
        },
        {
          "value": "home",
          "phrases": [
            "home goods"
          ]
        },
        {
          "value": "sports",
          "phrases": [
            "sports gear"
          ]
        }
      ]
    },
    "reset": null,
    "constraining": true,
    "reversible": true
  },
  "maxPrice": {
    "id": "maxPrice",
    "label": "Max Price ($)",
    "domain": {
      "kind": "number",
      "min": 0,
      "max": 500
    },
    "reset": 500,
    "constraining": true,
    "reversible": true
  },
  "minRating": {
    "id": "minRating",
    "label": "Minimum Rating",
    "domain": {
      "kind": "enum",
      "values": [
        {
          "value": 3,
          "phrases": [
            "3 stars"
          ]
        },
        {
          "value": 3.5,
          "phrases": [
            "3.5 stars"
          ]
        },
        {
          "value": 4,
          "phrases": [
            "4 stars"
          ]
        },
        {
          "value": 4.5,
          "phrases": [
            "4.5 stars"
          ]
        }
      ]
    },
    "reset": null,
    "constraining": true,
    "reversible": true
  },
  "inStockOnly": {
    "id": "inStockOnly",
    "label": "In stock only",
    "domain": {
      "kind": "boolean"
    },
    "reset": false,
    "constraining": true,
    "reversible": true
  },
  "sort": {
    "id": "sort",
    "label": "Sort",
    "domain": {
      "kind": "enum",
      "values": [
        {
          "value": "price_asc",
          "phrases": [
            "lowest price first",
            "price low to high"
          ]
        },
        {
          "value": "price_desc",
          "phrases": [
            "highest price first",
            "price high to low"
          ]
        },
        {
          "value": "rating_desc",
          "phrases": [
            "rating",
            "best rated first"
          ]
        },
        {
          "value": "name_asc",
          "phrases": [
            "name",
            "alphabetical order"
          ]
        }
      ]
    },
    "reset": null,
    "constraining": false,
    "reversible": true
  },
  "clearFilters": {
    "id": "clearFilters",
    "label": "Clear Filters",
    "domain": {
      "kind": "action"
    },
    "reset": null,
    "constraining": false,
    "reversible": false
  }
}) as Readonly<Record<ControlId, ControlSpec>>;

export const CONTROL_LIST: readonly ControlSpec[] = CONTROL_IDS.map((id) => CONTROLS[id]);

/** V₀ — the reset valuation (§4.10.2). */
export const V0: Readonly<Record<ControlId, ControlValue>> = Object.freeze({
  "category": null,
  "maxPrice": 500,
  "minRating": null,
  "inStockOnly": false,
  "sort": null,
  "clearFilters": null
}) as Readonly<Record<ControlId, ControlValue>>;

/** C_con — constraining controls a refinement clause may target (Eq. 4.12). */
export const C_CON: readonly ControlId[] = [
  "category",
  "maxPrice",
  "minRating",
  "inStockOnly"
];

/** C_rev — controls with a restorable previous value (Eq. 4.17). */
export const C_REV: readonly ControlId[] = [
  "category",
  "maxPrice",
  "minRating",
  "inStockOnly",
  "sort"
];

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

export const TEMPLATES: readonly TemplateSpec[] = Object.freeze([
  {
    "id": "category.show",
    "text": "show {value} items",
    "slot": "category",
    "writes": [
      "category"
    ],
    "predicates": [
      "syn",
      "indep",
      "refineBase"
    ]
  },
  {
    "id": "category.filter",
    "text": "filter to {value} only",
    "slot": "category",
    "writes": [
      "category"
    ],
    "predicates": [
      "syn",
      "indep",
      "refineBase"
    ]
  },
  {
    "id": "maxPrice.show",
    "text": "show items under ${value}",
    "slot": "maxPrice",
    "writes": [
      "maxPrice"
    ],
    "predicates": [
      "syn",
      "indep",
      "refineBase"
    ]
  },
  {
    "id": "maxPrice.cheaper",
    "text": "show items cheaper than ${value}",
    "slot": "maxPrice",
    "writes": [
      "maxPrice"
    ],
    "predicates": [
      "syn",
      "indep",
      "refineBase"
    ]
  },
  {
    "id": "minRating.show",
    "text": "show items rated {value} and up",
    "slot": "minRating",
    "writes": [
      "minRating"
    ],
    "predicates": [
      "syn",
      "indep",
      "refineBase"
    ]
  },
  {
    "id": "inStockOnly.hide",
    "text": "hide out-of-stock items",
    "writes": [
      "inStockOnly"
    ],
    "predicates": [
      "syn",
      "indep",
      "refineBase",
      "rev"
    ],
    "inverse": "inStockOnly.show"
  },
  {
    "id": "inStockOnly.show",
    "text": "show out-of-stock items again",
    "writes": [
      "inStockOnly"
    ],
    "predicates": [
      "rev"
    ]
  },
  {
    "id": "sort.by",
    "text": "sort by {value}",
    "slot": "sort",
    "writes": [
      "sort"
    ],
    "predicates": [
      "syn",
      "indep"
    ]
  },
  {
    "id": "sort.order",
    "text": "order the results by {value}",
    "slot": "sort",
    "writes": [
      "sort"
    ],
    "predicates": [
      "syn",
      "indep"
    ]
  },
  {
    "id": "clearFilters.all",
    "text": "clear all filters",
    "writes": [
      "category",
      "maxPrice",
      "minRating",
      "inStockOnly",
      "sort",
      "clearFilters"
    ],
    "predicates": [
      "syn"
    ]
  },
  {
    "id": "clearFilters.reset",
    "text": "reset every filter",
    "writes": [
      "category",
      "maxPrice",
      "minRating",
      "inStockOnly",
      "sort",
      "clearFilters"
    ],
    "predicates": [
      "syn"
    ]
  }
]) as readonly TemplateSpec[];

export interface RefinementClauseSpec {
  id: string;
  text: string;
  slot?: ControlId;
  target: ControlId;
  value?: string | number | boolean;
  note?: string;
}

export const REFINEMENT_CLAUSES: readonly RefinementClauseSpec[] = Object.freeze([
  {
    "id": "maxPrice.clause",
    "text": "under ${value}",
    "slot": "maxPrice",
    "target": "maxPrice"
  },
  {
    "id": "minRating.clause",
    "text": "rated {value} and up",
    "slot": "minRating",
    "target": "minRating"
  },
  {
    "id": "inStockOnly.clause",
    "text": "that are in stock",
    "target": "inStockOnly",
    "value": true
  },
  {
    "id": "category.clause",
    "text": "in {value}",
    "slot": "category",
    "target": "category"
  }
]) as readonly RefinementClauseSpec[];

export type SurfaceTransformSpec =
  | { id: string; kind: "uppercase"; note?: string }
  | { id: string; kind: "replacePrefix"; from: string; to: string; note?: string }
  | { id: string; kind: "append"; text: string; note?: string }
  | { id: string; kind: "moveSortClauseFirst"; note?: string };

export const SURFACE_TRANSFORMS: readonly SurfaceTransformSpec[] = Object.freeze([
  {
    "id": "uppercase",
    "kind": "uppercase",
    "note": "Figure 1.2 of the proposal: on this benchmark, uppercasing the utterance induced a spurious minRating >= 4.0 that no utterance requested."
  },
  {
    "id": "synonymPrefix",
    "kind": "replacePrefix",
    "from": "show ",
    "to": "display "
  },
  {
    "id": "formatSuffix",
    "kind": "append",
    "text": " in a table",
    "note": "A presentation request that must not alter any control value."
  },
  {
    "id": "clauseReorder",
    "kind": "moveSortClauseFirst",
    "note": "Reorders clauses within one utterance; still MR_SE, not MR_CA."
  }
]) as readonly SurfaceTransformSpec[];

export interface GoldSynPair {
  source: string;
  variant: string;
  /** Inherited from the source utterance's label (§4.6). */
  writes: readonly ControlId[];
  note?: string;
}

export const GOLD_SYN: readonly GoldSynPair[] = Object.freeze([
  {
    "source": "show electronics under $100 sorted by rating",
    "variant": "list the tech products below $100, best rated first",
    "writes": [
      "category",
      "maxPrice",
      "sort"
    ],
    "note": "Appendix A.4 — the mediator must map \"tech\" onto the electronics category."
  },
  {
    "source": "hide out-of-stock items",
    "variant": "only show me things that are available right now",
    "writes": [
      "inStockOnly"
    ]
  },
  {
    "source": "show books",
    "variant": "I'm looking for something to read",
    "writes": [
      "category"
    ],
    "note": "Indirect phrasing; accepted on review because the target is unambiguous."
  }
]) as readonly GoldSynPair[];
