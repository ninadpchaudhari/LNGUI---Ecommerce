/** Per-request experiment settings are applied directly and validated. */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { applyOverrides, handleApiRequest } from "./router.ts";
import { DEFAULT_SYSTEM_PROMPT } from "../shared/default-prompt.ts";
import { promptHash } from "../shared/prompt-text.ts";
import type { AppConfig } from "../shared/contract.ts";

const req = (overrides?: unknown) => new Request("http://x/api/config", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(overrides === undefined ? {} : { overrides }),
});
const deps = { store: null, waitUntil: () => {} };

describe("applyOverrides", () => {
  test("passes the environment through when no overrides are sent", async () => {
    const r = await applyOverrides(req(), { HISTORY_POLICY: "none" }, "/api/config");
    assert.deepEqual(r, { env: { HISTORY_POLICY: "none" } });
  });

  test("accepts settings without any permission flag or token", async () => {
    const r = await applyOverrides(req({ HISTORY_POLICY: "none" }), {}, "/api/config");
    assert.ok("env" in r && r.env.HISTORY_POLICY === "none");
  });

  test("a runs write token does not gate condition settings", async () => {
    const r = await applyOverrides(req({ HISTORY_POLICY: "none" }), { RUNS_WRITE_TOKEN: "s3cret" }, "/api/config");
    assert.ok("env" in r && r.env.HISTORY_POLICY === "none");
  });

  test("rejects keys outside the whitelist, such as API keys", async () => {
    const r = await applyOverrides(req({ OPENAI_API_KEY: "x" }), {}, "/api/config");
    assert.ok("error" in r && r.status === 400);
  });
});

test("POST /api/config reports the condition's P", async () => {
  const res = await handleApiRequest(
    req({ LLM_TEMPERATURE: "0.7", HISTORY_POLICY: "none", LOCAL_TEST_MODE: "true" }),
    {},
    deps,
  );
  const config = (await res!.json()) as AppConfig;
  assert.equal(config.temperature, 0.7);
  assert.equal(config.historyPolicy, "none");
  assert.equal(config.mode, "local-test");
});

describe("explicit P: a condition never inherits the server's .env", () => {
  test("a P key the overrides leave out is unset, not taken from the environment", async () => {
    const res = await handleApiRequest(
      req({ LOCAL_TEST_MODE: "true" }),
      { LLM_TEMPERATURE: "0.5", CLEAR_ACTION_ENABLED: "true", HISTORY_POLICY: "none" },
      deps,
    );
    const config = (await res!.json()) as AppConfig;
    assert.equal(config.temperature, null, "unset temperature means the provider default");
    assert.equal(config.clearActionEnabled, false, "code default, not the env's true");
    assert.equal(config.historyPolicy, "full");
  });

  test("without overrides, the interactive app still reads its environment", async () => {
    const res = await handleApiRequest(req(), { LLM_TEMPERATURE: "0.5", LOCAL_TEST_MODE: "true" }, deps);
    assert.equal(((await res!.json()) as AppConfig).temperature, 0.5);
  });
});

describe("Ollama provider and provider-default sampling", () => {
  async function fakeOllama() {
    const { createServer } = await import("node:http");
    const bodies: Array<Record<string, unknown>> = [];
    const server = createServer(async (r, s) => {
      const chunks: Buffer[] = [];
      for await (const c of r) chunks.push(c as Buffer);
      bodies.push(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      const command = { filters: { category: "books", maxPrice: null, minRating: null, inStockOnly: null }, sort: null, explanation: "ok" };
      s.setHeader("content-type", "application/json");
      s.end(JSON.stringify({
        id: "x", object: "chat.completion", created: 0, model: "llama3.1:8b",
        choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify(command) } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }));
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    return { server, bodies, base: `http://127.0.0.1:${port}/v1` };
  }

  const command = (overrides: Record<string, string>) =>
    new Request("http://x/api/command", {
      method: "POST",
      headers: { "content-type": "application/json", "x-lngui-langfuse": "off" },
      body: JSON.stringify({ prompt: "show books", history: [], overrides }),
    });

  test("routes to the server's Ollama and leaves unset sampling out of the call", async () => {
    const o = await fakeOllama();
    try {
      const res = await handleApiRequest(
        command({ LLM_PROVIDER: "ollama", LLM_MODEL: "llama3.1:8b" }),
        { OLLAMA_BASE_URL: o.base, LLM_TEMPERATURE: "0.9" },
        deps,
      );
      const body = (await res!.json()) as { filters: { category: string }; meta: { provider: string; P: { temperature: number | null }; langfuse: { enabled: boolean } } };
      assert.equal(res!.status, 200);
      assert.equal(body.filters.category, "books");
      assert.equal(body.meta.provider, "ollama");
      assert.equal(body.meta.P.temperature, null);
      assert.equal(body.meta.langfuse.enabled, false);
      assert.equal(o.bodies[0].model, "llama3.1:8b");
      assert.ok(!("temperature" in o.bodies[0]), "the env's 0.9 must not leak into the call");
      assert.ok(!("top_p" in o.bodies[0]));
    } finally {
      o.server.close();
    }
  });

  test("sends temperature when the condition sets it", async () => {
    const o = await fakeOllama();
    try {
      await handleApiRequest(
        command({ LLM_PROVIDER: "ollama", LLM_MODEL: "qwen2.5:7b", LLM_TEMPERATURE: "0" }),
        { OLLAMA_BASE_URL: o.base },
        deps,
      );
      assert.equal(o.bodies[0].temperature, 0);
      assert.equal(o.bodies[0].model, "qwen2.5:7b");
    } finally {
      o.server.close();
    }
  });

  test("Langfuse stays off when the request says off, even with keys configured", async () => {
    const o = await fakeOllama();
    try {
      const res = await handleApiRequest(
        command({ LLM_PROVIDER: "ollama", LLM_MODEL: "llama3.1:8b" }),
        { OLLAMA_BASE_URL: o.base, LANGFUSE_PUBLIC_KEY: "pk", LANGFUSE_SECRET_KEY: "sk" },
        deps,
      );
      const body = (await res!.json()) as { meta: { langfuse: { enabled: boolean } } };
      assert.equal(body.meta.langfuse.enabled, false);
    } finally {
      o.server.close();
    }
  });
});

describe("the system prompt travels as text", () => {
  const withPrompt = (text: string) =>
    req({ SYSTEM_PROMPT: text, LOCAL_TEST_MODE: "true" });

  test("survives the body with newlines and non-ASCII characters", async () => {
    const text = 'Rules:\n- "rated" means ≥ 4\n- naïve café';
    const res = await handleApiRequest(withPrompt(text), {}, deps);
    const config = (await res!.json()) as AppConfig;
    assert.equal(config.systemPromptHash, promptHash(text));
  });

  test("a different text gives a different P, and none gives the default", async () => {
    const a = (await (await handleApiRequest(withPrompt("one"), {}, deps))!.json()) as AppConfig;
    const b = (await (await handleApiRequest(withPrompt("two"), {}, deps))!.json()) as AppConfig;
    const none = (await (await handleApiRequest(req({ LOCAL_TEST_MODE: "true" }), {}, deps))!.json()) as AppConfig;
    assert.notEqual(a.systemPromptHash, b.systemPromptHash);
    assert.equal(none.systemPromptHash, promptHash(DEFAULT_SYSTEM_PROMPT));
  });

  test("a long prompt survives the request body without truncation", async () => {
    const text = "x".repeat(20_000);
    const res = await handleApiRequest(withPrompt(text), {}, deps);
    assert.equal(res!.status, 200);
    assert.equal(((await res!.json()) as AppConfig).systemPromptHash, promptHash(text));
  });

  test("the model receives exactly the condition's text as the system message", async () => {
    const { createServer } = await import("node:http");
    const bodies: Array<{ messages: Array<{ role: string; content: string }> }> = [];
    const server = createServer(async (r, s) => {
      const chunks: Buffer[] = [];
      for await (const c of r) chunks.push(c as Buffer);
      bodies.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      s.setHeader("content-type", "application/json");
      s.end(JSON.stringify({
        id: "x", object: "chat.completion", created: 0, model: "m",
        choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify({ filters: { category: null, maxPrice: null, minRating: null, inStockOnly: null }, sort: null, explanation: "ok" }) } }],
      }));
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
    try {
      const text = "Answer with JSON.\nBe literal.";
      await handleApiRequest(
        new Request("http://x/api/command", {
          method: "POST",
          headers: { "content-type": "application/json", "x-lngui-langfuse": "off" },
          body: JSON.stringify({ prompt: "show books", history: [], overrides: { LLM_PROVIDER: "ollama", LLM_MODEL: "m", SYSTEM_PROMPT: text } }),
        }),
        { OLLAMA_BASE_URL: base },
        deps,
      );
      assert.equal(bodies[0].messages[0].role, "system");
      assert.equal(bodies[0].messages[0].content, text);
    } finally {
      server.close();
    }
  });
});
