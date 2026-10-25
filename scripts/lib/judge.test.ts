/** The judge: what it is asked, what it records, and how it resumes. A local server stands in for OpenRouter. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import OpenAI from "openai";

import type { TurnRecord } from "../../shared/contract.ts";
import type { TrialRow } from "../../shared/trials.ts";
import { V0 } from "../../shared/surface.generated.ts";
import { answered, judgeMessage, parseJudgeReply, plannedJobs, readJudged, runJudge, type JudgeSettings } from "./judge.ts";

const SETTINGS: JudgeSettings = { model: "anthropic/claude-sonnet-5.5", reasoningEffort: "low", maxTokens: 2048, promptFile: "judge/judge.txt", promptSha256: "a".repeat(64) };

const turn = (id: string, role: "source" | "followup", turnIndex: number, u: string, extra: Partial<TurnRecord> = {}): TurnRecord =>
  ({ id, role, turnIndex, u, ok: true, rejected: [], vBefore: { ...V0 }, vAfter: { ...V0 }, ...extra }) as TurnRecord;
const trial = (status: TrialRow["status"], turnIds: string[], conditionId = "c"): TrialRow =>
  ({ runId: "r", conditionId, caseId: "CA-1", trial: 1, status, turnIds }) as TrialRow;

test("the judge sees the earlier requests of the same trace and the filters before and after", () => {
  const msg = judgeMessage(
    turn("b", "source", 1, "sort by name", { vBefore: { ...V0, category: "electronics" }, vAfter: { ...V0, category: "electronics", sort: "name_asc" } }),
    [turn("a", "source", 0, "show electronics items")],
  );
  assert.match(msg, /1\. "show electronics items"/);
  assert.match(msg, /Latest request: "sort by name"/);
  assert.match(msg, /before the latest request: category: electronics, maxPrice: 500 \(no limit\), minRating: none, inStockOnly: false, sort: none/);
  assert.match(msg, /after the latest request: .*sort: name_asc/);
  assert.doesNotMatch(msg, /clearFilters/);
  assert.match(judgeMessage(turn("a", "source", 0, "x", { ok: false }), []), /no usable reply/);
});

test("replies are read leniently, and anything without a pass or fail verdict is unreadable", () => {
  assert.deepEqual(parseJudgeReply('{"verdict": "fail", "reason": "dropped the price"}'), { verdict: "fail", reason: "dropped the price" });
  assert.deepEqual(parseJudgeReply('```json\n{"verdict":"pass","reason":"ok"}\n```'), { verdict: "pass", reason: "ok" });
  assert.equal(parseJudgeReply('{"verdict": "maybe"}'), null);
  assert.equal(parseJudgeReply("I think it passes."), null);
});

test("jobs: every turn of each non-infra trial of the chosen configurations, minus those already answered", () => {
  const turns = new Map([
    ["s0", turn("s0", "source", 0, "A")], ["s1", turn("s1", "source", 1, "B")],
    ["f0", turn("f0", "followup", 2, "B")], ["f1", turn("f1", "followup", 3, "A")],
    ["x0", turn("x0", "source", 0, "X")],
  ]);
  const trials = [trial("fail", ["s0", "s1", "f0", "f1"]), trial("infra", ["x0"]), trial("pass", ["x0"], "other")];
  const { jobs } = plannedJobs(trials, turns, new Set(["c"]), new Set(["s0"]));
  assert.deepEqual(jobs.map((j) => j.turn.id), ["s1", "f0", "f1"]);
  assert.deepEqual(jobs.find((j) => j.turn.id === "f1")!.earlier.map((t) => t.id), ["f0"], "earlier turns come from the same trace only");
});

async function body(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

test("each call states the model, reasoning, token cap and prompt; each row records the judge's P and resumes", async () => {
  const sent: Array<Record<string, unknown>> = [];
  const replies = ['{"verdict":"fail","reason":"lost the category"}', "no idea"];
  const server = createServer(async (req, res) => {
    sent.push(JSON.parse(await body(req)));
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({
      id: "x", object: "chat.completion", created: 0, model: "anthropic/claude-sonnet-5.5",
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: replies[sent.length - 1] } }],
      usage: { prompt_tokens: 400, completion_tokens: 50, total_tokens: 450, cost: 0.0013 },
    }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const dir = await mkdtemp(join(tmpdir(), "lngui-judge-"));
  try {
    const client = new OpenAI({ apiKey: "test", baseURL: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1` });
    const turns = new Map([["s0", turn("s0", "source", 0, "A")], ["s1", turn("s1", "source", 1, "B")]]);
    const out = join(dir, "judge.jsonl");
    const { jobs } = plannedJobs([trial("fail", ["s0", "s1"])], turns, null, new Set());
    await runJudge(client, SETTINGS, "SYSTEM", jobs, out, 1);

    assert.equal(sent[0].model, "anthropic/claude-sonnet-5.5");
    assert.deepEqual(sent[0].reasoning, { effort: "low" });
    assert.equal(sent[0].max_tokens, 2048);
    assert.equal("temperature" in sent[0], false);
    assert.equal((sent[0].messages as Array<{ content: string }>)[0].content, "SYSTEM");

    const judged = await readJudged(out, SETTINGS);
    assert.equal(judged.get("s0")!.verdict, "fail");
    assert.equal(judged.get("s0")!.usage!.costUsd, 0.0013);
    assert.equal(judged.get("s0")!.judge.resolvedModel, "anthropic/claude-sonnet-5.5");
    assert.equal(judged.get("s1")!.verdict, "invalid", "an unreadable reply is recorded, not guessed");
    assert.equal(plannedJobs([trial("fail", ["s0", "s1"])], turns, null, answered(judged)).jobs.length, 0, "a rerun asks nothing again");

    await assert.rejects(readJudged(out, { ...SETTINGS, reasoningEffort: "high" }), /different judge/, "never mixes two judges in one file");
    await writeFile(out, (await readFile(out, "utf8")) + JSON.stringify({ ...judged.get("s1")!, verdict: "error" }) + "\n");
    assert.deepEqual([...answered(await readJudged(out, SETTINGS))], ["s0"], "a failed call is asked again");
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});
