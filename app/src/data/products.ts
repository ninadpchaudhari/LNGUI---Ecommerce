/**
 * Re-export of the shared catalog and the control-surface value lists.
 *
 * The catalog itself moved to `shared/catalog.ts` and the value domains are
 * generated from `control-surface.yaml`, so `CATEGORIES` and `SORT_OPTIONS` are
 * no longer declared in two places. This module exists so existing imports of
 * `../data/products.ts` keep working.
 */
export { products, TOTAL_PRODUCTS, type Product, type Category } from "../../shared/catalog.ts";

import { CATEGORY_VALUES, SORT_VALUES } from "../../shared/surface.generated.ts";

/** Dom(category) minus ⊥. */
export const CATEGORIES = CATEGORY_VALUES;

/** Dom(sort) minus ⊥. */
export const SORT_OPTIONS = SORT_VALUES;

export type SortOption = (typeof SORT_VALUES)[number];
