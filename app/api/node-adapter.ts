/**
 * Converts a Node HTTP request into a Fetch Request for the shared router.
 *
 * Used by server.ts (Express) and by the parity test, so the test exercises
 * the exact adapter the dev server runs. Every request header is forwarded
 * except hop-by-hop ones: the router depends on x-lngui-langfuse, and an
 * adapter that dropped it would run a request under a P the caller did not ask for.
 */
import type { IncomingHttpHeaders } from "node:http";

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-connection",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
]);

export function forwardHeaders(incoming: IncomingHttpHeaders): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(incoming)) {
    if (value === undefined || HOP_BY_HOP.has(key.toLowerCase())) continue;
    headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }
  return headers;
}

export function toFetchRequest(
  url: string,
  method: string,
  incoming: IncomingHttpHeaders,
  body: string | undefined,
): Request {
  const headers = forwardHeaders(incoming);
  if (body !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json");
  // A Fetch Request throws if a GET or HEAD carries a body.
  const hasBody = method !== "GET" && method !== "HEAD" && body !== undefined;
  return new Request(url, { method, headers, ...(hasBody ? { body } : {}) });
}
