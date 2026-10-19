/**
 * The sweep engine end to end, in LOCAL_TEST_MODE: no network to a provider,
 * no LLM spend. Checks the plumbing, not a mediator.
 *
 * The parity test is the guard against the two front ends drifting apart. It
 * runs one test set through the in-process transport (the CLI) and through real
 * HTTP with the global fetch (the browser's path), and requires identical
 * outcomes trial by trial.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { handleApiRequest } from "../../api/router.ts";
import { toFetchRequest } from "../../api/node-adapter.ts";
import { generateCandidates, selectCases } from "../../shared/generate.ts";
import { sameOutcome, trialKey } from "../../shared/trials.ts";
import { promptHash } from "../../shared/prompt-text.ts";
import { memorySink, openCondition, runSweep, type Condition, type Transport } from "../../src/utils/sweep.ts";
import { inProcessTransport } from "./inprocess.ts";
import { fileSink, readTrials } from "./sweep.ts";

const { cases } = selectCases(generateCandidates().candidates, { seed: 1, groups: 2, perGroup: 1 });
const LOCAL: Condition = { id: "local", env: { LOCAL_TEST_MODE: "true" } };

test("the engine runs every case N times and resumes without repeating work", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lngui-sweep-"));
  try {
    const rt = await openCondition(LOCAL, inProcessTransport());
    assert.equal(rt.config.mode, "local-test");
    const trialsPath = join(dir, "trials.jsonl");
    const turnsPath = join(dir, "turns.jsonl");
    const common = { runId: "test", cases, conditions: [rt], seed: 1, concurrency: 2, maxInfraRetries: 0 };

    const first = await runSweep({ ...common, n: 2, sink: fileSink(trialsPath, turnsPath) });
    assert.equal(first.length, cases.length * 2);
    assert.ok(first.every((r) => r.status !== "infra"), first.map((r) => r.reason).join());

    const turns = (await readFile(turnsPath, "utf8")).trim().split("\n").map((l) => JSON.parse(l));
    const expectedTurns = cases.reduce((s, c) => s + c.sourceTrace.length + c.followupTrace.length, 0) * 2;
    assert.equal(turns.length, expectedTurns);

    const done = new Set((await readTrials(trialsPath)).map(trialKey));
    const second = await runSweep({ ...common, n: 3, done, sink: fileSink(trialsPath, turnsPath) });
    assert.equal(second.length, cases.length);
    assert.ok(second.every((r) => r.trial === 3));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

async function body(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

test("parity: in-process and HTTP transports give identical trial outcomes", async () => {
  // The same request adapter server.ts uses for the dev server.
  const server = createServer(async (req, res) => {
    const text = req.method === "GET" ? undefined : await body(req);
    const response = await handleApiRequest(
      toFetchRequest(`http://127.0.0.1${req.url}`, req.method ?? "GET", req.headers, text),
      {},
      { store: null, waitUntil: () => {} },
    );
    res.statusCode = response?.status ?? 404;
    res.setHeader("content-type", "application/json");
    res.end(response ? await response.text() : "{}");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;

  try {
    // The browser's path: the global fetch over HTTP.
    const http: Transport = { fetchImpl: (input, init) => fetch(`http://127.0.0.1:${port}${input}`, init) };
    const run = async (transport: Transport) => {
      const sink = memorySink();
      const rt = await openCondition(LOCAL, transport);
      await runSweep({ runId: "parity", cases, conditions: [rt], n: 2, seed: 7, concurrency: 3, maxInfraRetries: 0, sink });
      return { rt, rows: sink.rows };
    };
    const a = await run(inProcessTransport());
    const b = await run(http);

    assert.deepEqual(a.rt.P, b.rt.P, "both transports resolve the same P");
    // Guards the adapter: a non-default override must survive the HTTP hop.
    const ext: Condition = { id: "ext", env: { LOCAL_TEST_MODE: "true", SYSTEM_PROMPT: "A different prompt.\n≥ 4", HISTORY_POLICY: "none" } };
    const viaHttp = await openCondition(ext, http);
    assert.equal(viaHttp.P.systemPromptHash, promptHash("A different prompt.\n≥ 4"));
    assert.equal(viaHttp.P.historyPolicy, "none");
    assert.equal(a.rows.length, b.rows.length);
    const byKey = new Map(b.rows.map((r) => [trialKey(r), r]));
    for (const r of a.rows) {
      const other = byKey.get(trialKey(r));
      assert.ok(other, `missing ${trialKey(r)} over HTTP`);
      assert.ok(sameOutcome(r, other!), `outcome differs for ${trialKey(r)}`);
    }
  } finally {
    server.close();
  }
});
