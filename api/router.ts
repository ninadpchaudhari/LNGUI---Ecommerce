/**
 * One router, two runtimes.
 *
 * Returns `null` for any path outside /api/, so the Worker can fall through to
 * static assets and the Express server can 404. Plain URL.pathname matching —
 * six routes do not justify a router library.
 */
import { SCHEMA_VERSION, type AppConfig } from "../shared/contract.ts";
import { CONTROLS, V0 } from "../shared/surface.generated.ts";
import { handleCommandRequest, type CommandDeps } from "./command.ts";
import {
  isLocalTestMode,
  langfuseEnabled,
  ollamaRoot,
  resolveHistoryConfig,
  resolveLLMConfig,
  resolveModelPolicy,
  resolveSystemPrompt,
  resolveCommandMode,
  type CommandRuntimeEnv,
  type RuntimeEnv,
} from "./config.ts";
import { promptHashes } from "./prompt.ts";
import { OVERRIDE_KEYS, checkOverrides, type Overrides } from "../shared/overrides.ts";
import {
  ValidationError,
  clampLimit,
  normalizeMrCaseRecord,
  normalizeTurnRecord,
  type TurnListQuery,
  type TurnStore,
} from "./store.ts";

export interface ApiDeps extends CommandDeps {
  store: TurnStore | null;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function buildConfig(env: RuntimeEnv, persistence: AppConfig["persistence"]): AppConfig {
  const llm = resolveLLMConfig(env);
  const policy = resolveModelPolicy(env);
  const history = resolveHistoryConfig(env);
  const commandMode = resolveCommandMode(env);
  const hashes = promptHashes(resolveSystemPrompt(env), commandMode);

  return {
    schemaVersion: SCHEMA_VERSION,
    mode: isLocalTestMode(env) ? "local-test" : "llm",
    provider: isLocalTestMode(env) ? "local-test" : llm.provider,
    baseURL: llm.baseURL ?? null,
    defaultModel: policy.defaultModel,
    models: policy.models,
    allowAnyModel: policy.allowAnyModel,
    temperature: llm.temperature,
    topP: llm.topP,
    systemPromptHash: hashes.systemPromptHash,
    commandSchemaHash: hashes.commandSchemaHash,
    historyPolicy: history.policy,
    historyMaxTurns: history.maxTurns,
    commandMode,
    langfuseEnabled: langfuseEnabled(env),
    persistence,
    controls: CONTROLS,
    v0: { ...V0 },
  };
}

function listQuery(url: URL): TurnListQuery {
  const sessionId = url.searchParams.get("sessionId");
  const kind = url.searchParams.get("kind");
  const cursor = url.searchParams.get("cursor");
  return {
    limit: clampLimit(url.searchParams.get("limit")),
    ...(cursor ? { cursor } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(kind ? { kind } : {}),
  };
}

/** Routes whose JSON body may carry `overrides`: the two that resolve P. */
const OVERRIDE_ROUTES = new Set(["/api/command", "/api/config"]);

/**
 * Merges a request's P overrides (the `overrides` object in its JSON body)
 * over the server environment.
 *
 * A request whose overrides are malformed is rejected outright.
 * Ignoring them would run the request under a
 * P the caller did not ask for, and the caller would record the wrong one.
 *
 * The body is read from a clone, so the handler can still read the original.
 */
export async function applyOverrides(
  request: Request,
  env: RuntimeEnv,
  path: string,
): Promise<{ env: RuntimeEnv } | { error: string; status: number }> {
  if (request.method !== "POST" || !OVERRIDE_ROUTES.has(path)) return { env };
  let raw: unknown;
  try {
    raw = ((await request.clone().json()) as { overrides?: unknown } | null)?.overrides;
  } catch {
    return { env };
  }
  if (raw === undefined) return { env };

  const { overrides, problems } = checkOverrides(raw);
  if (problems.length > 0) return { error: `Invalid overrides: ${problems.join("; ")}`, status: 400 };
  // Every P key the condition leaves out is explicitly unset, so the server's
  // .env cannot leak into a condition (see getEnvVar).
  const unset = Object.fromEntries(OVERRIDE_KEYS.map((k) => [k, ""])) as Overrides;
  return { env: { ...env, ...unset, ...overrides } };
}

export async function handleApiRequest(
  request: Request,
  runtimeEnv: CommandRuntimeEnv | RuntimeEnv,
  deps: ApiDeps,
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith("/api/")) return null;

  const merged = await applyOverrides(request, runtimeEnv as RuntimeEnv, path);
  if ("error" in merged) return json({ error: merged.error }, merged.status);
  const env = merged.env;
  const { store } = deps;

  if (path === "/api/command") {
    return handleCommandRequest(request, env, deps);
  }

  if (path === "/api/ollama/models" && request.method === "GET") {
    // Lists models installed in the server's Ollama, for the Experiments page.
    try {
      const res = await fetch(`${ollamaRoot(env)}/api/tags`, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) return json({ models: [], error: `Ollama answered ${res.status}` });
      const body = (await res.json()) as { models?: Array<{ name?: string }> };
      return json({ models: (body.models ?? []).map((m) => m.name).filter(Boolean) });
    } catch {
      return json({ models: [], error: `No Ollama server at ${ollamaRoot(env)}` });
    }
  }

  // GET reads the server's own P. POST with `overrides` resolves a condition's P.
  if (path === "/api/config" && (request.method === "GET" || request.method === "POST")) {
    return json(buildConfig(env, store ? store.kind : "none"));
  }

  // ── Turn records ──────────────────────────────────────────────────────────

  if (path === "/api/runs") {
    if (request.method === "POST") {
      if (!store) return json({ error: "No persistence configured" }, 503);
      try {
        const record = normalizeTurnRecord(await request.json());
        await store.putTurn(record);
        return json({ id: record.id }, 201);
      } catch (e) {
        const message = e instanceof Error ? e.message : "Invalid turn record";
        return json({ error: message }, e instanceof ValidationError ? 400 : 500);
      }
    }
    if (request.method === "GET") {
      if (!store) return json({ items: [], nextCursor: null });
      return json(await store.listTurns(listQuery(url)));
    }
    if (request.method === "DELETE") {
      if (!store) return json({ error: "No persistence configured" }, 503);
      const sessionId = url.searchParams.get("sessionId");
      await store.clear(sessionId ?? undefined);
      return json({ cleared: true, sessionId });
    }
    return json({ error: "Method not allowed" }, 405);
  }

  if (path.startsWith("/api/runs/") && request.method === "GET") {
    if (!store) return json({ error: "Not found" }, 404);
    const id = decodeURIComponent(path.slice("/api/runs/".length));
    const record = await store.getTurn(id);
    return record ? json(record) : json({ error: "Not found" }, 404);
  }

  // ── MR case records ───────────────────────────────────────────────────────

  if (path === "/api/mr-cases") {
    if (request.method === "POST") {
      if (!store) return json({ error: "No persistence configured" }, 503);
      try {
        const record = normalizeMrCaseRecord(await request.json());
        await store.putMrCase(record);
        return json({ id: record.id }, 201);
      } catch (e) {
        const message = e instanceof Error ? e.message : "Invalid case record";
        return json({ error: message }, e instanceof ValidationError ? 400 : 500);
      }
    }
    if (request.method === "GET") {
      if (!store) return json({ items: [], nextCursor: null });
      return json(await store.listMrCases(listQuery(url)));
    }
    return json({ error: "Method not allowed" }, 405);
  }

  return json({ error: "Not found" }, 404);
}
