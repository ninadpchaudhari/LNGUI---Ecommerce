import type { Category, SortOption } from "../data/products.ts";

export interface CommandFilters {
  category: Category | null;
  maxPrice: number | null;
  minRating: number | null;
  inStockOnly: boolean | null;
}

export interface Command {
  filters: CommandFilters;
  sort: SortOption | null;
  explanation: string;
}

export interface UISnapshot {
  category: Category | null;
  maxPrice: number;
  minRating: number | null;
  inStockOnly: boolean;
  sort: SortOption | null;
  resultingProductIds: number[];
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export type MetamorphicVerdict = "PASS" | "FAIL" | "WEAK_PASS" | "SKIPPED";

export interface MetamorphicResult {
  relation: string;
  basePrompt: string;
  variantPrompt: string;
  baseCommand: Command | null;
  variantCommand: Command | null;
  baseSnapshot: UISnapshot | null;
  variantSnapshot: UISnapshot | null;
  verdict: MetamorphicVerdict;
  reason: string;
  run: number;
}

export interface LogEntry {
  timestamp: string;
  basePrompt: string;
  relationName: string;
  variantPrompt: string;
  returnedCommand: Command | null;
  uiSnapshot: UISnapshot | null;
  verdict: MetamorphicVerdict | "COMMAND";
  reason: string;
}
