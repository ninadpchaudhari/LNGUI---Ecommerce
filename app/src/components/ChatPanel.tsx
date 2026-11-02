import { useState } from "react";
import type { AppConfig, ChatMessage, Command, TurnRecord } from "../utils/types.ts";
import { COMMITTED_PROMPTS, describeP, promptNameOf } from "../utils/prompts.ts";
import { CHAT_MODELS, chatEfforts, settingsFor, takesNoSampling, type ChatSettings } from "../utils/chat-models.ts";

interface Props {
  messages: ChatMessage[];
  lastCommand: Command | null;
  lastTurn: TurnRecord | null;
  settings: ChatSettings;
  onSettingsChange: (s: ChatSettings) => void;
  /** P as the server resolves the settings, or null while unresolved. */
  resolvedP: AppConfig | null;
  /** Why the settings cannot run, if they cannot. */
  settingsError: string | null;
  loading: boolean;
  onSend: (text: string) => void;
  onReset: () => void;
  historyTurns: number;
}

/** The last call: what was served and what it did. P itself is the line above. */
function StatusLine({ turn }: { turn: TurnRecord | null }) {
  if (!turn?.meta) {
    return <p className="model-line">no mediator call yet</p>;
  }
  const m = turn.meta;
  const rerouted = m.P.resolvedModel != null && m.P.resolvedModel !== m.P.requestedModel;
  const warn = rerouted || !turn.ok || turn.flags.commandOverReach;

  return (
    <p className={"model-line" + (warn ? " model-line-warn" : "")}>
      last call: {m.P.resolvedModel ?? m.P.requestedModel}
      {rerouted && <span title={`requested ${m.P.requestedModel}`}> ≠</span>}
      {" · "}{m.totalLatencyMs} ms
      {m.usageTotal?.totalTokens != null && <> · {m.usageTotal.totalTokens} tok</>}
      {" · "}{turn.dBefore.count} → {turn.dAfter.count}
      {turn.flags.commandOverReach && " · over-reach"}
      {!turn.flags.contextIntact && " · context mismatch"}
    </p>
  );
}

/** Model, prompt and sampling. Fixed for a session, as P is for a trace. */
function Settings({ settings: s, onChange, locked }: {
  settings: ChatSettings;
  onChange: (s: ChatSettings) => void;
  locked: boolean;
}) {
  const set = (patch: Partial<ChatSettings>) => onChange({ ...s, ...patch });
  const fixed = takesNoSampling(s);
  return (
    <fieldset className="chat-settings" disabled={locked}>
      <label className="model-picker-label">
        model
        <select value={s.model} onChange={(e) => {
          const m = CHAT_MODELS.find((x) => x.model === e.target.value);
          if (m) onChange(settingsFor(m, s.prompt));
        }}>
          {CHAT_MODELS.map((m) => <option key={m.model} value={m.model}>{m.label}</option>)}
        </select>
      </label>
      <label className="model-picker-label">
        prompt
        <select value={s.prompt} onChange={(e) => set({ prompt: e.target.value })}>
          {COMMITTED_PROMPTS.map((p) => <option key={p.name} value={p.name}>{p.name} ({p.implementation})</option>)}
        </select>
      </label>
      <div className="chat-settings-row">
        <label className="model-picker-label">
          temperature
          <input className="model-picker-input" value={s.temperature} disabled={fixed} placeholder={fixed ? "not accepted" : "not sent"} onChange={(e) => set({ temperature: e.target.value })} />
        </label>
        <label className="model-picker-label">
          top_p
          <input className="model-picker-input" value={s.topP} disabled={fixed} placeholder={fixed ? "not accepted" : "not sent"} onChange={(e) => set({ topP: e.target.value })} />
        </label>
      </div>
      {chatEfforts(s) && (
        <label className="model-picker-label">
          reasoning
          <select value={s.reasoning} onChange={(e) => set({ reasoning: e.target.value })}>
            {chatEfforts(s)!.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
      )}
      {locked && <p className="chat-hint">Settings are fixed for the session. Reset the session to change them.</p>}
    </fieldset>
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

      <Settings
        settings={props.settings}
        onChange={props.onSettingsChange}
        locked={loading || props.historyTurns > 0}
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
        <button className="chat-send-btn" onClick={send} disabled={loading || !input.trim() || props.settingsError !== null}>
          Send
        </button>
      </div>

      {props.settingsError ? (
        <p className="model-line model-line-warn">{props.settingsError}</p>
      ) : (
        <p className="model-line">
          {props.resolvedP
            ? describeP(props.resolvedP, promptNameOf(props.resolvedP.systemPromptHash) ?? "custom")
            : "resolving P…"}
        </p>
      )}
      <StatusLine turn={lastTurn} />

      <p className="chat-context-line">
        next message is sent with {props.historyTurns === 0
          ? "no earlier turns"
          : `the ${props.historyTurns} earlier turn${props.historyTurns === 1 ? "" : "s"} of this session`}
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
