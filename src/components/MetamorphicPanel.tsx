import { useState } from "react";
import type { MetamorphicResult } from "../utils/types.ts";
import { runAllRelations } from "../utils/metamorphic.ts";
import { getLogs, exportJSON, exportCSV, downloadFile, clearLogs } from "../utils/logging.ts";

const VERDICT_COLOR: Record<string, string> = {
  PASS: "#16a34a",
  WEAK_PASS: "#ca8a04",
  FAIL: "#dc2626",
  SKIPPED: "#888",
};

export function MetamorphicPanel() {
  const [basePrompt, setBasePrompt] = useState("show electronics under $100 sorted by rating");
  const [repeatN, setRepeatN] = useState(3);
  const [results, setResults] = useState<MetamorphicResult[]>([]);
  const [running, setRunning] = useState(false);
  const [logCount, setLogCount] = useState(0);
  const [selectedResult, setSelectedResult] = useState<MetamorphicResult | null>(null);

  const handleRun = async () => {
    setRunning(true);
    setResults([]);
    await runAllRelations(basePrompt, repeatN, (r) => {
      setResults((prev) => [...prev, r]);
    });
    setLogCount(getLogs().length);
    setRunning(false);
  };

  return (
    <section className="metamorphic-section">
      <h2>Metamorphic Tests</h2>

      <div className="meta-controls">
        <label className="field-label" style={{ flex: 1 }}>
          Base Prompt
          <input
            type="text"
            value={basePrompt}
            onChange={(e) => setBasePrompt(e.target.value)}
            style={{ width: "100%" }}
          />
        </label>
        <label className="field-label">
          Repeat N
          <input
            type="number" min={1} max={20} value={repeatN}
            onChange={(e) => setRepeatN(Number(e.target.value) || 1)}
            style={{ width: 60 }}
          />
        </label>
        <button
          className="meta-run-btn"
          onClick={handleRun}
          disabled={running || !basePrompt.trim()}
        >
          {running ? "Running..." : "Run All Tests"}
        </button>
      </div>

      <div className="meta-export-row">
        <button className="clear-btn" onClick={() => downloadFile(exportJSON(), "log.json", "application/json")}>
          Export JSON
        </button>
        <button className="clear-btn" onClick={() => downloadFile(exportCSV(), "log.csv", "text/csv")}>
          Export CSV
        </button>
        <button className="clear-btn" onClick={() => { clearLogs(); setResults([]); setLogCount(0); }}>
          Clear Logs
        </button>
        <span className="meta-log-count">{logCount} log entries</span>
      </div>

      {results.length > 0 && (
        <table className="meta-table">
          <thead>
            <tr>
              <th>Run</th>
              <th>Relation</th>
              <th>Variant Prompt</th>
              <th>Verdict</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r, i) => (
              <tr
                key={i}
                className="meta-result-row"
                onClick={() => setSelectedResult(r)}
                title="Click to view full test details"
              >
                <td>{r.run}</td>
                <td>{r.relation}</td>
                <td title={r.variantPrompt} className="meta-variant-cell">
                  {r.variantPrompt || "—"}
                </td>
                <td style={{ fontWeight: 700, color: VERDICT_COLOR[r.verdict] }}>
                  {r.verdict}
                </td>
                <td className="meta-reason-cell">{r.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {selectedResult && (
        <div className="meta-modal-backdrop" onClick={() => setSelectedResult(null)}>
          <div className="meta-modal" onClick={(e) => e.stopPropagation()}>
            <div className="meta-modal-header">
              <h3>Test Details</h3>
              <button className="clear-btn" onClick={() => setSelectedResult(null)}>Close</button>
            </div>

            <div className="meta-modal-grid">
              <div><strong>Run:</strong> {selectedResult.run}</div>
              <div><strong>Relation:</strong> {selectedResult.relation}</div>
              <div>
                <strong>Verdict:</strong>{" "}
                <span style={{ color: VERDICT_COLOR[selectedResult.verdict], fontWeight: 700 }}>
                  {selectedResult.verdict}
                </span>
              </div>
            </div>

            <div className="meta-modal-block">
              <strong>Base Query Tested</strong>
              <pre className="meta-modal-pre">{selectedResult.basePrompt || "—"}</pre>
            </div>

            <div className="meta-modal-block">
              <strong>Variant Query Tested</strong>
              <pre className="meta-modal-pre">{selectedResult.variantPrompt || "—"}</pre>
            </div>

            <div className="meta-modal-block">
              <strong>Reason</strong>
              <pre className="meta-modal-pre">{selectedResult.reason || "—"}</pre>
            </div>

            <div className="meta-modal-block">
              <strong>Base LLM Output Text</strong>
              <pre className="meta-modal-pre">{selectedResult.baseCommand?.explanation || "—"}</pre>
            </div>

            <div className="meta-modal-block">
              <strong>Variant LLM Output Text</strong>
              <pre className="meta-modal-pre">{selectedResult.variantCommand?.explanation || "—"}</pre>
            </div>

            <div className="meta-modal-block">
              <strong>Base Returned Command</strong>
              <pre className="meta-modal-pre">{JSON.stringify(selectedResult.baseCommand, null, 2) || "null"}</pre>
            </div>

            <div className="meta-modal-block">
              <strong>Variant Returned Command</strong>
              <pre className="meta-modal-pre">{JSON.stringify(selectedResult.variantCommand, null, 2) || "null"}</pre>
            </div>

            <div className="meta-modal-block">
              <strong>Base Snapshot</strong>
              <pre className="meta-modal-pre">{JSON.stringify(selectedResult.baseSnapshot, null, 2) || "null"}</pre>
            </div>

            <div className="meta-modal-block">
              <strong>Variant Snapshot</strong>
              <pre className="meta-modal-pre">{JSON.stringify(selectedResult.variantSnapshot, null, 2) || "null"}</pre>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
