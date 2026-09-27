import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { covNL, footprint, unreachedControls } from "../shared/contract.ts";
import type {
  AppConfig,
  ChatMessage,
  Command,
  ControlId,
  MrCaseRecord,
  PromptConfig,
  SystemState,
  TurnRecord,
  Valuation,
} from "./utils/types.ts";
import { renderData, resetState, visibleProducts } from "../shared/transition.ts";
import { fetchConfig, fetchTurns, saveTurn } from "./utils/api.ts";
import { inferWriteSet } from "./utils/relations.ts";
import { runTurn } from "./utils/mediator.ts";
import { FilterPanel } from "./components/FilterPanel.tsx";
import { ProductGrid } from "./components/ProductGrid.tsx";
import { ChatPanel } from "./components/ChatPanel.tsx";
import { TracePanel } from "./components/TracePanel.tsx";
import { MetamorphicPanel } from "./components/MetamorphicPanel.tsx";

/** P before /api/config answers. Replaced on mount and by each response. */
const BOOTSTRAP_P: PromptConfig = {
  requestedModel: "",
  resolvedModel: null,
  temperature: 0,
  topP: 1,
  systemPromptHash: "",
  commandSchemaHash: "",
  historyPolicy: "full",
  historyMaxTurns: null,
  clearActionEnabled: true,
};

function promptConfigFrom(config: AppConfig, model: string): PromptConfig {
  return {
    requestedModel: model,
    resolvedModel: null,
    temperature: config.temperature,
    topP: config.topP,
    systemPromptHash: config.systemPromptHash,
    commandSchemaHash: config.commandSchemaHash,
    historyPolicy: config.historyPolicy,
    historyMaxTurns: config.historyMaxTurns,
    clearActionEnabled: config.clearActionEnabled,
  };
}

export default function App() {
  // σ = ⟨V, H, P, D⟩ is the single source of truth. The filter sidebar and the
  // product grid are both projections of it, so they cannot disagree.
  const [state, setState] = useState<SystemState>(() => resetState(BOOTSTRAP_P));
  const [sessionId, setSessionId] = useState(() => crypto.randomUUID());

  const [config, setConfig] = useState<AppConfig | null>(null);
  const [model, setModel] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [lastCommand, setLastCommand] = useState<Command | null>(null);
  const [loading, setLoading] = useState(false);

  const [turns, setTurns] = useState<TurnRecord[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [lastFootprint, setLastFootprint] = useState<readonly ControlId[]>([]);

  const turnIndex = useRef(0);

  // On mount: read P from the server, then seed the panel from persisted
  // records so the trace survives a reload.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const c = await fetchConfig();
        if (cancelled) return;
        setConfig(c);
        setModel(c.defaultModel);
        setState((prev) => ({ ...prev, P: promptConfigFrom(c, c.defaultModel) }));
      } catch {
        // Leave the bootstrap P in place; the first response will correct it.
      }
      const page = await fetchTurns({ limit: 50 });
      if (cancelled) return;
      setTurns(page.items);
      setCursor(page.nextCursor);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (config) setState((prev) => ({ ...prev, P: promptConfigFrom(config, model) }));
  }, [config, model]);

  const displayed = useMemo(() => visibleProducts(state.V), [state.V]);

  const footprints = useMemo(() => turns.map((t) => t.fp), [turns]);
  const coverage = useMemo(() => covNL(footprints), [footprints]);
  const unreached = useMemo(() => unreachedControls(footprints), [footprints]);

  const record = useCallback((r: TurnRecord) => {
    setTurns((prev) => [r, ...prev.filter((t) => t.id !== r.id)]);
    saveTurn(r);
  }, []);

  /**
   * One chat turn. σ′ is computed by the pure reducer inside `runTurn` and
   * applied wholesale — never read back out of React state, which would observe the
   * previous render's values.
   */
  const handleSend = async (text: string) => {
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setLoading(true);
    const before = state.V;
    try {
      const { state: next, record: turn } = await runTurn(state, text, {
        ...(model ? { model } : {}),
        sessionId,
        turnIndex: turnIndex.current++,
        kind: "chat",
        writeSet: inferWriteSet(text),
      });

      setState(next);
      setLastFootprint(footprint(before, next.V));
      if (turn.q) setLastCommand(turn.q);
      setMessages((prev) => [
        ...prev,
        turn.ok
          ? { role: "assistant", content: turn.q?.explanation ?? "(no explanation)", turnId: turn.id }
          : { role: "assistant", content: `Error: ${turn.error}`, turnId: turn.id, isError: true },
      ]);
      record(turn);
    } finally {
      setLoading(false);
    }
  };

  /** Direct manipulation of a control, bypassing the mediator. */
  const handleValuationChange = (V: Valuation) => {
    setLastFootprint(footprint(state.V, V));
    setState((prev) => ({ ...prev, V, D: renderData(V) }));
  };

  /** ResetApp — σ₀: V₀, empty H, fixed P, canonical D. */
  const handleReset = () => {
    setState(resetState(config ? promptConfigFrom(config, model) : BOOTSTRAP_P));
    setSessionId(crypto.randomUUID());
    setMessages([]);
    setLastCommand(null);
    setLastFootprint([]);
    turnIndex.current = 0;
  };

  const handleClearFilters = () => {
    const V: Valuation = { ...state.V };
    for (const key of Object.keys(config?.v0 ?? {}) as ControlId[]) {
      (V as Record<ControlId, unknown>)[key] = (config?.v0 ?? {})[key];
    }
    handleValuationChange(V);
  };

  const handleLoadMore = async () => {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const page = await fetchTurns({ limit: 50, cursor });
      setTurns((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  };

  const handleClearRecords = async () => {
    await fetch("/api/runs", { method: "DELETE" }).catch(() => {});
    setTurns([]);
    setCursor(null);
  };

  const lastTurn = turns.length > 0 ? turns[0] : null;

  return (
    <div className="app">
      <header className="header">
        <h1>Chat-Assisted Ecommerce Case Study</h1>
      </header>

      <div className="layout">
        <FilterPanel
          V={state.V}
          lastFootprint={lastFootprint}
          onChange={handleValuationChange}
          onClear={handleClearFilters}
        />

        <main className="main">
          <p className="count-line">
            Showing {state.D.count} of {state.D.total} products
          </p>
          <ProductGrid products={displayed} />
        </main>

        <ChatPanel
          messages={messages}
          lastCommand={lastCommand}
          lastTurn={lastTurn}
          config={config}
          model={model}
          loading={loading}
          onSend={handleSend}
          onModelChange={setModel}
          onReset={handleReset}
          historyTurns={state.H.length}
        />
      </div>

      <TracePanel
        turns={turns}
        covNL={coverage}
        unreached={unreached}
        loadingMore={loadingMore}
        hasMore={cursor !== null}
        onLoadMore={handleLoadMore}
        onClear={handleClearRecords}
      />

      <MetamorphicPanel
        config={config}
        model={model}
        sessionId={sessionId}
        P={state.P}
        onTurn={record}
        onCases={(cases: MrCaseRecord[]) => void cases}
      />
    </div>
  );
}
