import { useState } from "react";
import type { AppConfig, ChatMessage, Command, TurnRecord } from "../utils/types.ts";
import { ModelPicker } from "./ModelPicker.tsx";

interface Props {
  messages: ChatMessage[];
  lastCommand: Command | null;
  lastTurn: TurnRecord | null;
  config: AppConfig | null;
  model: string;
  loading: boolean;
  onSend: (text: string) => void;
  onModelChange: (model: string) => void;
  onReset: () => void;
  historyTurns: number;
}

/** The always-visible provenance line, so the mediator is never invisible. */
function StatusLine({ turn }: { turn: TurnRecord | null }) {
  if (!turn?.meta) {
    return <p className="model-line">no mediator call yet</p>;
  }
  const m = turn.meta;
  const rerouted = m.P.resolvedModel != null && m.P.resolvedModel !== m.P.requestedModel;
  const warn = rerouted || m.repaired || !turn.ok || turn.flags.commandOverReach;

  return (
    <p className={"model-line" + (warn ? " model-line-warn" : "")}>
      {m.P.resolvedModel ?? m.P.requestedModel}
      {rerouted && <span title={`requested ${m.P.requestedModel}`}> ≠</span>}
      {" · "}{m.totalLatencyMs} ms
      {m.usageTotal?.totalTokens != null && <> · {m.usageTotal.totalTokens} tok</>}
      {" · "}{turn.dBefore.count} → {turn.dAfter.count}
      {m.repaired && " · repaired"}
      {turn.flags.commandOverReach && " · over-reach"}
      {!turn.flags.contextIntact && " · context mismatch"}
    </p>
  );
}

export function ChatPanel(props: Props) {
  const { messages, lastCommand, lastTurn, loading } = props;
  const [input, setInput] = useState("");
  const [debugOpen, setDebugOpen] = useState(false);

  const send = () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    props.onSend(text);
  };

  return (
    <div className="chat-panel">
      <div className="chat-panel-head">
        <h2>Chat Assistant</h2>
        <button
          className="clear-btn"
          onClick={props.onReset}
          disabled={loading}
          title="ResetApp: σ₀ — clears H and returns every control to V₀"
        >
          Reset session
        </button>
      </div>

      <p className="chat-hint">
        Describe what you want to see. The assistant updates filters and sorting.
      </p>

      <ModelPicker
        config={props.config}
        model={props.model}
        onChange={props.onModelChange}
        disabled={loading}
      />

      <div className="chat-history">
        {messages.map((m, i) => (
          <div
            key={i}
            className={
              "chat-msg chat-msg-" + m.role + (m.isError ? " chat-msg-error" : "")
            }
          >
            <strong>{m.role === "user" ? "You" : "Assistant"}: </strong>
            {m.content}
          </div>
        ))}
        {loading && <div className="chat-msg chat-msg-loading">Thinking...</div>}
      </div>

      <div className="chat-input-row">
        <textarea
          className="chat-textarea"
          value={input}
          placeholder='e.g. "show electronics under $100 sorted by rating"'
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button className="chat-send-btn" onClick={send} disabled={loading || !input.trim()}>
          Send
        </button>
      </div>

      <StatusLine turn={lastTurn} />

      <p className="chat-context-line">
        H: {props.historyTurns} turn{props.historyTurns === 1 ? "" : "s"}
        {props.config && (
          <>
            {" "}· policy <code>{props.config.historyPolicy}</code>
            {props.config.historyMaxTurns !== null && ` (k=${props.config.historyMaxTurns})`}
            {props.config.historyPolicy === "none" && (
              <span className="trace-flag-bad"> · history not sent</span>
            )}
          </>
        )}
      </p>

      <button className="debug-toggle" onClick={() => setDebugOpen((v) => !v)}>
        {debugOpen ? "Hide" : "Show"} last command JSON
      </button>
      {debugOpen && (
        <pre className="debug-json">
          {lastCommand ? JSON.stringify(lastCommand, null, 2) : "No command yet."}
        </pre>
      )}
    </div>
  );
}
