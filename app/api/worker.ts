/**
 * Cloudflare Worker entrypoint.
 *
 * Serves both the API and the built SPA. `run_worker_first: ["/api/*"]` sends
 * API paths here; everything else is served from the assets binding, with the
 * ASSETS fallback below as a safety net if that routing ever changes.
 */
import type { AssetsLike, D1Like, ExecutionContextLike } from "./cf.ts";
import type { CommandRuntimeEnv } from "./config.ts";
import { handleApiRequest } from "./router.ts";
import { createD1TurnStore } from "./store-d1.ts";

export interface Env extends CommandRuntimeEnv {
  ASSETS: AssetsLike;
  /** Absent until `wrangler d1 create` has been run and bound. */
  DB?: D1Like;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContextLike): Promise<Response> {
    const store = env.DB ? createD1TurnStore(env.DB) : null;

    const response = await handleApiRequest(request, env, {
      store,
      // Background work must not be able to fail the request: a Langfuse
      // outage should cost a trace, not a response.
      waitUntil: (p) => ctx.waitUntil(p.catch(() => {})),
    });

    return response ?? env.ASSETS.fetch(request);
  },
};
