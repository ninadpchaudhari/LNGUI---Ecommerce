/**
 * One conversation kept on the dev server, so a script (../harness/shop.py) can use the app the way the page does.
 *
 * The page keeps σ = ⟨V, H, P, D⟩ in the browser and runs every sentence through runTurn (src/utils/mediator.ts):
 * M behind POST /api/command, then Apply and A (shared/transition.ts). These routes run the same code, with σ held
 * here instead of in a browser tab:
 *
 *     POST /api/session/reset         σ0: V0, an empty history; returns V and D
 *     POST /api/session/say {u}       one turn through runTurn; returns V, D, and the error if the turn failed
 *     GET  /api/session/state         V and D
 *
 * The model settings are the server's environment (server.ts loads them; see ../configs/). Only server.ts mounts these
 * routes; the deployed Worker does not have them.
 */
import type { PromptConfig, SystemState } from "../shared/contract.ts";
import { LANGFUSE_HEADER } from "../shared/overrides.ts";
import { resetState } from "../shared/transition.ts";
import { runTurn } from "../src/utils/mediator.ts";
import type { FetchLike } from "../src/utils/api.ts";
import { handleApiRequest } from "./router.ts";
import type { RuntimeEnv } from "./config.ts";

/** P before the first turn reports the real one; P is provenance and never part of a verdict. */
const NO_P: PromptConfig = {
  requestedModel: "",
  resolvedModel: null,
  temperature: null,
  topP: null,
  systemPromptHash: "",
  commandSchemaHash: "",
  historyPolicy: "full",
  historyMaxTurns: null,
};

let state: SystemState = resetState(NO_P);
let sessionId = crypto.randomUUID();

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function observed() {
  return { V: state.V, D: state.D.productIds };
}

/** Handles /api/session/*; null for any other path. */
export async function handleSessionRequest(request: Request, env: RuntimeEnv): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (!path.startsWith("/api/session/")) return null;

  if (path === "/api/session/state" && request.method === "GET") return json(observed());

  if (path === "/api/session/reset" && request.method === "POST") {
    state = resetState(NO_P);
    sessionId = crypto.randomUUID();
    return json(observed());
  }

  if (path === "/api/session/say" && request.method === "POST") {
    const { u } = (await request.json()) as { u?: unknown };
    if (typeof u !== "string" || u.trim() === "") return json({ error: "say needs {u: <sentence>}" }, 400);

    // POST /api/command, answered in this process rather than over the network: the same router, the same env.
    const fetchImpl: FetchLike = async (input, init) =>
      (await handleApiRequest(new Request(new URL(input, request.url), init), env, { store: null, waitUntil: () => {} })) ??
      json({ error: "Not Found" }, 404);

    const turn = await runTurn(state, u, {
      sessionId,
      turnIndex: state.H.length,
      fetchImpl,
      headers: { [LANGFUSE_HEADER]: "off" },
    });
    state = turn.state;
    return json({
      ...observed(),
      q: turn.record.q,
      // A failed turn: what went wrong, and the server's error code (null when the request never got an answer).
      error: turn.record.ok ? null : turn.record.error,
      code: turn.record.ok ? null : (turn.record.meta?.error?.code ?? null),
    });
  }

  return json({ error: `no route ${request.method} ${path}` }, 404);
}
