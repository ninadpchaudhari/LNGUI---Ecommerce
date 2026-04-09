import type { Command, UISnapshot, MetamorphicResult, MetamorphicVerdict } from "./types.ts";
import type { Filters } from "./filterSort.ts";
import { products } from "../data/products.ts";
import { filterProducts, sortProducts, DEFAULT_FILTERS } from "./filterSort.ts";
import { sendCommand } from "./api.ts";
import { addLog } from "./logging.ts";

// ── Snapshot helpers ──

function snapshotFromCommand(cmd: Command): UISnapshot {
  const filters: Filters = {
    category: cmd.filters.category ?? DEFAULT_FILTERS.category,
    maxPrice: cmd.filters.maxPrice ?? DEFAULT_FILTERS.maxPrice,
    minRating: cmd.filters.minRating ?? DEFAULT_FILTERS.minRating,
    inStockOnly: cmd.filters.inStockOnly ?? DEFAULT_FILTERS.inStockOnly,
  };
  const sorted = sortProducts(filterProducts(products, filters), cmd.sort ?? null);
  return {
    ...filters,
    sort: cmd.sort ?? null,
    resultingProductIds: sorted.map((p) => p.id),
  };
}

function compareSnapshots(a: UISnapshot, b: UISnapshot): MetamorphicVerdict {
  const idsMatch = a.resultingProductIds.join(",") === b.resultingProductIds.join(",");
  const exactMatch =
    a.category === b.category &&
    a.maxPrice === b.maxPrice &&
    a.minRating === b.minRating &&
    a.inStockOnly === b.inStockOnly &&
    a.sort === b.sort;

  if (exactMatch && idsMatch) return "PASS";
  if (idsMatch) return "WEAK_PASS";
  return "FAIL";
}

// ── Single prompt runner ──

async function run(prompt: string): Promise<{ cmd: Command; snap: UISnapshot }> {
  const cmd = await sendCommand(prompt);
  return { cmd, snap: snapshotFromCommand(cmd) };
}

function fail(relation: string, base: string, variant: string, msg: string, runIdx: number): MetamorphicResult {
  return {
    relation, basePrompt: base, variantPrompt: variant,
    baseCommand: null, variantCommand: null,
    baseSnapshot: null, variantSnapshot: null,
    verdict: "FAIL", reason: `Error: ${msg}`, run: runIdx,
  };
}

// ── Relations ──

async function caseInvariance(base: string, runIdx: number): Promise<MetamorphicResult> {
  const variant = base.toUpperCase();
  try {
    const [a, b] = await Promise.all([run(base), run(variant)]);
    const verdict = compareSnapshots(a.snap, b.snap);
    return {
      relation: "Case Invariance", basePrompt: base, variantPrompt: variant,
      baseCommand: a.cmd, variantCommand: b.cmd,
      baseSnapshot: a.snap, variantSnapshot: b.snap, verdict,
      reason: verdict === "PASS" ? "Identical output" : verdict === "WEAK_PASS" ? "Same IDs, minor filter diff" : "Different results for case change",
      run: runIdx,
    };
  } catch (e: unknown) { return fail("Case Invariance", base, variant, (e as Error).message, runIdx); }
}

async function synonymPrefix(base: string, runIdx: number): Promise<MetamorphicResult> {
  const variant = base.toLowerCase().startsWith("show ")
    ? "display " + base.slice(5)
    : "display " + base;
  try {
    const [a, b] = await Promise.all([run(base), run(variant)]);
    const verdict = compareSnapshots(a.snap, b.snap);
    return {
      relation: "Synonym Prefix", basePrompt: base, variantPrompt: variant,
      baseCommand: a.cmd, variantCommand: b.cmd,
      baseSnapshot: a.snap, variantSnapshot: b.snap, verdict,
      reason: verdict === "PASS" ? "Synonym treated equally" : verdict === "WEAK_PASS" ? "Same IDs, minor filter diff" : "Different results for synonym",
      run: runIdx,
    };
  } catch (e: unknown) { return fail("Synonym Prefix", base, variant, (e as Error).message, runIdx); }
}

async function formatSuffix(base: string, runIdx: number): Promise<MetamorphicResult> {
  const variant = base + " in a table";
  try {
    const [a, b] = await Promise.all([run(base), run(variant)]);
    const verdict = compareSnapshots(a.snap, b.snap);
    return {
      relation: "Format Suffix", basePrompt: base, variantPrompt: variant,
      baseCommand: a.cmd, variantCommand: b.cmd,
      baseSnapshot: a.snap, variantSnapshot: b.snap, verdict,
      reason: verdict === "PASS" ? "Format suffix ignored" : verdict === "WEAK_PASS" ? "Same IDs, minor filter diff" : "Format suffix altered results",
      run: runIdx,
    };
  } catch (e: unknown) { return fail("Format Suffix", base, variant, (e as Error).message, runIdx); }
}

async function idempotency(base: string, runIdx: number): Promise<MetamorphicResult> {
  try {
    const a = await run(base);
    const b = await run(base);
    const verdict = compareSnapshots(a.snap, b.snap);
    return {
      relation: "Idempotency", basePrompt: base, variantPrompt: base,
      baseCommand: a.cmd, variantCommand: b.cmd,
      baseSnapshot: a.snap, variantSnapshot: b.snap, verdict,
      reason: verdict === "PASS" ? "Deterministic" : verdict === "WEAK_PASS" ? "Same IDs, minor filter diff" : "Non-deterministic",
      run: runIdx,
    };
  } catch (e: unknown) { return fail("Idempotency", base, base, (e as Error).message, runIdx); }
}

async function commutativity(base: string, runIdx: number): Promise<MetamorphicResult> {
  const sortPattern = /\b(sorted?\s+by\s+\w+)/i;
  const match = base.match(sortPattern);
  if (!match) {
    return {
      relation: "Commutativity", basePrompt: base, variantPrompt: "",
      baseCommand: null, variantCommand: null,
      baseSnapshot: null, variantSnapshot: null,
      verdict: "SKIPPED", reason: "No sort clause detected", run: runIdx,
    };
  }
  const clause = match[0];
  const rest = base.replace(sortPattern, "").replace(/\s+/g, " ").trim();
  const variant = clause + " " + rest;
  try {
    const [a, b] = await Promise.all([run(base), run(variant)]);
    const verdict = compareSnapshots(a.snap, b.snap);
    return {
      relation: "Commutativity", basePrompt: base, variantPrompt: variant,
      baseCommand: a.cmd, variantCommand: b.cmd,
      baseSnapshot: a.snap, variantSnapshot: b.snap, verdict,
      reason: verdict === "PASS" ? "Order irrelevant" : verdict === "WEAK_PASS" ? "Same IDs, minor filter diff" : "Clause order changed results",
      run: runIdx,
    };
  } catch (e: unknown) { return fail("Commutativity", base, variant, (e as Error).message, runIdx); }
}

const RELATIONS = [caseInvariance, synonymPrefix, formatSuffix, idempotency, commutativity];
export const RELATION_NAMES = ["Case Invariance", "Synonym Prefix", "Format Suffix", "Idempotency", "Commutativity"];

export async function runAllRelations(
  basePrompt: string,
  repeatCount: number,
  onResult: (r: MetamorphicResult) => void,
): Promise<MetamorphicResult[]> {
  const all: MetamorphicResult[] = [];
  for (let i = 0; i < repeatCount; i++) {
    for (const rel of RELATIONS) {
      const result = await rel(basePrompt, i + 1);
      all.push(result);
      onResult(result);
      addLog({
        timestamp: new Date().toISOString(),
        basePrompt: result.basePrompt,
        relationName: result.relation,
        variantPrompt: result.variantPrompt,
        returnedCommand: result.variantCommand,
        uiSnapshot: result.variantSnapshot,
        verdict: result.verdict,
        reason: result.reason,
      });
    }
  }
  return all;
}
