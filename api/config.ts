/**
 * Environment and runtime-configuration resolution.
 *
 * Extracted from command.ts because P (prompt and runtime configuration) is now
 * needed by two endpoints: POST /api/command and GET /api/config. Keeping the
 * resolution in one place is what makes P reportable, which §4.17 requires —
 * "every reported result will be paired with the model identifier and
 * parameters" — and what §5.7 needs in order to hold P fixed across mediators.
 */
import { MODEL_ID_RE, type HistoryPolicy, type LlmProvider } from "../shared/contract.ts";
import type { HistoryConfig } from "../shared/history.ts";

export type { HistoryConfig } from "../shared/history.ts";

export type RuntimeEnv = Record<string, string | undefined>;

export type CommandRuntimeEnv = {
  /** OpenRouter is the default provider. Both spellings of the key are accepted. */
  OPEN_ROUTER_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_BASE_URL?: string;
  OPENROUTER_MODEL?: string;
  /** Comma-separated allowlist offered in the UI dropdown. */
  OPENROUTER_MODELS?: string;
  /** "true" lets the client send any syntactically valid model id. */
  OPENROUTER_MODEL_ALLOW_ANY?: string;
  OPENROUTER_SITE_URL?: string;
  OPENROUTER_APP_TITLE?: string;
  /** Direct OpenAI, used only when no OpenRouter key is present. */
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  OPENAI_MODEL?: string;
  LLM_TEMPERATURE?: string;
  LLM_TOP_P?: string;
  LLM_TIMEOUT_MS?: string;
  /** full | last-k | none. "none" seeds the display-only-history fault. */
  HISTORY_POLICY?: string;
  HISTORY_MAX_TURNS?: string;
  /** "false" removes clearFilters from Q and from the system prompt. */
  CLEAR_ACTION_ENABLED?: string;
  LANGFUSE_PUBLIC_KEY?: string;
  LANGFUSE_SECRET_KEY?: string;
  LANGFUSE_BASE_URL?: string;
  LOCAL_TEST_MODE?: string;
  RUNS_WRITE_TOKEN?: string;
  RUNS_READ_TOKEN?: string;
};

const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_OPENROUTER_MODEL = "openai/gpt-4o-mini";
const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Reads from the explicitly threaded runtime env first, then falls back to
 * process.env. The fallback is what makes the Worker's `env` and the Express
 * server's `process.env` interchangeable.
 */
export function getEnvVar(env: RuntimeEnv, key: string): string | undefined {
  const fromRuntime = env[key];
  if (typeof fromRuntime === "string" && fromRuntime.length > 0) return fromRuntime;
  if (typeof process !== "undefined" && process?.env?.[key]) return process.env[key];
  return undefined;
}

const str = (env: RuntimeEnv, key: string): string | undefined =>
  getEnvVar(env, key)?.trim() || undefined;

const bool = (env: RuntimeEnv, key: string, fallback: boolean): boolean => {
  const raw = str(env, key)?.toLowerCase();
  if (raw === undefined) return fallback;
  return raw === "true" || raw === "1" || raw === "yes";
};

const num = (env: RuntimeEnv, key: string, fallback: number): number => {
  const raw = str(env, key);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export function isLocalTestMode(env: RuntimeEnv): boolean {
  return str(env, "LOCAL_TEST_MODE")?.toLowerCase() === "true";
}

export interface LLMConfig {
  provider: LlmProvider;
  model: string;
  baseURL?: string;
  apiKey: string;
  defaultHeaders?: Record<string, string>;
  temperature: number;
  topP: number;
  timeoutMs: number;
}

/**
 * Provider resolution is key-first: an OpenRouter key selects OpenRouter,
 * otherwise an OpenAI key selects direct OpenAI, otherwise there is no
 * provider and the request fails.
 */
export function resolveLLMConfig(env: RuntimeEnv): LLMConfig {
  const sampling = {
    // Pinned deterministic by default, so that a difference between two runs is
    // attributable to the mediator rather than to decoding.
    temperature: num(env, "LLM_TEMPERATURE", 0),
    topP: num(env, "LLM_TOP_P", 1),
    timeoutMs: num(env, "LLM_TIMEOUT_MS", DEFAULT_TIMEOUT_MS),
  };

  const openRouterApiKey = str(env, "OPEN_ROUTER_API_KEY") || str(env, "OPENROUTER_API_KEY");
  if (openRouterApiKey) {
    return {
      ...sampling,
      provider: "openrouter",
      apiKey: openRouterApiKey,
      baseURL:
        str(env, "OPENROUTER_BASE_URL") ||
        str(env, "OPENAI_BASE_URL") ||
        DEFAULT_OPENROUTER_BASE_URL,
      model: str(env, "OPENROUTER_MODEL") || str(env, "OPENAI_MODEL") || DEFAULT_OPENROUTER_MODEL,
      defaultHeaders: {
        "HTTP-Referer": str(env, "OPENROUTER_SITE_URL") || "http://localhost:5173",
        "X-Title": str(env, "OPENROUTER_APP_TITLE") || "LNGUI Ecommerce Case Study",
      },
    };
  }

  const openAIApiKey = str(env, "OPENAI_API_KEY");
  const openAIBaseURL = str(env, "OPENAI_BASE_URL");
  return {
    ...sampling,
    provider: openAIApiKey ? "openai" : "none",
    apiKey: openAIApiKey ?? "",
    ...(openAIBaseURL ? { baseURL: openAIBaseURL } : {}),
    model: str(env, "OPENAI_MODEL") || DEFAULT_OPENAI_MODEL,
  };
}

// ── Model policy ────────────────────────────────────────────────────────────

export interface ModelPolicy {
  /** The env-configured default. Experiments repeat by leaving this alone. */
  defaultModel: string;
  /** Dropdown contents; always contains defaultModel first. */
  models: string[];
  allowAnyModel: boolean;
}

export function resolveModelPolicy(env: RuntimeEnv): ModelPolicy {
  const defaultModel = resolveLLMConfig(env).model;
  const listed = (str(env, "OPENROUTER_MODELS") ?? "")
    .split(",")
    .map((m) => m.trim())
    .filter((m) => m.length > 0);

  // Deduplicate with the default first, so the dropdown is never empty and
  // never disagrees with the configured default.
  const models = [defaultModel, ...listed.filter((m) => m !== defaultModel)];

  return {
    defaultModel,
    models,
    allowAnyModel: bool(env, "OPENROUTER_MODEL_ALLOW_ANY", false),
  };
}

export type ModelSelection =
  | { ok: true; model: string; source: "client" | "env-default" }
  | { ok: false; reason: string };

/**
 * Picks the model for one request. The default comes from the environment so a
 * sweep can be repeated without touching the UI; a client override is accepted
 * only if it is in the allowlist or the allow-any flag is set.
 */
export function selectModel(env: RuntimeEnv, requested?: string): ModelSelection {
  const policy = resolveModelPolicy(env);
  const wanted = requested?.trim();

  if (!wanted) return { ok: true, model: policy.defaultModel, source: "env-default" };
  if (!MODEL_ID_RE.test(wanted)) {
    return { ok: false, reason: `Model id "${wanted}" is not a valid identifier.` };
  }
  if (policy.models.includes(wanted)) return { ok: true, model: wanted, source: "client" };
  if (policy.allowAnyModel) return { ok: true, model: wanted, source: "client" };

  return {
    ok: false,
    reason:
      `Model "${wanted}" is not allowed. Permitted: ${policy.models.join(", ")}. ` +
      `Set OPENROUTER_MODEL_ALLOW_ANY=true to accept arbitrary ids.`,
  };
}

// ── History policy (part of P) ──────────────────────────────────────────────

/**
 * How much of H reaches the mediator. This is the dial that induces Context
 * Amnesia (§4.8): "none" is the display-only-history fault, "last-k" is the
 * truncation mechanism described in §1.2, and "full" is the reference
 * condition. Recording it in P is what later distinguishes "the model forgot"
 * from "the model was never told".
 */
export function resolveHistoryConfig(env: RuntimeEnv): HistoryConfig {
  const raw = str(env, "HISTORY_POLICY")?.toLowerCase();
  const policy: HistoryPolicy =
    raw === "none" ? "none" : raw === "last-k" ? "last-k" : "full";
  if (policy !== "last-k") return { policy, maxTurns: null };

  const k = Math.max(0, Math.floor(num(env, "HISTORY_MAX_TURNS", 3)));
  return { policy, maxTurns: k };
}

export function clearActionEnabled(env: RuntimeEnv): boolean {
  return bool(env, "CLEAR_ACTION_ENABLED", true);
}

export function langfuseEnabled(env: RuntimeEnv): boolean {
  return Boolean(str(env, "LANGFUSE_PUBLIC_KEY") && str(env, "LANGFUSE_SECRET_KEY"));
}
