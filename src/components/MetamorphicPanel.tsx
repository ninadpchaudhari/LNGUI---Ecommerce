import { useState } from "react";
import type {
  AppConfig,
  MrCaseRecord,
  PromptConfig,
  RelationName,
  TurnRecord,
} from "../utils/types.ts";
import { buildInstances, runRelations } from "../utils/relations.ts";
import { saveMrCase } from "../utils/api.ts";
import { downloadFile, exportCasesCsv } from "../utils/logging.ts";

interface Props {
  config: AppConfig | null;
  model: string;
  sessionId: string;
  P: PromptConfig;
  onTurn: (record: TurnRecord) => void;
  onCases?: (cases: MrCaseRecord[]) => void;
}

const VERDICT_CLASS: Record<string, string> = {
  pass: "verdict-pass",
  fail: "verdict-fail",
  skipped: "verdict-skipped",
};

const RELATION_LABEL: Record<RelationName, string> = {
  MR_SE: "MR_SE · Semantic Equivalence",
  MR_AC: "MR_AC · Additive Constraining",
  MR_CA: "MR_CA · Commuting Actions",
  MR_REV: "MR_REV · Action Reversibility",
  CONTEXT_AMNESIA: "Context Amnesia (multi-turn MR_CA)",
};

/**
 * Drives Algorithm 1 over the four relations of Table 4.1.
 *
 * A verdict is a property of N trials, not of one run: `fails/N > ε` (Eq. 4.18).
 * There is no WEAK_PASS — under O(σ) = ⟨V,D⟩ a V difference is a violation.
 */
export function MetamorphicPanel(props: Props) {
  const [basePrompt, setBasePrompt] = useState("show electronics under $100 sorted by rating");
  const [n, setN] = useState(3);
  const [epsilon, setEpsilon] = useState(0.2);
  const [cases, setCases] = useState<MrCaseRecord[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [summary, setSummary] = useState<{ covNL: number; covMR: number; invocations: number } | null>(
    null,
  );
  const [open, setOpen] = useState<string | null>(null);

  const instances = buildInstances(basePrompt);
  // MR_CA and the amnesia case run multi-utterance traces, so the call count is
  // not simply 2N per case (§4.18).
  const plannedCalls =
    instances.reduce((sum, i) => sum + i.sourceTrace.length + i.followupTrace.length, 0) * n;

  const run = async () => {
    setRunning(true);
    setCases([]);
    setSummary(null);
    setProgress({ done: 0, total: instances.length });
    try {
      const result = await runRelations(basePrompt, {
        n,
        epsilon,
        ...(props.model ? { model: props.model } : {}),
        sessionId: props.sessionId,
        P: props.P,
        onTurn: props.onTurn,
        onCase: (c) => {
          setCases((prev) => [...prev.filter((p) => p.id !== c.id), c]);
          saveMrCase(c);
        },
        onProgress: (done, total) => setProgress({ done, total }),
      });
      setSummary({
        covNL: result.covNL,
        covMR: result.covMR,
        invocations: result.invocations,
      });
      props.onCases?.(result.cases);
    } finally {
      setRunning(false);
      setProgress(null);
    }
  };

  const localMode = props.config?.mode === "local-test";

  return (
    <section className="metamorphic-section">
      <h2>Metamorphic Tests</h2>

      <div className="meta-controls">
        <label className="field-label" style={{ flex: 1 }}>
          Base utterance
          <input
            type="text"
            value={basePrompt}
            onChange={(e) => setBasePrompt(e.target.value)}
            style={{ width: "100%" }}
          />
        </label>
        <label className="field-label" title="Repetitions per test case (Algorithm 1)">
          N
          <input
            type="number" min={1} max={20} value={n}
            onChange={(e) => setN(Math.max(1, Number(e.target.value) || 1))}
            style={{ width: 56 }}
          />
        </label>
        <label className="field-label" title="Tolerated failure rate ε (Eq. 4.18)">
          ε
          <input
            type="number" min={0} max={0.99} step={0.05} value={epsilon}
            onChange={(e) => setEpsilon(Math.min(0.99, Math.max(0, Number(e.target.value) || 0)))}
            style={{ width: 64 }}
          />
        </label>
        <button className="meta-run-btn" onClick={run} disabled={running || !basePrompt.trim()}>
          {running ? "Running…" : "Run relations"}
        </button>
      </div>

      <p className="meta-log-count">
        {instances.length} instance{instances.length === 1 ? "" : "s"} · ≈{plannedCalls} mediator
        call{plannedCalls === 1 ? "" : "s"} at N={n}
        {localMode ? (
          <span className="trace-note"> · LOCAL_TEST_MODE: no LLM spend</span>
        ) : (
          <span className="trace-flag-warn"> · live model: this will spend tokens</span>
        )}
        {progress && ` · ${progress.done}/${progress.total} cases`}
      </p>

      {summary && (
        <p className="meta-log-count">
          Cov<sub>NL</sub> = {(summary.covNL * 100).toFixed(0)}% · Cov<sub>MR</sub> ={" "}
          {(summary.covMR * 100).toFixed(0)}% · {summary.invocations} invocations
        </p>
      )}

      <div className="meta-export-row">
        <button
          className="clear-btn"
          onClick={() => downloadFile(exportCasesCsv(cases), "mr-cases.csv", "text/csv")}
          disabled={cases.length === 0}
        >
          Export cases CSV
        </button>
      </div>

      {cases.length > 0 && (
        <table className="meta-table">
          <thead>
            <tr>
              <th>relation</th>
              <th>predicate</th>
              <th>source → follow-up</th>
              <th>fails/N</th>
              <th>rate</th>
              <th>verdict</th>
            </tr>
          </thead>
          <tbody>
            {cases.map((c) => {
              const isOpen = open === c.id;
              return [
                <tr
                  key={c.id}
                  className="meta-result-row"
                  onClick={() => setOpen(isOpen ? null : c.id)}
                >
                  <td>{RELATION_LABEL[c.relation] ?? c.relation}</td>
                  <td><code>{c.predicate}</code></td>
                  <td className="meta-variant-cell">
                    {c.sourceTrace.join(" · ") || "σ₀"} → {c.followupTrace.join(" · ")}
                  </td>
                  <td>{c.fails}/{c.n}</td>
                  <td>{(c.failureRate * 100).toFixed(0)}%</td>
                  <td className={VERDICT_CLASS[c.verdict]}>
                    {c.verdict.toUpperCase()}
                    {c.verdict === "fail" && ` (> ${c.epsilon})`}
                  </td>
                </tr>,
                isOpen ? (
                  <tr key={c.id + "-d"}>
                    <td colSpan={6}>
                      <div className="trace-detail trace-p">
                        <span>legacy label: {c.legacyName ?? "—"}</span>
                        <span>ε = {c.epsilon}</span>
                        <span>invocations: {c.mediatorInvocations}</span>
                        <span>tokens: {c.totalTokens ?? "—"}</span>
                        <span>
                          time to first failure:{" "}
                          {c.firstFailureMs === null ? "—" : `${c.firstFailureMs} ms`}
                        </span>
                        {c.skipReason && <span>skipped: {c.skipReason}</span>}
                        <span>evidence: {c.evidenceTurnIds.length} turn records</span>
                      </div>
                    </td>
                  </tr>
                ) : null,
              ];
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
