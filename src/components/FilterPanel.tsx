import { CONTROLS, type ControlId } from "../../shared/surface.generated.ts";
import type { CategoryValue, SortValue, Valuation } from "../utils/types.ts";

interface Props {
  V: Valuation;
  /** Controls moved by the most recent utterance, highlighted as fp(u,σ). */
  lastFootprint: readonly ControlId[];
  onChange: (next: Valuation) => void;
  onClear: () => void;
}

const enumValues = (control: ControlId) => {
  const domain = CONTROLS[control].domain;
  return domain.kind === "enum" ? domain.values : [];
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The control surface, rendered from the generated Γ_app rather than from
 * hardcoded option lists — so the panel cannot drift from Dom(c).
 */
export function FilterPanel({ V, lastFootprint, onChange, onClear }: Props) {
  const set = <K extends ControlId>(control: K, value: Valuation[K]) =>
    onChange({ ...V, [control]: value });

  const cls = (control: ControlId) =>
    "field-label" + (lastFootprint.includes(control) ? " field-label-touched" : "");

  return (
    <aside className="sidebar">
      <h2>Filters</h2>

      <label className={cls("category")}>
        {CONTROLS.category.label}
        <select
          value={V.category ?? ""}
          onChange={(e) => set("category", (e.target.value || null) as CategoryValue | null)}
        >
          <option value="">All</option>
          {enumValues("category").map((v) => (
            <option key={String(v.value)} value={String(v.value)}>
              {cap(String(v.value))}
            </option>
          ))}
        </select>
      </label>

      <label className={cls("maxPrice")}>
        {CONTROLS.maxPrice.label}
        <input
          type="number"
          min={CONTROLS.maxPrice.domain.kind === "number" ? CONTROLS.maxPrice.domain.min : 0}
          max={CONTROLS.maxPrice.domain.kind === "number" ? CONTROLS.maxPrice.domain.max : 500}
          value={V.maxPrice ?? ""}
          onChange={(e) => set("maxPrice", e.target.value === "" ? null : Number(e.target.value))}
        />
      </label>

      <label className={cls("minRating")}>
        {CONTROLS.minRating.label}
        <select
          value={V.minRating ?? ""}
          onChange={(e) =>
            set("minRating", (e.target.value === "" ? null : Number(e.target.value)) as Valuation["minRating"])
          }
        >
          <option value="">Any</option>
          {enumValues("minRating").map((v) => (
            <option key={String(v.value)} value={String(v.value)}>
              {Number(v.value).toFixed(1)}+
            </option>
          ))}
        </select>
      </label>

      <label className={"checkbox-label" + (lastFootprint.includes("inStockOnly") ? " field-label-touched" : "")}>
        <input
          type="checkbox"
          checked={V.inStockOnly === true}
          onChange={(e) => set("inStockOnly", e.target.checked)}
        />
        {CONTROLS.inStockOnly.label}
      </label>

      <button
        className={"clear-btn" + (lastFootprint.includes("clearFilters") ? " field-label-touched" : "")}
        onClick={onClear}
      >
        {CONTROLS.clearFilters.label}
        {V.clearFilters === "invoked" && <span className="control-flag"> · invoked</span>}
      </button>

      <hr />

      <label className={cls("sort")}>
        {CONTROLS.sort.label}
        <select
          value={V.sort ?? ""}
          onChange={(e) => set("sort", (e.target.value || null) as SortValue | null)}
        >
          <option value="">Default</option>
          {enumValues("sort").map((v) => (
            <option key={String(v.value)} value={String(v.value)}>
              {v.phrases[0]}
            </option>
          ))}
        </select>
      </label>
    </aside>
  );
}
