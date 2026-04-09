import OpenAI from "openai";
import { Langfuse } from "langfuse";
import { z } from "zod/v4";

const CATEGORIES = ["electronics", "books", "clothing", "home", "sports"] as const;
const SORTS = ["price_asc", "price_desc", "rating_desc", "name_asc"] as const;

type RuntimeEnv = Record<string, string | undefined>;

export type CommandRuntimeEnv = {
  OPENAI_API_KEY?: string;
  OPEN_ROUTER_API_KEY?: string;
  OPENAI_MODEL?: string;
  OPENAI_BASE_URL?: string;
  LITELLM_BASE_URL?: string;
  LITELLM_MODEL?: string;
  LITELLM_API_KEY?: string;
  LITELLM_API_KEY_HEADER?: string;
  LANGFUSE_PUBLIC_KEY?: string;
  LANGFUSE_SECRET_KEY?: string;
  LANGFUSE_BASE_URL?: string;
  LOCAL_TEST_MODE?: string;
};

const CommandSchema = z.object({
  filters: z.object({
    category: z.enum(CATEGORIES).nullable(),
    maxPrice: z.number().nullable(),
    minRating: z.number().nullable(),
    inStockOnly: z.boolean().nullable(),
  }),
  sort: z.enum(SORTS).nullable(),
  explanation: z.string(),
});

type CommandResult = z.infer<typeof CommandSchema>;

type TraceLike = {
  update?: (data: unknown) => void;
  generation?: (data: unknown) => GenerationLike;
};

type GenerationLike = {
  end?: (data: unknown) => void;
};

type LangfuseLike = {
  trace?: (data: unknown) => TraceLike;
  shutdownAsync?: () => Promise<void>;
};

function buildSystemPrompt(categories: readonly string[], sorts: readonly string[]): string {
  return `You are a product filter assistant. Given a user's natural language request, output ONLY a JSON object matching this schema:

{
  "filters": {
    "category": <one of ${JSON.stringify(categories)} or null>,
    "maxPrice": <number or null>,
    "minRating": <number or null>,
    "inStockOnly": <boolean or null>
  },
  "sort": <one of ${JSON.stringify(sorts)} or null>,
  "explanation": "<short summary of what you set>"
}

Rules:
- If the user does NOT mention a field, return null for it. Do NOT invent constraints.
- category must be exactly one of the known values or null.
- sort must be exactly one of the known values or null.
- "under $X" or "less than $X" means maxPrice = X.
- "highly rated" / "top rated" means minRating >= 4.0 and/or sort "rating_desc".
- "in stock" / "available" means inStockOnly = true.
- Output ONLY the JSON object. No markdown fences, no extra text.`;
}

function extractJSON(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  return (fenced ? fenced[1] : raw).trim();
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

function getEnvVar(env: RuntimeEnv, key: string): string | undefined {
  const fromRuntime = env[key];
  if (typeof fromRuntime === "string" && fromRuntime.length > 0) {
    return fromRuntime;
  }

  if (typeof process !== "undefined" && process?.env?.[key]) {
    return process.env[key];
  }

  return undefined;
}

function resolveLLMConfig(env: RuntimeEnv): {
  model: string;
  baseURL?: string;
  apiKey: string;
  defaultHeaders?: Record<string, string>;
  usingLiteLLM: boolean;
} {
  const defaultOpenRouterBaseURL = "https://openrouter.ai/api/v1";
  const defaultOpenRouterModel = "openai/gpt-4o-mini";
  const liteBaseURL = getEnvVar(env, "LITELLM_BASE_URL")?.trim();
  const openAIBaseURL = getEnvVar(env, "OPENAI_BASE_URL")?.trim();
  const liteModel = getEnvVar(env, "LITELLM_MODEL")?.trim();
  const openAIModel = getEnvVar(env, "OPENAI_MODEL")?.trim();
  const openAIApiKey = getEnvVar(env, "OPENAI_API_KEY")?.trim();
  const openRouterApiKey = getEnvVar(env, "OPEN_ROUTER_API_KEY")?.trim();
  const liteApiKey = getEnvVar(env, "LITELLM_API_KEY")?.trim();
  const customHeaderName = getEnvVar(env, "LITELLM_API_KEY_HEADER")?.trim();

  const useLiteLLM = Boolean(liteBaseURL);
  const apiKey = useLiteLLM ? liteApiKey || "local-litellm" : openRouterApiKey || openAIApiKey || "";
  const model = useLiteLLM
    ? liteModel || openAIModel || defaultOpenRouterModel
    : openAIModel || defaultOpenRouterModel;
  const baseURL = useLiteLLM ? liteBaseURL : openAIBaseURL || defaultOpenRouterBaseURL;

  let defaultHeaders: Record<string, string> | undefined;
  if (useLiteLLM && customHeaderName && apiKey) {
    defaultHeaders = { [customHeaderName]: apiKey };
  }

  return {
    model,
    baseURL,
    apiKey,
    defaultHeaders,
    usingLiteLLM: useLiteLLM,
  };
}

function createLangfuseClient(env: RuntimeEnv): LangfuseLike | undefined {
  const publicKey = getEnvVar(env, "LANGFUSE_PUBLIC_KEY")?.trim();
  const secretKey = getEnvVar(env, "LANGFUSE_SECRET_KEY")?.trim();
  const baseUrl = getEnvVar(env, "LANGFUSE_BASE_URL")?.trim();

  if (!publicKey || !secretKey) {
    return undefined;
  }

  return new Langfuse({
    publicKey,
    secretKey,
    ...(baseUrl ? { baseUrl } : {}),
  }) as unknown as LangfuseLike;
}

async function callLLM(
  client: OpenAI,
  model: string,
  system: string,
  user: string,
  generation?: GenerationLike,
): Promise<string> {
  console.log("[callLLM] using model:", JSON.stringify(model), "baseURL:", client.baseURL);
  const res = await client.chat.completions.create({
    model,
    temperature: 0,
    top_p: 1,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });

  const raw = res.choices[0]?.message?.content?.trim() ?? "";
  generation?.end?.({
    output: raw,
    usageDetails: res.usage,
    level: "DEFAULT",
    statusMessage: "ok",
  });
  return raw;
}

async function parseRequestBody(request: Request): Promise<{
  prompt: string;
  availableCategories?: readonly string[];
  availableSorts?: readonly string[];
}> {
  const body = (await request.json()) as {
    prompt?: unknown;
    availableCategories?: unknown;
    availableSorts?: unknown;
  };

  if (!body?.prompt || typeof body.prompt !== "string") {
    throw new Error("Missing 'prompt' string in request body");
  }

  const categories = Array.isArray(body.availableCategories)
    ? body.availableCategories.filter((value): value is string => typeof value === "string")
    : undefined;

  const sorts = Array.isArray(body.availableSorts)
    ? body.availableSorts.filter((value): value is string => typeof value === "string")
    : undefined;

  return {
    prompt: body.prompt,
    availableCategories: categories,
    availableSorts: sorts,
  };
}

function okResult(result: CommandResult): Response {
  return jsonResponse(result, { status: 200 });
}

function buildLocalTestCommand(
  prompt: string,
  categories: readonly string[],
  sorts: readonly string[],
): CommandResult {
  const text = prompt.toLowerCase();

  const schemaSafeCategories = CATEGORIES.filter((value) => categories.includes(value));

  const category =
    schemaSafeCategories.find((candidate) => text.includes(candidate.toLowerCase())) ?? null;

  const maxPriceMatch =
    text.match(/(?:under|less\s+than|below|max(?:imum)?\s+of?)\s*\$?\s*(\d+(?:\.\d+)?)/i) ??
    text.match(/\$\s*(\d+(?:\.\d+)?)\s*(?:or\s+less|or\s+below|max)/i);
  const maxPrice = maxPriceMatch ? Number(maxPriceMatch[1]) : null;

  const ratingMatch = text.match(/(\d(?:\.\d)?)\s*(?:\+|and\s+up)?\s*stars?/i);
  const hasHighlyRatedLanguage = /highly\s+rated|top\s+rated|best\s+rated/.test(text);
  const minRating = ratingMatch ? Number(ratingMatch[1]) : hasHighlyRatedLanguage ? 4 : null;

  const inStockOnly = /in\s+stock|available/.test(text) ? true : null;

  let sort: CommandResult["sort"] = null;
  if (/(cheapest|lowest\s+price|budget|low\s+to\s+high)/.test(text) && sorts.includes("price_asc")) {
    sort = "price_asc";
  } else if (
    /(most\s+expensive|highest\s+price|premium|high\s+to\s+low)/.test(text) &&
    sorts.includes("price_desc")
  ) {
    sort = "price_desc";
  } else if (/(top\s+rated|rating|best\s+rated)/.test(text) && sorts.includes("rating_desc")) {
    sort = "rating_desc";
  } else if (/(alphabetical|name|a\s+to\s+z)/.test(text) && sorts.includes("name_asc")) {
    sort = "name_asc";
  }

  return {
    filters: {
      category: category as CommandResult["filters"]["category"],
      maxPrice,
      minRating,
      inStockOnly,
    },
    sort,
    explanation: "Local test mode parsed request without external LLM call.",
  };
}

export async function handleCommandRequest(
  request: Request,
  runtimeEnv: CommandRuntimeEnv = {},
): Promise<Response> {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }

  let parsedBody: Awaited<ReturnType<typeof parseRequestBody>>;
  try {
    parsedBody = await parseRequestBody(request);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Invalid JSON body";
    return jsonResponse({ error: message }, { status: 400 });
  }

  const categoryValues = parsedBody.availableCategories ?? [...CATEGORIES];
  const sortValues = parsedBody.availableSorts ?? [...SORTS];

  if (getEnvVar(runtimeEnv as RuntimeEnv, "LOCAL_TEST_MODE") === "true") {
    const localResult = buildLocalTestCommand(parsedBody.prompt, categoryValues, sortValues);
    return okResult(localResult);
  }

  const llm = resolveLLMConfig(runtimeEnv as RuntimeEnv);
  if (!llm.usingLiteLLM && !llm.apiKey) {
    return jsonResponse(
      {
        error: "Missing API key. Set OPEN_ROUTER_API_KEY (for OpenRouter) or OPENAI_API_KEY, or use LITELLM_BASE_URL with LITELLM_API_KEY.",
      },
      { status: 500 },
    );
  }

  const client = new OpenAI({
    apiKey: llm.apiKey,
    ...(llm.baseURL ? { baseURL: llm.baseURL } : {}),
    ...(llm.defaultHeaders ? { defaultHeaders: llm.defaultHeaders } : {}),
  });

  const langfuse = createLangfuseClient(runtimeEnv as RuntimeEnv);
  const trace = langfuse?.trace?.({
    name: "command-api-request",
    input: {
      prompt: parsedBody.prompt,
      availableCategories: parsedBody.availableCategories,
      availableSorts: parsedBody.availableSorts,
    },
    metadata: {
      model: llm.model,
      baseURL: llm.baseURL,
      liteLLMEnabled: Boolean(getEnvVar(runtimeEnv as RuntimeEnv, "LITELLM_BASE_URL")),
    },
  });

  const system = buildSystemPrompt(categoryValues, sortValues);

  let raw: string;
  try {
    const generation = trace?.generation?.({
      name: "command-llm-initial",
      model: llm.model,
      input: { system, user: parsedBody.prompt },
      metadata: { attempt: 1 },
    });
    raw = await callLLM(client, llm.model, system, parsedBody.prompt, generation);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    trace?.update?.({ output: { error: msg }, level: "ERROR", statusMessage: "LLM call failed" });
    await langfuse?.shutdownAsync?.();
    return jsonResponse({ error: "LLM call failed", detail: msg }, { status: 502 });
  }

  console.log("[command] prompt:", JSON.stringify(parsedBody.prompt));
  console.log("[command] raw:", raw);

  let json1: string;
  try {
    json1 = extractJSON(raw);
    const first = CommandSchema.safeParse(JSON.parse(json1));
    if (first.success) {
      trace?.update?.({ output: first.data, level: "DEFAULT", statusMessage: "ok-first-pass" });
      await langfuse?.shutdownAsync?.();
      return okResult(first.data);
    }
  } catch {
    json1 = raw;
  }

  console.log("[command] first parse failed, retrying");
  const repairPrompt = `The following was supposed to be valid JSON matching the schema but failed:\n\n${json1}\n\nFix it and output ONLY valid JSON. No other text.`;

  let raw2: string;
  try {
    const generation = trace?.generation?.({
      name: "command-llm-repair",
      model: llm.model,
      input: { system, user: repairPrompt },
      metadata: { attempt: 2, reason: "json-repair" },
    });
    raw2 = await callLLM(client, llm.model, system, repairPrompt, generation);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    trace?.update?.({ output: { error: msg }, level: "ERROR", statusMessage: "LLM retry failed" });
    await langfuse?.shutdownAsync?.();
    return jsonResponse({ error: "LLM retry failed", detail: msg }, { status: 502 });
  }

  console.log("[command] retry raw:", raw2);
  try {
    const json2 = extractJSON(raw2);
    const second = CommandSchema.safeParse(JSON.parse(json2));
    if (second.success) {
      trace?.update?.({ output: second.data, level: "DEFAULT", statusMessage: "ok-repair" });
      await langfuse?.shutdownAsync?.();
      return okResult(second.data);
    }

    trace?.update?.({
      output: {
        error: "Invalid command after retry",
        firstResponse: json1,
        secondResponse: json2,
        validationError: second.error.message,
      },
      level: "ERROR",
      statusMessage: "validation-failed",
    });
    await langfuse?.shutdownAsync?.();
    return jsonResponse(
      {
        error: "Invalid command after retry",
        firstResponse: json1,
        secondResponse: json2,
        validationError: second.error.message,
      },
      { status: 422 },
    );
  } catch {
    trace?.update?.({
      output: { error: "Could not parse LLM response as JSON", raw: raw2 },
      level: "ERROR",
      statusMessage: "json-parse-failed",
    });
    await langfuse?.shutdownAsync?.();
    return jsonResponse({ error: "Could not parse LLM response as JSON", raw: raw2 }, { status: 422 });
  }
}

export default handleCommandRequest;
