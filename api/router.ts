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
  clearActionEnabled,
  getEnvVar,
  isLocalTestMode,
  langfuseEnabled,
  resolveHistoryConfig,
  resolveLLMConfig,
  resolveModelPolicy,
  type CommandRuntimeEnv,
  type RuntimeEnv,
} from "./config.ts";
import { promptHashes } from "./prompt.ts";
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
  const clearEnabled = clearActionEnabled(env);
  const hashes = promptHashes(clearEnabled);

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
    clearActionEnabled: clearEnabled,
    langfuseEnabled: langfuseEnabled(env),
    persistence,
    controls: CONTROLS,
    v0: { ...V0 },
  };
}

/**
 * Optional shared-secret gates. Both default to off so local development needs
 * no setup; setting RUNS_WRITE_TOKEN before exposing a deployed URL is what
 * stops POST /api/runs being a public write.
 */
function authorized(request: Request, env: RuntimeEnv, which: "read" | "write"): boolean {
  const expected = getEnvVar(env, which === "read" ? "RUNS_READ_TOKEN" : "RUNS_WRITE_TOKEN")?.trim();
  if (!expected) return true;
  return request.headers.get("x-runs-token") === expected;
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

export async function handleApiRequest(
  request: Request,
  runtimeEnv: CommandRuntimeEnv | RuntimeEnv,
  deps: ApiDeps,
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith("/api/")) return null;

  const env = runtimeEnv as RuntimeEnv;
  const { store } = deps;

  if (path === "/api/command") {
    return handleCommandRequest(request, runtimeEnv, deps);
  }

  if (path === "/api/config" && request.method === "GET") {
    return json(buildConfig(env, store ? store.kind : "none"));
  }

  // ── Turn records ──────────────────────────────────────────────────────────

  if (path === "/api/runs") {
    if (request.method === "POST") {
      if (!authorized(request, env, "write")) return json({ error: "Forbidden" }, 403);
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
      if (!authorized(request, env, "read")) return json({ error: "Forbidden" }, 403);
      if (!store) return json({ items: [], nextCursor: null });
      return json(await store.listTurns(listQuery(url)));
    }
    if (request.method === "DELETE") {
      if (!authorized(request, env, "write")) return json({ error: "Forbidden" }, 403);
      if (!store) return json({ error: "No persistence configured" }, 503);
      const sessionId = url.searchParams.get("sessionId");
      await store.clear(sessionId ?? undefined);
      return json({ cleared: true, sessionId });
    }
    return json({ error: "Method not allowed" }, 405);
  }

  if (path.startsWith("/api/runs/") && request.method === "GET") {
    if (!authorized(request, env, "read")) return json({ error: "Forbidden" }, 403);
    if (!store) return json({ error: "Not found" }, 404);
    const id = decodeURIComponent(path.slice("/api/runs/".length));
    const record = await store.getTurn(id);
    return record ? json(record) : json({ error: "Not found" }, 404);
  }

  // ── MR case records ───────────────────────────────────────────────────────

  if (path === "/api/mr-cases") {
    if (request.method === "POST") {
      if (!authorized(request, env, "write")) return json({ error: "Forbidden" }, 403);
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
      if (!authorized(request, env, "read")) return json({ error: "Forbidden" }, 403);
      if (!store) return json({ items: [], nextCursor: null });
      return json(await store.listMrCases(listQuery(url)));
    }
    return json({ error: "Method not allowed" }, 405);
  }

  return json({ error: "Not found" }, 404);
}
