/**
 * HTTP client for the API. Every failure path preserves `meta`, so a failed
 * turn reaches the trace panel instead of being swallowed into a chat bubble.
 */
import type {
  AppConfig,
  CommandMeta,
  CommandResponse,
  History,
  MrCaseRecord,
  TurnRecord,
} from "../../shared/contract.ts";

/**
 * Requests are relative in the browser. Setting `globalThis.LNGUI_API_BASE`
 * lets the same client code drive the API from Node — which is what makes a
 * headless sweep possible without a browser.
 */
function url(path: string): string {
  const base = (globalThis as { LNGUI_API_BASE?: string }).LNGUI_API_BASE;
  return base ? `${base.replace(/\/$/, "")}${path}` : path;
}

/** Carries the server's meta through a rejection, so failures stay observable. */
export class CommandApiError extends Error {
  status: number;
  meta: CommandMeta | null;
  body: unknown;

  constructor(message: string, status: number, meta: CommandMeta | null, body: unknown) {
    super(message);
    this.name = "CommandApiError";
    this.status = status;
    this.meta = meta;
    this.body = body;
  }
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { error: text.slice(0, 500) };
  }
}

export interface SendCommandOptions {
  model?: string;
  history?: History;
  /** Turns visible on screen, which may exceed what the policy actually sends. */
  historyDisplayedCount?: number;
  sessionId?: string;
}

export async function sendCommand(
  prompt: string,
  options: SendCommandOptions = {},
): Promise<CommandResponse> {
  const res = await fetch(url("/api/command"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      ...(options.model ? { model: options.model } : {}),
      history: options.history ?? [],
      historyDisplayedCount: options.historyDisplayedCount ?? options.history?.length ?? 0,
      ...(options.sessionId ? { sessionId: options.sessionId } : {}),
    }),
  });

  const body = await readJson(res);
  if (!res.ok) {
    const b = body as { error?: string; detail?: string; meta?: CommandMeta };
    throw new CommandApiError(
      b.detail ? `${b.error}: ${b.detail}` : (b.error ?? `API ${res.status}`),
      res.status,
      b.meta ?? null,
      body,
    );
  }
  return body as CommandResponse;
}

export async function fetchConfig(): Promise<AppConfig> {
  const res = await fetch(url("/api/config"));
  if (!res.ok) throw new Error(`GET /api/config failed: ${res.status}`);
  return (await res.json()) as AppConfig;
}

/**
 * Fire-and-forget. `keepalive` so a turn issued just before navigation still
 * lands, and a persistence failure never blocks the UI.
 */
export function saveTurn(record: TurnRecord): void {
  void fetch(url("/api/runs"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(record),
    keepalive: true,
  }).catch(() => {});
}

export function saveMrCase(record: MrCaseRecord): void {
  void fetch(url("/api/mr-cases"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(record),
    keepalive: true,
  }).catch(() => {});
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export async function fetchTurns(params: {
  limit?: number;
  cursor?: string | null;
  sessionId?: string;
  kind?: string;
} = {}): Promise<Page<TurnRecord>> {
  const q = new URLSearchParams();
  q.set("limit", String(params.limit ?? 50));
  if (params.cursor) q.set("cursor", params.cursor);
  if (params.sessionId) q.set("sessionId", params.sessionId);
  if (params.kind) q.set("kind", params.kind);

  const res = await fetch(url(`/api/runs?${q.toString()}`));
  if (!res.ok) return { items: [], nextCursor: null };
  return (await res.json()) as Page<TurnRecord>;
}

export async function fetchMrCases(params: { limit?: number; sessionId?: string } = {}): Promise<
  Page<MrCaseRecord>
> {
  const q = new URLSearchParams();
  q.set("limit", String(params.limit ?? 50));
  if (params.sessionId) q.set("sessionId", params.sessionId);

  const res = await fetch(url(`/api/mr-cases?${q.toString()}`));
  if (!res.ok) return { items: [], nextCursor: null };
  return (await res.json()) as Page<MrCaseRecord>;
}
