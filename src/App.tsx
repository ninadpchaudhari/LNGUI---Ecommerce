import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { covNL, footprint, promptConfigFrom, unreachedControls } from "../shared/contract.ts";
import type {
  AppConfig,
  ChatMessage,
  Command,
  ControlId,
  PromptConfig,
  SystemState,
  TurnRecord,
  Valuation,
} from "./utils/types.ts";
import { renderData, resetState, visibleProducts } from "../shared/transition.ts";
import { fetchConfig, fetchTurns, resolveConfig, saveTurn } from "./utils/api.ts";
import { COMMITTED_PROMPTS } from "./utils/prompts.ts";
import { normalizePrompt } from "../shared/prompt-text.ts";
import type { Overrides } from "../shared/overrides.ts";
import { inferWriteSet } from "./utils/relations.ts";
import { runTurn } from "./utils/mediator.ts";
import { FilterPanel } from "./components/FilterPanel.tsx";
import { ProductGrid } from "./components/ProductGrid.tsx";
import { ChatPanel } from "./components/ChatPanel.tsx";
import { CHAT_MODELS, settingsFor, type ChatSettings } from "./utils/chat-models.ts";
import { TracePanel } from "./components/TracePanel.tsx";
import { ExperimentsPage } from "./components/ExperimentsPage.tsx";

type View = "benchmark" | "experiments";
const viewFromHash = (): View => (window.location.hash === "#experiments" ? "experiments" : "benchmark");

/** P before /api/config answers. Replaced on mount and by each response. */
const BOOTSTRAP_P: PromptConfig = {
  requestedModel: "",
  resolvedModel: null,
  temperature: null,
  topP: null,
  systemPromptHash: "",
  commandSchemaHash: "",
  historyPolicy: "full",
  historyMaxTurns: null,
};

export default function App() {
  const [view, setView] = useState<View>(viewFromHash);
  useEffect(() => {
    const onHash = () => setView(viewFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  // σ = ⟨V, H, P, D⟩ is the single source of truth. The filter sidebar and the
  // product grid are both projections of it, so they cannot disagree.
  const [state, setState] = useState<SystemState>(() => resetState(BOOTSTRAP_P));
  const [sessionId, setSessionId] = useState(() => crypto.randomUUID());

  const [config, setConfig] = useState<AppConfig | null>(null);
  // The chat runs as one condition: the same settings an experiment states,
  // sent as overrides, so the server's .env never fills a gap.
  const [settings, setSettings] = useState<ChatSettings>(() => settingsFor(CHAT_MODELS[0], COMMITTED_PROMPTS[0].name));
  const [resolved, setResolved] = useState<{ P: AppConfig | null; error: string | null }>({ P: null, error: null });
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

  const overrides = useMemo((): Overrides => {
    const p = COMMITTED_PROMPTS.find((x) => x.name === settings.prompt) ?? COMMITTED_PROMPTS[0];
    const base: Overrides = { SYSTEM_PROMPT: normalizePrompt(p.text), LNGUI_COMMAND_MODE: p.implementation, HISTORY_POLICY: "full" };
    const t = settings.temperature.trim();
    const topP = settings.topP.trim();
    return {
      ...base,
      LLM_PROVIDER: settings.provider,
      LLM_MODEL: settings.model,
      ...(t ? { LLM_TEMPERATURE: t } : {}),
      ...(topP ? { LLM_TOP_P: topP } : {}),
    };
  }, [settings]);
  // The same rule as an experiment condition (shared/experiment.ts).
  const settingsProblem = !settings.temperature.trim() && !settings.topP.trim() ? "Set a temperature or a top_p." : null;

  // P as the server resolves these settings: what the next turn will run under.
  useEffect(() => {
    let live = true;
    const t = window.setTimeout(async () => {
      try {
        const P = await resolveConfig(overrides);
        if (!live) return;
        setResolved({ P, error: null });
        setState((prev) => ({ ...prev, P: promptConfigFrom(P, P.defaultModel) }));
      } catch (e) {
        if (live) setResolved({ P: null, error: e instanceof Error ? e.message : String(e) });
      }
    }, 300);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [overrides]);

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
    if (settingsProblem || resolved.error) return;
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setLoading(true);
    const before = state.V;
    try {
      const { state: next, record: turn } = await runTurn(state, text, {
        overrides,
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
    setState(resetState(resolved.P ? promptConfigFrom(resolved.P, resolved.P.defaultModel) : BOOTSTRAP_P));
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

  // The newest record of this session only; the store also holds earlier sessions and saved runs.
  const lastTurn = turns.find((t) => t.sessionId === sessionId) ?? null;

  return (
    <div className="app">
      <header className="header header-nav">
        <h1>Chat-Assisted Ecommerce Case Study</h1>
        <nav className="view-tabs" aria-label="View">
          <a href="#benchmark" className={view === "benchmark" ? "on" : ""} aria-current={view === "benchmark" ? "page" : undefined}>Benchmark</a>
          <a href="#experiments" className={view === "experiments" ? "on" : ""} aria-current={view === "experiments" ? "page" : undefined}>Experiments</a>
        </nav>
      </header>

      {view === "experiments" ? (
        <ExperimentsPage config={config} />
      ) : (
      <>
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
          settings={settings}
          onSettingsChange={setSettings}
          resolvedP={resolved.P}
          settingsError={settingsProblem ?? resolved.error ?? (resolved.P?.mode === "llm" && resolved.P.provider === "none" ? "The server has no API key for this provider." : null)}
          loading={loading}
          onSend={handleSend}
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
      </>
      )}
    </div>
  );
}
