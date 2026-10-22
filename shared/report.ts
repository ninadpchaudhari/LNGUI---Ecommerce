/**
 * Summaries of a sweep's trial rows, rendered as Markdown, LaTeX or CSV.
 *
 * Infrastructure-failed trials are excluded from every rate and counted in
 * their own column. Averages over cases weight each case equally, which is
 * what fail@k means in Chapter 5; the pooled trial rate is reported beside it.
 */
import type { RelationName } from "./contract.ts";
import type { TrialRow } from "./trials.ts";

/**
 * fail@k from N trials with c failures: the chance that a random k-subset of
 * the N trials contains at least one failure, 1 − C(N−c, k) / C(N, k).
 * Null when k > N.
 */
export function failAtK(n: number, c: number, k: number): number | null {
  if (k > n || n <= 0) return null;
  if (n - c < k) return 1;
  // C(N−c, k) / C(N, k) = ∏_{i=0}^{k−1} (N−c−i) / (N−i), stable for large N.
  let ratio = 1;
  for (let i = 0; i < k; i++) ratio *= (n - c - i) / (n - i);
  return 1 - ratio;
}

/**
 * The row a trial is reported under. MR_CE splits into its two generation
 * families, and context amnesia is reported under MR_CA, as in
 * Table 4.3, rather than as a sixth relation.
 */
export function reportGroup(r: { relation: RelationName; strata: readonly string[] }): string {
  if (r.relation === "MR_CE") return r.strata.includes("ce:surface") ? "MR_CE (surface)" : "MR_CE (para)";
  if (r.relation === "CONTEXT_AMNESIA") return "MR_CA (context amnesia)";
  return r.relation;
}

const GROUP_ORDER = [
  "MR_CE (para)",
  "MR_CE (surface)",
  "MR_AC",
  "MR_CA",
  "MR_CA (context amnesia)",
  "MR_REV",
  "MR_COMP",
];

const groupRank = (g: string): number => {
  const i = GROUP_ORDER.indexOf(g);
  return i === -1 ? GROUP_ORDER.length : i;
};

/**
 * What produced the rows, for labelling a report: the local parser, a model,
 * or both. Null when no row records its mode (trials from before it was saved).
 */
export function runModeLabel(rows: readonly Pick<TrialRow, "mode">[]): string | null {
  const modes = new Set(rows.map((r) => r.mode).filter((m) => m !== undefined));
  if (modes.size === 0) return null;
  if (modes.size > 1) return "mixed: dry run and LLM";
  return modes.has("local-test") ? "dry run — local parser" : "LLM";
}

/** The default report title, with the run mode so a dry run cannot pass for a model run. */
export function reportTitle(runId: string, rows: readonly Pick<TrialRow, "mode">[]): string {
  const label = runModeLabel(rows);
  return `MR results, ${runId}${label ? ` (${label})` : ""}`;
}

export interface CaseStat {
  conditionId: string;
  caseId: string;
  relation: RelationName;
  /** Report row, from `reportGroup`. */
  group: string;
  semanticGroup: string;
  n: number;
  fails: number;
  infra: number;
  /** First trial (round) that failed, or null if none did within N. */
  firstFailure: number | null;
  firstFailureReason: string | null;
  overReachTrials: number;
  tokens: number;
}

export function caseStats(rows: readonly TrialRow[]): CaseStat[] {
  const byCase = new Map<string, TrialRow[]>();
  for (const r of rows) {
    const key = `${r.conditionId}|${r.caseId}`;
    byCase.set(key, [...(byCase.get(key) ?? []), r]);
  }
  const stats: CaseStat[] = [];
  for (const trials of byCase.values()) {
    const sorted = [...trials].sort((a, b) => a.trial - b.trial);
    const valid = sorted.filter((t) => t.status !== "infra");
    const firstFail = valid.find((t) => t.status === "fail");
    const head = sorted[0];
    stats.push({
      conditionId: head.conditionId,
      caseId: head.caseId,
      relation: head.relation,
      group: reportGroup(head),
      semanticGroup: head.semanticGroup,
      n: valid.length,
      fails: valid.filter((t) => t.status === "fail").length,
      infra: sorted.length - valid.length,
      firstFailure: firstFail?.trial ?? null,
      firstFailureReason: firstFail?.reason ?? null,
      overReachTrials: valid.filter((t) => t.overReach).length,
      tokens: sorted.reduce((s, t) => s + (t.tokens ?? 0), 0),
    });
  }
  return stats;
}

export interface Column {
  key: string;
  label: string;
  /** LaTeX header, when it differs from the plain label. */
  latex?: string;
  numeric: boolean;
}

export interface Table {
  title: string;
  columns: Column[];
  rows: Array<Record<string, string>>;
}

const mean = (xs: number[]): number | null => (xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length);
const fmt = (x: number | null, digits = 2): string => (x === null ? "—" : x.toFixed(digits));
const pct = (x: number | null): string => (x === null ? "—" : `${(x * 100).toFixed(1)}%`);

function orderedConditions(rows: readonly { conditionId: string }[]): string[] {
  return [...new Set(rows.map((r) => r.conditionId))];
}

/** One row per condition × report group. */
export function summaryTable(rows: readonly TrialRow[], ks: readonly number[], title: string): Table {
  const stats = caseStats(rows);
  const columns: Column[] = [
    { key: "condition", label: "Condition", numeric: false },
    { key: "mr", label: "MR", numeric: false },
    { key: "cases", label: "Cases", numeric: true },
    { key: "groups", label: "Groups", numeric: true },
    { key: "trials", label: "Trials", numeric: true },
    { key: "infra", label: "Infra", numeric: true },
    { key: "rate", label: "Fail rate", numeric: true },
    { key: "split", label: "Pass / Int. / Fail", numeric: false },
    ...ks.map((k) => ({ key: `f${k}`, label: `fail@${k}`, latex: `fail@${k}`, numeric: true })),
    { key: "h2", label: "fail@3 (failed ≥1)", latex: "fail@3 (failed $\\geq$1)", numeric: true },
    { key: "overreach", label: "Over-reach", numeric: true },
    { key: "tokens", label: "Tokens", numeric: true },
  ];

  const out: Table["rows"] = [];
  const groups = [...new Set(stats.map((s) => s.group))].sort((a, b) => groupRank(a) - groupRank(b) || a.localeCompare(b));
  for (const cond of orderedConditions(stats)) {
    for (const rel of groups) {
      const group = stats.filter((s) => s.conditionId === cond && s.group === rel);
      if (group.length === 0) continue;
      const trials = group.reduce((s, c) => s + c.n, 0);
      const failures = group.reduce((s, c) => s + c.fails, 0);
      const allPass = group.filter((c) => c.fails === 0).length;
      const allFail = group.filter((c) => c.n > 0 && c.fails === c.n).length;
      const row: Record<string, string> = {
        condition: cond,
        mr: rel,
        cases: String(group.length),
        groups: String(new Set(group.map((c) => c.semanticGroup)).size),
        trials: String(trials),
        infra: String(group.reduce((s, c) => s + c.infra, 0)),
        rate: pct(trials === 0 ? null : failures / trials),
        split: `${allPass} / ${group.length - allPass - allFail} / ${allFail}`,
        h2: fmt(mean(
          group.filter((c) => c.fails > 0).map((c) => failAtK(c.n, c.fails, 3)).filter((x): x is number => x !== null),
        )),
        overreach: pct(trials === 0 ? null : group.reduce((s, c) => s + c.overReachTrials, 0) / trials),
        tokens: String(group.reduce((s, c) => s + c.tokens, 0)),
      };
      for (const k of ks) {
        row[`f${k}`] = fmt(mean(group.map((c) => failAtK(c.n, c.fails, k)).filter((x): x is number => x !== null)));
      }
      out.push(row);
    }
  }
  return { title, columns, rows: out };
}

/** One row per condition × case, for debugging a run. */
export function caseTable(rows: readonly TrialRow[], ks: readonly number[], title: string): Table {
  const stats = caseStats(rows).sort((a, b) =>
    a.conditionId.localeCompare(b.conditionId) ||
    groupRank(a.group) - groupRank(b.group) ||
    a.caseId.localeCompare(b.caseId),
  );
  return {
    title,
    columns: [
      { key: "condition", label: "Condition", numeric: false },
      { key: "case", label: "Case", numeric: false },
      { key: "mr", label: "MR", numeric: false },
      { key: "group", label: "Group", numeric: false },
      { key: "cn", label: "c / N", numeric: true },
      ...ks.map((k) => ({ key: `f${k}`, label: `fail@${k}`, numeric: true })),
      { key: "first", label: "First fail", numeric: true },
      { key: "reason", label: "First failure reason", numeric: false },
    ],
    rows: stats.map((s) => {
      const row: Record<string, string> = {
        condition: s.conditionId,
        case: s.caseId,
        mr: s.group,
        group: s.semanticGroup,
        cn: `${s.fails} / ${s.n}`,
        // Right-censored: no failure within N is "not observed", not "never".
        first: s.firstFailure === null ? `>${s.n}` : String(s.firstFailure),
        reason: s.firstFailureReason ?? "",
      };
      for (const k of ks) row[`f${k}`] = fmt(failAtK(s.n, s.fails, k));
      return row;
    }),
  };
}

// ── Rendering ───────────────────────────────────────────────────────────────

export type Format = "md" | "latex" | "csv";

function markdown(t: Table): string {
  const widths = t.columns.map((c) =>
    Math.max(c.label.length, ...t.rows.map((r) => (r[c.key] ?? "").length)),
  );
  const line = (cells: string[]) => `| ${cells.map((c) => c.replace(/\|/g, "\\|")).join(" | ")} |`;
  const pad = (s: string, w: number, right: boolean) => (right ? s.padStart(w) : s.padEnd(w));
  return [
    line(t.columns.map((c, i) => pad(c.label, widths[i], false))),
    line(t.columns.map((c, i) => (c.numeric ? "-".repeat(widths[i] - 1) + ":" : "-".repeat(widths[i])))),
    ...t.rows.map((r) => line(t.columns.map((c, i) => pad(r[c.key] ?? "", widths[i], c.numeric)))),
  ].join("\n");
}

export function latexEscape(s: string): string {
  return s
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/([&%$#_{}])/g, "\\$1")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}")
    .replace(/≥/g, "$\\geq$")
    .replace(/→/g, "$\\rightarrow$")
    .replace(/—/g, "---");
}

/** MR_CE (surface) → $MR_{CE}$ (surface), matching the proposal's notation. */
function latexCell(key: string, value: string): string {
  const m = key === "mr" ? value.match(/^MR_([A-Z]+)(.*)$/) : null;
  if (m) return `$MR_{${m[1]}}$${latexEscape(m[2])}`;
  return latexEscape(value);
}

function latex(t: Table): string {
  const spec = t.columns.map((c) => (c.numeric ? "r" : "l")).join("");
  return [
    "% Requires \\usepackage{booktabs}. Generated by scripts/report.ts.",
    "\\begin{table}[ht]",
    "\\centering",
    "\\small",
    `\\caption{${latexEscape(t.title)}}`,
    `\\begin{tabular}{${spec}}`,
    "\\toprule",
    t.columns.map((c) => c.latex ?? latexEscape(c.label)).join(" & ") + " \\\\",
    "\\midrule",
    ...t.rows.map((r) => t.columns.map((c) => latexCell(c.key, r[c.key] ?? "")).join(" & ") + " \\\\"),
    "\\bottomrule",
    "\\end{tabular}",
    "\\end{table}",
  ].join("\n");
}

function csvCell(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csv(t: Table): string {
  return [
    t.columns.map((c) => csvCell(c.label)).join(","),
    ...t.rows.map((r) => t.columns.map((c) => csvCell(r[c.key] ?? "")).join(",")),
  ].join("\n");
}

export function render(t: Table, format: Format): string {
  switch (format) {
    case "md":
      return markdown(t);
    case "latex":
      return latex(t);
    case "csv":
      return csv(t);
  }
}
