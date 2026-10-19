/**
 * The experiment workbench: choose a frozen test set, choose conditions, then
 * either copy the experiment file for the CLI or run it here.
 *
 * Everything on this page uses the same modules as scripts/: the case
 * validator (shared/cases.ts), the experiment schema
 * (shared/experiment.ts), the sweep engine (utils/sweep.ts) and the report
 * (shared/report.ts). A browser run and a CLI run of one experiment file go
 * through identical code apart from the transport.
 *
 * A condition states every setting that defines P. Settings it leaves out
 * take their code default, and an unset temperature or top_p is not sent, so
 * the provider's default for the model applies. The server's .env never
 * fills a gap (shared/overrides.ts).
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { AppConfig } from "../../shared/contract.ts";
import { parseCasesJsonl, toJsonl, type MrCase } from "../../shared/cases.ts";
import { experimentSchema, type CasesManifest } from "../../shared/experiment.ts";
import { caseTable, render, reportGroup, summaryTable, type Format, type Table } from "../../shared/report.ts";
import { parseTrialsJsonl, type TrialRow } from "../../shared/trials.ts";
import { summarizeSuite, type SuiteRow } from "../../shared/suite-summary.ts";
import { LANGFUSE_HEADER, type Overrides } from "../../shared/overrides.ts";
import { PROMPT_NAME_RE, normalizePrompt, promptHash, promptSha256 } from "../../shared/prompt-text.ts";
import { adhocCases } from "../utils/relations.ts";
import { saveTurn } from "../utils/api.ts";
import { downloadFile } from "../utils/logging.ts";
import {
  memorySink,
  openCondition,
  plannedInvocations,
  runSweep,
  type Condition,
  type ConditionRuntime,
  type Transport,
} from "../utils/sweep.ts";
import pilotText from "../../cases/pilot.jsonl?raw";

// ── Helpers ─────────────────────────────────────────────────────────────────

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const fmt = (n: number) => n.toLocaleString("en-US");
const slug = (s: string) => s.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "");
const shortModel = (m: string) => slug(m.split("/").pop()!.replace(/:/g, "-"));
const parseList = (s: string) => s.split(",").map((t) => t.trim()).filter(Boolean);
const newSeed = () => 100000 + Math.floor(Math.random() * 900000);

/** A model choice: which provider serves it, and the provider's model id. */
interface ModelChoice {
  provider: "openrouter" | "ollama";
  model: string;
}
const keyOf = (m: ModelChoice) => `${m.provider}:${m.model}`;

function countByGroup(cases: readonly MrCase[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of cases) out[reportGroup(c)] = (out[reportGroup(c)] ?? 0) + 1;
  return out;
}

async function copyText(text: string, onDone: (msg: string) => void) {
  try {
    await navigator.clipboard.writeText(text);
    onDone("Copied.");
  } catch {
    onDone("Copy failed. Select the text and copy it by hand.");
  }
}

/** A small (i) that explains a field on hover or keyboard focus. */
function Help({ children }: { children: ReactNode }) {
  const id = useId();
  const anchor = useRef<HTMLSpanElement>(null);
  const tip = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  useLayoutEffect(() => {
    if (!open || !anchor.current || !tip.current) return;
    const rect = anchor.current.getBoundingClientRect();
    const box = tip.current.getBoundingClientRect();
    const left = Math.max(12, Math.min(rect.left + rect.width / 2 - box.width / 2, window.innerWidth - box.width - 12));
    const top = rect.top - box.height - 6 >= 8 ? rect.top - box.height - 6 : rect.bottom + 6;
    setPosition({ top, left });
  }, [open, children]);

  return (
    <span ref={anchor} className="xp-help" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        className="xp-help-btn"
        aria-describedby={id}
        aria-label="What is this?"
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >i</button>
      {open && createPortal(
        <span ref={tip} role="tooltip" id={id} className="xp-help-tip" style={{ top: position.top, left: position.left }}>{children}</span>,
        document.body,
      )}
    </span>
  );
}

function ShortHash({ value }: { value?: string }) {
  return <code className="xp-hash" title={value || undefined} aria-label="SHA-256 fingerprint">SHA-256 {value ? value.slice(0, 7) : "pending"}</code>;
}

function Field({ label, help, children }: { label: ReactNode; help?: ReactNode; children: ReactNode }) {
  return (
    <label className="xp-f">
      <span className="xp-f-label">{label}{help && <Help>{help}</Help>}</span>
      {children}
    </label>
  );
}

function TableView({ table }: { table: Table }) {
  return (
    <div className="xp-scroll">
      <table className="xp-table">
        <thead>
          <tr>{table.columns.map((c) => <th key={c.key} className={c.numeric ? "num" : ""}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {table.rows.map((r, i) => (
            <tr key={i}>{table.columns.map((c) => <td key={c.key} className={c.numeric ? "num" : ""}>{r[c.key]}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The test set by report row, each row expandable into the operators behind it. */
function SuiteTable({ rows }: { rows: SuiteRow[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const flip = (g: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });
  const total = (k: "cases" | "utterances") => rows.reduce((s, r) => s + r[k], 0);
  return (
    <div className="xp-scroll">
      <table className="xp-table xp-suite">
        <thead>
          <tr>
            <th>Metamorphic relation</th>
            <th>Relation name / examples</th>
            <th className="num">Test cases <Help>Each metamorphic test case fixes an initial state, a source trace and a follow-up trace.</Help></th>
            <th className="num">Utterances (N = 1) <Help>Total utterances across the source and follow-up traces, executing each test case in this row once under one condition. Each test case is repeated N times.</Help></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isOpen = open.has(r.group);
            return [
              <tr key={r.group} className="xp-suite-row">
                <td>
                  <button type="button" className="xp-expand" aria-expanded={isOpen} onClick={() => flip(r.group)}>
                    <span aria-hidden="true">{isOpen ? "▾" : "▸"}</span> {r.group}
                  </button>
                </td>
                <td className="xp-dim">{r.checks}</td>
                <td className="num">{r.cases}</td>
                <td className="num">{r.utterances}</td>
              </tr>,
              ...(isOpen
                ? r.operators.map((o) => (
                    <tr key={`${r.group}/${o.key}`} className="xp-op-row">
                      <td className="xp-op-name">{o.label}</td>
                      <td className="xp-dim">
                        <div>{o.help}</div>
                        <div className="xp-trace-example"><b>Source trace:</b> {o.example.sourceTrace.map((u) => `“${u}”`).join(" → ") || "Initial state (σ₀)"}</div>
                        <div className="xp-trace-example"><b>Follow-up trace:</b> {o.example.followupTrace.map((u) => `“${u}”`).join(" → ") || "Initial state (σ₀)"}</div>
                      </td>
                      <td className="num">{o.cases}</td>
                      <td></td>
                    </tr>
                  ))
                : []),
            ];
          })}
          <tr className="xp-total">
            <td>Total</td>
            <td></td>
            <td className="num">{total("cases")}</td>
            <td className="num">{total("utterances")}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/**
 * Every prompts/*.txt in the repo, bundled when the page is built. These are
 * the prompts an experiment can reference by file, so they are read-only here.
 * The default comes first.
 */
const COMMITTED_PROMPTS: PromptEntry[] = Object.entries(
  import.meta.glob("../../prompts/*.txt", { query: "?raw", import: "default", eager: true }) as Record<string, string>,
)
  .map(([path, text]) => ({ name: path.split("/").pop()!.replace(/\.txt$/, ""), text: normalizePrompt(text) }))
  .sort((a, b) => (a.name === "default" ? -1 : b.name === "default" ? 1 : a.name.localeCompare(b.name)));
const COMMITTED_NAMES = new Set(COMMITTED_PROMPTS.map((p) => p.name));
const DEFAULT_TEXT = COMMITTED_PROMPTS.find((p) => p.name === "default")!.text;

/** A system prompt the experiment can use. The text is sent exactly as written. */
interface PromptEntry {
  name: string;
  text: string;
}

/** A condition as the page holds it: settings plus the prompt it runs under. */
interface PageCondition {
  id: string;
  env: Overrides;
  prompt: { name: string; text: string };
}

/** What the sweep engine and the server see: the prompt text rides in the overrides. */
const toEngine = (c: PageCondition): Condition => ({ id: c.id, env: { ...c.env, SYSTEM_PROMPT: c.prompt.text } });

/** Lines added and removed against another text, ignoring order. */
function lineDiff(base: string, text: string): { added: number; removed: number } {
  const count = (t: string) => t.split("\n").reduce<Map<string, number>>((m, l) => m.set(l, (m.get(l) ?? 0) + 1), new Map());
  const a = count(base);
  const b = count(text);
  let added = 0;
  let removed = 0;
  for (const [l, n] of b) added += Math.max(0, n - (a.get(l) ?? 0));
  for (const [l, n] of a) removed += Math.max(0, n - (b.get(l) ?? 0));
  return { added, removed };
}

const uniqueName = (taken: string[], want: string) => {
  const base = want.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "prompt";
  if (!taken.includes(base)) return base;
  let i = 2;
  while (taken.includes(`${base}-${i}`)) i += 1;
  return `${base}-${i}`;
};

// ── Page ────────────────────────────────────────────────────────────────────

const PILOT = parseCasesJsonl(pilotText);
const PILOT_UTTERANCES = [...new Set(PILOT.cases.flatMap((c) => [...c.sourceTrace, ...c.followupTrace]))];
const PILOT_UTTERANCE_SET = new Set(PILOT_UTTERANCES);

type Source = "bundled" | "adhoc";

interface Props {
  config: AppConfig | null;
}

export function ExperimentsPage({ config }: Props) {
  const [status, setStatus] = useState("");
  const say = (msg: string) => {
    setStatus(msg);
    window.setTimeout(() => setStatus((s) => (s === msg ? "" : s)), 4000);
  };

  // ── 1. Test Set ──────────────────────────────────────────────────────────
  const [source, setSource] = useState<Source>("bundled");
  const [selectedUtterance, setSelectedUtterance] = useState(PILOT_UTTERANCES[0]);
  const [customUtterance, setCustomUtterance] = useState("");
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [groupFilter, setGroupFilter] = useState("all");

  const suite = useMemo(() => {
    if (source === "bundled") {
      return { short: "pilot", originalText: pilotText, ...PILOT, path: "cases/pilot.jsonl" };
    }
    const utterance = (selectedUtterance === "custom" ? customUtterance : selectedUtterance).trim();
    // Existing choices reuse whole cases, including the recorded write sets.
    const cases = PILOT_UTTERANCE_SET.has(utterance)
      ? PILOT.cases.filter((c) => [...c.sourceTrace, ...c.followupTrace].includes(utterance))
      : utterance
        ? adhocCases(utterance).filter((c) => c.sourceTrace[0] === utterance)
        : [];
    return { short: "adhoc", originalText: null, cases, problems: PILOT.problems, path: "cases/adhoc.jsonl" };
  }, [source, selectedUtterance, customUtterance]);

  useEffect(() => {
    setExcluded(new Set());
    setGroupFilter("all");
  }, [suite]);

  const included = useMemo(() => suite.cases.filter((c) => !excluded.has(c.id)), [suite, excluded]);
  // Unchanged files keep their exact bytes, so the hash matches the file on disk.
  const suiteText = excluded.size === 0 && suite.originalText !== null ? suite.originalText : toJsonl(included);
  const derived = suiteText !== suite.originalText;
  const [suiteSha, setSuiteSha] = useState("");
  useEffect(() => {
    let live = true;
    void sha256Hex(suiteText).then((h) => live && setSuiteSha(h));
    return () => {
      live = false;
    };
  }, [suiteText]);

  const [casesPath, setCasesPath] = useState("cases/pilot.jsonl");
  useEffect(() => setCasesPath(suite.path), [suite.path]);

  const groupCounts = countByGroup(included);
  const suiteRows = useMemo(() => summarizeSuite(included), [included]);
  const groupNames = Object.keys(countByGroup(suite.cases));
  const visibleCases = suite.cases.filter((c) => groupFilter === "all" || reportGroup(c) === groupFilter);

  const derivedManifest = (): CasesManifest => ({
    file: casesPath,
    sha256: suiteSha,
    caseCount: included.length,
    generator: null,
    git: null,
    createdAt: new Date().toISOString(),
    counts: groupCounts,
  });

  // ── 2. Conditions ─────────────────────────────────────────────────────────
  const openRouterList = config?.models?.length ? config.models : ["openai/gpt-4o-mini"];
  const [models, setModels] = useState<ModelChoice[]>(() => openRouterList.map((model) => ({ provider: "openrouter", model })));
  const [modelsOn, setModelsOn] = useState<string[]>(() => [`openrouter:${openRouterList[0]}`]);
  useEffect(() => {
    setModels((m) => {
      const known = new Set(m.map(keyOf));
      return [...m, ...openRouterList.map((model) => ({ provider: "openrouter" as const, model })).filter((c) => !known.has(keyOf(c)))];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);
  const [ollama, setOllama] = useState<{ loading: boolean; error: string }>({ loading: false, error: "" });
  const loadOllama = async () => {
    setOllama({ loading: true, error: "" });
    try {
      const res = await fetch("/api/ollama/models");
      const body = (await res.json()) as { models: string[]; error?: string };
      setModels((m) => {
        const known = new Set(m.map(keyOf));
        return [...m, ...body.models.map((model) => ({ provider: "ollama" as const, model })).filter((c) => !known.has(keyOf(c)))];
      });
      setOllama({ loading: false, error: body.error ?? (body.models.length === 0 ? "Ollama has no models installed." : "") });
    } catch {
      setOllama({ loading: false, error: "Could not reach the API server." });
    }
  };
  const [newModel, setNewModel] = useState({ provider: "openrouter" as ModelChoice["provider"], model: "" });
  // ── Prompts ──
  const [prompts, setPrompts] = useState<PromptEntry[]>(COMMITTED_PROMPTS);
  const [promptsOn, setPromptsOn] = useState<string[]>(["default"]);
  const [editing, setEditing] = useState("default");
  const [shas, setShas] = useState<Record<string, string>>({});
  useEffect(() => {
    let live = true;
    void Promise.all(prompts.map(async (p) => [p.name, await promptSha256(p.text)] as const)).then((e) => live && setShas(Object.fromEntries(e)));
    return () => {
      live = false;
    };
  }, [prompts]);
  const editingPrompt = prompts.find((p) => p.name === editing) ?? prompts[0];
  const isCommitted = COMMITTED_NAMES.has(editingPrompt.name);
  const addPrompt = (want: string, text: string) => {
    const name = uniqueName(prompts.map((p) => p.name), want);
    setPrompts((ps) => [...ps, { name, text }]);
    setPromptsOn((on) => [...on, name]);
    setEditing(name);
  };
  const [temps, setTemps] = useState("default");
  const [history, setHistory] = useState<string[]>(["full"]);
  const [maxTurns, setMaxTurns] = useState(3);
  const [clear, setClear] = useState("false");
  const [topP, setTopP] = useState("");
  const [local, setLocal] = useState(false);
  const [condOff, setCondOff] = useState<Set<string>>(new Set());

  const chosenModels = models.filter((m) => modelsOn.includes(keyOf(m)));
  const chosenPrompts = prompts.filter((p) => promptsOn.includes(p.name));
  const allConditions: PageCondition[] = useMemo(() => {
    const ms: (ModelChoice | null)[] = local ? [null] : chosenModels;
    const ts = local ? ["default"] : parseList(temps);
    const out: PageCondition[] = [];
    for (const m of ms)
      for (const pr of chosenPrompts)
        for (const t of ts)
          for (const h of history) {
            const env: Overrides = {};
            if (local) env.LOCAL_TEST_MODE = "true";
            else {
              env.LLM_PROVIDER = m!.provider;
              env.LLM_MODEL = m!.model;
            }
            if (!local && t !== "default") env.LLM_TEMPERATURE = t;
            if (!local && topP.trim()) env.LLM_TOP_P = topP.trim();
            env.HISTORY_POLICY = h;
            if (h === "last-k") env.HISTORY_MAX_TURNS = String(maxTurns);
            env.CLEAR_ACTION_ENABLED = clear;
            const parts: string[] = [];
            if (local) parts.push("local");
            else if (ms.length > 1) parts.push(`${m!.provider === "ollama" ? "ollama-" : ""}${shortModel(m!.model)}`);
            if (chosenPrompts.length > 1 || pr.name !== "default") parts.push(pr.name);
            if (clear === "true") parts.push("clear");
            if (!local) parts.push(t === "default" ? "tdefault" : `t${t}`);
            if (history.length > 1 || h !== "full") parts.push(h === "last-k" ? `last${maxTurns}` : h);
            out.push({ id: parts.join("-"), env, prompt: { name: pr.name, text: normalizePrompt(pr.text) } });
          }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local, modelsOn, models, temps, prompts, promptsOn, history, maxTurns, clear, topP]);
  const conditions = allConditions.filter((c) => !condOff.has(c.id));

  const toggle = (list: string[], set: (v: string[]) => void, v: string) =>
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  // Each condition's P, as the server resolves it. Shows exactly what a run
  // will use, including code defaults for anything the condition leaves out.
  const [resolved, setResolved] = useState<Record<string, { P?: AppConfig; error?: string }>>({});
  const condKey = JSON.stringify(allConditions);
  useEffect(() => {
    let live = true;
    const t = window.setTimeout(async () => {
      const out: Record<string, { P?: AppConfig; error?: string }> = {};
      await Promise.all(allConditions.map(async (c) => {
        try {
          const res = await fetch("/api/config", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ overrides: toEngine(c).env }),
          });
          if (!res.ok) {
            const body = (await res.json().catch(() => ({}))) as { error?: string };
            out[c.id] = { error: body.error ?? `HTTP ${res.status}` };
          } else out[c.id] = { P: (await res.json()) as AppConfig };
        } catch {
          out[c.id] = { error: "API server not reachable" };
        }
      }));
      if (live) setResolved(out);
    }, 400);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [condKey]);

  // ── 3. Experiment file ────────────────────────────────────────────────────
  const [exp, setExp] = useState(() => ({ n: 10, seed: newSeed(), concurrency: 4, maxInfraRetries: 2 }));
  const modelsPart = local ? "local" : chosenModels.length === 1 ? shortModel(chosenModels[0].model) : `${chosenModels.length}models`;
  const autoName = slug(`${suite.short}-${modelsPart}-${conditions.length}cond-n${exp.n}`);
  const [customName, setCustomName] = useState<string | null>(null);
  const name = customName ?? autoName;

  const experiment = {
    name,
    cases: casesPath,
    casesSha256: suiteSha || undefined,
    n: exp.n,
    seed: exp.seed,
    concurrency: exp.concurrency,
    maxInfraRetries: exp.maxInfraRetries,
    conditions: conditions.map((c) => ({
      id: c.id,
      prompt: { file: `prompts/${c.prompt.name}.txt`, sha256: shas[c.prompt.name] ?? "" },
      env: c.env,
    })),
  };
  const check = experimentSchema.safeParse(experiment);
  const issues: Array<["bad" | "warn", string]> = check.success
    ? []
    : check.error.issues.map((i) => ["bad", `${i.path.join(".") || "experiment"}: ${i.message}`]);
  if (suite.problems.length) issues.push(["bad", `Cases file has ${suite.problems.length} problem(s): ${suite.problems[0]}`]);
  if (included.length === 0) issues.push(["bad", "The test set has no cases."]);
  if (chosenPrompts.length === 0) issues.push(["bad", "Tick at least one prompt."]);
  for (const pr of chosenPrompts) {
    if (!PROMPT_NAME_RE.test(pr.name)) issues.push(["bad", `Prompt name "${pr.name}" may use only letters, digits, dot, dash and underscore.`]);
    if (normalizePrompt(pr.text) === "") issues.push(["bad", `Prompt ${pr.name} is empty.`]);
  }
  const prNames = prompts.map((p) => p.name);
  if (new Set(prNames).size !== prNames.length) issues.push(["bad", "Two prompts share a name."]);
  if (!local && parseList(temps).some((t) => t !== "default" && !(Number(t) >= 0 && Number(t) <= 2))) {
    issues.push(["bad", "Temperatures are numbers from 0 to 2, or the word default."]);
  }
  const resolveErrors = [...new Set(Object.values(resolved).map((r) => r.error).filter(Boolean))];
  if (resolveErrors.length) issues.push(["warn", `Could not resolve P: ${resolveErrors[0]}`]);
  if (derived) issues.push(["warn", `This test set differs from any file on disk. Download it to ${casesPath} before running from the CLI.`]);
  if (suite.cases.some((c) => c.provenance.generator === "manual")) issues.push(["warn", "New utterances use inferred write sets. Treat their results as exploration."]);
  if (!local && exp.n < 3) issues.push(["warn", "With N below 3, fail@3 cannot be computed."]);
  if (!local && parseList(temps).every((t) => Number(t) === 0)) {
    issues.push(["warn", "Every condition runs at temperature 0, so per-case failure rates will sit near 0 or 1."]);
  }
  const blocked = issues.some(([k]) => k === "bad");
  const experimentJson = JSON.stringify(check.success ? check.data : experiment, null, 2) + "\n";
  const filePath = `experiments/${name || "experiment"}.json`;
  const utterancesPerSuite = plannedInvocations(included, 1, 1);
  const calls = utterancesPerSuite * conditions.length * exp.n;
  const trials = included.length * conditions.length * exp.n;

  // ── 4. Run here ───────────────────────────────────────────────────────────
  const [spendOk, setSpendOk] = useState(false);
  const [saveTurns, setSaveTurns] = useState(false);
  const [langfuse, setLangfuse] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, round: 0, fails: 0, infra: 0 });
  const [runRows, setRunRows] = useState<TrialRow[]>([]);
  const [runError, setRunError] = useState("");
  const runData = useRef<{ manifest: Record<string, unknown>; turns: unknown[] } | null>(null);
  const abort = useRef<AbortController | null>(null);

  const start = async () => {
    setRunError("");
    setRunRows([]);
    setRunning(true);
    const ac = new AbortController();
    abort.current = ac;
    const transport: Transport = {
      headers: { [LANGFUSE_HEADER]: langfuse ? "on" : "off" },
    };
    try {
      const runtimes: ConditionRuntime[] = [];
      for (const c of conditions) {
        const rt = await openCondition(toEngine(c), transport);
        if (rt.config.mode === "llm" && rt.config.provider === "none") {
          throw new Error(`Condition ${c.id}: the server has no API key for this provider.`);
        }
        runtimes.push(rt);
      }
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const runId = `${name}-${stamp}`;
      const sink = memorySink();
      runData.current = {
        manifest: {
          runId,
          runner: "browser",
          langfuse,
          experimentPath: filePath,
          experiment: check.success ? check.data : experiment,
          casesSha256: suiteSha,
          caseCount: included.length,
          plannedInvocations: calls,
          userAgent: navigator.userAgent,
          startedAt: new Date().toISOString(),
          // The exact prompt texts, so a run can be reproduced from its manifest.
          prompts: Object.fromEntries(
            [...new Set(conditions.map((c) => c.prompt.name))].map((n) => {
              const pr = conditions.find((c) => c.prompt.name === n)!.prompt;
              return [promptHash(pr.text), { file: `prompts/${n}.txt`, sha256: shas[n] ?? "", text: pr.text }];
            }),
          ),
          conditions: runtimes.map((rt) => ({ id: rt.condition.id, model: rt.model, P: rt.P, mode: rt.config.mode, provider: rt.config.provider })),
        },
        turns: sink.turnRecords,
      };
      let fails = 0;
      let infra = 0;
      await runSweep({
        runId,
        cases: included,
        conditions: runtimes,
        n: exp.n,
        seed: exp.seed,
        concurrency: exp.concurrency,
        maxInfraRetries: exp.maxInfraRetries,
        signal: ac.signal,
        sink: {
          turns: (records) => {
            sink.turns(records);
            if (saveTurns) records.forEach((r) => saveTurn(r));
          },
          trial: (row) => sink.trial(row),
        },
        onTrial: (row, p) => {
          if (row.status === "fail") fails += 1;
          if (row.status === "infra") infra += 1;
          setProgress({ ...p, fails, infra });
          setRunRows([...sink.rows]);
        },
      });
      runData.current.manifest.finishedAt = new Date().toISOString();
      if (ac.signal.aborted) runData.current.manifest.stoppedEarly = true;
      say(ac.signal.aborted ? "Stopped. Trials in flight were recorded." : "Run finished.");
    } catch (e) {
      setRunError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  // ── 5. Report ─────────────────────────────────────────────────────────────
  const [loaded, setLoaded] = useState<{ name: string; rows: TrialRow[] } | null>(null);
  const [reportFrom, setReportFrom] = useState<"run" | "file">("run");
  const [by, setBy] = useState<"mr" | "case">("mr");
  const [format, setFormat] = useState<Format>("md");
  const reportRows = reportFrom === "file" && loaded ? loaded.rows : runRows;
  const reportTable = reportRows.length
    ? (by === "case" ? caseTable : summaryTable)(reportRows, [1, 3, 5], `MR results, ${reportRows[0].runId}`)
    : null;
  const tokensPerCall = (() => {
    const rows = loaded?.rows ?? [];
    const inv = rows.reduce((s, r) => s + r.invocations, 0);
    const tok = rows.reduce((s, r) => s + (r.tokens ?? 0), 0);
    return inv > 0 && tok > 0 ? tok / inv : null;
  })();

  const pText = (c: PageCondition) => {
    const r = resolved[c.id];
    if (!r) return "resolving…";
    if (r.error) return `⚠ ${r.error}`;
    const P = r.P!;
    if (P.mode === "local-test") return `local parser · prompt ${c.prompt.name} · history ${P.historyPolicy}`;
    return [
      `${P.provider} ${P.defaultModel}`,
      `prompt ${c.prompt.name} · SHA-256 ${shas[c.prompt.name]?.slice(0, 7) ?? "pending"}`,
      `T ${P.temperature ?? "provider default"}`,
      `top_p ${P.topP ?? "provider default"}`,
      `history ${P.historyPolicy}${P.historyMaxTurns !== null ? ` k=${P.historyMaxTurns}` : ""}`,
      `clear ${P.clearActionEnabled ? "on" : "off"}`,
    ].join(" · ");
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="xp">
      <div className="xp-main">
        <section className="xp-block">
          <h2>1. Test Set <small></small></h2>
          <div className="xp-body">
            <Field label="Test set">
              <select id="suite-source" value={source} onChange={(e) => setSource(e.target.value as Source)}>
                <option value="bundled">cases/pilot.jsonl</option>
                <option value="adhoc">Ad-hoc</option>
              </select>
            </Field>
            <div><ShortHash value={suiteSha} /></div>
            {source === "bundled" && (
              <p className="xp-note">
                These test cases come from templates and fixed input transformations, with human-reviewed paraphrases.
              </p>
            )}
            {source === "adhoc" && (
              <>
                <Field label="Utterance">
                  <select id="adhoc-utterance" value={selectedUtterance} onChange={(e) => setSelectedUtterance(e.target.value)}>
                    {PILOT_UTTERANCES.map((utterance) => <option key={utterance} value={utterance}>{utterance}</option>)}
                    <option value="custom">Add custom utterance…</option>
                  </select>
                </Field>
                {selectedUtterance === "custom" ? (
                  <>
                    <Field label="Custom utterance">
                      <input id="adhoc-custom" type="text" value={customUtterance} onChange={(e) => setCustomUtterance(e.target.value)} placeholder="Enter a sentence" />
                    </Field>
                    <p className="xp-note">Custom sentences have no predefined write set. Write sets are inferred, so these results are exploratory.</p>
                  </>
                ) : (
                  <p className="xp-note">Runs the existing cases containing this utterance, using their defined write sets.</p>
                )}
              </>
            )}
            <SuiteTable rows={suiteRows} />
            {suite.problems.length > 0 && <div className="xp-issue bad">{suite.problems.slice(0, 3).join(" · ")}</div>}

            {derived && (
              <details className="xp-details">
                <summary>Download cases</summary>
            <div className="xp-row">
              <Field label="Path in the repo" help="Where this test set lives, relative to the LNGUI repo root. The experiment file points here, and the CLI checks the file's hash.">
                <input id="cases-path" type="text" value={casesPath} onChange={(e) => setCasesPath(e.target.value)} spellCheck={false} />
              </Field>
              <button type="button" disabled={!derived || included.length === 0} onClick={() => {
                downloadFile(suiteText, casesPath.split("/").pop() || "cases.jsonl", "application/jsonl");
                downloadFile(JSON.stringify(derivedManifest(), null, 2) + "\n", (casesPath.split("/").pop() || "cases.jsonl").replace(/\.jsonl$/, "") + ".manifest.json", "application/json");
              }}>Download test set + manifest</button>
            </div>

              </details>
            )}

            <details className="xp-details">
              <summary>Test cases ({included.length} of {suite.cases.length} included)</summary>
              <div className="xp-row">
                <label className="xp-f"><span>Show</span>
                  <select id="group-filter" value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)}>
                    <option value="all">All relations</option>
                    {groupNames.map((g) => <option key={g} value={g}>{g}</option>)}
                  </select>
                </label>
                <p className="xp-note">Unticking a case makes a new test set with a new hash.</p>
              </div>
              <div className="xp-scroll xp-cases">
                <table className="xp-table">
                  <thead><tr><th>Use</th><th>Test case</th><th>Metamorphic relation</th><th>Source trace</th><th>Follow-up trace</th></tr></thead>
                  <tbody>
                    {visibleCases.map((c) => (
                      <tr key={c.id} className={excluded.has(c.id) ? "off" : ""}>
                        <td><input type="checkbox" aria-label={`Include ${c.id}`} checked={!excluded.has(c.id)} onChange={() => {
                          const next = new Set(excluded);
                          if (next.has(c.id)) next.delete(c.id);
                          else next.add(c.id);
                          setExcluded(next);
                        }} /></td>
                        <td className="xp-mono">{c.id}</td>
                        <td>{reportGroup(c)}</td>
                        <td>{c.sourceTrace.join(" → ") || "σ₀"}</td>
                        <td>{c.followupTrace.join(" → ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </div>
        </section>

        <section className="xp-block">
          <h2>2. Prompts <small>the system prompt</small></h2>
          <div className="xp-body">
            <div className="xp-chips">
              {prompts.map((p) => (
                <label key={p.name} className={`xp-chip ${promptsOn.includes(p.name) ? "on" : ""}`}>
                  <input type="checkbox" checked={promptsOn.includes(p.name)} onChange={() => toggle(promptsOn, setPromptsOn, p.name)} />
                  {p.name} <ShortHash value={shas[p.name]} />
                </label>
              ))}
            </div>
            <div className="xp-row">
              <Field label="Showing">
                <select id="prompt-edit" value={editingPrompt.name} onChange={(e) => setEditing(e.target.value)}>
                  {prompts.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
                </select>
              </Field>
              <button type="button" onClick={() => addPrompt(`${editingPrompt.name}-edit`, editingPrompt.text)}>Duplicate to edit</button>
              <label className="xp-file-btn">
                Load .txt
                <input id="prompt-file" type="file" accept=".txt,text/plain" onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void f.text().then((t) => addPrompt(f.name.replace(/\.txt$/, ""), t));
                }} />
              </label>
              <button type="button" onClick={() => downloadFile(normalizePrompt(editingPrompt.text) + "\n", `${editingPrompt.name}.txt`, "text/plain")}>Download .txt</button>
              {!isCommitted && (
                <button type="button" onClick={() => {
                  setPrompts((ps) => ps.filter((p) => p.name !== editingPrompt.name));
                  setPromptsOn((on) => on.filter((n) => n !== editingPrompt.name));
                  setEditing("default");
                }}>Delete</button>
              )}
            </div>
            {!isCommitted && (
              <Field label="Name" help="Becomes the file name, prompts/<name>.txt, and part of each condition's id. Letters, digits, dot, dash and underscore.">
                <input id="prompt-name" type="text" value={editingPrompt.name} spellCheck={false} onChange={(e) => {
                  const next = e.target.value;
                  const old = editingPrompt.name;
                  setPrompts((ps) => ps.map((p) => (p.name === old ? { ...p, name: next } : p)));
                  setPromptsOn((on) => on.map((n) => (n === old ? next : n)));
                  setEditing(next);
                }} />
              </Field>
            )}
            <textarea
              id="prompt-text"
              className="xp-prompt"
              aria-label={`System prompt ${editingPrompt.name}`}
              readOnly={isCommitted}
              spellCheck={false}
              value={editingPrompt.text}
              onChange={(e) => {
                const text = e.target.value;
                setPrompts((ps) => ps.map((p) => (p.name === editingPrompt.name ? { ...p, text } : p)));
              }}
            />
            <div className="xp-mono xp-dim">
              {normalizePrompt(editingPrompt.text).length} chars · <ShortHash value={shas[editingPrompt.name]} />
              {editingPrompt.name !== "default" && (() => {
                const d = lineDiff(DEFAULT_TEXT, normalizePrompt(editingPrompt.text));
                return d.added + d.removed === 0 ? " · same text as default" : ` · vs default: +${d.added} −${d.removed} lines`;
              })()}
            </div>
          </div>
        </section>

        <section className="xp-block">
          <h2>3. Configurations to compare</h2>
          <div className="xp-body">
            <p className="xp-note">
              Select one or more values for each setting. Each combination becomes a configuration to compare.
              
            </p>
            <label className="xp-check xp-boxed">
              <input id="local" type="checkbox" checked={local} onChange={(e) => setLocal(e.target.checked)} />
              <span><b>Dry Run.</b> Run tests with simulated responses. No model calls or conversation history.</span>
            </label>
            {!local && (
              <div className="xp-factor">
                <div className="xp-label">Models<Help>Each checked model becomes its own set of conditions. OpenRouter models use the server's OpenRouter key. Ollama models run on the server's local Ollama (OLLAMA_BASE_URL, default http://localhost:11434/v1).</Help></div>
                {(["openrouter", "ollama"] as const).map((prov) => (
                  <div key={prov} className="xp-provider">
                    <span className="xp-provider-name">{prov === "openrouter" ? "OpenRouter" : "Ollama"}</span>
                    <div className="xp-chips">
                      {models.filter((m) => m.provider === prov).map((m) => (
                        <label key={keyOf(m)} className={`xp-chip ${modelsOn.includes(keyOf(m)) ? "on" : ""}`}>
                          <input type="checkbox" checked={modelsOn.includes(keyOf(m))} onChange={() => toggle(modelsOn, setModelsOn, keyOf(m))} />{m.model}
                        </label>
                      ))}
                      {prov === "ollama" && (
                        <button type="button" className="xp-small" onClick={() => void loadOllama()} disabled={ollama.loading}>
                          {ollama.loading ? "Loading…" : "Load installed models"}
                        </button>
                      )}
                    </div>
                    {prov === "ollama" && ollama.error && <span className="xp-dim xp-small-text">{ollama.error}</span>}
                  </div>
                ))}
                <div className="xp-row">
                  <select id="new-model-provider" value={newModel.provider} onChange={(e) => setNewModel({ ...newModel, provider: e.target.value as ModelChoice["provider"] })}>
                    <option value="openrouter">OpenRouter</option><option value="ollama">Ollama</option>
                  </select>
                  <input id="new-model" type="text" placeholder={newModel.provider === "ollama" ? "llama3.1:8b" : "provider/model-id"} value={newModel.model} onChange={(e) => setNewModel({ ...newModel, model: e.target.value })} spellCheck={false} />
                  <button type="button" onClick={() => {
                    const v = newModel.model.trim();
                    if (!/^[A-Za-z0-9._:/-]{1,120}$/.test(v)) return say("Model ids use letters, digits and . _ : / - only.");
                    const choice = { provider: newModel.provider, model: v };
                    setModels((m) => (m.some((x) => keyOf(x) === keyOf(choice)) ? m : [...m, choice]));
                    setModelsOn((on) => [...new Set([...on, keyOf(choice)])]);
                    setNewModel({ ...newModel, model: "" });
                  }}>Add model</button>
                </div>
              </div>
            )}
            {!local && (
              <Field label={<>Temperatures <em>LLM_TEMPERATURE</em></>} help="Comma-separated. The word default sends no temperature, so the provider's default for the model applies. Numbers are sent as given, for example 0 for near-deterministic decoding.">
                <input id="temps" type="text" value={temps} onChange={(e) => setTemps(e.target.value)} spellCheck={false} />
              </Field>
            )}
            <div className="xp-factor">
              <div className="xp-label">History policy <em>HISTORY_POLICY</em><Help>How much of the conversation reaches the mediator. full sends every turn. last-k sends the last k turns. none sends nothing, which seeds the display-only-history fault.</Help></div>
              <div className="xp-chips">
                {["full", "last-k", "none"].map((v) => (
                  <label key={v} className={`xp-chip ${history.includes(v) ? "on" : ""}`}><input type="checkbox" checked={history.includes(v)} onChange={() => toggle(history, setHistory, v)} />{v}</label>
                ))}
              </div>
            </div>
            <div className="xp-grid">
              {history.includes("last-k") && (
                <Field label="Turns kept (last-k)"><input id="max-turns" type="number" min={1} value={maxTurns} onChange={(e) => setMaxTurns(Math.max(1, Number(e.target.value)))} /></Field>
              )}
              <Field label="Clear-filters in the command language" help="Whether the model's JSON may include clearFilters. This changes the schema only. It does not change the prompt text, so a prompt that should make the model clear filters has to say so itself.">
                <select id="clear" value={clear} onChange={(e) => setClear(e.target.value)}>
                  <option value="false">Off</option><option value="true">On</option>
                </select>
              </Field>
              {!local && (
                <Field label="top_p" help="Leave empty to send no top_p, so the provider's default applies.">
                  <input id="top-p" type="text" placeholder="provider default" value={topP} onChange={(e) => setTopP(e.target.value)} />
                </Field>
              )}
            </div>
            <div className="xp-scroll">
              <table className="xp-table">
                <thead><tr><th>Use</th><th>Condition</th><th>P, as the server resolves it</th></tr></thead>
                <tbody>
                  {allConditions.map((c) => (
                    <tr key={c.id} className={condOff.has(c.id) ? "off" : ""}>
                      <td><input type="checkbox" aria-label={`Include ${c.id}`} checked={!condOff.has(c.id)} onChange={() => {
                        const next = new Set(condOff);
                        if (next.has(c.id)) next.delete(c.id);
                        else next.add(c.id);
                        setCondOff(next);
                      }} /></td>
                      <td className="xp-mono">{c.id}</td>
                      <td className="xp-mono xp-dim">{pText(c)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="xp-block">
          <h2>4. Experiment <small>experiments/&lt;name&gt;.json</small></h2>
          <div className="xp-body">
            <div className="xp-grid">
              <Field label="Name" help="Names the experiment file and the run folder, runs/<name>-<time>/. It is built from the test set, models, condition count and N until you edit it.">
                <span className="xp-inline">
                  <input id="exp-name" type="text" value={name} onChange={(e) => setCustomName(e.target.value)} spellCheck={false} />
                  {customName !== null && <button type="button" onClick={() => setCustomName(null)}>Auto</button>}
                </span>
              </Field>
              <Field label="Trials per case (N)" help="How many times each case runs under each condition. RQ2's fail@k needs N ≥ k. Ten is the pilot budget.">
                <input id="exp-n" type="number" min={1} value={exp.n} onChange={(e) => setExp({ ...exp, n: Number(e.target.value) })} />
              </Field>
              <Field label="Trial-order seed" help="Seeds the shuffled order of trials within each round. It is recorded in the experiment file, so a run's order can be reproduced. It does not change which cases run.">
                <span className="xp-inline">
                  <input id="exp-seed" type="number" value={exp.seed} onChange={(e) => setExp({ ...exp, seed: Number(e.target.value) })} />
                  <button type="button" onClick={() => setExp({ ...exp, seed: newSeed() })}>New</button>
                </span>
              </Field>
              <Field label="Parallel trials" help="How many trials run at once. Turns inside one trial always run in order. Raise it for speed, lower it if the provider rate-limits.">
                <input id="exp-conc" type="number" min={1} value={exp.concurrency} onChange={(e) => setExp({ ...exp, concurrency: Number(e.target.value) })} />
              </Field>
              <Field label="Retries on provider errors" help="How many times to rerun a trial when the infrastructure fails: a timeout, a provider error, or a missing key. A wrong or malformed command from the model is a mediator failure and is never retried. A trial that still fails is recorded as infra and kept out of every rate.">
                <input id="exp-retries" type="number" min={0} value={exp.maxInfraRetries} onChange={(e) => setExp({ ...exp, maxInfraRetries: Number(e.target.value) })} />
              </Field>
            </div>
          </div>
        </section>

        <section className="xp-block">
          <h2>5. Run here <small>same engine as npm run sweep</small></h2>
          <div className="xp-body">
            <p className="xp-note">
              Trials stay in this tab until you download them.
            </p>
            <label className="xp-check"><input id="langfuse" type="checkbox" checked={langfuse} onChange={(e) => setLangfuse(e.target.checked)} /> Trace every call to Langfuse <Help>Sends each model call to Langfuse when the server has Langfuse keys. Off by default, since turns.jsonl already holds every prompt and reply. The CLI uses --langfuse for the same switch.</Help></label>
            <label className="xp-check"><input id="save-turns" type="checkbox" checked={saveTurns} onChange={(e) => setSaveTurns(e.target.checked)} /> Also save every turn to the run store (/api/runs)</label>
            {!local && (
              <label className="xp-check"><input id="spend-ok" type="checkbox" checked={spendOk} onChange={(e) => setSpendOk(e.target.checked)} /> I understand this run schedules {fmt(calls)} model calls and may incur API charges.</label>
            )}
            <div className="xp-row">
              {!running ? (
                <button type="button" className="primary" disabled={blocked || (!local && !spendOk)} onClick={() => void start()}>
                  Run {fmt(trials)} trials
                </button>
              ) : (
                <button type="button" onClick={() => abort.current?.abort()}>Stop after trials in flight</button>
              )}
              <button type="button" disabled={!runData.current || runRows.length === 0} onClick={() => {
                const d = runData.current!;
                const id = String(d.manifest.runId);
                downloadFile(runRows.map((r) => JSON.stringify(r)).join("\n") + "\n", `${id}.trials.jsonl`, "application/jsonl");
                downloadFile(d.turns.map((r) => JSON.stringify(r)).join("\n") + "\n", `${id}.turns.jsonl`, "application/jsonl");
                downloadFile(JSON.stringify(d.manifest, null, 2) + "\n", `${id}.manifest.json`, "application/json");
              }}>Download trials, turns, manifest</button>
            </div>
            {(running || progress.total > 0) && (
              <div className="xp-progress">
                <div className="xp-bar"><div style={{ width: `${progress.total ? (100 * progress.done) / progress.total : 0}%` }} /></div>
                <div className="xp-mono xp-dim">round {progress.round}/{exp.n} · {fmt(progress.done)}/{fmt(progress.total)} trials · fails {progress.fails} · infra {progress.infra}</div>
              </div>
            )}
            {runError && <div className="xp-issue bad">{runError}</div>}
          </div>
        </section>

        <section className="xp-block">
          <h2>6. Report <small>shared/report.ts</small></h2>
          <div className="xp-body">
            <div className="xp-row">
              <div className="xp-tabs">
                <button type="button" className={reportFrom === "run" ? "on" : ""} onClick={() => setReportFrom("run")}>This tab's run</button>
                <button type="button" className={reportFrom === "file" ? "on" : ""} onClick={() => setReportFrom("file")}>trials.jsonl file</button>
              </div>
              {reportFrom === "file" && (
                <input id="trials-file" type="file" accept=".jsonl,.txt" onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void f.text().then((t) => setLoaded({ name: f.name, rows: parseTrialsJsonl(t) }));
                }} />
              )}
              <select id="report-by" value={by} onChange={(e) => setBy(e.target.value as "mr" | "case")}>
                <option value="mr">By MR row</option><option value="case">By case</option>
              </select>
            </div>
            {reportTable ? (
              <>
                <TableView table={reportTable} />
                <p className="xp-note">
                  Over-reach is the share of trials where some turn changed a control outside that utterance's declared write set W.
                  It is a standing check reported apart from the MR verdict. For frozen cases W comes from the generation template.
                </p>
                <div className="xp-row">
                  <select id="report-format" value={format} onChange={(e) => setFormat(e.target.value as Format)}>
                    <option value="md">Markdown</option><option value="latex">LaTeX</option><option value="csv">CSV</option>
                  </select>
                  <button type="button" onClick={() => void copyText(render(reportTable, format), say)}>Copy table</button>
                </div>
              </>
            ) : (
              <p className="xp-note">No trials yet. Run the experiment here, or load a trials.jsonl from runs/.</p>
            )}
          </div>
        </section>
      </div>

      <aside className="xp-side">
        <section className="xp-run-estimate" aria-label="Run estimate">
          <div className="xp-estimate-heading">Run estimate{local && <span>Dry Run</span>}</div>
          <div className="xp-stats">
            <div><b>{fmt(conditions.length)}</b><span>Configurations</span></div>
            <div><b>{fmt(trials)}</b><span>Total trials</span></div>
            <div className={!local && calls > 0 ? "xp-call-estimate" : undefined}>
              <b>{local ? "0" : fmt(calls)}</b><span>Model calls</span>
            </div>
          </div>
          <div className="xp-estimate-detail">
            <p><b>Trials:</b> {fmt(included.length)} test cases × {fmt(exp.n)} repeats × {fmt(conditions.length)} {conditions.length === 1 ? "configuration" : "configurations"} = {fmt(trials)}</p>
            {!local && (
              <>
                <p><b>Model calls:</b> {fmt(utterancesPerSuite)} utterances × {fmt(exp.n)} repeats × {fmt(conditions.length)} {conditions.length === 1 ? "configuration" : "configurations"} = {fmt(calls)}</p>
                
              </>
            )}

          </div>
        </section>
        {tokensPerCall !== null && !local && (
          <div className="xp-note">≈{fmt(Math.round(tokensPerCall * calls))} tokens, at {Math.round(tokensPerCall)} per call from {loaded?.name}</div>
        )}
        {issues.map(([k, m], i) => <div key={i} className={`xp-issue ${k}`}>{m}</div>)}
        <div className="xp-sheet">
          <div className="xp-sheet-bar"><span>{filePath}</span>
            <span className="xp-row">
              <button type="button" disabled={blocked} onClick={() => void copyText(experimentJson, say)}>Copy</button>
              <button type="button" disabled={blocked} onClick={() => downloadFile(experimentJson, filePath.split("/").pop()!, "application/json")}>Download</button>
            </span>
          </div>
          <pre>{experimentJson}</pre>
          <div className="xp-sheet-fingerprint">
            <span>Test suite: {casesPath}</span>
            <span><ShortHash value={suiteSha} /></span>
          </div>
        </div>
        <div className="xp-status" role="status">{status}</div>
      </aside>
    </div>
  );
}
