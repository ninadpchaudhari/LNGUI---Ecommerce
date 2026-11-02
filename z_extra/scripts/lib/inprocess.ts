/**
 * A transport that calls the API handler in-process, so a sweep needs no
 * server. Conditions still reach P through request overrides, exactly as
 * they do from the browser.
 *
 * Keys the overrides do not set fall back to process.env (api/config.ts), so
 * the API key comes from .env.
 */
import { handleApiRequest } from "../../api/router.ts";
import type { FetchLike } from "../../src/utils/api.ts";
import type { Transport } from "../../src/utils/sweep.ts";

const ORIGIN = "http://sweep.local";

export function inProcessTransport(headers: Record<string, string> = {}): Transport {
  const pending: Promise<unknown>[] = [];
  const deps = {
    store: null,
    waitUntil: (p: Promise<unknown>) => {
      pending.push(p.catch(() => {}));
    },
  };
  const fetchImpl: FetchLike = async (input, init) => {
    const response = await handleApiRequest(new Request(new URL(input, ORIGIN), init), {}, deps);
    return response ?? new Response(JSON.stringify({ error: "Not Found" }), { status: 404 });
  };
  return {
    fetchImpl,
    headers,
    drain: async () => {
      await Promise.allSettled(pending.splice(0));
    },
  };
}
