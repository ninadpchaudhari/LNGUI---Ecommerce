import OpenAI from "openai";
import { LANGFUSE_HEADER } from "../shared/overrides.ts";
import { Langfuse } from "langfuse";

import {
  SCHEMA_VERSION,
  type AttemptName,
  type AttemptOutcome,
  type AttemptRecord,
  type Command,
  type CommandErrorCode,
  type CommandMeta,
  type History,
  type HistoryTurn,
  type ModelSource,
  type PromptConfig,
  type SortValue,
  type TokenUsage,
} from "../shared/contract.ts";
import { applyCommand } from "../shared/transition.ts";
import { CATEGORY_VALUES, V0 } from "../shared/surface.generated.ts";
import { effectiveHistory, renderHistory, type ChatMessage } from "../shared/history.ts";
import {
  buildCommandSchema,
  promptHashes,
} from "./prompt.ts";
import {
  getEnvVar,
  isLocalTestMode,
  resolveHistoryConfig,
  resolveLLMConfig,
  resolveSystemPrompt,
  resolveCommandMode,
  selectModel,
  type CommandRuntimeEnv,
  type RuntimeEnv,
} from "./config.ts";

export type { CommandRuntimeEnv } from "./config.ts";

/** Hard cap on raw model text retained in a record. */
const MAX_RAW_CHARS = 8000;

// ── Langfuse (structural types; the SDK surface is not imported) ────────────

type GenerationLike = { end?: (data: unknown) => void };
type TraceLike = {
  update?: (data: unknown) => void;
  generation?: (data: unknown) => GenerationLike;
  getTraceUrl?: () => string | undefined;
};
type LangfuseLike = {
  trace?: (data: unknown) => TraceLike;
  shutdownAsync?: () => Promise<void>;
};

function createLangfuseClient(env: RuntimeEnv): LangfuseLike | undefined {
  const publicKey = getEnvVar(env, "LANGFUSE_PUBLIC_KEY")?.trim();
  const secretKey = getEnvVar(env, "LANGFUSE_SECRET_KEY")?.trim();
  const baseUrl = getEnvVar(env, "LANGFUSE_BASE_URL")?.trim();
  if (!publicKey || !secretKey) return undefined;
  return new Langfuse({
    publicKey,
    secretKey,
    ...(baseUrl ? { baseUrl } : {}),
  }) as unknown as LangfuseLike;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function extractJSON(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  return (fenced ? fenced[1] : raw).trim();
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

function truncate(raw: string | null): { text: string | null; truncated: boolean } {
  if (raw === null) return { text: null, truncated: false };
  if (raw.length <= MAX_RAW_CHARS) return { text: raw, truncated: false };
  return { text: raw.slice(0, MAX_RAW_CHARS), truncated: true };
}

function sumUsage(attempts: AttemptRecord[]): TokenUsage | null {
  const present = attempts.filter((a) => a.usage !== null);
  if (present.length === 0) return null;
  const add = (pick: (u: TokenUsage) => number | null): number | null => {
    let total: number | null = null;
    for (const a of present) {
      const v = pick(a.usage as TokenUsage);
      if (v !== null) total = (total ?? 0) + v;
    }
    return total;
  };
  return {
    promptTokens: add((u) => u.promptTokens),
    completionTokens: add((u) => u.completionTokens),
    totalTokens: add((u) => u.totalTokens),
    costUsd: add((u) => u.costUsd),
  };
}

// ── M — the LLM call ────────────────────────────────────────────────────────

interface LLMCallResult {
  raw: string;
  resolvedModel: string | null;
  responseId: string | null;
  providerName: string | null;
  finishReason: string | null;
  usage: TokenUsage | null;
  latencyMs: number;
}

async function callLLM(
  client: OpenAI,
  model: string,
  messages: ChatMessage[],
  sampling: { temperature: number | null; topP: number | null; timeoutMs: number },
): Promise<LLMCallResult> {
  const started = Date.now();
  const res = await client.chat.completions.create(
    {
      model,
      // Unset sampling parameters are left out, so the provider's default for
      // this model applies. P records them as null.
      ...(sampling.temperature !== null ? { temperature: sampling.temperature } : {}),
      ...(sampling.topP !== null ? { top_p: sampling.topP } : {}),
      messages,
    },
    { timeout: sampling.timeoutMs },
  );
  const latencyMs = Date.now() - started;

  // OpenRouter returns fields the OpenAI SDK does not type but does preserve.
  const extra = res as unknown as { provider?: string; usage?: { cost?: number } };
  const u = res.usage;

  return {
    raw: res.choices[0]?.message?.content?.trim() ?? "",
    resolvedModel: res.model ?? null,
    responseId: res.id ?? null,
    providerName: extra.provider ?? null,
    finishReason: res.choices[0]?.finish_reason ?? null,
    usage: u
      ? {
          promptTokens: u.prompt_tokens ?? null,
          completionTokens: u.completion_tokens ?? null,
          totalTokens: u.total_tokens ?? null,
          costUsd: extra.usage?.cost ?? null,
        }
      : null,
    latencyMs,
  };
}

// ── Request body ────────────────────────────────────────────────────────────

interface ParsedBody {
  prompt: string;
  model?: string;
  history: History;
  historyDisplayedCount: number;
  sessionId?: string;
}

function parseHistory(value: unknown): History {
  if (!Array.isArray(value)) return [];
  const out: History = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const turn = raw as Partial<HistoryTurn>;
    if (typeof turn.u !== "string") continue;
    out.push({
      u: turn.u,
      q: (turn.q ?? null) as Command | null,
      V: turn.V as HistoryTurn["V"],
      D: turn.D as HistoryTurn["D"],
    });
  }
  return out;
}

async function parseRequestBody(request: Request): Promise<ParsedBody> {
  const body = (await request.json()) as Record<string, unknown>;

  if (!body?.prompt || typeof body.prompt !== "string") {
    throw new Error("Missing 'prompt' string in request body");
  }

  const history = parseHistory(body.history);
  const displayed =
    typeof body.historyDisplayedCount === "number" && body.historyDisplayedCount >= 0
      ? body.historyDisplayedCount
      : history.length;

  return {
    prompt: body.prompt,
    ...(typeof body.model === "string" ? { model: body.model } : {}),
    history,
    historyDisplayedCount: displayed,
    ...(typeof body.sessionId === "string" ? { sessionId: body.sessionId } : {}),
  };
}

// ── Local test mode ─────────────────────────────────────────────────────────

/**
 * Deterministic stand-in for the mediator: no network call, no sampling.
 *
 * It is *stateless by construction* — it parses the current utterance alone and
 * ignores H entirely. Apply preserves omitted fields, but contextual references
 * still require a real mediator. Local mode is for UI and plumbing
 * work, and for checking that a relation *runs*, not for measuring a mediator.
 *
 * It is the reference reading of the bundled cases: "highly rated" is
 * minRating 4, while "best rated" or "top rated" only sorts. The enhanced
 * prompts deliberately do not spell these readings out, so a model's own reading is
 * what the relations measure. A dry-run failure should point at the harness or
 * the case, not at the parser.
 */
function buildLocalTestCommand(prompt: string): Command {
  const text = prompt.toLowerCase();

  const category =
    CATEGORY_VALUES.find((c) => text.includes(c)) ??
    (/\b(?:tech|gadgets?)\b/.test(text) ? "electronics" : null);

  const maxPriceMatch =
    text.match(/(?:under|less\s+than|cheaper\s+than|below|max(?:imum)?\s+of?)\s*\$?\s*(\d+(?:\.\d+)?)/i) ??
    text.match(/\$\s*(\d+(?:\.\d+)?)\s*(?:or\s+less|or\s+below|max)/i);
  const maxPrice = maxPriceMatch ? Number(maxPriceMatch[1]) : null;

  const ratingMatch = text.match(/(\d(?:\.\d)?)\s*(?:\+|and\s+up)?\s*stars?/i);
  // Only "highly rated" sets a minimum; "best rated first" is a sort.
  const highlyRated = /highly\s+rated/.test(text);
  const minRating = ratingMatch ? Number(ratingMatch[1]) : highlyRated ? 4 : null;

  // Negative phrasings first: "show out-of-stock items again" is the inverse of
  // "hide out-of-stock items", and a substring match would otherwise read the
  // "stock" in both as a request to filter.
  const inStockOnly = /\b(show|include|also)\b[^.]*out.of.stock/.test(text)
    ? false
    : /hide[^.]*out.of.stock|\bin\s+stock\b|\bavailable\b|\bexclude[^.]*out.of.stock/.test(text)
      ? true
      : null;

  let sort: SortValue | null = null;
  if (/(cheapest|lowest\s+price|budget|low\s+to\s+high)/.test(text)) sort = "price_asc";
  else if (/(most\s+expensive|highest\s+price|premium|high\s+to\s+low)/.test(text)) sort = "price_desc";
  else if (/(top\s+rated|rating|best\s+rated)/.test(text)) sort = "rating_desc";
  else if (/(alphabetical|name|a\s+to\s+z)/.test(text)) sort = "name_asc";

  const wantsClear = /\b(?:clear|reset)\s+(?:(?:all|the|every)\s+)?filters?\b|\b(?:clear|reset)\s+(?:everything|all)\b|\bstart over\b/.test(text);

  return {
    filters: {
      ...(category === null ? {} : { category }),
      ...(maxPrice === null ? {} : { maxPrice }),
      ...(minRating === null ? {} : { minRating }),
      ...(inStockOnly === null ? {} : { inStockOnly }),
      ...(/(?:remove|clear|reset).*category|all categories/.test(text) ? { category: null } : {}),
      ...(/(?:remove|clear|reset).*(?:price|budget)/.test(text) ? { maxPrice: null } : {}),
      ...(/(?:remove|clear|reset).*rating/.test(text) ? { minRating: null } : {}),
      ...(/(?:remove|clear|reset).*(?:stock|availability)/.test(text) ? { inStockOnly: null } : {}),
    },
    ...(sort === null ? {} : { sort }),
    ...(/(?:remove|clear|reset).*sort|default order/.test(text) ? { sort: null } : {}),
    ...(wantsClear ? { clearFilters: true } : {}),
    explanation: "Local test mode parsed request without external LLM call.",
  };
}

// ── The handler ─────────────────────────────────────────────────────────────

export interface CommandDeps {
  /** Schedules background work; ctx.waitUntil in the Worker, a collector in Express. */
  waitUntil: (p: Promise<unknown>) => void;
}

export async function handleCommandRequest(
  request: Request,
  /**
   * Accepts either the documented key set or a bare env record, so the Worker's
   * typed `env` and the Express server's `process.env` are interchangeable.
   */
  runtimeEnv: CommandRuntimeEnv | RuntimeEnv = {},
  deps?: Partial<CommandDeps>,
): Promise<Response> {
  const waitUntil = deps?.waitUntil ?? ((p: Promise<unknown>) => void p.catch(() => {}));

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }

  const env = runtimeEnv as RuntimeEnv;
  const commandMode = resolveCommandMode(env);
  const historyConfig = resolveHistoryConfig(env);
  const schema = buildCommandSchema(commandMode);
  const system = resolveSystemPrompt(env);
  const hashes = promptHashes(system, commandMode);
  const requestId = crypto.randomUUID();
  const startedAtMs = Date.now();
  const timestamp = new Date().toISOString();
  const attempts: AttemptRecord[] = [];

  let parsedBody: ParsedBody;
  try {
    parsedBody = await parseRequestBody(request);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Invalid JSON body";
    const llm = resolveLLMConfig(env);
    return jsonResponse(
      {
        error: message,
        meta: {
          schemaVersion: SCHEMA_VERSION,
          requestId,
          timestamp,
          mode: isLocalTestMode(env) ? "local-test" : "llm",
          provider: isLocalTestMode(env) ? "local-test" : llm.provider,
          baseURL: llm.baseURL ?? null,
          modelSource: "env-default",
          P: {
            requestedModel: llm.model,
            resolvedModel: null,
            temperature: llm.temperature,
            topP: llm.topP,
            systemPromptHash: hashes.systemPromptHash,
            commandSchemaHash: hashes.commandSchemaHash,
            historyPolicy: historyConfig.policy,
            historyMaxTurns: historyConfig.maxTurns,
            commandMode,
          },
          attempts: [],
          repaired: false,
          totalLatencyMs: Date.now() - startedAtMs,
          usageTotal: null,
          historyTurnsEffective: 0,
          historyTurnsDisplayed: 0,
          langfuse: { enabled: false, traceId: null, url: null },
          error: { code: "bad_request", message },
        } satisfies CommandMeta,
      },
      { status: 400 },
    );
  }

  const selection = selectModel(env, parsedBody.model);
  const llm = resolveLLMConfig(env);
  const localMode = isLocalTestMode(env);
  const chosenModel = selection.ok ? selection.model : llm.model;
  const modelSource: ModelSource = selection.ok ? selection.source : "env-default";

  const sentTurns = effectiveHistory(parsedBody.history, historyConfig);

  const basePromptConfig = (resolvedModel: string | null): PromptConfig => ({
    requestedModel: chosenModel,
    resolvedModel,
    temperature: llm.temperature,
    topP: llm.topP,
    systemPromptHash: hashes.systemPromptHash,
    commandSchemaHash: hashes.commandSchemaHash,
    historyPolicy: historyConfig.policy,
    historyMaxTurns: historyConfig.maxTurns,
    commandMode,
  });

  // Sweeps send `x-lngui-langfuse: off` unless the experimenter opts in.
  const tracingOff = request.headers.get(LANGFUSE_HEADER)?.toLowerCase() === "off";
  const langfuse = localMode || tracingOff ? undefined : createLangfuseClient(env);
  const trace = langfuse?.trace?.({
    // Reusing requestId as the trace id means the D1 record and the Langfuse
    // trace join on a single key.
    id: requestId,
    name: "command-api-request",
    input: { prompt: parsedBody.prompt, historyTurns: sentTurns.length },
    metadata: {
      provider: llm.provider,
      model: chosenModel,
      baseURL: llm.baseURL,
      historyPolicy: historyConfig.policy,
      commandMode,
    },
    ...(parsedBody.sessionId ? { sessionId: parsedBody.sessionId } : {}),
  });

  const buildMeta = (
    errorCode: CommandErrorCode | null,
    errorMessage?: string,
    detail?: string,
  ): CommandMeta => {
    const last = attempts[attempts.length - 1];
    return {
      schemaVersion: SCHEMA_VERSION,
      requestId,
      timestamp,
      mode: localMode ? "local-test" : "llm",
      provider: localMode ? "local-test" : llm.provider,
      baseURL: localMode ? null : (llm.baseURL ?? null),
      modelSource,
      P: basePromptConfig(last?.resolvedModel ?? null),
      attempts,
      repaired: attempts.some((a) => a.name === "repair" && a.outcome === "parsed"),
      totalLatencyMs: Date.now() - startedAtMs,
      usageTotal: sumUsage(attempts),
      historyTurnsEffective: sentTurns.length,
      historyTurnsDisplayed: parsedBody.historyDisplayedCount,
      langfuse: {
        enabled: Boolean(langfuse),
        traceId: langfuse ? requestId : null,
        url: trace?.getTraceUrl?.() ?? null,
      },
      error:
        errorCode === null
          ? null
          : {
              code: errorCode,
              message: errorMessage ?? "",
              ...(detail === undefined ? {} : { detail }),
            },
    };
  };

  /** Single exit point: attaches meta, closes the trace, flushes off the hot path. */
  const finish = (
    body: Record<string, unknown>,
    status: number,
    errorCode: CommandErrorCode | null,
    traceStatus: string,
  ): Response => {
    const meta = buildMeta(errorCode, typeof body.error === "string" ? body.error : undefined,
      typeof body.detail === "string" ? body.detail : undefined);
    trace?.update?.({
      output: errorCode === null ? body : { error: body.error, detail: body.detail },
      level: errorCode === null ? "DEFAULT" : "ERROR",
      statusMessage: traceStatus,
    });
    // Langfuse delivery must not sit on the user-visible latency path, and a
    // Langfuse outage must never fail the request.
    if (langfuse?.shutdownAsync) {
      waitUntil(langfuse.shutdownAsync().catch(() => {}));
    }
    return jsonResponse({ ...body, meta }, { status });
  };

  if (!selection.ok) {
    return finish(
      { error: "Model not allowed", detail: selection.reason },
      400,
      "model_not_allowed",
      "model-not-allowed",
    );
  }

  if (localMode) {
    let command = buildLocalTestCommand(parsedBody.prompt);
    if (commandMode === "full") {
      // Deterministic plumbing stand-in: reconstruct only from supplied command history.
      let valuation = { ...V0 };
      for (const turn of sentTurns) {
        if (turn.q) valuation = applyCommand(valuation, turn.q).V;
      }
      valuation = applyCommand(valuation, command).V;
      const { category, maxPrice, minRating, inStockOnly, sort } = valuation;
      command = { ...command, filters: { category, maxPrice, minRating, inStockOnly }, sort };
    }
    return finish(
      command as unknown as Record<string, unknown>,
      200,
      null,
      "ok-local-test",
    );
  }

  if (llm.provider === "none") {
    return finish(
      {
        error:
          "Missing API key. Set OPEN_ROUTER_API_KEY (OpenRouter) or OPENAI_API_KEY (direct OpenAI).",
      },
      500,
      "missing_api_key",
      "missing-api-key",
    );
  }

  const client = new OpenAI({
    apiKey: llm.apiKey,
    ...(llm.baseURL ? { baseURL: llm.baseURL } : {}),
    ...(llm.defaultHeaders ? { defaultHeaders: llm.defaultHeaders } : {}),
  });

  const historyMessages = renderHistory(sentTurns);
  let userMessage = parsedBody.prompt;

  // Two attempts: the initial call and one JSON repair. Collapsed into a loop so
  // that every exit path runs through `finish` and therefore carries meta.
  for (let attempt = 1; attempt <= 2; attempt++) {
    const name: AttemptName = attempt === 1 ? "initial" : "repair";
    const messages: ChatMessage[] = [
      { role: "system", content: system },
      ...(attempt === 1 ? historyMessages : []),
      { role: "user", content: userMessage },
    ];

    const generation = trace?.generation?.({
      name: `command-llm-${name}`,
      model: chosenModel,
      input: { messages },
      metadata: { attempt, historyTurns: attempt === 1 ? sentTurns.length : 0 },
    });

    const attemptStartedAt = new Date().toISOString();
    let call: LLMCallResult;
    try {
      call = await callLLM(client, chosenModel, messages, llm);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      attempts.push({
        attempt,
        name,
        startedAt: attemptStartedAt,
        latencyMs: Date.now() - startedAtMs,
        requestedModel: chosenModel,
        resolvedModel: null,
        responseId: null,
        providerName: null,
        finishReason: null,
        userPrompt: userMessage,
        rawText: null,
        rawTruncated: false,
        usage: null,
        outcome: "llm-error",
        errorMessage: msg,
      });
      generation?.end?.({ level: "ERROR", statusMessage: msg });
      return finish(
        { error: attempt === 1 ? "LLM call failed" : "LLM retry failed", detail: msg },
        502,
        "llm_error",
        attempt === 1 ? "llm-call-failed" : "llm-retry-failed",
      );
    }

    let extracted: string;
    let outcome: AttemptOutcome;
    let parsed: Command | null = null;
    let validationError: string | undefined;
    try {
      extracted = extractJSON(call.raw);
      const result = schema.safeParse(JSON.parse(extracted));
      if (result.success) {
        outcome = "parsed";
        parsed = result.data as Command;
      } else {
        outcome = "schema-invalid";
        validationError = result.error.message;
      }
    } catch {
      extracted = call.raw;
      outcome = "json-invalid";
    }

    const raw = truncate(call.raw);
    attempts.push({
      attempt,
      name,
      startedAt: attemptStartedAt,
      latencyMs: call.latencyMs,
      requestedModel: chosenModel,
      resolvedModel: call.resolvedModel,
      responseId: call.responseId,
      providerName: call.providerName,
      finishReason: call.finishReason,
      userPrompt: userMessage,
      rawText: raw.text,
      rawTruncated: raw.truncated,
      usage: call.usage,
      outcome,
      errorMessage: validationError ?? null,
    });
    generation?.end?.({
      output: call.raw,
      usageDetails: call.usage,
      level: outcome === "parsed" ? "DEFAULT" : "WARNING",
      statusMessage: outcome,
    });

    if (parsed !== null) {
      return finish(
        parsed as unknown as Record<string, unknown>,
        200,
        null,
        attempt === 1 ? "ok-first-pass" : "ok-repair",
      );
    }

    if (attempt === 2) {
      const first = attempts[0]?.rawText ?? null;
      return outcome === "schema-invalid"
        ? finish(
            {
              error: "Invalid command after retry",
              firstResponse: first,
              secondResponse: extracted,
              validationError,
            },
            422,
            "schema_invalid",
            "validation-failed",
          )
        : finish(
            { error: "Could not parse LLM response as JSON", raw: raw.text },
            422,
            "invalid_json",
            "json-parse-failed",
          );
    }

    userMessage =
      `The following was supposed to be valid JSON matching the schema but failed:\n\n` +
      `${extracted}\n\nFix it and output ONLY valid JSON. No other text.`;
  }

  // Unreachable: the loop returns on every path.
  return finish({ error: "Internal error" }, 500, "internal", "internal");
}

export default handleCommandRequest;
