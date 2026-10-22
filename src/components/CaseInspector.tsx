/**
 * The cases behind one report row. Each case lists its trials, and each trial
 * shows what decided its verdict: the source and follow-up requests, the
 * command the mediator returned for each, the changes those commands made,
 * and the reason the relation held or failed.
 *
 * Trial rows carry the verdict; the requests and commands live in the turn
 * records, joined by TrialRow.turnIds. Without turn records (an older
 * trials.jsonl loaded on its own) the inspector still shows verdicts, reasons
 * and the final observations.
 */
import { useState } from "react";
import type { Command, TurnRecord, Valuation } from "../../shared/contract.ts";
import type { MrCase } from "../../shared/cases.ts";
import { caseStats } from "../../shared/report.ts";
import type { TrialRow } from "../../shared/trials.ts";
import { CONTROL_IDS } from "../../shared/surface.generated.ts";
import { TurnDetail } from "./TracePanel.tsx";

export interface InspectorSelection {
  conditionId: string;
  /** A report group (MR row), or null when a single case is selected. */
  group: string | null;
  caseId: string | null;
  label: string;
}

type Filter = "all" | "fail" | "overreach";

const bottom = (v: unknown) => (v === null || v === undefined ? "⊥" : JSON.stringify(v));

const matches = (t: TrialRow, f: Filter) =>
  f === "all" || (f === "fail" ? t.status === "fail" : t.overReach);

/** A command in one line: the assignments it asks for, then sort and clear. */
function commandText(q: Command | null): string {
  if (q === null) return "no command";
  const parts: string[] = [];
  if (q.clearFilters) parts.push("clear all");
  for (const [k, v] of Object.entries(q.filters ?? {})) {
    if (v !== undefined) parts.push(`${k} = ${bottom(v)}`);
  }
  if (q.sort !== undefined && q.sort !== null) parts.push(`sort = ${q.sort}`);
  return parts.length ? parts.join(", ") : "no changes";
}

function changed(before: Valuation, after: Valuation) {
  return CONTROL_IDS.filter((c) => before[c] !== after[c]).map((c) => ({ c, before: before[c], after: after[c] }));
}

function TurnLine({ turn }: { turn: TurnRecord }) {
  const [open, setOpen] = useState(false);
  const moves = changed(turn.vBefore, turn.vAfter);
  return (
    <li className="ci-turn">
      <button type="button" className="ci-turn-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span aria-hidden="true">{open ? "▾" : "▸"}</span>
        <span className="ci-u">“{turn.u}”</span>
      </button>
      <div className="ci-turn-body">
        <div><span className="ci-k">Command</span> <code>{commandText(turn.q)}</code></div>
        <div>
          <span className="ci-k">Changes</span>{" "}
          {moves.length === 0 ? <span className="xp-dim">none</span> : moves.map(({ c, before, after }) => (
            <span key={c} className={turn.flags.overReachControls.includes(c) ? "ci-chg ci-bad" : "ci-chg"}>
              {c}: {bottom(before)} → {bottom(after)}
              {turn.flags.overReachControls.includes(c) && " (not allowed)"}
            </span>
          ))}
          <span className="xp-dim"> · results {turn.dBefore.count} → {turn.dAfter.count}</span>
        </div>
        {turn.rejected.length > 0 && (
          <div className="ci-bad">Rejected: {turn.rejected.map((r) => `${r.control} = ${bottom(r.value)} (${r.reason})`).join(", ")}</div>
        )}
        {turn.error && <div className="ci-bad">Error: {turn.error}</div>}
        {open && <TurnDetail turn={turn} />}
      </div>
    </li>
  );
}

function Trace({ title, turns, fallback }: { title: string; turns: TurnRecord[] | null; fallback: readonly string[] | undefined }) {
  return (
    <div className="ci-trace">
      <h5>{title}</h5>
      {turns !== null ? (
        turns.length ? <ol>{turns.map((t) => <TurnLine key={t.id} turn={t} />)}</ol> : <p className="xp-dim">Initial state (σ₀), no requests.</p>
      ) : fallback ? (
        fallback.length ? <ol>{fallback.map((u, i) => <li key={i} className="ci-turn"><span className="ci-u">“{u}”</span></li>)}</ol> : <p className="xp-dim">Initial state (σ₀), no requests.</p>
      ) : (
        <p className="xp-dim">Requests not available.</p>
      )}
    </div>
  );
}

/** Where the two traces ended up, with the controls that differ marked. */
function Observations({ t }: { t: TrialRow }) {
  const s = t.observations.source;
  const f = t.observations.followup;
  if (!s?.V || !f?.V) return null;
  const differ = CONTROL_IDS.filter((c) => s.V[c] !== f.V[c]);
  return (
    <div className="ci-obs">
      <span className="ci-k">Final states</span>{" "}
      {differ.length === 0
        ? <span className="xp-dim">source and follow-up end with the same filters</span>
        : differ.map((c) => <span key={c} className="ci-chg">{c}: source {bottom(s.V[c])}, follow-up {bottom(f.V[c])}</span>)}
      <span className="xp-dim"> · results {s.D.count} vs {f.D.count}</span>
    </div>
  );
}

function Trial({ t, turns, mrCase }: { t: TrialRow; turns: ReadonlyMap<string, TurnRecord> | null; mrCase?: MrCase }) {
  const records = turns ? t.turnIds.map((id) => turns.get(id)).filter((r): r is TurnRecord => r !== undefined) : null;
  const have = records !== null && records.length === t.turnIds.length ? records : null;
  return (
    <div className={`ci-trial ci-${t.status}`}>
      <div className="ci-trial-head">
        <b>Trial {t.trial}</b>
        <span className={`ci-badge ci-badge-${t.status}`}>{t.status}</span>
        {t.overReach && <span className="ci-badge ci-badge-fail">over-reach: {t.overReachControls.join(", ")}</span>}
        {!t.contextIntact && <span className="ci-badge ci-badge-infra">context not intact</span>}
        {t.attempt > 1 && <span className="xp-dim">attempt {t.attempt}</span>}
      </div>
      <div className="ci-reason"><span className="ci-k">Verdict reason</span> {t.reason || <span className="xp-dim">none recorded</span>}</div>
      <div className="ci-traces">
        <Trace title="Source" turns={have && have.filter((r) => r.role === "source")} fallback={mrCase?.sourceTrace} />
        <Trace title="Follow-up" turns={have && have.filter((r) => r.role === "followup")} fallback={mrCase?.followupTrace} />
      </div>
      <Observations t={t} />
    </div>
  );
}

export function CaseInspector({
  rows,
  turns,
  cases,
  selection,
  onClose,
}: {
  rows: readonly TrialRow[];
  /** Turn records by id, or null when none are loaded. */
  turns: ReadonlyMap<string, TurnRecord> | null;
  cases: ReadonlyMap<string, MrCase>;
  selection: InspectorSelection;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState<Filter>(selection.caseId ? "all" : "fail");
  // Held here, not left to <details>, so a re-render during a run does not close them.
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const flip = (id: string) =>
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const scoped = rows.filter((r) => r.conditionId === selection.conditionId && (selection.caseId ? r.caseId === selection.caseId : true));
  const stats = caseStats(scoped)
    .filter((s) => selection.group === null || s.group === selection.group)
    .sort((a, b) => a.caseId.localeCompare(b.caseId));
  const counts = {
    all: stats.length,
    fail: stats.filter((s) => s.fails > 0).length,
    overreach: stats.filter((s) => s.overReachTrials > 0).length,
  };
  const shown = stats.filter((s) => filter === "all" || (filter === "fail" ? s.fails > 0 : s.overReachTrials > 0));
  const missingTurns = turns === null || scoped.some((r) => r.turnIds.some((id) => !turns.has(id)));

  return (
    <div className="ci" aria-label={`Cases for ${selection.label}`}>
      <div className="ci-head">
        <h4>{selection.label}</h4>
        <div className="xp-tabs" role="group" aria-label="Filter cases">
          {(["all", "fail", "overreach"] as const).map((f) => (
            <button key={f} type="button" className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>
              {f === "all" ? "All" : f === "fail" ? "Failed" : "Over-reach"} ({counts[f]})
            </button>
          ))}
        </div>
        <button type="button" onClick={onClose}>Close</button>
      </div>
      {missingTurns && (
        <p className="xp-note">
          Turn records are not loaded for every trial, so commands and changes are missing where noted. Load the run's turns.jsonl to see them.
        </p>
      )}
      {shown.length === 0 && <p className="xp-note">No cases match this filter.</p>}
      {shown.map((s) => {
        const mrCase = cases.get(s.caseId);
        const trials = scoped
          .filter((r) => r.caseId === s.caseId)
          .sort((a, b) => a.trial - b.trial)
          .filter((t) => matches(t, filter));
        return (
          <details key={s.caseId} className="ci-case" open={shown.length === 1 || openIds.has(s.caseId)}>
            <summary onClick={(e) => {
              e.preventDefault();
              flip(s.caseId);
            }}>
              <code>{s.caseId}</code>
              {selection.group === null && <span className="xp-dim">{s.group}</span>}
              <span>{s.fails} / {s.n} failed</span>
              {s.overReachTrials > 0 && <span className="ci-bad">{s.overReachTrials} over-reach</span>}
              {s.infra > 0 && <span className="xp-dim">{s.infra} infra</span>}
            </summary>
            {mrCase?.description && <p className="xp-note">{mrCase.description}</p>}
            {trials.map((t) => <Trial key={`${t.trial}-${t.attempt}`} t={t} turns={turns} mrCase={mrCase} />)}
          </details>
        );
      })}
    </div>
  );
}
