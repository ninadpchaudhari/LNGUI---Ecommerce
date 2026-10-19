import { useState } from "react";
import { CONTROL_IDS } from "../../shared/surface.generated.ts";
import type { AttemptRecord, TurnRecord } from "../utils/types.ts";
import { downloadFile, exportTurnsCsv } from "../utils/logging.ts";

interface Props {
  turns: readonly TurnRecord[];
  covNL: number;
  unreached: readonly string[];
  loadingMore: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  onClear: () => void;
}

const time = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleTimeString();
};

const bottom = (v: unknown) => (v === null || v === undefined ? "⊥" : String(v));

function Delta({ turn }: { turn: TurnRecord }) {
  const before = turn.dBefore.count;
  const after = turn.dAfter.count;
  const delta = after - before;
  const cls = delta === 0 ? "" : delta > 0 ? " trace-delta-up" : " trace-delta-down";
  return (
    <span className={"trace-delta" + cls}>
      {before} → {after}
      {delta !== 0 && <span className="trace-delta-n"> ({delta > 0 ? "+" : ""}{delta})</span>}
    </span>
  );
}

function Attempt({ a }: { a: AttemptRecord }) {
  const rerouted = a.resolvedModel !== null && a.resolvedModel !== a.requestedModel;
  return (
    <div className="trace-attempt">
      <div className="trace-attempt-head">
        <strong>{a.name}</strong> #{a.attempt} · {a.latencyMs} ms · <code>{a.outcome}</code>
        {a.usage?.totalTokens !== null && a.usage?.totalTokens !== undefined && (
          <> · {a.usage.totalTokens} tok</>
        )}
      </div>
      <div className="trace-attempt-meta">
        requested <code>{a.requestedModel}</code>
        {" → "}
        served <code className={rerouted ? "trace-badge-warn" : undefined}>
          {a.resolvedModel ?? "—"}
        </code>
        {rerouted && " ≠"}
        {a.responseId && <> · <code>{a.responseId}</code></>}
        {a.providerName && <> · via {a.providerName}</>}
        {a.finishReason && <> · finish: {a.finishReason}</>}
      </div>
      {a.errorMessage && <div className="trace-error">{a.errorMessage}</div>}
      <pre className="meta-modal-pre">{a.rawText ?? "(no text returned)"}
{a.rawTruncated ? "\n… [truncated]" : ""}</pre>
    </div>
  );
}

/** V diff, laid out as field · before → after. Unchanged rows are dimmed. */
function ValuationDiff({ turn }: { turn: TurnRecord }) {
  return (
    <table className="trace-diff-table">
      <tbody>
        {CONTROL_IDS.map((c) => {
          const before = turn.vBefore[c];
          const after = turn.vAfter[c];
          const moved = before !== after;
          const declared = turn.writeSet === null || turn.writeSet.includes(c);
          return (
            <tr key={c} className={moved ? "trace-row-moved" : "trace-row-still"}>
              <td>{c}</td>
              <td>{bottom(before)}</td>
              <td>{moved ? "→" : ""}</td>
              <td>{moved ? bottom(after) : ""}</td>
              <td>
                {moved && !declared && (
                  <span className="trace-badge-warn">∉ W</span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Detail({ turn }: { turn: TurnRecord }) {
  const m = turn.meta;
  const added = turn.dAfter.productIds.filter((id) => !turn.dBefore.productIds.includes(id));
  const removed = turn.dBefore.productIds.filter((id) => !turn.dAfter.productIds.includes(id));
  const sameSet = added.length === 0 && removed.length === 0;
  const reordered = sameSet && turn.dBefore.productIds.join() !== turn.dAfter.productIds.join();

  return (
    <div className="trace-detail">
      <div className="trace-stage">
        <div className="trace-stage-label">u</div>
        <div className="trace-stage-body">{turn.u}</div>
      </div>

      <div className="trace-stage-arrow">
        ↓ <em>M</em>
        {m && (
          <>
            {" "}— {m.P.requestedModel}
            {m.P.resolvedModel && m.P.resolvedModel !== m.P.requestedModel && (
              <> → <span className="trace-badge-warn">{m.P.resolvedModel}</span></>
            )}
            {" · "}{m.totalLatencyMs} ms
            {m.repaired && <> · <span className="trace-badge-warn">repaired</span></>}
          </>
        )}
      </div>

      {m?.attempts.map((a) => <Attempt key={`${a.name}-${a.attempt}`} a={a} />)}
      {m && m.attempts.length === 0 && (
        <div className="trace-attempt-meta">
          no mediator call — mode <code>{m.mode}</code>
        </div>
      )}

      <div className="trace-stage">
        <div className="trace-stage-label">q</div>
        <div className="trace-stage-body">
          <pre className="meta-modal-pre">{JSON.stringify(turn.q, null, 2)}</pre>
        </div>
      </div>

      <div className="trace-stage-arrow">↓ <em>Apply</em></div>

      <div className="trace-stage">
        <div className="trace-stage-label">V′</div>
        <div className="trace-stage-body">
          <ValuationDiff turn={turn} />
          <div className="trace-sets">
            <span>fp = {`{${turn.fp.join(", ")}}`}</span>
            <span title={turn.kind === "chat" ? "Guessed from the wording of the typed utterance (inferWriteSet)" : "Declared by the case's generation template"}>
              W = {turn.writeSet === null ? "(unlabelled)" : `{${turn.writeSet.join(", ")}}`}
              {turn.writeSet !== null && <em>{turn.kind === "chat" ? " inferred from wording" : " declared by the case"}</em>}
            </span>
          </div>
          {turn.flags.commandOverReach && (
            <div className="trace-flag trace-flag-bad">
              ⚠ command over-reach: the mediator changed {turn.flags.overReachControls.join(", ")}, which this utterance's write set W
              {turn.kind === "chat" ? " (guessed from your wording)" : ""} does not include.
              {turn.kind === "chat" && " If you did ask for it, the guess was too narrow and this is a false alarm."}
            </div>
          )}
          {turn.rejected.length > 0 && (
            <div className="trace-flag trace-flag-bad">
              ⚠ rejected by Apply:{" "}
              {turn.rejected
                .map((r) => `${r.control}=${JSON.stringify(r.value)} (${r.reason})`)
                .join(", ")}
            </div>
          )}
        </div>
      </div>

      <div className="trace-stage-arrow">↓ <em>A</em></div>

      <div className="trace-stage">
        <div className="trace-stage-label">D′</div>
        <div className="trace-stage-body">
          <Delta turn={turn} />
          {removed.length > 0 && (
            <div className="trace-removed">removed [{removed.join(", ")}]</div>
          )}
          {added.length > 0 && <div className="trace-added">added [{added.join(", ")}]</div>}
          {reordered && <div className="trace-note">same set, different order (sort only)</div>}
          {sameSet && !reordered && <div className="trace-note">no change to D</div>}
        </div>
      </div>

      {m && (
        <div className="trace-stage">
          <div className="trace-stage-label">P</div>
          <div className="trace-stage-body trace-p">
            <span>temp {m.P.temperature ?? "provider default"}</span>
            <span>top_p {m.P.topP ?? "provider default"}</span>
            <span>prompt {m.P.systemPromptHash}</span>
            <span>schema {m.P.commandSchemaHash}</span>
            <span>
              history {m.P.historyPolicy}
              {m.P.historyMaxTurns !== null && ` (k=${m.P.historyMaxTurns})`}
              {" · sent "}{m.historyTurnsEffective}/{m.historyTurnsDisplayed}
            </span>
            <span>clear action {m.P.clearActionEnabled ? "on" : "off"}</span>
            {!turn.flags.contextIntact && (
              <span className="trace-flag-bad">
                ⚠ context integrity: {m.historyTurnsDisplayed} turn(s) shown,{" "}
                {m.historyTurnsEffective} sent
              </span>
            )}
            {m.langfuse.url ? (
              <a href={m.langfuse.url} target="_blank" rel="noreferrer">
                Langfuse trace ↗
              </a>
            ) : (
              m.langfuse.traceId && <span>trace {m.langfuse.traceId}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The observability panel: every transition, newest first, expandable to the
 * full u → q → V′ → D′ chain with its P provenance.
 */
export function TracePanel(props: Props) {
  const { turns, covNL, unreached } = props;
  const [openId, setOpenId] = useState<string | null>(null);
  const [kind, setKind] = useState<"all" | "chat" | "mr">("all");

  const shown = turns.filter((t) => kind === "all" || t.kind === kind);

  return (
    <section className="metamorphic-section trace-panel">
      <div className="trace-toolbar">
        <h2>Trace</h2>
        <span className="trace-cov">
          Cov<sub>NL</sub> = {(covNL * 100).toFixed(0)}% ({CONTROL_IDS.length - unreached.length}/
          {CONTROL_IDS.length})
          {unreached.length > 0 && (
            <span className="trace-note"> · never reached: {unreached.join(", ")}</span>
          )}
        </span>
        <span className="trace-spacer" />
        <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
          <option value="all">all turns</option>
          <option value="chat">chat only</option>
          <option value="mr">metamorphic only</option>
        </select>
        <button
          className="clear-btn"
          onClick={() =>
            downloadFile(exportTurnsCsv(shown), "turns.csv", "text/csv")
          }
          disabled={shown.length === 0}
        >
          Export turns CSV
        </button>
        <button className="clear-btn" onClick={props.onClear} disabled={turns.length === 0}>
          Clear records
        </button>
      </div>

      {shown.length === 0 ? (
        <div className="empty-state">No turns recorded yet.</div>
      ) : (
        <table className="meta-table trace-table">
          <thead>
            <tr>
              <th>time</th>
              <th>kind</th>
              <th>utterance</th>
              <th>model</th>
              <th>latency</th>
              <th>tokens</th>
              <th>D</th>
              <th>flags</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((t) => {
              const m = t.meta;
              const rerouted =
                m?.P.resolvedModel != null && m.P.resolvedModel !== m.P.requestedModel;
              const open = openId === t.id;
              return [
                <tr
                  key={t.id}
                  className={"trace-row" + (open ? " trace-row-open" : "")}
                  onClick={() => setOpenId(open ? null : t.id)}
                >
                  <td>{time(t.createdAt)}</td>
                  <td>
                    <span className={"trace-badge trace-badge-" + t.kind}>
                      {t.relation ?? t.kind}
                    </span>
                  </td>
                  <td className="meta-variant-cell" title={t.u}>{t.u}</td>
                  <td>
                    <span
                      className={"trace-badge-model" + (rerouted ? " trace-badge-warn" : "")}
                      title={
                        rerouted
                          ? `requested ${m?.P.requestedModel}, served ${m?.P.resolvedModel}`
                          : undefined
                      }
                    >
                      {m?.P.resolvedModel ?? m?.P.requestedModel ?? "—"}
                      {rerouted && " ≠"}
                    </span>
                  </td>
                  <td>{m ? `${m.totalLatencyMs} ms` : "—"}</td>
                  <td>{m?.usageTotal?.totalTokens ?? "—"}</td>
                  <td><Delta turn={t} /></td>
                  <td className="trace-flags">
                    {!t.ok && <span className="trace-flag-bad">error</span>}
                    {t.flags.commandOverReach && <span className="trace-flag-bad">over-reach</span>}
                    {!t.flags.contextIntact && <span className="trace-flag-bad">context</span>}
                    {t.rejected.length > 0 && <span className="trace-flag-bad">rejected</span>}
                    {m?.repaired && <span className="trace-flag-warn">repaired</span>}
                  </td>
                </tr>,
                open ? (
                  <tr key={t.id + "-detail"}>
                    <td colSpan={8}><Detail turn={t} /></td>
                  </tr>
                ) : null,
              ];
            })}
          </tbody>
        </table>
      )}

      {props.hasMore && (
        <button className="clear-btn" onClick={props.onLoadMore} disabled={props.loadingMore}>
          {props.loadingMore ? "Loading…" : "Load more"}
        </button>
      )}
    </section>
  );
}
