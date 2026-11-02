/**
 * Reasoning effort on the wire: sent to OpenRouter and Ollama as
 * reasoning.effort and recorded in P; not sent to direct OpenAI, and recorded
 * there as null. A
 * local server stands in for the provider and captures the request body.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";

import { handleApiRequest } from "./router.ts";
import type { CommandMeta } from "../shared/contract.ts";

async function body(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function withFakeProvider(fn: (baseURL: string, sent: Record<string, unknown>[]) => Promise<void>) {
  const sent: Record<string, unknown>[] = [];
  const server = createServer(async (req, res) => {
    sent.push(JSON.parse(await body(req)));
    const command = { filters: { category: "books", maxPrice: null, minRating: null, inStockOnly: null }, sort: null, explanation: "books" };
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({
      id: "fake", object: "chat.completion", created: 0, model: "fake",
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify(command) } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, sent);
  } finally {
    server.close();
  }
}

async function command(env: Record<string, string>): Promise<CommandMeta> {
  const res = await handleApiRequest(
    new Request("http://local/api/command", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: "show books", history: [] }) }),
    env,
    { store: null, waitUntil: () => {} },
  );
  assert.ok(res);
  return ((await res.json()) as { meta: CommandMeta }).meta;
}

test("OpenRouter receives reasoning.effort, and P records it", async () => {
  await withFakeProvider(async (baseURL, sent) => {
    const meta = await command({
      LLM_PROVIDER: "openrouter", OPEN_ROUTER_API_KEY: "test", OPENROUTER_BASE_URL: baseURL,
      LLM_MODEL: "openai/gpt-5-nano", LLM_REASONING_EFFORT: "minimal", LNGUI_COMMAND_MODE: "full",
    });
    assert.deepEqual(sent[0].reasoning, { effort: "minimal" });
    assert.equal(meta.P.reasoningEffort, "minimal");
  });
});

test("without the setting nothing is sent, and P records null", async () => {
  await withFakeProvider(async (baseURL, sent) => {
    const meta = await command({ LLM_PROVIDER: "openrouter", OPEN_ROUTER_API_KEY: "test", OPENROUTER_BASE_URL: baseURL, LLM_MODEL: "openai/gpt-4o-mini", LNGUI_COMMAND_MODE: "full" });
    assert.equal("reasoning" in sent[0], false);
    assert.equal(meta.P.reasoningEffort, null);
  });
});

test("Ollama receives reasoning.effort too, and P records it", async () => {
  await withFakeProvider(async (baseURL, sent) => {
    const meta = await command({ LLM_PROVIDER: "ollama", OLLAMA_BASE_URL: baseURL, LLM_MODEL: "qwen3.5:4b", LLM_REASONING_EFFORT: "none", LNGUI_COMMAND_MODE: "full" });
    assert.deepEqual(sent[0].reasoning, { effort: "none" });
    assert.equal(meta.P.reasoningEffort, "none");
  });
});

test("direct OpenAI never receives it, and P says so", async () => {
  await withFakeProvider(async (baseURL, sent) => {
    const meta = await command({ LLM_PROVIDER: "openai", OPENAI_API_KEY: "test", OPENAI_BASE_URL: baseURL, LLM_MODEL: "gpt-4o-mini", LLM_REASONING_EFFORT: "none", LNGUI_COMMAND_MODE: "full" });
    assert.equal("reasoning" in sent[0], false);
    assert.equal(meta.P.reasoningEffort, null);
  });
});
